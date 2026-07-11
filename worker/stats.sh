#!/usr/bin/env bash
# Read visitor analytics from the D1 store. Run from the worker/ dir: ./stats.sh
# Needs wrangler auth (npx wrangler login). Pass a day count as $1 (default 7).
set -euo pipefail
DB="mitanshu-analytics"
DAYS="${1:-7}"
q() { npx wrangler d1 execute "$DB" --remote --command "$1" 2>/dev/null; }

echo "── last $DAYS days ──────────────────────────────────"
q "SELECT COUNT(*) AS pageviews, COUNT(DISTINCT ua||screen) AS rough_visitors
   FROM events WHERE ts >= datetime('now','-$DAYS days');"

echo "── who sent them (utm_source — your tagged links) ──"
q "SELECT COALESCE(NULLIF(utm_source,''),'(direct/untagged)') AS source, COUNT(*) AS hits
   FROM events WHERE ts >= datetime('now','-$DAYS days')
   GROUP BY source ORDER BY hits DESC LIMIT 15;"

echo "── referrers ──"
q "SELECT COALESCE(NULLIF(referrer,''),'(none)') AS referrer, COUNT(*) AS hits
   FROM events WHERE ts >= datetime('now','-$DAYS days')
   GROUP BY referrer ORDER BY hits DESC LIMIT 15;"

echo "── top pages ──"
q "SELECT path, COUNT(*) AS views FROM events
   WHERE ts >= datetime('now','-$DAYS days')
   GROUP BY path ORDER BY views DESC LIMIT 15;"

echo "── where (country / city) ──"
q "SELECT country, city, COUNT(*) AS hits FROM events
   WHERE ts >= datetime('now','-$DAYS days')
   GROUP BY country, city ORDER BY hits DESC LIMIT 15;"

echo "── device split ──"
q "SELECT device, COUNT(*) AS hits FROM events
   WHERE ts >= datetime('now','-$DAYS days') GROUP BY device ORDER BY hits DESC;"
