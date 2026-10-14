// Blind LLM judge. For each prompt, the variant images are shown unlabeled
// (as "Image 1..N") and scored 1-10 on three criteria. Each prompt is judged
// in two orders (forward and reversed) and the scores are averaged, to cancel
// out position bias.
//
//   node judge.mjs            judge every prompt that has all variant images
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { VARIANTS, callClaude, createLimiter, parseJSON } from "./lib.mjs";

const RESULTS = new URL(`./${process.env.BENCH_OUT || "results"}/`, import.meta.url);
const JUDGE_MODEL = process.env.JUDGE_MODEL || "opus";
const JUDGE_EFFORT = process.env.JUDGE_EFFORT || "medium";
const CRITERIA = ["fidelity", "coherence", "craft"];

const SYSTEM = `You are a strict art director judging images an AI drew with HTML Canvas code from a text request.
Score every image from 1 to 10 on each criterion, using the full range and comparing the images against each other:
- fidelity: does it clearly depict what the request asks for, with nothing important missing?
- coherence: do the parts fit together as one picture: correct placement and overlap, consistent perspective, scale and lighting, no stray, floating, misaligned or covered-up pieces?
- craft: overall visual quality: shading, color harmony, detail, polish.
Reply with only JSON, no prose and no code fences:
{"images":[{"image":1,"fidelity":0,"coherence":0,"craft":0,"note":"short reason"}],"best":1}`;

const variants = Object.keys(VARIANTS);
const limit = createLimiter(4);
const prompts = readdirSync(RESULTS).filter(id => variants.every(v => existsSync(new URL(`${id}/${v}.png`, RESULTS))));

await Promise.all(prompts.map(id => limit(async () => {
    const out = new URL(`${id}/judge.json`, RESULTS);
    if (existsSync(out)) return console.log(`[${id}] already judged`);
    const { request } = JSON.parse(readFileSync(new URL(`${id}/plan.json`, RESULTS), "utf-8"));

    const passes = [];
    for (const order of [variants, [...variants].reverse()]) {
        const images = order.map(v => readFileSync(new URL(`${id}/${v}.png`, RESULTS)));
        const call = await callClaude({
            system: SYSTEM, images, model: JUDGE_MODEL, effort: JUDGE_EFFORT,
            prompt: `Request: "${request}"\nThe ${images.length} attached images are Image 1 to Image ${images.length}, in order.`,
        });
        const verdict = parseJSON(call.text);
        passes.push({
            order,
            best: order[verdict.best - 1],
            scores: Object.fromEntries(verdict.images.map(s => [order[s.image - 1],
                { ...Object.fromEntries(CRITERIA.map(c => [c, s[c]])), note: s.note }])),
        });
    }

    const scores = Object.fromEntries(variants.map(v => {
        const avg = Object.fromEntries(CRITERIA.map(c => [c, mean(passes.map(p => p.scores[v][c]))]));
        avg.overall = mean(CRITERIA.map(c => avg[c]));
        return [v, avg];
    }));
    writeFileSync(out, JSON.stringify({ request, judge: `${JUDGE_MODEL}/${JUDGE_EFFORT}`, scores, passes }, null, 2));
    console.log(`[${id}] ` + variants.map(v => `${v} ${scores[v].overall.toFixed(1)}`).join(", "));
})));

function mean(xs) {
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}
