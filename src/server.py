import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

try:
    import requests
except ImportError:
    requests = None

NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_API_KEY = "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"
MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class DebugProxyHandler(BaseHTTPRequestHandler):
    def _send_json_response(self, status_code, body_bytes):
        self.send_response(status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)
        self.wfile.flush()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()
        self.wfile.flush()

    def do_POST(self):
        api_key = NVIDIA_API_KEY
        if not api_key:
            self._send_json_response(500, json.dumps({
                "error": "NVIDIA_API_KEY is not set. Export it in your shell before starting the server."
            }).encode("utf-8"))
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            payload = {}

        if not isinstance(payload, dict):
            payload = {}

        stream = bool(payload.get("stream", False))
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "text/event-stream" if stream else "application/json",
            "Content-Type": "application/json",
        }

        upstream_payload = {
            "model": payload.get("model", MODEL),
            "messages": payload.get("messages", [{"role": "user", "content": ""}]),
            "stream": stream,
            "temperature": payload.get("temperature", 0.6),
            "top_p": payload.get("top_p", 0.95),
            "max_tokens": payload.get("max_tokens", 65536),
            "reasoning_budget": payload.get("reasoning_budget", 16384),
        }

        if "prompt" in payload:
            upstream_payload["prompt"] = payload["prompt"]

        try:
            if requests is None:
                raise RuntimeError("requests package is not installed")

            print(f"[proxy] Calling NVIDIA API...")
            start = time.time()

            response = requests.post(
                NVIDIA_URL,
                headers=headers,
                json=upstream_payload,
                stream=stream,
                timeout=300,
            )

            elapsed = time.time() - start
            print(f"[proxy] NVIDIA responded {response.status_code} in {elapsed:.1f}s")

            if stream:
                self.send_response(response.status_code)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for line in response.iter_lines():
                    if line:
                        self.wfile.write(line + b"\n")
                        self.wfile.flush()
            else:
                self._send_json_response(response.status_code, response.content)

        except Exception as e:
            print(f"[proxy] Error: {e}")
            self._send_json_response(500, json.dumps({"error": str(e)}).encode("utf-8"))

        print("=" * 50)


if __name__ == "__main__":
    server_address = ("127.0.0.1", 8000)
    httpd = ThreadedHTTPServer(server_address, DebugProxyHandler)
    print("Server running at http://127.0.0.1:8000")
    httpd.serve_forever()
