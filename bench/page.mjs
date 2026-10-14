// Builds results/report.html: a self-contained page with the summary table,
// a tokens-vs-quality chart and every image side by side. Narrative text comes
// from results/findings.html (hand-written after reading the numbers).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { VARIANTS } from "./lib.mjs";

const RESULTS = new URL(`./${process.env.BENCH_OUT || "results"}/`, import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, RESULTS), "utf-8"));
const { totals, rows } = read("summary.json");
const findings = existsSync(new URL("findings.html", RESULTS)) ? readFileSync(new URL("findings.html", RESULTS), "utf-8") : "";
const variants = Object.keys(VARIANTS);
const LABEL = { text: "Text state", "shot-half": "Screenshot 50%", "shot-full": "Screenshot 100%" };
const DESC = {
    text: "Current app. Parts drawn 3 at a time; each call sees the other parts' names and boxes.",
    "shot-half": "One part at a time; each call also gets a 400×300 image of the canvas so far.",
    "shot-full": "One part at a time; each call also gets an 800×600 image of the canvas so far.",
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = x => Math.round(x).toLocaleString("en");
const f1 = x => x == null ? "–" : x.toFixed(1);
const base = totals.find(t => t.variant === "text");
const delta = (x, b) => { const d = ((x - b) / b) * 100; return Math.abs(d) < 0.5 ? "baseline" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}%`; };

async function jpeg(path) {
    const img = await loadImage(readFileSync(new URL(path, RESULTS)));
    const c = createCanvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    return `data:image/jpeg;base64,${c.toBuffer("image/jpeg", 82).toString("base64")}`;
}

// Chart: x = input tokens per drawing, y = judge overall. One dot per prompt
// (small) and one per variant mean (large). Single axis pair, no dual scales.
function chart() {
    const W = 640, H = 340, L = 56, R = 24, T = 20, B = 48;
    const pts = rows.filter(r => r.overall != null);
    const xs = pts.map(r => r.input), ys = pts.map(r => r.overall);
    const x0 = Math.floor(Math.min(...xs) / 2000) * 2000, x1 = Math.ceil(Math.max(...xs) / 2000) * 2000;
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(10, Math.ceil(Math.max(...ys)) + 0);
    const sx = v => L + ((v - x0) / (x1 - x0)) * (W - L - R);
    const sy = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Input tokens per drawing versus judge score">`;
    for (let v = y0; v <= y1; v++) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${L - 10}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    for (let v = x0; v <= x1; v += 4000) svg += `<text class="tick" x="${sx(v)}" y="${H - B + 20}" text-anchor="middle">${(v / 1000).toFixed(0)}k</text>`;
    svg += `<text class="axis" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Input tokens per drawing (all calls, incl. cache)</text>`;
    svg += `<text class="axis" x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">Judge score (1–10)</text>`;
    for (const r of pts) svg += `<circle class="dot s-${r.variant}" cx="${sx(r.input)}" cy="${sy(r.overall)}" r="5"><title>${esc(`${LABEL[r.variant]} · ${r.prompt}: ${n(r.input)} input tokens, score ${f1(r.overall)}`)}</title></circle>`;
    for (const [i, t] of totals.entries()) {
        const avgIn = t.input / t.prompts;
        if (t.overall == null) continue;
        svg += `<circle class="mean s-${t.variant}" cx="${sx(avgIn)}" cy="${sy(t.overall)}" r="9"><title>${esc(`${LABEL[t.variant]} mean: ${n(avgIn)} input tokens, score ${f1(t.overall)}`)}</title></circle>`;
        svg += `<text class="dl" x="${sx(avgIn) + 14}" y="${sy(t.overall) + (i - 1) * 4 + 4}">${LABEL[t.variant]} ${f1(t.overall)}</text>`;
    }
    return svg + "</svg>";
}

