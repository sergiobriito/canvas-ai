// Runs every prompt through every variant and saves images + token usage.
// The plan is made once per prompt and shared, so the only difference between
// variants is the state each draw call gets. Finished runs are skipped, so the
// script can be re-run after an interruption.
//
//   node run.mjs                       all prompts, all variants
//   node run.mjs --only cube,bicycle   a subset of prompts
//   node run.mjs --variants text       a subset of variants
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VARIANTS, drawWithVariant, makePlan, sumUsage, MODEL, EFFORT } from "./lib.mjs";

export const PROMPTS = {
    cube: "Draw a blue circle inside a red cube",
    landscape: "Draw a landscape",
    bicycle: "Draw a red bicycle",
    cat: "Draw a cat sitting on a windowsill at night",
    lighthouse: "Draw a lighthouse on a rocky coast at sunset",
    fruit: "Draw a bowl of fruit on a wooden table",
};

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1].split(",") : null; };
const only = flag("--only") || Object.keys(PROMPTS);
const variants = flag("--variants") || Object.keys(VARIANTS);
const RESULTS = new URL(`./${process.env.BENCH_OUT || "results"}/`, import.meta.url);

console.log(`Model ${MODEL}, effort ${EFFORT}; prompts: ${only.join(", ")}; variants: ${variants.join(", ")}`);

await Promise.all(only.map(async id => {
    const dir = new URL(`${id}/`, RESULTS);
    mkdirSync(dir, { recursive: true });
    const planFile = new URL("plan.json", dir);

    let planRecord;
    if (existsSync(planFile)) {
        planRecord = JSON.parse(readFileSync(planFile, "utf-8"));
    } else {
        const { plan, call } = await makePlan(PROMPTS[id]);
        planRecord = { request: PROMPTS[id], plan, call: { ...call, text: undefined } };
        writeFileSync(planFile, JSON.stringify(planRecord, null, 2));
        console.log(`[${id}] plan: ${plan.parts.length} parts`);
    }

    // Variants of one prompt run concurrently; "text" is itself 3-way parallel.
    await Promise.all(variants.map(async name => {
        const resultFile = new URL(`${name}.json`, dir);
        if (existsSync(resultFile)) return console.log(`[${id}] ${name}: already done`);
        try {
            const run = await drawWithVariant(planRecord.request, planRecord.plan, name);
            writeFileSync(new URL(`${name}.png`, dir), run.png);
            const usage = sumUsage(run.calls);
            writeFileSync(resultFile, JSON.stringify({
                variant: name, model: MODEL, effort: EFFORT, usage,
                wallSeconds: run.wallSeconds, failed: run.failed, calls: run.calls,
            }, null, 2));
            console.log(`[${id}] ${name}: ${usage.calls} calls, in ${usage.totalInput}, out ${usage.output}, ` +
                `${run.wallSeconds.toFixed(0)}s, ${run.failed.length} failed`);
        } catch (error) {
            console.error(`[${id}] ${name} FAILED:`, error.message);
        }
    }));
}));
