#!/usr/bin/env bash
# Publish one version of the render into the versioned showcase archive.
#
# usage:
#   scripts/publish-site.sh --id iter7 --video out/preview.mp4 --sheets out/compare/iter7 \
#                           [--scores "7.0,7.2,7.6"] [--note "text"]
#   scripts/publish-site.sh --id iter6 --scores "7.2,7.4,7.8"      # attach scores to an existing version
#   scripts/publish-site.sh --final out/final.mp4                   # copy 4K final to site/media/final/final.mp4
#
# Options:
#   --id ID          version id (e.g. iter7). Re-using an id replaces that entry in place (idempotent).
#   --video FILE     rendered preview; re-encoded for the web (H.264 yuv420p, CRF 22, faststart, AAC).
#   --sheets DIR     directory containing sheet_*.jpg comparison sheets.
#   --scores A,B,C   judge scores for the three sections (0-7.25s, 7.5-14.75s, 15-20.4s).
#                    For iterN it also upserts round N in site/scores.json.
#   --note TEXT      extra changelog line.
#   --label TEXT     display label (default "vN" for iterN, else the id).
#   --commit REF     git commit to describe (default HEAD).
#   --final FILE     copy a final 4K render to site/media/final/final.mp4 and record it in data.json.
#                    Also copies out/sbs/final.mp4 (if present) to site/media/final/sidebyside.mp4.
#   --final-sbs FILE side-by-side for the final (default out/sbs/final.mp4).
#   --no-sbs         skip generating the per-version side-by-side video.
#   --render-date D  ISO date of the render (default: video file mtime).
#
# Layout (all under site/, media is gitignored):
#   site/media/versions/<id>/{video.mp4,meta.json,sheets/sheet_NN.jpg}
#   site/versions.json   ordered list, newest first (read by index.html)
#   site/media/current.mp4, site/data.json   always mirror the newest version
set -euo pipefail
cd "$(dirname "$0")/.."

ID=""; VIDEO=""; SHEETS=""; SCORES=""; NOTE=""; LABEL=""; COMMIT="HEAD"; FINAL=""; RDATE=""; FINAL_SBS="out/sbs/final.mp4"; NO_SBS=""
usage(){ sed -n "2,28p" "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --id) ID=$2; shift 2;;
    --video) VIDEO=$2; shift 2;;
    --sheets) SHEETS=$2; shift 2;;
    --scores) SCORES=$2; shift 2;;
    --note) NOTE=$2; shift 2;;
    --label) LABEL=$2; shift 2;;
    --commit) COMMIT=$2; shift 2;;
    --final) FINAL=$2; shift 2;;
    --render-date) RDATE=$2; shift 2;;
    --final-sbs) FINAL_SBS=$2; shift 2;;
    --no-sbs) NO_SBS=1; shift;;
    -h|--help) usage 0;;
    *) echo "unknown option: $1" >&2; usage;;
  esac
