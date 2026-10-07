# v18 media for the making-of page

These two files are unmodified copies of existing project media, pinned to archive
revision [`d2546690bbaf3dcdf1c8fe79079ac10dac31de70`](https://github.com/EClinick/love-motion-recreation/tree/d2546690bbaf3dcdf1c8fe79079ac10dac31de70/media/versions/v18).
Its [`meta.json`](https://github.com/EClinick/love-motion-recreation/blob/d2546690bbaf3dcdf1c8fe79079ac10dac31de70/media/versions/v18/meta.json)
identifies the v18 render commit as `fda013a` and describes index-aligned comparison pairs.

| File | Upstream path | Git blob SHA-1 |
| --- | --- | --- |
| `sidebyside.mp4` | `media/versions/v18/sidebyside.mp4` | `a1658642350a640d2728f994f2602b15ec69c2c1` |
| `pair_030.jpg` | `media/versions/v18/pairs/pair_030.jpg` | `fbf72335faca86065d8683353ba2760f433c88d0` |

The video is 2880×1080 H.264 at 24000/1001 fps, with the **original reference on the
left** and **Claude's v18 recreation on the right**. The 1600×600 still uses the same
ordering and labels both panels 14.514500 seconds. Neither is a relabelled v14/v16
asset, a silhouette overlay, or a claim of perfect fidelity.

The original web reference at `media/original/original.mp4` has the same Git blob
(`1f5968622259667dbd890809c4a1889b0564548d`) in this checkout and the pinned upstream
revision; it has not been replaced by a recreation.

These selected files live outside `media/versions/` so updating the making-of page
does not change the main showcase's generated version manifest. The static build
already copies all of `media/`, including this directory. The page explicitly
separates this later v18 media from the earlier prompt/session checkpoint.
