#!/usr/bin/env bash
# Reference (left) vs rendered still (right) for each time, stacked into one image.
# usage: scripts/still-compare.sh <out.png> <t> [t...]   (stills from: node src/render.js --stills ...)
set -euo pipefail
OUT=$1; shift
TMP=$(mktemp -d)
args=()
for t in "$@"; do
  n=$(awk -v t="$t" 'BEGIN { printf "%d", t * 24000 / 1001 + 0.5 }')
  # select by frame index: seeking to a rounded time can land one frame late
  ffmpeg -v error -y -i ref/reference.mp4 -i "out/stills/r_$t.png" -filter_complex \
    "[0:v]select='eq(n\\,$n)',scale=640:480,drawtext=text='REF $t':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6[a];[1:v]scale=640:480[b];[a][b]hstack" \
    -frames:v 1 -fps_mode passthrough "$TMP/$t.png"
  args+=(-i "$TMP/$t.png")
done
if [ "$#" -gt 1 ]; then ffmpeg -v error -y "${args[@]}" -filter_complex "vstack=inputs=$#" "$OUT"; else cp "$TMP/$1.png" "$OUT"; fi
rm -rf "$TMP"
