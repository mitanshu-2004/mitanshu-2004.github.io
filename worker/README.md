# mitanshu.dev chat backend

A tiny Cloudflare Worker that powers the "Ask me anything" widget. It holds the Groq
API keys server-side, grounds the model in `system-prompt.js`, rotates across the keys,
and streams the reply back. The browser never sees a key.

```
worker/
  src/chat.js        the Worker (production)
  system-prompt.js   what the assistant knows — edit this to change its answers
  wrangler.toml      Worker config (name, ALLOWED_ORIGINS)
  dev-proxy.py       local stand-in for the Worker, for testing (not deployed)
  .dev.vars          the keys — gitignored, never committed
```

## Test locally (no account needed)

```bash
python3 worker/dev-proxy.py          # serves http://localhost:8787/chat
python3 -m http.server 4173 --directory .   # the site, in another shell
```

Open http://localhost:4173 — the widget detects localhost and talks to the dev-proxy.
The dev-proxy reads the keys from `worker/.dev.vars` and mirrors the Worker's logic, so
what you see locally is what the Worker does.

## Deploy the Worker (your Cloudflare account, free tier)

```bash
cd worker
npm install -g wrangler        # once
wrangler login                 # opens the browser; log into your Cloudflare account

# Set the keys as an encrypted secret (paste the comma-joined keys when prompted).
# The comma-joined string is already in .dev.vars on the GROQ_API_KEYS line.
wrangler secret put GROQ_API_KEYS

wrangler deploy                # prints the Worker URL, e.g.
                               #   https://mitanshu-chat.<your-subdomain>.workers.dev
```

## Point the site at it

In every page's `<head>` there's:

```html
<meta name="chat-endpoint" content="https://mitanshu-chat.YOURSUBDOMAIN.workers.dev/chat">
```

Replace `YOURSUBDOMAIN` with your real subdomain (keep the `/chat` path). Until you do,
the widget simply doesn't appear in production — no broken button. One-liner to patch
all pages at once from the repo root:

```bash
grep -rl YOURSUBDOMAIN --include=*.html . \
  | xargs sed -i 's/mitanshu-chat.YOURSUBDOMAIN.workers.dev/mitanshu-chat.YOUR-REAL-SUBDOMAIN.workers.dev/'
```

`ALLOWED_ORIGINS` in `wrangler.toml` already lists `https://mitanshu.dev`. If you test
against the raw `*.workers.dev` URL from the live site first, add that origin too and
redeploy.

## Notes

- Model: `llama-3.3-70b-versatile`, with `llama-3.1-8b-instant` as a fallback if the
  primary 5xxs. Change in `src/chat.js`.
- Guards: only the last 16 turns are kept, each message capped at 1500 chars, replies
  capped at 700 tokens, CORS locked to `ALLOWED_ORIGINS`. For extra safety against key
  drain, add a Cloudflare rate-limit rule on the Worker route.
- Rotating 12 free keys spreads load across accounts; a rate-limited key is skipped and
  the next one tried on the same request.
