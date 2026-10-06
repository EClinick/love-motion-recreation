# love-motion-recreation

A frame-by-frame recreation of a 20-second kinetic-typography / pixel-icon motion piece,
built entirely from code: every icon, figure, scribble and transition is drawn procedurally
with `@napi-rs/canvas` (Skia) and encoded with ffmpeg. No footage from the reference is used.

## Layout

| path | what |
| --- | --- |
| `src/scenes.js` | the timeline – 14 shots, each a pure function of time |
| `src/lib/sprites.js` | original pixel-art icons rasterised on an integer grid |
| `src/lib/figures.js` | thermal-gradient head profile and hand |
| `src/lib/fx.js` | grain, vignettes, sparkle stars, handwriting scribbles, type |
| `src/render.js` | multi-threaded renderer → ffmpeg segments → mux with audio |
| `scripts/compare.sh` | side-by-side reference vs. render contact sheets |

## Usage

Put `reference.mp4` and `audio.mp3` in `ref/` (see `ref/README.md`), then:

```bash
npm install && scripts/fetch-fonts.sh
npm run preview      # 1440x1080, ~15s
npm run compare      # contact sheets in out/compare/latest
npm run render       # 2880x2160 with 4-sample motion blur
node src/render.js --stills 2.5,8.7   # single frames to out/stills
```
