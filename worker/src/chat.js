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

// ---- Telegram notifications (optional — inert until both secrets are set:
//      npx wrangler secret put TELEGRAM_BOT_TOKEN
//      npx wrangler secret put TELEGRAM_CHAT_ID ) ----

const escHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// UTC ISO string -> "14:32 IST · 12 Jul"
function istTime(iso) {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return String(d.getUTCHours()).padStart(2, "0") + ":" +
         String(d.getUTCMinutes()).padStart(2, "0") + " IST · " +
         d.getUTCDate() + " " + months[d.getUTCMonth()];
}

// "Chrome · Windows" from a raw user-agent; coarse on purpose.
function parseUA(ua) {
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Linux|X11/.test(ua) ? "Linux" : "";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /SamsungBrowser/.test(ua) ? "Samsung Browser" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch { /* notifications are best-effort */ }
}

// Instant ping when a tagged link gets opened (resume / application / any
// per-company campaign). Deduped: quiet if the same source+campaign already
// fired within 15 minutes, so a reload doesn't ping twice. Only rows OLDER
// than this one (id < ours) count, so when duplicate beacons race, exactly
// the earliest row pings — never zero, never two.
async function alertTaggedVisit(env, row, rowId) {
  const prev = await env.ANALYTICS_DB.prepare(
    `SELECT COUNT(*) AS n FROM events
     WHERE utm_source = ?1 AND utm_campaign = ?2 AND id < ?3
       AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')`
  ).bind(row.src, row.camp, rowId).first();
  if (prev && prev.n > 0) return;

  const title = row.camp
    ? `\u{1F514} <b>${escHtml(row.camp)}</b> opened your site`
    : `\u{1F514} <b>${escHtml(row.src)}</b> link opened`;
  const bo = parseUA(row.ua || "");
  const lines = [title, ""];
  lines.push(`<b>Source:</b> ${escHtml(row.src || "—")}`);
  if (row.camp) lines.push(`<b>Campaign:</b> ${escHtml(row.camp)}`);
  lines.push(`<b>Page:</b> ${escHtml(row.path || "/")}`);
  lines.push(`<b>Device:</b> ${row.device}${bo ? " · " + bo : ""}`);
  if (row.net) lines.push(`<b>Network:</b> ${escHtml(row.net)}`);
  lines.push(`<b>Time:</b> ${istTime(row.ts)}`);
  await sendTelegram(env, lines.join("\n"));
}

// Log one chatbot exchange: reassemble the streamed SSE answer, store the
// full Q&A in D1, and push a trimmed copy to Telegram.
async function logChat(env, request, messages, stream) {
  let raw = "";
  const reader = stream.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
  }
  let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      answer += (j.choices && j.choices[0] && j.choices[0].delta &&
                 j.choices[0].delta.content) || "";
    } catch { /* partial frame — skip */ }
  }
  const question = messages[messages.length - 1].content;
  const ua = request.headers.get("User-Agent") || "";
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
  const ts = new Date().toISOString();
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO chats (ts, question, answer, device) VALUES (?,?,?,?)`
  ).bind(ts, question.slice(0, 1500), answer.slice(0, 4000), device).run();

  const trim = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  const bo = parseUA(ua);
  await sendTelegram(env,
    `\u{1F4AC} <b>Chatbot</b>\n\n` +
    `<b>Q:</b> ${escHtml(trim(question, 500))}\n` +
    `<b>A:</b> ${escHtml(trim(answer || "(no reply)", 800))}\n\n` +
    `<b>Device:</b> ${device}${bo ? " · " + bo : ""} · <b>Time:</b> ${istTime(ts)}`);
}

// Fire-and-forget pageview logger. Writes one row to D1; never throws to the
// caller (analytics must never break the page). Body is sent as text/plain so
// the browser beacon skips the CORS preflight.
async function handleCollect(request, env, headers, originOk, ctx) {
  if (request.method !== "POST" || !originOk)
    return new Response(null, { status: 204, headers });
  if (!env.ANALYTICS_DB) return new Response(null, { status: 204, headers });
  try {
    const b = JSON.parse(await request.text() || "{}");
    const ua = request.headers.get("User-Agent") || "";
    const mobile = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
    const cf = request.cf || {};
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    const row = {
      ts: new Date().toISOString(),
      path: clip(b.path, 300),
      src: clip(b.utm_source, 120) || "",
      camp: clip(b.utm_campaign, 120) || "",
      country: request.headers.get("CF-IPCountry") || null,
      city: clip(cf.city, 120),
      device: mobile,
      net: clip(cf.asOrganization, 120),
      ua,
    };
    // Browsers sometimes double-fire the beacon (prerender, retries) — an
    // identical event within 2 seconds is the same pageview; keep one row.
    const dup = await env.ANALYTICS_DB.prepare(
      `SELECT 1 FROM events
       WHERE path IS ?1 AND ua = ?2 AND screen IS ?3
         AND utm_source = ?4 AND utm_campaign = ?5
         AND ts >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 seconds')
       LIMIT 1`
    ).bind(row.path, clip(ua, 400), clip(b.screen, 20), row.src, row.camp).first();
    if (dup) return new Response(null, { status: 204, headers });

    const ins = await env.ANALYTICS_DB.prepare(
      `INSERT INTO events
       (ts, path, referrer, utm_source, utm_medium, utm_campaign, country, city, device, screen, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      row.ts, row.path, clip(b.referrer, 300),
      row.src, clip(b.utm_medium, 120), row.camp,
      row.country, row.city,
      mobile, clip(b.screen, 20), clip(ua, 400)
    ).run();
    // Recruiter-signal ping: any per-company campaign, or a resume/application link.
    const interesting = row.camp || row.src === "resume" || row.src === "application";
    if (interesting && ctx)
      ctx.waitUntil(
        alertTaggedVisit(env, row, ins.meta && ins.meta.last_row_id).catch(() => {})
      );
  } catch { /* analytics is best-effort — swallow everything */ }
  return new Response(null, { status: 204, headers });
}

