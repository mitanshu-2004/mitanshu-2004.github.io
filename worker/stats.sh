#!/usr/bin/env bash
# Read visitor analytics from the D1 store. Run from the worker/ dir: ./stats.sh
# Needs wrangler auth (npx wrangler login). Pass a day count as $1 (default 7).
set -euo pipefail
DB="mitanshu-analytics"
DAYS="${1:-7}"

run() {  # $1 = section title, $2 = SQL — prints a clean table, no wrangler noise
  local out
  out=$(npx wrangler d1 execute "$DB" --remote --json --command "$2" 2>/dev/null)
  echo "$out" | TITLE="$1" python3 -c '
import sys, json, os
rows = json.load(sys.stdin)[0]["results"]
print("\n\033[1m" + os.environ["TITLE"] + "\033[0m")
if not rows:
    print("  (nothing yet)"); sys.exit()
cols = list(rows[0].keys())
w = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
print("  " + "  ".join(c.ljust(w[c]) for c in cols))
for r in rows:
    print("  " + "  ".join(str(r[c]).ljust(w[c]) for c in cols))
'
}

echo "════ mitanshu.dev — last $DAYS days ════"
run "totals" "SELECT COUNT(*) AS pageviews, COUNT(DISTINCT ua||screen) AS rough_visitors
   FROM events WHERE ts >= datetime('now','-$DAYS days');"
run "who sent them (utm_source — your tagged links)" "SELECT COALESCE(NULLIF(utm_source,''),'(direct/untagged)') AS source, COUNT(*) AS hits
   FROM events WHERE ts >= datetime('now','-$DAYS days') GROUP BY source ORDER BY hits DESC LIMIT 15;"
run "which application (utm_campaign — per-company links)" "SELECT utm_campaign AS company, MIN(substr(ts,1,16)) AS first_visit, COUNT(*) AS hits
   FROM events WHERE ts >= datetime('now','-$DAYS days') AND utm_campaign != ''
   GROUP BY company ORDER BY hits DESC LIMIT 20;"
run "referrers" "SELECT COALESCE(NULLIF(referrer,''),'(none)') AS referrer, COUNT(*) AS hits
   FROM events WHERE ts >= datetime('now','-$DAYS days') GROUP BY referrer ORDER BY hits DESC LIMIT 15;"
run "top pages" "SELECT path, COUNT(*) AS views FROM events
   WHERE ts >= datetime('now','-$DAYS days') GROUP BY path ORDER BY views DESC LIMIT 15;"
run "where (country / city)" "SELECT country, city, COUNT(*) AS hits FROM events
   WHERE ts >= datetime('now','-$DAYS days') GROUP BY country, city ORDER BY hits DESC LIMIT 15;"
run "device split" "SELECT device, COUNT(*) AS hits FROM events
   WHERE ts >= datetime('now','-$DAYS days') GROUP BY device ORDER BY hits DESC;"
