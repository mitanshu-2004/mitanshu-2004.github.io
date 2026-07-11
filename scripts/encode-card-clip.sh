#!/usr/bin/env bash
# Encode a homepage card clip to spec, reproducibly, and generate its poster.
#
#   scripts/encode-card-clip.sh <input> <output.mp4> [--start S] [--dur D]
#                               [--crop W:H:X:Y] [--width PX] [--crf N]
#
# Spec: muted, H.264 yuv420p, +faststart (moov first so the first frame paints
# before download completes), ~8s, ≤1.2 MB target. Writes <output>-poster.jpg
# from frame 0 so poster→first-frame has no jump.
#
# Example:
#   scripts/encode-card-clip.sh raw.mp4 assets/media/nextup-card.mp4 \
#     --start 0.3 --dur 8 --crop 1040:670:40:110 --width 800
set -euo pipefail

if [[ $# -lt 2 ]]; then
  grep '^#' "$0" | sed 's/^# \?//'; exit 1
fi
IN="$1"; OUT="$2"; shift 2
START=0; DUR=8; CROP=""; WIDTH=800; CRF=27
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START="$2"; shift 2;;
    --dur)   DUR="$2";   shift 2;;
    --crop)  CROP="$2";  shift 2;;
    --width) WIDTH="$2"; shift 2;;
    --crf)   CRF="$2";   shift 2;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }

VF=""
[[ -n "$CROP" ]] && VF="crop=${CROP},"
VF="${VF}scale=${WIDTH}:-2"

echo "Encoding $OUT  (start=$START dur=$DUR crop='${CROP:-none}' width=$WIDTH crf=$CRF)"
ffmpeg -y -ss "$START" -t "$DUR" -i "$IN" \
  -vf "$VF" -an \
  -c:v libx264 -pix_fmt yuv420p -crf "$CRF" -preset slow -movflags +faststart \
  "$OUT" -loglevel error

POSTER="${OUT%.mp4}-poster.jpg"
ffmpeg -y -i "$OUT" -frames:v 1 -q:v 3 "$POSTER" -loglevel error

SIZE=$(du -h "$OUT" | cut -f1)
echo "→ $OUT ($SIZE)  +  $POSTER"
ffprobe -v error -show_entries stream=width,height:format=duration \
  -of default=noprint_wrappers=1 "$OUT"
BYTES=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
if [[ "$BYTES" -gt 1258291 ]]; then
  echo "WARNING: over the 1.2 MB card budget — raise --crf or shorten --dur." >&2
fi
