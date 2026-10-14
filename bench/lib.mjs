// Shared pieces for the benchmark: the Claude Code call, the plan step and the
// draw loop. The plan/draw logic mirrors src/agent.js so the "text" variant is
// the same agent the app runs; the screenshot variants only change the state
// each draw call receives.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = new URL("../src/", import.meta.url);
export const SYSTEM_PROMPTS = {
    plan: readFileSync(new URL("prompts/plan.md", ROOT), "utf-8"),
    draw: readFileSync(new URL("prompts/draw.md", ROOT), "utf-8"),
};

export const WIDTH = 800;
export const HEIGHT = 600;
export const MODEL = process.env.BENCH_MODEL || "opus";
export const EFFORT = process.env.BENCH_EFFORT || "high";
const MAX_PARTS = 12;
const TIMEOUT_MS = 300_000;
const WORK_DIR = mkdtempSync(join(tmpdir(), "canvas-bench-"));
const CLAUDE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ANTHROPIC_API_KEY"));

// One `claude -p` call. Images (PNG buffers) go in as real image content
// blocks, which is why the message is sent as stream-json.
export function callClaude({ system, prompt, image, images = image ? [image] : [], model = MODEL, effort = EFFORT }) {
    const content = images.map(png => ({ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } }));
    content.push({ type: "text", text: prompt });
    const message = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";

    const args = [
        "-p", "--model", model, "--effort", effort,
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--tools", "", "--strict-mcp-config", "--no-session-persistence",
        "--system-prompt", system,
    ];

    return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(process.env.CLAUDE_BIN || "claude", args, { cwd: WORK_DIR, env: CLAUDE_ENV });
        let stdout = "", stderr = "";
        const timer = setTimeout(() => { child.kill(); reject(new Error("claude timed out")); }, TIMEOUT_MS);
        child.stdout.on("data", d => stdout += d);
        child.stderr.on("data", d => stderr += d);
        child.on("error", reject);
        child.on("close", code => {
            clearTimeout(timer);
            const result = stdout.split("\n").filter(Boolean).map(safeJSON).find(d => d?.type === "result");
            if (!result) return reject(new Error(stderr.trim() || `claude exited with code ${code}`));
            if (result.is_error) return reject(new Error(result.result || "Claude Code returned an error."));
            const u = result.usage || {};
            resolve({
                text: result.result || "",
                seconds: (Date.now() - started) / 1000,
                usage: {
                    input: u.input_tokens || 0,
                    cacheWrite: u.cache_creation_input_tokens || 0,
                    cacheRead: u.cache_read_input_tokens || 0,
                    output: u.output_tokens || 0,
                },
                costUsd: result.total_cost_usd ?? null,
            });
        });
        child.stdin.end(message);
    });
}

export async function makePlan(request) {
    const call = await callClaude({ system: SYSTEM_PROMPTS.plan, prompt: `Request: ${request}\nCanvas: ${WIDTH}x${HEIGHT}` });
    const plan = parseJSON(call.text);
    if (!Array.isArray(plan.parts) || plan.parts.length === 0) throw new Error("The plan has no parts.");
    plan.parts = plan.parts.slice(0, MAX_PARTS);
    return { plan, call };
}

// Variants:
//   text        - current app: parts requested in parallel, state = other parts' names + boxes
//   shot-full   - sequential, state = text above + 800x600 screenshot of the canvas so far
//   shot-half   - sequential, state = text above + 400x300 screenshot (old build3 used 0.5 scale)
export const VARIANTS = {
    text: { parallel: 3, screenshotScale: 0 },
    "shot-half": { parallel: 1, screenshotScale: 0.5 },
    "shot-full": { parallel: 1, screenshotScale: 1 },
};

export async function drawWithVariant(request, plan, variantName) {
    const variant = VARIANTS[variantName];
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = plan.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const calls = [];
    const failed = [];
    const started = Date.now();

    const writeCode = async part => {
        let prompt = basePrompt(request, plan, part);
        let image;
        if (variant.screenshotScale) {
            image = screenshot(canvas, variant.screenshotScale);
            prompt = `Canvas so far (attached image, ${Math.round(variant.screenshotScale * 100)}% scale): ` +
                `the background and every part listed before yours are already drawn. ` +
                `Match their actual positions, colors and lighting so your part fits.\n${prompt}`;
        }
        const first = await callClaude({ system: SYSTEM_PROMPTS.draw, prompt, image });
        calls.push({ part: part.name, ...first, text: undefined });
        let code = stripFences(first.text);
        try {
            new Function("ctx", code);
        } catch (error) {
            const retry = await callClaude({ system: SYSTEM_PROMPTS.draw, image,
                prompt: `${prompt}\nYour previous code failed with: ${error.message}. Return corrected code.` });
            calls.push({ part: `${part.name} (retry)`, ...retry, text: undefined });
            code = stripFences(retry.text);
        }
        return code;
    };

    const draw = (part, code) => {
        ctx.save();
        try {
            new Function("ctx", code)(ctx);
        } catch (error) {
            failed.push({ part: part.name, error: String(error.message || error) });
        } finally {
            ctx.restore();
        }
    };

    if (variant.parallel > 1) {
        const limit = createLimiter(variant.parallel);
        const pending = plan.parts.map(part => limit(() => writeCode(part)));
        for (const [i, part] of plan.parts.entries()) {
            try { draw(part, await pending[i]); }
            catch (error) { failed.push({ part: part.name, error: String(error.message || error) }); }
        }
    } else {
        // Sequential: each call sees the canvas with every earlier part drawn.
        for (const part of plan.parts) {
            try { draw(part, await writeCode(part)); }
            catch (error) { failed.push({ part: part.name, error: String(error.message || error) }); }
        }
    }

    return { png: canvas.toBuffer("image/png"), calls, failed, wallSeconds: (Date.now() - started) / 1000 };
}

function basePrompt(request, plan, part) {
    const neighbours = plan.parts.filter(o => o !== part).map(o => `${o.name} [${o.box}]`).join("; ");
    return [
        `Picture: ${request}`,
        `Canvas: ${WIDTH}x${HEIGHT}, light: ${plan.light}, palette: ${plan.palette}`,
        `Other parts: ${neighbours || "none"}`,
        `Draw "${part.name}" in box [${part.box}]: ${part.desc}`,
    ].join("\n");
}

function screenshot(canvas, scale) {
    if (scale === 1) return canvas.toBuffer("image/png");
    const small = createCanvas(Math.round(WIDTH * scale), Math.round(HEIGHT * scale));
    small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    return small.toBuffer("image/png");
}

export function stripFences(text) {
    const match = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
    return (match ? match[1] : text).trim();
}

export function parseJSON(text) {
    const cleaned = stripFences(text);
    return JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1));
}

function safeJSON(line) {
    try { return JSON.parse(line); } catch { return null; }
}

export function createLimiter(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || queue.length === 0) return;
        active++;
        const { task, resolve, reject } = queue.shift();
        task().then(resolve, reject).finally(() => { active--; next(); });
    };
    return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}

export function sumUsage(calls) {
    const total = { calls: calls.length, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, costUsd: 0 };
    for (const c of calls) {
        for (const k of ["input", "cacheWrite", "cacheRead", "output"]) total[k] += c.usage[k];
        total.costUsd += c.costUsd || 0;
    }
    total.totalInput = total.input + total.cacheWrite + total.cacheRead;
    return total;
}