// Daily digest of the last 24h, pushed to Telegram by the cron trigger.
async function sendDailyDigest(env) {
  if (!env.ANALYTICS_DB) return;
  const q = (sql) => env.ANALYTICS_DB.prepare(sql);
  const [totals, sources, camps, pages, chats] = await env.ANALYTICS_DB.batch([
    q(`SELECT COUNT(*) AS pv, COUNT(DISTINCT ua||screen) AS vis
       FROM events WHERE ts >= datetime('now','-1 day')`),
    q(`SELECT COALESCE(NULLIF(utm_source,''),'direct') AS s, COUNT(*) AS n
       FROM events WHERE ts >= datetime('now','-1 day') GROUP BY s ORDER BY n DESC LIMIT 6`),
    q(`SELECT utm_campaign AS c, COUNT(*) AS n FROM events
       WHERE ts >= datetime('now','-1 day') AND utm_campaign != ''
       GROUP BY c ORDER BY n DESC LIMIT 10`),
    q(`SELECT path, COUNT(*) AS n FROM events
       WHERE ts >= datetime('now','-1 day') GROUP BY path ORDER BY n DESC LIMIT 5`),
    q(`SELECT COUNT(*) AS n FROM chats WHERE ts >= datetime('now','-1 day')`),
  ]);

  const t = totals.results[0] || { pv: 0, vis: 0 };
  const nchats = (chats.results[0] || { n: 0 }).n;
  const line = (rows, f) => rows.map(f).join(" · ") || "none";
  let msg =
    `\u{1F4CA} <b>mitanshu.dev — last 24h</b>\n\n` +
    `<b>Views:</b> ${t.pv} · <b>Visitors:</b> ${t.vis} · <b>Chats:</b> ${nchats}\n` +
    `<b>Sources:</b> ${line(sources.results, (r) => `${escHtml(r.s)} ${r.n}`)}\n`;
  if (camps.results.length)
    msg += `\u{1F3AF} <b>Campaigns:</b> ${line(camps.results, (r) => `${escHtml(r.c)} ${r.n}`)}\n`;
  msg += `<b>Top pages:</b> ${line(pages.results, (r) => `${escHtml(r.path || "?")} ${r.n}`)}`;
  await sendTelegram(env, msg);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyDigest(env).catch(() => {}));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const headers = cors(origin, allowed);
    const originOkEarly = allowed.length === 0 || (origin !== "" && allowed.includes(origin));

    if (url.pathname === "/collect")
      return handleCollect(request, env, headers, originOkEarly, ctx);

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
        // Tee the reply stream: one branch to the visitor untouched, one
        // reassembled into a Q&A log after the stream ends.
        let clientBody = upstream.body;
        if (env.ANALYTICS_DB && ctx) {
          const [toClient, toLog] = upstream.body.tee();
          clientBody = toClient;
          ctx.waitUntil(logChat(env, request, messages, toLog).catch(() => {}));
        }
        return new Response(clientBody, {
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
