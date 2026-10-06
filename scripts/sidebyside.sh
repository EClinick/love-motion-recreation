#!/usr/bin/env bash
# Side-by-side comparison video: reference (left) vs render (right), with the soundtrack.
# usage: scripts/sidebyside.sh <render.mp4> <out.mp4> [label]
set -euo pipefail
cd "$(dirname "$0")/.."
REN=${1:?render video}
OUT=${2:?output path}
LABEL=${3:-RECREATION}
mkdir -p "$(dirname "$OUT")"
ffmpeg -v error -y -i ref/reference.mp4 -i "$REN" -i ref/audio.mp3 -filter_complex "\
[0:v]scale=1440:1080,setsar=1,fps=24000/1001,drawtext=text='REFERENCE':x=24:y=24:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10[a];\
[1:v]scale=1440:1080,setsar=1,fps=24000/1001,drawtext=text='${LABEL}':x=24:y=24:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10[b];\
[a][b]hstack=inputs=2:shortest=1[v]" \
  -map '[v]' -map 2:a -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
echo "$OUT"
