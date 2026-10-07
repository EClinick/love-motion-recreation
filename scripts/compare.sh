#!/usr/bin/env bash
# Build side-by-side contact sheets: reference (left) vs render (right), 4 fps.
# usage: scripts/compare.sh out/preview.mp4 out/compare/iter1 [fps]
set -euo pipefail
REN=${1:-out/preview.mp4}
OUT=${2:-out/compare}
FPS=${3:-4}
STEP=$(awk -v f="$FPS" 'BEGIN { printf "%d", 24 / f + 0.5 }')
mkdir -p "$OUT"
rm -f "$OUT"/sheet_*.jpg
ffmpeg -v error -y -i ref/reference.mp4 -i "$REN" -filter_complex "\
[0:v]select='not(mod(n\,$STEP))',scale=480:360,drawtext=text='REF':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6[a];\
[1:v]select='not(mod(n\,$STEP))',scale=480:360,drawtext=text='OURS %{pts\:flt}':x=6:y=6:fontsize=18:fontcolor=cyan:box=1:boxcolor=black@0.6[b];\
[a][b]hstack,pad=iw+8:ih+8:4:4:color=white,tile=2x5:color=white" -vsync vfr "$OUT/sheet_%02d.jpg"
ls "$OUT"
