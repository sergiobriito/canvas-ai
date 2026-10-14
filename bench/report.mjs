// Aggregates results/*/{variant}.json and judge.json into summary.json and a
// markdown table (printed and saved as summary.md).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { VARIANTS } from "./lib.mjs";

const RESULTS = new URL(`./${process.env.BENCH_OUT || "results"}/`, import.meta.url);
const variants = Object.keys(VARIANTS);
const read = path => JSON.parse(readFileSync(new URL(path, RESULTS), "utf-8"));

const rows = [];
for (const id of readdirSync(RESULTS).filter(id => existsSync(new URL(`${id}/plan.json`, RESULTS)))) {
    const plan = read(`${id}/plan.json`);
    const judge = existsSync(new URL(`${id}/judge.json`, RESULTS)) ? read(`${id}/judge.json`) : null;
    for (const v of variants) {
        if (!existsSync(new URL(`${id}/${v}.json`, RESULTS))) continue;
        const r = read(`${id}/${v}.json`);
        rows.push({
            prompt: id, variant: v, parts: plan.plan.parts.length,
            calls: r.usage.calls, input: r.usage.totalInput, output: r.usage.output,
            costUsd: r.usage.costUsd, wallSeconds: r.wallSeconds, failed: r.failed.length,
            ...(judge ? judge.scores[v] : {}),
        });
    }
}

const totals = variants.map(v => {
    const rs = rows.filter(r => r.variant === v);
    const sum = k => rs.reduce((a, r) => a + (r[k] ?? 0), 0);
    const avg = k => rs.filter(r => r[k] != null).length ? sum(k) / rs.filter(r => r[k] != null).length : null;
    return {
        variant: v, prompts: rs.length, calls: sum("calls"), input: sum("input"), output: sum("output"),
        costUsd: sum("costUsd"), wallSeconds: sum("wallSeconds"), failed: sum("failed"),
        fidelity: avg("fidelity"), coherence: avg("coherence"), craft: avg("craft"), overall: avg("overall"),
    };
});

const base = totals.find(t => t.variant === "text");
const pct = (x, b) => b ? `${x >= b ? "+" : ""}${(((x - b) / b) * 100).toFixed(0)}%` : "";
const f1 = x => x == null ? "-" : x.toFixed(1);

const lines = [
    "| Variant | Calls | Input tok | Output tok | Cost (API-equiv) | Wall time | Failed parts | Fidelity | Coherence | Craft | Overall |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...totals.map(t => `| ${t.variant} | ${t.calls} | ${t.input.toLocaleString("en")} (${pct(t.input, base.input)}) | ` +
        `${t.output.toLocaleString("en")} (${pct(t.output, base.output)}) | $${t.costUsd.toFixed(2)} (${pct(t.costUsd, base.costUsd)}) | ` +
        `${Math.round(t.wallSeconds)}s | ${t.failed} | ${f1(t.fidelity)} | ${f1(t.coherence)} | ${f1(t.craft)} | ${f1(t.overall)} |`),
    "",
    "| Prompt | Variant | Parts | Input tok | Output tok | Wall | Overall |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${r.prompt} | ${r.variant} | ${r.parts} | ${r.input} | ${r.output} | ${Math.round(r.wallSeconds)}s | ${f1(r.overall)} |`),
];

writeFileSync(new URL("summary.json", RESULTS), JSON.stringify({ totals, rows }, null, 2));
writeFileSync(new URL("summary.md", RESULTS), lines.join("\n") + "\n");
console.log(lines.join("\n"));
