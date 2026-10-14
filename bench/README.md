# State benchmark

Compares what each draw call sees as state:

- `text`: the current app. Parts are drawn 3 at a time, and each call sees the other parts' names and boxes.
- `shot-half` / `shot-full`: parts are drawn one at a time, and each call also gets a 400×300 or 800×600 PNG of the canvas so far.

Every variant uses the same plan per prompt, so the only difference is the state. Images are rendered headless with `@napi-rs/canvas`. Calls go through `claude -p`, the same way `src/server.py` makes them.

```bash
npm install
node run.mjs      # plans + draws every prompt × variant into results/ (resumable)
node judge.mjs    # blind LLM judge, two image orders per prompt
node report.mjs   # results/summary.md + summary.json
node page.mjs     # results/report.html
```

`BENCH_MODEL`, `BENCH_EFFORT`, `JUDGE_MODEL`, `JUDGE_EFFORT` and `BENCH_OUT` override the defaults (opus / high / opus / medium / results).
