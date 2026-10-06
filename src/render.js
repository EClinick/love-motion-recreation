// Parallel frame renderer.
//   node src/render.js [--scale 1] [--samples 1] [--from 0] [--to 20.48] [--out out/render.mp4] [--stills t1,t2,...]
// Workers render contiguous frame ranges, each piping raw RGBA into its own ffmpeg
// segment; segments are then concatenated and muxed with the soundtrack.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FPS_NUM = 24000;
const FPS_DEN = 1001;
const FPS = FPS_NUM / FPS_DEN;
const DURATION = 20.458;

function args() {
  const a = process.argv.slice(2);
  const o = { scale: 1, samples: 1, from: 0, to: DURATION, out: 'out/render.mp4', stills: null, workers: Math.max(1, os.cpus().length - 2) };
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    o[k] = ['out', 'stills'].includes(k) ? a[i + 1] : Number(a[i + 1]);
  }
  return o;
}

function renderer(scale, samples) {
  const { createCanvas } = require('@napi-rs/canvas');
  const { renderFrame, setScale } = require('./scenes');
  setScale(scale);
  const { W, H } = require('./lib/core');
  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext('2d');
  const sub = samples > 1 ? createCanvas(W * scale, H * scale) : null;
  const sctx = sub && sub.getContext('2d');
  return (frame) => {
    const t = frame / FPS;
    if (samples <= 1) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      renderFrame(ctx, t, frame);
      return canvas;
    }
    // temporal supersampling = motion blur (180° shutter)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * scale, H * scale);
    for (let i = 0; i < samples; i++) {
      const st = t + ((i + 0.5) / samples - 0.5) * (0.5 / FPS);
      sctx.setTransform(scale, 0, 0, scale, 0, 0);
      renderFrame(sctx, Math.max(0, st), frame);
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(sub, 0, 0);
    }
    ctx.globalAlpha = 1;
    return canvas;
  };
}

if (!isMainThread) {
  const { start, end, scale, samples, segPath } = workerData;
  const draw = renderer(scale, samples);
  const { W, H } = require('./lib/core');
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W * scale}x${H * scale}`,
    '-r', `${FPS_NUM}/${FPS_DEN}`, '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
    '-pix_fmt', 'yuv420p', segPath,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  (async () => {
    for (let f = start; f < end; f++) {
      const c = draw(f);
      const buf = c.data();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      parentPort.postMessage({ done: 1 });
    }
    ff.stdin.end();
    ff.on('close', (code) => parentPort.postMessage({ finished: code }));
  })();
} else {
  const o = args();
  const outDir = path.join(ROOT, path.dirname(o.out));
  fs.mkdirSync(outDir, { recursive: true });

  if (o.stills) {
    // quick single-frame renders to PNG for inspection
    const draw = renderer(o.scale, o.samples);
    const dir = path.join(ROOT, 'out', 'stills');
    fs.mkdirSync(dir, { recursive: true });
    o.stills.split(',').forEach((s) => {
      const f = Math.round(Number(s) * FPS);
      fs.writeFileSync(path.join(dir, `r_${s}.png`), draw(f).toBuffer('image/png'));
    });
    console.log('stills ->', dir);
    process.exit(0);
  }

  const f0 = Math.round(o.from * FPS);
  const f1 = Math.round(o.to * FPS);
  const total = f1 - f0;
  const n = Math.min(o.workers, total);
  const segDir = path.join(ROOT, 'out', 'segments');
  fs.rmSync(segDir, { recursive: true, force: true });
  fs.mkdirSync(segDir, { recursive: true });
  const per = Math.ceil(total / n);
  let done = 0;
  const t0 = Date.now();
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const start = f0 + i * per;
    const end = Math.min(f1, start + per);
    if (start >= end) break;
    const segPath = path.join(segDir, `seg_${String(i).padStart(3, '0')}.mp4`);
    jobs.push(
      new Promise((resolve, reject) => {
        const w = new Worker(__filename, { workerData: { start, end, scale: o.scale, samples: o.samples, segPath } });
        w.on('message', (m) => {
          if (m.done) {
            done++;
            if (done % 20 === 0 || done === total) process.stdout.write(`\r${done}/${total} frames  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          }
          if (m.finished !== undefined) (m.finished === 0 ? resolve(segPath) : reject(new Error('ffmpeg failed')));
        });
        w.on('error', reject);
      })
    );
  }
  Promise.all(jobs).then((segs) => {
    console.log();
    const list = path.join(segDir, 'list.txt');
    fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
    const silent = path.join(segDir, 'silent.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
    const out = path.join(ROOT, o.out);
    const audioOffset = o.from;
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', silent, '-ss', String(audioOffset), '-i', path.join(ROOT, 'ref', 'audio.mp3'),
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out,
    ]);
    console.log('wrote', out, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  });
}
