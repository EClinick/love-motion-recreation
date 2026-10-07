#!/usr/bin/env bash
# Reference (left) vs render (right) frame pairs for the judges, larger than the contact sheets.
# usage: scripts/judge-pairs.sh <render.mp4> <outdir> [fps=2]
set -euo pipefail
REN=$1
OUT=$2
FPS=${3:-2}
STEP=$(awk -v f="$FPS" 'BEGIN { printf "%d", 24 / f + 0.5 }')
mkdir -p "$OUT"
rm -f "$OUT"/pair_*.jpg
ffmpeg -v error -y -i ref/reference.mp4 -i "$REN" -filter_complex "\
[0:v]drawtext=text='REF %{pts\:flt}':x=28:y=28:fontsize=80:fontcolor=yellow:box=1:boxcolor=black@0.6,select='not(mod(n\,$STEP))',setpts=N/TB/$FPS,scale=800:600[a];\
[1:v]drawtext=text='OURS %{pts\:flt}':x=14:y=14:fontsize=40:fontcolor=cyan:box=1:boxcolor=black@0.6,select='not(mod(n\,$STEP))',setpts=N/TB/$FPS,scale=800:600[b];\
[a][b]hstack" -q:v 3 -vsync vfr "$OUT/pair_%03d.jpg"
ls "$OUT" | wc -l
