#!/usr/bin/env bash
# Refresh site/media and site/data.json from the latest render + comparison sheets.
# Idempotent: safe to re-run after every iteration. Never edits index.html.
# usage: scripts/publish-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PREVIEW=out/preview.mp4
[ -f "$PREVIEW" ] || { echo "missing $PREVIEW" >&2; exit 1; }

# newest iterN directory (numeric order) that actually contains sheets
ITER_DIR=""
for d in $(ls -d out/compare/iter[0-9]* 2>/dev/null | sort -V -r); do
  if ls "$d"/sheet_*.jpg >/dev/null 2>&1; then ITER_DIR=$d; break; fi
done
[ -n "$ITER_DIR" ] || { echo "no out/compare/iterN with sheets" >&2; exit 1; }
ITER=$(basename "$ITER_DIR")

mkdir -p site/media/compare
cp -f "$PREVIEW" site/media/current.mp4.tmp && mv -f site/media/current.mp4.tmp site/media/current.mp4
rm -f site/media/compare/sheet_*.jpg
cp -f "$ITER_DIR"/sheet_*.jpg site/media/compare/

export ITER PREVIEW
python3 - <<'PY'
import json, os, subprocess, glob, datetime
def sh(*a): return subprocess.check_output(a, text=True).strip()
h, subj, date = sh("git","log","-1","--format=%h%x1f%s%x1f%cI").split("\x1f")
dirty = bool(sh("git","status","--porcelain","--","src","scripts/compare.sh"))
mt = os.path.getmtime(os.environ["PREVIEW"])
render = datetime.datetime.fromtimestamp(mt).astimezone().isoformat(timespec="seconds")
try:
    pr = sh("ffprobe","-v","error","-show_entries","format=duration:stream=width,height","-of","json","site/media/current.mp4")
    pj = json.loads(pr); dur = float(pj["format"]["duration"])
    st = [s for s in pj["streams"] if "width" in s][0]; res = f'{st["width"]}x{st["height"]}'
except Exception: dur, res = None, None
sheets = sorted(os.path.basename(p) for p in glob.glob("site/media/compare/sheet_*.jpg"))
scores = json.load(open("site/scores.json"))
data = {
  "generated": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
  "version": {"hash": h, "subject": subj, "date": date, "dirty": dirty},
  "render": {"date": render, "duration": dur, "resolution": res, "v": int(mt)},
  "iteration": os.environ["ITER"],
  "sheets": sheets,
  "scores": scores,
}
json.dump(data, open("site/data.json.tmp","w"), indent=2)
os.replace("site/data.json.tmp","site/data.json")
print("published", os.environ["ITER"], len(sheets), "sheets;", h, subj)
PY
