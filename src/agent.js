const LLM_URL = "/api/llm";
const MAX_PARTS = 12;
const MAX_PARALLEL_CALLS = 3;

export class CanvasAgent {
    constructor(canvas, onStatus = () => {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.onStatus = onStatus;
    }

    async run(request) {
        const { width, height } = this.canvas;
        this.stats = { calls: 0, input: 0, cached: 0, output: 0 };
        const started = performance.now();

        log(`Agent started: "${request}"`);
        this.onStatus("Planning…");
        const plan = await this.plan(request);
        log(`Plan: ${plan.parts.length} parts`, plan.parts.map(({ name, box }) => ({ name, box: String(box) })));

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = plan.background;
        this.ctx.fillRect(0, 0, width, height);
        
        const limit = createLimiter(MAX_PARALLEL_CALLS);
        const pending = plan.parts.map(part => limit(() => this.writeCode(request, plan, part)));
        const failed = [];

        for (const [i, part] of plan.parts.entries()) {
            this.onStatus(`Drawing ${part.name} (${i + 1}/${plan.parts.length})…`);
            try {
                this.draw(await pending[i]);
                log(`Drawn ${part.name} (${i + 1}/${plan.parts.length})`);
            } catch (error) {
                console.warn(`[CanvasAgent] ${part.name} failed:`, error);
                failed.push(part.name);
            }
        }

        const { calls, input, cached, output } = this.stats;
        log(`Agent finished in ${seconds(started)}s: ${calls} calls, ` +
            `${input} input (+${cached} cached) and ${output} output tokens`);

        this.onStatus(failed.length
            ? `Done, but ${failed.length} part(s) failed: ${failed.join(", ")}`
            : "Done.");
    }

    async plan(request) {
        const { width, height } = this.canvas;
        const text = await this.callLLM("plan", "plan", `Request: ${request}\nCanvas: ${width}x${height}`);
        const plan = parseJSON(text);

        if (!Array.isArray(plan.parts) || plan.parts.length === 0) {
            throw new Error("The plan has no parts.");
        }

        plan.parts = plan.parts.slice(0, MAX_PARTS);
        return plan;
    }

    async writeCode(request, plan, part) {
        const { width, height } = this.canvas;
        const neighbours = plan.parts
            .filter(other => other !== part)
            .map(other => `${other.name} [${other.box}]`)
            .join("; ");

        const prompt = [
            `Picture: ${request}`,
            `Canvas: ${width}x${height}, light: ${plan.light}, palette: ${plan.palette}`,
            `Other parts: ${neighbours || "none"}`,
            `Draw "${part.name}" in box [${part.box}]: ${part.desc}`
        ].join("\n");

        const code = stripFences(await this.callLLM("draw", part.name, prompt));

        try {
            new Function("ctx", code);
            return code;
        } catch (error) {
            log(`${part.name}: syntax error, retrying`, error.message);
            return stripFences(await this.callLLM("draw", `${part.name} (retry)`,
                `${prompt}\nYour previous code failed with: ${error.message}. Return corrected code.`));
        }
    }

    draw(code) {
        this.ctx.save();
        try {
            new Function("ctx", code)(this.ctx);
        } finally {
            this.ctx.restore();
        }
    }

    async callLLM(task, label, prompt) {
        const started = performance.now();
        const response = await fetch(LLM_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task, prompt })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `LLM request failed (${response.status})`);
        }

        const { input = 0, cached = 0, output = 0 } = data.usage || {};
        this.stats.calls++;
        this.stats.input += input;
        this.stats.cached += cached;
        this.stats.output += output;

        console.groupCollapsed(`[CanvasAgent] ${task}: ${label} (${seconds(started)}s, ` +
            `in ${input} +${cached} cached, out ${output} tokens)`);
        console.log(`Prompt:\n${prompt}`);
        console.log(`Response:\n${data.text}`);
        console.groupEnd();

        return data.text;
    }
}

function log(message, details) {
    if (details === undefined) console.log(`[CanvasAgent] ${message}`);
    else console.log(`[CanvasAgent] ${message}`, details);
}

function seconds(since) {
    return ((performance.now() - since) / 1000).toFixed(1);
}

function stripFences(text) {
    const match = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
    return (match ? match[1] : text).trim();
}

function parseJSON(text) {
    const cleaned = stripFences(text);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    try {
        return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        console.log("[CanvasAgent] Raw LLM response:", text);
        throw new Error("The LLM returned invalid JSON.");
    }
}

function createLimiter(max) {
    let active = 0;
    const queue = [];

    const next = () => {
        if (active >= max || queue.length === 0) return;
        active++;
        const { task, resolve, reject } = queue.shift();
        task().then(resolve, reject).finally(() => {
            active--;
            next();
        });
    };

    return task => new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        next();
    });
}
