#!/usr/bin/env bash
# Reference (left) vs render (right) frame pairs for the judges, larger than the contact sheets.
# usage: scripts/judge-pairs.sh <render.mp4> <outdir> [fps=2]
set -euo pipefail
REN=$1
OUT=$2
FPS=${3:-2}
mkdir -p "$OUT"
rm -f "$OUT"/pair_*.jpg
ffmpeg -v error -y -i ref/reference.mp4 -i "$REN" -filter_complex "\
[0:v]select='isnan(prev_selected_t)+gte(t-prev_selected_t\,1/$FPS-0.01)',scale=800:600,drawtext=text='REF %{pts\:flt}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6[a];\
[1:v]select='isnan(prev_selected_t)+gte(t-prev_selected_t\,1/$FPS-0.01)',scale=800:600,drawtext=text='OURS %{pts\:flt}':x=8:y=8:fontsize=22:fontcolor=cyan:box=1:boxcolor=black@0.6[b];\
[a][b]hstack" -q:v 3 -vsync vfr "$OUT/pair_%03d.jpg"
ls "$OUT" | wc -l
