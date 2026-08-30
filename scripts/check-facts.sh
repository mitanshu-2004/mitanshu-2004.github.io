#!/usr/bin/env bash
# check-facts.sh — figures that were wrong once must not come back.
#
# Why this exists: "51 episodes · 2.1 h" lived in four files at once — the
# home page, the write-up, llms.txt and the chatbot's knowledge base — and
# stayed live for months. It merged the 10-task Franka set with the separate
# 45-episode glove-rig set and labelled the total as one of them. Correcting
# one file looked like correcting the fact. Nothing caught it.
#
# The résumé is the verified record. Anything corrected against it goes here.
#
# Two files are exempt by design: this script, which must name the figures to
# guard them, and worker/system-prompt.js, which names them to instruct the
# chatbot never to say them.
#
#   make facts        # or: scripts/check-facts.sh
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
check() {  # check <needle> <why>
  hits=$(grep -rIl -- "$1" \
          --include=*.html --include=*.txt --include=*.xml --include=*.js \
          . 2>/dev/null \
          | grep -v '^./.git' \
          | grep -v 'scripts/check-facts.sh' \
          | grep -v 'worker/system-prompt.js' || true)
  if [ -n "$hits" ]; then
    echo "  RETIRED FIGURE BACK: \"$1\""
    echo "     $2"
    echo "$hits" | sed 's/^/       /'
    fail=1
  fi
}

echo "Checking retired figures..."
check "51 episodes"  "Franka is 10 tasks; the 45-episode set is the glove rig."
check "51-episode"   "Franka is 10 tasks; the 45-episode set is the glove rig."
check "2.1 h"        "Not attested in any source."
check "660 mm"       "CS66 reach is 914 mm per Elite Robots' datasheet."

# Claims the résumé verifies that must not silently disappear again.
echo "Checking résumé claims are still present..."
for pair in "125 Hz|teleop control rate" "45/45|episodes validated" \
            "A.T.O.M.|hexapod is a team project" "CGPA|education is verifiable"; do
  needle="${pair%%|*}"; why="${pair##*|}"
  if ! grep -rqI -- "$needle" --include=*.html . 2>/dev/null; then
    echo "  MISSING: \"$needle\" — $why"; fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "done. no figure has regressed." || echo "FAILED."
exit $fail
