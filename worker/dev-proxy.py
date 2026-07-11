#!/usr/bin/env python3
"""Local stand-in for the Cloudflare Worker (worker/src/chat.js).

Same contract, same grounding, same key rotation — so what I test at
localhost:8787 is what the deployed Worker does. Reads keys from worker/.dev.vars
(gitignored). Not for production; the real thing is the Worker.

    python3 worker/dev-proxy.py         # serves on http://localhost:8787/chat
"""
import json
import os
import random
import re
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
PRIMARY_MODEL = "llama-3.3-70b-versatile"
FALLBACK_MODEL = "llama-3.1-8b-instant"
MAX_MESSAGES = 16
MAX_CHARS = 1500
MAX_TOKENS = 700
PORT = 8787


def load_dev_vars():
    vars_ = {}
    path = os.path.join(HERE, ".dev.vars")
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vars_[k.strip()] = v.strip()
    return vars_


def load_system_prompt():
    # Pull the exact string out of system-prompt.js so grounding stays in sync.
    src = open(os.path.join(HERE, "system-prompt.js")).read()
    m = re.search(r"SYSTEM_PROMPT\s*=\s*`(.*?)`", src, re.S)
    if not m:
        raise RuntimeError("could not find SYSTEM_PROMPT in system-prompt.js")
    return m.group(1)


DEV_VARS = load_dev_vars()
SYSTEM_PROMPT = load_system_prompt()
KEYS = [k.strip() for k in DEV_VARS.get("GROQ_API_KEYS", "").split(",") if k.strip()]
ALLOWED = [o.strip() for o in DEV_VARS.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.0: the body is delimited by connection close, which is the simplest
    # reliable way to stream an unknown-length SSE response from a dev server.
    # The production Worker streams via proper chunked HTTP/1.1 on its own.
    protocol_version = "HTTP/1.0"

    def _cors(self):
        origin = self.headers.get("Origin", "")
        allow = origin if (not ALLOWED or origin in ALLOWED) and origin else (ALLOWED[0] if ALLOWED else "*")
        self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _err(self, status, msg):
        payload = json.dumps({"error": msg}).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw)
        except Exception:
            return self._err(400, "bad json")

        msgs = body.get("messages") if isinstance(body, dict) else None
        if not isinstance(msgs, list):
            msgs = []
        clean = [
            {"role": m["role"], "content": str(m["content"])[:MAX_CHARS]}
            for m in msgs
            if isinstance(m, dict) and m.get("role") in ("user", "assistant")
            and isinstance(m.get("content"), str)
        ][-MAX_MESSAGES:]
        if not clean or clean[-1]["role"] != "user":
            return self._err(400, "need a user message last")
        if not KEYS:
            return self._err(500, "server not configured")

        payload = {
            "model": PRIMARY_MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + clean,
            "max_tokens": MAX_TOKENS,
            "temperature": 0.4,
            "stream": True,
        }

        start = random.randrange(len(KEYS))
        tried_fallback = False
        i = 0
        while i < len(KEYS):
            key = KEYS[(start + i) % len(KEYS)]
            req = urllib.request.Request(
                GROQ_URL,
                data=json.dumps(payload).encode(),
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    # Groq is behind Cloudflare, which 403s the default Python-urllib
                    # UA (error 1010). The deployed Worker uses fetch and isn't affected;
                    # this line only matters for local dev.
                    "User-Agent": "mitanshu-dev-proxy/1.0",
                },
                method="POST",
            )
            try:
                resp = urllib.request.urlopen(req, timeout=60)
            except urllib.error.HTTPError as e:
                if e.code in (401, 403, 429):
                    i += 1
                    continue
                if not tried_fallback and e.code >= 500:
                    tried_fallback = True
                    payload["model"] = FALLBACK_MODEL
                    continue
                i += 1
                continue
            except Exception:
                i += 1
                continue

            # stream the SSE straight through
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                for line in resp:
                    self.wfile.write(line)
                    self.wfile.flush()
            except Exception:
                pass
            return

        return self._err(503, "all keys are busy right now — try again in a moment")

    def log_message(self, *a):
        pass  # quiet


if __name__ == "__main__":
    print(f"dev-proxy: {len(KEYS)} keys, prompt {len(SYSTEM_PROMPT)} chars, on :{PORT}/chat")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
