#!/usr/bin/env node
// Tiny static server with HTTP Range support (video seeking). Binds 127.0.0.1 only.
// usage: node scripts/serve-site.js [port=8787] [dir=site]
const http = require('http'), fs = require('fs'), path = require('path');
const port = +process.argv[2] || 8787;
const root = path.resolve(process.argv[3] || path.join(__dirname, '..', 'site'));
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const h = { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString() };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let s = m[1] ? +m[1] : st.size - +m[2], e = m[1] && m[2] ? +m[2] : st.size - 1;
      e = Math.min(e, st.size - 1);
      if (s > e || s >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f, { start: s, end: e }).pipe(res);
    } else {
      res.writeHead(200, { ...h, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).pipe(res);
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
