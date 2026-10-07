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
[0:v]drawtext=text='REF':x=36:y=36:fontsize=108:fontcolor=yellow:box=1:boxcolor=black@0.6,select='not(mod(n\,$STEP))',setpts=N/TB/$FPS,scale=480:360[a];\
[1:v]drawtext=text='OURS %{pts\:flt}':x=18:y=18:fontsize=54:fontcolor=cyan:box=1:boxcolor=black@0.6,select='not(mod(n\,$STEP))',setpts=N/TB/$FPS,scale=480:360[b];\
[a][b]hstack,pad=iw+8:ih+8:4:4:color=white,tile=2x5:color=white" -vsync vfr "$OUT/sheet_%02d.jpg"
ls "$OUT"
