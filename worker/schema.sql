-- mitanshu.dev visitor analytics — one row per pageview.
-- No cookies, no IP stored; country/city come from Cloudflare edge headers.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,          -- ISO-8601, set server-side
  path       TEXT,                   -- e.g. /projects/nextup-cobot.html
  referrer   TEXT,                   -- document.referrer host (where they came from)
  utm_source   TEXT,                 -- ?utm_source= — which link/company sent them
  utm_medium   TEXT,
  utm_campaign TEXT,
  country    TEXT,                   -- CF-IPCountry
  city       TEXT,                   -- cf.city
  device     TEXT,                   -- mobile | desktop (coarse, from UA)
  screen     TEXT,                   -- e.g. 1440x900
  ua         TEXT                    -- raw user-agent, for bot filtering
);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_utm  ON events(utm_source);
CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);

-- Chatbot conversation log — one row per exchange (visitor question + bot answer).
CREATE TABLE IF NOT EXISTS chats (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,             -- ISO-8601, set server-side
  question TEXT,                      -- visitor's message (clipped)
  answer   TEXT,                      -- bot's streamed reply, reassembled
  device   TEXT                       -- mobile | desktop
);
CREATE INDEX IF NOT EXISTS idx_chats_ts ON chats(ts);
