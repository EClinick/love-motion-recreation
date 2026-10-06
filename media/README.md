# Media archive

Every video produced by the Love motion recreation project, one folder per iteration, plus the original and the final 4K render.
All videos are H.264 (High profile, yuv420p) with AAC 192 kb/s audio and `+faststart`, and each is under 95 MB so it can live in git.

## Index

| Version | Commit | Judge scores (0-7.25 / 7.5-14.75 / 15-20.4 s) | Render | Side-by-side | Sheets | Extras |
|---|---|---|---|---|---|---|
| v01 | [`3778cec`](https://github.com/EClinick/love-motion-recreation/commit/3778cec) | 4.5 / 5.0 / 5.0 | [`render.mp4`](versions/v01/render.mp4) (7.2 MB) | [`sidebyside.mp4`](versions/v01/sidebyside.mp4) (14.0 MB) | `sheets/` (9) |  |
| v02 | [`9920be9`](https://github.com/EClinick/love-motion-recreation/commit/9920be9) | 5.3 / 6.0 / 5.5 | [`render.mp4`](versions/v02/render.mp4) (7.9 MB) | [`sidebyside.mp4`](versions/v02/sidebyside.mp4) (14.3 MB) | `sheets/` (9) |  |
| v03 | [`8b14209`](https://github.com/EClinick/love-motion-recreation/commit/8b14209) | 6.3 / 6.5 / 6.5 | [`render.mp4`](versions/v03/render.mp4) (8.2 MB) | [`sidebyside.mp4`](versions/v03/sidebyside.mp4) (14.5 MB) | `sheets/` (9) |  |
| v04 | [`a631508`](https://github.com/EClinick/love-motion-recreation/commit/a631508) | 6.7 / 7.0 / 7.0 | [`render.mp4`](versions/v04/render.mp4) (8.3 MB) | [`sidebyside.mp4`](versions/v04/sidebyside.mp4) (14.6 MB) | `sheets/` (9) |  |
| v05 | [`1107073`](https://github.com/EClinick/love-motion-recreation/commit/1107073) | 6.7 / 7.0 / 7.5 | [`render.mp4`](versions/v05/render.mp4) (8.6 MB) | [`sidebyside.mp4`](versions/v05/sidebyside.mp4) (14.9 MB) | `sheets/` (9) |  |
| v06 | [`5821a0b`](https://github.com/EClinick/love-motion-recreation/commit/5821a0b) | 6.9 / 7.5 / 7.5 | [`render.mp4`](versions/v06/render.mp4) (8.7 MB) | [`sidebyside.mp4`](versions/v06/sidebyside.mp4) (15.0 MB) | `sheets/` (9) |  |
| v07 | [`a874e5e`](https://github.com/EClinick/love-motion-recreation/commit/a874e5e) | 7.0 / 7.7 / 7.7 | [`render.mp4`](versions/v07/render.mp4) (8.7 MB) | [`sidebyside.mp4`](versions/v07/sidebyside.mp4) (14.9 MB) | `sheets/` (9) |  |
| v08 | [`1b54415`](https://github.com/EClinick/love-motion-recreation/commit/1b54415) | 6.8 / 7.8 / 7.6 | [`render.mp4`](versions/v08/render.mp4) (15.7 MB) | [`sidebyside.mp4`](versions/v08/sidebyside.mp4) (20.8 MB) | `sheets/` (9) |  |
| v09 | [`2aca35b`](https://github.com/EClinick/love-motion-recreation/commit/2aca35b) | 7.0 / 7.8 / 7.7 | [`render.mp4`](versions/v09/render.mp4) (12.3 MB) | [`sidebyside.mp4`](versions/v09/sidebyside.mp4) (17.9 MB) | `sheets/` (9) |  |
| v10 | [`47d780e`](https://github.com/EClinick/love-motion-recreation/commit/47d780e) | 7.0 / 7.9 / 8.0 | [`render.mp4`](versions/v10/render.mp4) (10.6 MB) | [`sidebyside.mp4`](versions/v10/sidebyside.mp4) (16.7 MB) | `sheets/` (9) | shape overlays |
| v11 | [`81a5932`](https://github.com/EClinick/love-motion-recreation/commit/81a5932) | 7.0 / 7.9 / 8.1 | [`render.mp4`](versions/v11/render.mp4) (10.0 MB) | [`sidebyside.mp4`](versions/v11/sidebyside.mp4) (16.2 MB) | `sheets/` (9) | shape overlays |
| v12 | [`265bc53`](https://github.com/EClinick/love-motion-recreation/commit/265bc53) | 7.0 / 8.0 / 8.2 | [`render.mp4`](versions/v12/render.mp4) (9.9 MB) | [`sidebyside.mp4`](versions/v12/sidebyside.mp4) (16.1 MB) | `sheets/` (9) | shape overlays |
| v13 | [`c437219`](https://github.com/EClinick/love-motion-recreation/commit/c437219) | not judged | [`render.mp4`](versions/v13/render.mp4) (9.9 MB) | [`sidebyside.mp4`](versions/v13/sidebyside.mp4) (16.1 MB) | `sheets/` (9) | shape overlays |
| v14 (final) | [`ce0afd5`](https://github.com/EClinick/love-motion-recreation/commit/ce0afd5) | 6.8 / 7.9 / 8.4 | [`render.mp4`](versions/v14/render.mp4) (10.0 MB) | [`sidebyside.mp4`](versions/v14/sidebyside.mp4) (16.1 MB) | `sheets/` (9) | shape overlays |

## Other files

- [`original/original.mp4`](original/original.mp4) (14.6 MB): the reference video this project recreates, re-encoded to 1440x1080 for the web. [`original/original.mp3`](original/original.mp3) is its soundtrack.
- [`final/claude_v14_2880x2160.mp4`](final/claude_v14_2880x2160.mp4) (66.9 MB): the final render of v14 at 2880x2160 with motion blur and audio.
- [`final/claude_v14_sidebyside.mp4`](final/claude_v14_sidebyside.mp4) (28.6 MB): the original (left, labelled REFERENCE) next to the final render (right, labelled CLAUDE), 2880x1080.

## What each file in a version folder is

- `render.mp4`: the 1440x1080 preview render of that iteration's commit, with the soundtrack. Early versions (v01-v06) were re-rendered from their commits after the originals were overwritten.
- `sidebyside.mp4`: reference on the left, that version on the right (2880x1080), with the soundtrack.
- `sheets/sheet_01.jpg` ... `sheet_09.jpg`: comparison contact sheets, 4 fps, reference left and render right, as shown to the judges.
- `extras/*.png` (v10 onward): shape-match overlays at 5.0 s and 14.6 s (cyan = original, red = ours).
- `meta.json`: commit, dates, judge scores, changelog and the site's file paths. The paths inside refer to the showcase site layout, not this folder.

Judge scores are out of 10 and come from the Sonnet judge rounds. A version's scores are those given to that version's render.
