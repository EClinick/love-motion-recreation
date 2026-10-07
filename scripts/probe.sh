#!/usr/bin/env bash
# Mean colour of small regions, reference vs rendered stills (out/stills/r_<t>.png), in 1440x1080 coords.
# usage: scripts/probe.sh "t1 t2 ..." "name:x:y:w:h ..."
set -euo pipefail
px(){ ffmpeg -v error "$@" -f rawvideo -pix_fmt rgb24 - | od -An -tu1 -w3 | head -1 | xargs printf '#%02x%02x%02x'; }
for t in $1; do
  line="t=$t"
  for r in $2; do
    IFS=: read -r n x y w h <<<"$r"
    f="scale=1440:1080,crop=$w:$h:$x:$y,scale=1:1:flags=area"
    fi=$(awk -v t="$t" 'BEGIN { printf "%d", t * 24000 / 1001 + 0.5 }')
    line="$line | $n ref $(px -i ref/reference.mp4 -vf "select='eq(n\\,$fi)',$f" -frames:v 1 -fps_mode passthrough) ours $(px -i "out/stills/r_$t.png" -vf "$f")"
  done
  echo "$line"
done