const prompts = [...new Set(rows.map(r => r.prompt))];
const gallery = [];
for (const id of prompts) {
    const plan = read(`${id}/plan.json`);
    const judge = existsSync(new URL(`${id}/judge.json`, RESULTS)) ? read(`${id}/judge.json`) : null;
    const cells = [];
    for (const v of variants) {
        const r = rows.find(x => x.prompt === id && x.variant === v);
        if (!r) continue;
        const notes = judge ? judge.passes.map(p => p.scores[v]?.note).filter(Boolean) : [];
        cells.push(`<figure class="shot">
  <img src="${await jpeg(`${id}/${v}.png`)}" alt="${esc(`${plan.request}, ${LABEL[v]}`)}" width="800" height="600" loading="lazy">
  <figcaption>
    <div class="cap-head"><span class="key s-${v}"></span>${LABEL[v]}<b>${f1(r.overall)}</b></div>
    <div class="cap-meta">${n(r.input)} in · ${n(r.output)} out · ${Math.round(r.wallSeconds)}s${r.failed ? ` · <span class="warn">${r.failed} part failed</span>` : ""}</div>
    ${notes.length ? `<p class="note">${esc(notes[0])}</p>` : ""}
  </figcaption>
</figure>`);
    }
    gallery.push(`<section class="prompt" id="${id}">
  <h3>“${esc(plan.request)}”</h3>
  <p class="sub">${plan.plan.parts.length} parts in the shared plan: ${plan.plan.parts.map(p => `<code>${esc(p.name)}</code>`).join(" ")}</p>
  <div class="trio">${cells.join("")}</div>
</section>`);
}

const table = `<div class="tablewrap"><table>
<thead><tr><th>Variant</th><th>Input tokens</th><th>Output tokens</th><th>API-equiv. cost</th><th>Fidelity</th><th>Coherence</th><th>Craft</th><th>Overall</th></tr></thead>
<tbody>${totals.map(t => `<tr>
<th scope="row"><span class="key s-${t.variant}"></span>${LABEL[t.variant]}<small>${DESC[t.variant]}</small></th>
<td>${n(t.input)}<small>${delta(t.input, base.input)}</small></td>
<td>${n(t.output)}<small>${delta(t.output, base.output)}</small></td>
<td>$${t.costUsd.toFixed(2)}<small>${delta(t.costUsd, base.costUsd)}</small></td>
<td>${f1(t.fidelity)}</td><td>${f1(t.coherence)}</td><td>${f1(t.craft)}</td><td class="strong">${f1(t.overall)}</td>
</tr>`).join("")}</tbody></table></div>`;

