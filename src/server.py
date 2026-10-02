import json
import os
import shutil
import subprocess
import tempfile
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
PORT = 8000
CLAUDE_BIN = shutil.which("claude")
MODEL = "opus"
EFFORT = "high"
TIMEOUT_SECONDS = 300

SYSTEM_PROMPTS = {
    task: (ROOT / "prompts" / f"{task}.md").read_text(encoding="utf-8")
    for task in ("plan", "draw")
}

WORK_DIR = tempfile.mkdtemp(prefix="canvas-ai-")

CLAUDE_ENV = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}


def call_claude(task, prompt):
    result = subprocess.run(
        [
            CLAUDE_BIN, "-p",
            "--model", MODEL,
            "--effort", EFFORT,
            "--output-format", "json",
            "--tools", "",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--system-prompt", SYSTEM_PROMPTS[task],
        ],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=WORK_DIR,
        env=CLAUDE_ENV,
        timeout=TIMEOUT_SECONDS,
    )

    if not result.stdout.strip():
        raise RuntimeError(result.stderr.strip() or f"claude exited with code {result.returncode}")

    data = json.loads(result.stdout)
    if data.get("is_error"):
        raise RuntimeError(data.get("result") or "Claude Code returned an error.")

    return data


class Server(ThreadingHTTPServer):
    allow_reuse_address = False


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if self.path != "/api/llm":
            self.send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            task, prompt = body["task"], body["prompt"]
            if task not in SYSTEM_PROMPTS:
                raise ValueError(f"Unknown task: {task}")
        except (ValueError, KeyError, TypeError) as e:
            self.send_json(400, {"error": f"Bad request: {e}"})
            return

        start = time.time()
        try:
            data = call_claude(task, prompt)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Claude Code timed out."})
            return
        except Exception as e:
            print(f"[{task}] error: {e}", flush=True)
            self.send_json(500, {"error": str(e)})
            return

        raw = data.get("usage") or {}
        usage = {
            "input": raw.get("input_tokens", 0) + raw.get("cache_creation_input_tokens", 0),
            "cached": raw.get("cache_read_input_tokens", 0),
            "output": raw.get("output_tokens", 0),
        }
        print(
            f"[{task}] {time.time() - start:.1f}s, in {usage['input']} "
            f"(+{usage['cached']} cached), out {usage['output']} tokens",
            flush=True,
        )
        self.send_json(200, {"text": data.get("result", ""), "usage": usage})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    if not CLAUDE_BIN:
        raise SystemExit("Claude Code CLI not found. Install it and run `claude` once to log in.")

    try:
        server = Server(("127.0.0.1", PORT), partial(Handler, directory=str(ROOT)))
    except OSError:
        raise SystemExit(f"Port {PORT} is already in use. Stop the other server first.")

    url = f"http://127.0.0.1:{PORT}"
    print(f"Canvas AI running at {url} (Claude Code, model: {MODEL}, effort: {EFFORT})")
    webbrowser.open(url)
    server.serve_forever()