done
[ -n "$ID" ] || [ -n "$FINAL" ] || usage
[[ -z "$ID" || "$ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad --id" >&2; exit 1; }

mkdir -p site/media
STAGE_VIDEO=""
cleanup(){ [ -n "$STAGE_VIDEO" ] && rm -f "$STAGE_VIDEO" || true; }
trap cleanup EXIT

# ---- final 4K ---------------------------------------------------------------------
if [ -n "$FINAL" ]; then
  [ -f "$FINAL" ] || { echo "missing $FINAL" >&2; exit 1; }
  mkdir -p site/media/final
  cp -f "$FINAL" site/media/final/final.mp4.tmp && mv -f site/media/final/final.mp4.tmp site/media/final/final.mp4
  echo "final copied: site/media/final/final.mp4"
  if [ -f "$FINAL_SBS" ]; then
    cp -f "$FINAL_SBS" site/media/final/sidebyside.mp4.tmp && mv -f site/media/final/sidebyside.mp4.tmp site/media/final/sidebyside.mp4
    echo "final side-by-side copied: site/media/final/sidebyside.mp4"
  fi
fi

# ---- encode + copy sheets -----------------------------------------------------------
if [ -n "$ID" ]; then
  VDIR=site/media/versions/$ID
  mkdir -p "$VDIR"
  if [ -n "$VIDEO" ]; then
    [ -f "$VIDEO" ] || { echo "missing $VIDEO" >&2; exit 1; }
    STAGE_VIDEO="$VDIR/.video.tmp.mp4"
    ffmpeg -v error -y -i "$VIDEO" \
      -map 0:v:0 -map '0:a:0?' \
      -vf "scale=1440:1080:flags=lanczos,format=yuv420p" \
      -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
      -c:a aac -b:a 128k -movflags +faststart "$STAGE_VIDEO"
    mv -f "$STAGE_VIDEO" "$VDIR/video.mp4"; STAGE_VIDEO=""
    if [ -z "$NO_SBS" ]; then
      SBS_LABEL=${LABEL:-$([[ "$ID" =~ ^iter([0-9]+)$ ]] && echo "v${BASH_REMATCH[1]}" || echo "$ID")}
      STAGE_VIDEO="$VDIR/.sbs.tmp.mp4"
      scripts/sidebyside.sh "$VIDEO" "$STAGE_VIDEO" "RECREATION $SBS_LABEL" >/dev/null
      mv -f "$STAGE_VIDEO" "$VDIR/sidebyside.mp4"; STAGE_VIDEO=""
    fi
    if [ -z "$RDATE" ]; then
      RDATE=$(date -d "@$(stat -c %Y "$VIDEO")" --iso-8601=seconds)
    fi
  fi
  if [ -n "$SHEETS" ]; then
    ls "$SHEETS"/sheet_*.jpg >/dev/null 2>&1 || { echo "no sheet_*.jpg in $SHEETS" >&2; exit 1; }
    mkdir -p "$VDIR/sheets"; rm -f "$VDIR"/sheets/sheet_*.jpg
    cp -f "$SHEETS"/sheet_*.jpg "$VDIR/sheets/"
  fi
fi

export ID COMMIT SCORES NOTE LABEL RDATE HAVE_VIDEO=${VIDEO:+1} HAVE_SHEETS=${SHEETS:+1} HAVE_FINAL=${FINAL:+1}
python3 - <<'PY'
import json, os, re, subprocess, datetime, glob, shutil

E = os.environ
def sh(*a, check=True):
    r = subprocess.run(a, capture_output=True, text=True)
    if check and r.returncode: raise SystemExit(f"{' '.join(a)}: {r.stderr.strip()}")
    return r.stdout.strip()
def write_json(path, obj):
    with open(path + ".tmp", "w") as f: json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(path + ".tmp", path)
def now(): return datetime.datetime.now().astimezone().isoformat(timespec="seconds")
def probe(path):
    try:
        j = json.loads(sh("ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=width,height,codec_type", "-of", "json", path))
        st = [s for s in j["streams"] if s.get("codec_type") == "video"][0]
        return round(float(j["format"]["duration"]), 3), f'{st["width"]}x{st["height"]}', int(j["format"]["size"])
    except Exception:
        return None, None, None

VJ = "site/versions.json"
versions = json.load(open(VJ)) if os.path.exists(VJ) else []
# tolerate {"versions":[...]} wrapper
if isinstance(versions, dict): versions = versions.get("versions", [])

ID = E.get("ID", "")
meta = None
if ID:
    vdir = f"site/media/versions/{ID}"
    idx = next((i for i, v in enumerate(versions) if v["id"] == ID), None)
    old = versions[idx] if idx is not None else None
    if old is None and not E.get("HAVE_VIDEO"):
        raise SystemExit(f"{ID} does not exist yet: --video is required to create it")

    meta = dict(old) if old else {}
    meta["id"] = ID
    m = re.fullmatch(r"iter(\d+)", ID)
    num = int(m.group(1)) if m else None
    if E.get("LABEL"): meta["label"] = E["LABEL"]
    else: meta.setdefault("label", f"v{num}" if num else ID)

    # git info (only refreshed when a video/sheets publish creates or replaces the entry)
    if old is None or E.get("HAVE_VIDEO") or E.get("HAVE_SHEETS"):
        ref = E["COMMIT"]
        h, subj, cdate, body = (sh("git", "log", "-1", "--format=%h%x1f%s%x1f%cI%x1f%b", ref).split("\x1f") + [""])[:4]
        dirty = ref == "HEAD" and bool(sh("git", "status", "--porcelain", "--", "src", "scripts/compare.sh"))
        meta.update(hash=h, subject=subj, commit_date=cdate, dirty=dirty)

        # previous version = next-older entry already in the archive
        older = versions[idx + 1:] if idx is not None else versions
        prev = older[0] if older else None
        lines = []
        if prev and prev.get("hash") and prev["hash"] != h:
            stat = sh("git", "diff", "--shortstat", prev["hash"], h, "--", "src", check=False)
            files = sh("git", "diff", "--numstat", prev["hash"], h, "--", "src", check=False)
            names = [os.path.basename(l.split("\t")[2]) for l in files.splitlines() if l.count("\t") >= 2]
            if stat:
                nums = re.findall(r"(\d+) (file|insertion|deletion)", stat)
                d = {k: int(n) for n, k in nums}
                lines.append(f"vs {prev['label']}: {d.get('file',0)} source file(s) changed, +{d.get('insertion',0)}/-{d.get('deletion',0)} lines ({', '.join(names)}).")
            else:
                lines.append(f"vs {prev['label']}: no source changes (re-render).")
        elif prev is None:
            lines.append("Initial version: the first full canvas engine render.")
        # commit body, minus trailers
        for l in body.splitlines():
            l = l.strip()
            if l and not re.match(r"(Co-Authored-By|Signed-off-by):", l, re.I) and "Generated with" not in l:
                lines.append(l)
        meta["changelog"] = lines
    if E.get("NOTE"):
        cl = meta.setdefault("changelog", [])
        if E["NOTE"] not in cl: cl.append(E["NOTE"])
        meta["note"] = E["NOTE"]

    # media facts
    vid = f"{vdir}/video.mp4"
    if os.path.exists(vid):
        dur, res, size = probe(vid)
        meta.update(video=f"media/versions/{ID}/video.mp4", duration=dur, resolution=res, size=size)
        if E.get("HAVE_VIDEO"):
            meta["render_date"] = E.get("RDATE") or now()
            meta["v"] = int(os.path.getmtime(vid))
        else:
            meta.setdefault("v", int(os.path.getmtime(vid)))
    sbs = f"{vdir}/sidebyside.mp4"
    if os.path.exists(sbs):
        _, sres, ssize = probe(sbs)
        meta.update(sidebyside=f"media/versions/{ID}/sidebyside.mp4", sbs_resolution=sres, sbs_size=ssize)
    meta["sheets"] = [f"media/versions/{ID}/sheets/{os.path.basename(p)}" for p in sorted(glob.glob(f"{vdir}/sheets/sheet_*.jpg"))]
    meta["published"] = now()

    # scores
    sj = json.load(open("site/scores.json")) if os.path.exists("site/scores.json") else {"sections": [], "rounds": []}
    if E.get("SCORES"):
        sc = [float(x) for x in E["SCORES"].split(",") if x.strip()]
        meta["scores"] = sc
        if num:   # keep the hand-edited scores.json in step
            sj["rounds"] = [r for r in sj["rounds"] if r["round"] != num] + [{"round": num, "scores": sc}]
            sj["rounds"].sort(key=lambda r: r["round"])
            write_json("site/scores.json", sj)
    elif meta.get("scores") is None and num:
        r = next((r for r in sj["rounds"] if r["round"] == num), None)
        meta["scores"] = r["scores"] if r else None
    meta.setdefault("scores", None)
    meta["score_sections"] = sj.get("sections", [])

    # write meta + list
    os.makedirs(vdir, exist_ok=True)
    write_json(f"{vdir}/meta.json", meta)
    if idx is None: versions.insert(0, meta)
    else: versions[idx] = meta
    write_json(VJ, versions)
    print(f"published {ID} ({meta['label']}) {meta.get('hash')} scores={meta['scores']}; {len(versions)} versions")

# ---- current.mp4 + data.json always mirror the newest version -----------------------
data_path = "site/data.json"
data = json.load(open(data_path)) if os.path.exists(data_path) else {}
if versions:
    top = versions[0]
    src = f"site/{top['video']}" if top.get("video") else None
    if src and os.path.exists(src):
        stale = (not os.path.exists("site/media/current.mp4") or data.get("iteration") != top["id"]
                 or (E.get("ID") == top["id"] and E.get("HAVE_VIDEO")))
        if stale:
            shutil.copyfile(src, "site/media/current.mp4.tmp"); os.replace("site/media/current.mp4.tmp", "site/media/current.mp4")
    data.pop("scores", None)   # legacy key; scores now live in versions.json
    data.update({
        "generated": now(),
        "iteration": top["id"], "label": top["label"],
        "version": {"hash": top.get("hash"), "subject": top.get("subject"), "date": top.get("commit_date"), "dirty": top.get("dirty", False)},
        "render": {"date": top.get("render_date"), "duration": top.get("duration"), "resolution": top.get("resolution"), "v": top.get("v")},
        "sheets": [os.path.basename(s) for s in top.get("sheets", [])],
        "versions": [v["id"] for v in versions],
    })
if E.get("HAVE_FINAL"):
    f = "site/media/final/final.mp4"
    dur, res, size = probe(f)
    data["final"] = {"path": "media/final/final.mp4", "resolution": res, "duration": dur, "size": size, "date": now(), "label": "2880x2160"}
    sb = "site/media/final/sidebyside.mp4"
    if os.path.exists(sb):
        _, sres, ssize = probe(sb)
        data["final"].update(sidebyside="media/final/sidebyside.mp4", sbs_resolution=sres, sbs_size=ssize)
write_json(data_path, data)
PY