const html = `<title>Canvas State Benchmark</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column for the argument, widening to a 3-up contact sheet for the images. */
:root {
  --bg: #f6f7f9; --panel: #ffffff; --ink: #14171c; --ink-2: #4b525d; --ink-3: #7a828e; --rule: #dde1e7;
  --accent: #2a78d6; --warn: #b4441c;
  --s-text: #2a78d6; --s-half: #eb6834; --s-full: #1baf7a;
  --display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;
  --body: "Instrument Sans", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #121417; --panel: #1b1e23; --ink: #eef0f3; --ink-2: #b6bcc6; --ink-3: #8a919c; --rule: #2c3138;
  --accent: #3987e5; --warn: #ee8a5e; --s-text: #3987e5; --s-half: #d95926; --s-full: #199e70; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #121417; --panel: #1b1e23; --ink: #eef0f3; --ink-2: #b6bcc6; --ink-3: #8a919c; --rule: #2c3138;
  --accent: #3987e5; --warn: #ee8a5e; --s-text: #3987e5; --s-half: #d95926; --s-full: #199e70; color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font: 400 16px/1.6 var(--body); }
.wrap { max-width: 1180px; margin: 0 auto; padding: 48px 20px 80px; display: grid; gap: 56px; }
.col { max-width: 720px; display: grid; gap: 16px; min-width: 0; }
.eyebrow { font: 500 12px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
h1 { font: 700 clamp(32px, 5vw, 48px)/1.05 var(--display); letter-spacing: -.02em; margin: 0; text-wrap: balance; }
h2 { font: 600 26px/1.2 var(--display); margin: 0; text-wrap: balance; }
h3 { font: 600 20px/1.3 var(--display); margin: 0; text-wrap: balance; }
p { margin: 0; color: var(--ink-2); }
.lede { font-size: 19px; color: var(--ink); }
ul { margin: 0; padding-left: 20px; color: var(--ink-2); display: grid; gap: 6px; }
strong { color: var(--ink); font-weight: 600; }
code { font: 400 .86em var(--mono); background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px; }
.tablewrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: 8px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; min-width: 860px; font-variant-numeric: tabular-nums; }
th, td { padding: 14px 16px; text-align: right; border-bottom: 1px solid var(--rule); vertical-align: top; font-size: 15px; }
thead th { font: 500 12px var(--mono); letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); }
tbody tr:last-child > * { border-bottom: 0; }
th[scope=row], thead th:first-child { text-align: left; font-weight: 600; width: 30%; }
td small, th small { display: block; font: 400 12px/1.4 var(--body); color: var(--ink-3); margin-top: 3px; }
th[scope=row] small { font-weight: 400; max-width: 34ch; }
td.strong { font-weight: 600; font-size: 17px; }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; }
.s-text { background: var(--s-text); fill: var(--s-text); } .s-shot-half { background: var(--s-half); fill: var(--s-half); } .s-shot-full { background: var(--s-full); fill: var(--s-full); }
.chartbox { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 16px; overflow-x: auto; }
.chartbox svg { width: 100%; min-width: 520px; height: auto; display: block; }
.grid { stroke: var(--rule); stroke-width: 1; }
.tick { fill: var(--ink-3); font: 12px var(--mono); }
.axis { fill: var(--ink-2); font: 13px var(--body); }
.dl { fill: var(--ink); font: 600 13px var(--body); }
.dot { opacity: .45; stroke: var(--panel); stroke-width: 2; }
.mean { stroke: var(--panel); stroke-width: 2; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 14px; color: var(--ink-2); }
.prompt { display: grid; gap: 12px; padding-top: 28px; border-top: 1px solid var(--rule); }
.sub { font-size: 14px; } .sub code { font-size: 12px; margin: 2px 0; display: inline-block; }
.trio { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.shot { margin: 0; display: grid; gap: 10px; align-content: start; min-width: 0; }
.shot img { width: 100%; height: auto; aspect-ratio: 4 / 3; border-radius: 6px; border: 1px solid var(--rule); background: var(--panel); }
.cap-head { display: flex; align-items: center; font-weight: 600; font-size: 15px; }
.cap-head b { margin-left: auto; font: 600 18px var(--mono); }
.cap-meta { font: 12px var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.note { font-size: 13px; line-height: 1.5; }
.warn { color: var(--warn); }
.findings { display: grid; gap: 16px; }
</style>
<main class="wrap">
  <header class="col">
    <span class="eyebrow">canvas-ai · ${rows.length / variants.length} prompts × ${variants.length} variants · Opus, effort high</span>
    <h1>Text state vs. screenshot state</h1>
    <p class="lede">Each draw call in Canvas AI gets a short text summary of the other parts. This benchmark checks whether also giving every call a screenshot of the canvas improves the picture enough to pay for the extra tokens and time.</p>
  </header>
  <section class="col findings">${findings}</section>
  <section style="display:grid;gap:16px;min-width:0">
    <h2>Totals across all prompts</h2>
    ${table}
  </section>
  <section class="col" style="max-width:820px">
    <h2>Tokens against quality</h2>
    <div class="legend">${variants.map(v => `<span><span class="key s-${v}"></span>${LABEL[v]}</span>`).join("")}<span style="color:var(--ink-3)">Small dots: one prompt. Large dots: mean.</span></div>
    <div class="chartbox">${chart()}</div>
  </section>
  <section style="display:grid;gap:8px;min-width:0">
    <h2>Every drawing</h2>
    <p>Scores are the blind judge's mean of fidelity, coherence and craft, averaged over two image orders. The note is the judge's own comment from the first pass.</p>
    ${gallery.join("\n")}
  </section>
</main>`;

writeFileSync(new URL("report.html", RESULTS), html);
console.log(`report.html: ${(html.length / 1024).toFixed(0)} KB`);
