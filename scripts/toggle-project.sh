#!/usr/bin/env bash
# Hide or restore a homepage work-card without hand-editing index.html.
#
#   scripts/toggle-project.sh "<unique text from the card>"        # hide
#   scripts/toggle-project.sh "<unique text from the card>" show   # restore
#
# Matches the <article class="work-card">...</article> block whose contents
# contain the given text (e.g. the title), and adds/removes a `hidden`
# attribute on it. Card stays in the source, just doesn't render.
#
# Example:
#   scripts/toggle-project.sh "A language model, from scratch"
#   scripts/toggle-project.sh "A language model, from scratch" show
set -euo pipefail

if [[ $# -lt 1 ]]; then
  grep '^#' "$0" | sed 's/^# \?//'; exit 1
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$DIR/index.html"
MATCH="$1"
MODE="${2:-hide}"

python3 - "$FILE" "$MATCH" "$MODE" <<'PYEOF'
import re, sys

path, match, mode = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(path, encoding="utf-8").read()

pattern = re.compile(r'(<article class="work-card[^"]*"[^>]*>)(.*?)(</article>)', re.DOTALL)
found = False

def repl(m):
    global found
    open_tag, body, close_tag = m.groups()
    if match not in body:
        return m.group(0)
    found = True
    if mode == "show":
        new_open = re.sub(r"\s+hidden\b", "", open_tag)
    else:
        if re.search(r"\bhidden\b", open_tag):
            new_open = open_tag
        else:
            new_open = open_tag[:-1] + " hidden>"
    return new_open + body + close_tag

new_html, _ = pattern.subn(repl, html)
if not found:
    sys.exit(f"No work-card found containing: {match!r}")

# Recompute the org-filter pill counts from cards actually visible now.
counts = {}
for m in pattern.finditer(new_html):
    open_tag = m.group(1)
    if "hidden" in open_tag:
        continue
    org = re.search(r'data-org="([^"]+)"', open_tag)
    if org:
        counts[org.group(1)] = counts.get(org.group(1), 0) + 1
counts["all"] = sum(counts.values())

def fix_count(m):
    f = m.group("f")
    return f'{m.group("pre")}{counts.get(f, 0)}{m.group("post")}'

new_html = re.sub(
    r'(?P<pre><button class="ofil" data-f="(?P<f>[^"]+)"[^>]*>[^<]*<span class="ct">)\d+(?P<post></span></button>)',
    fix_count,
    new_html,
)

open(path, "w", encoding="utf-8").write(new_html)
print(f"{'Restored' if mode == 'show' else 'Hid'} card matching: {match!r}")
PYEOF
