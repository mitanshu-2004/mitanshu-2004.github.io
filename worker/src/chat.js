// mitanshu.dev chat proxy — Cloudflare Worker.
// Holds the Groq keys server-side, grounds the model, and streams the reply back.
// The browser never sees a key. Deploy notes: worker/README.md.
import { SYSTEM_PROMPT } from "../system-prompt.js";

const PRIMARY_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_MESSAGES = 16;   // trailing turns kept from the conversation
const MAX_CHARS = 1500;    // per message, characters
const MAX_TOKENS = 700;    // reply length cap

function cors(origin, allowed) {
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok && origin ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// Fire-and-forget pageview logger. Writes one row to D1; never throws to the
// caller (analytics must never break the page). Body is sent as text/plain so
// the browser beacon skips the CORS preflight.
async function handleCollect(request, env, headers, originOk) {
  if (request.method !== "POST" || !originOk)
    return new Response(null, { status: 204, headers });
  if (!env.ANALYTICS_DB) return new Response(null, { status: 204, headers });
  try {
    const b = JSON.parse(await request.text() || "{}");
    const ua = request.headers.get("User-Agent") || "";
    const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
    const cf = request.cf || {};
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO events
       (ts, path, referrer, utm_source, utm_medium, utm_campaign, country, city, device, screen, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      new Date().toISOString(),
      clip(b.path, 300), clip(b.referrer, 300),
      clip(b.utm_source, 120), clip(b.utm_medium, 120), clip(b.utm_campaign, 120),
      request.headers.get("CF-IPCountry") || null, clip(cf.city, 120),
      mobile, clip(b.screen, 20), clip(ua, 400)
    ).run();
  } catch { /* analytics is best-effort — swallow everything */ }
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const headers = cors(origin, allowed);
    const originOkEarly = allowed.length === 0 || (origin !== "" && allowed.includes(origin));

    if (url.pathname === "/collect")
      return handleCollect(request, env, headers, originOkEarly);

    // Origin gate: only the site's own pages may call this. Note that Origin is
    // browser-enforced but spoofable by non-browser clients, so the per-IP rate
    // limit below is the real backstop against key abuse.
    const originOk = allowed.length === 0 || (origin !== "" && allowed.includes(origin));

    if (request.method === "OPTIONS")
      return new Response(null, { status: originOk ? 204 : 403, headers });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, headers);
    if (!originOk) return json({ error: "forbidden origin" }, 403, headers);

    // Per-IP rate limit (Cloudflare Rate Limiting binding). Fails open if the
    // binding isn't configured, so the Worker still runs without it.
    if (env.CHAT_RATE_LIMIT) {
      const ip = request.headers.get("CF-Connecting-IP") || "anon";
      try {
        const { success } = await env.CHAT_RATE_LIMIT.limit({ key: ip });
        if (!success)
          return json({ error: "too many requests — give it a few seconds" }, 429, headers);
      } catch { /* limiter unavailable — fail open */ }
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "bad json" }, 400, headers); }

    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (!messages.length || messages[messages.length - 1].role !== "user")
      return json({ error: "need a user message last" }, 400, headers);

    const keys = (env.GROQ_API_KEYS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!keys.length) return json({ error: "server not configured" }, 500, headers);

    const payload = {
      model: PRIMARY_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
      stream: true,
    };

    // Start the rotation at a random key so load spreads across accounts,
    // then fail over to the next key on auth/rate errors.
    const start = Math.floor(Math.random() * keys.length);
    let triedFallback = false;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[(start + i) % keys.length];
      let upstream;
      try {
        upstream = await fetch(GROQ_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        continue; // network blip on this key, try the next
      }

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }

      // Rate-limited or unauthorized on this key → next key.
      if ([401, 403, 429].includes(upstream.status)) continue;

      // A model/server error: try the smaller model once, same rotation.
      if (!triedFallback && upstream.status >= 500) {
        triedFallback = true;
        payload.model = FALLBACK_MODEL;
        i--; // retry this same key with the fallback model
        continue;
      }
    }

    return json({ error: "all keys are busy right now — try again in a moment" }, 503, headers);
  },
};
