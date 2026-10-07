#!/usr/bin/env node
// Build a portable /site showcase from the committed media archive.
// usage: node scripts/build-site.js [outDir=dist]  (or SITE_DIST=<dir>)
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const media = path.join(root, 'media');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const scores = read(path.join(root, 'site/scores.json'));
const stat = p => fs.statSync(path.join(root, 'site', p)).size;
const versions = fs.readdirSync(path.join(media, 'versions'))
  .filter(name => /^v\d+$/.test(name))
  .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))
  .map(name => {
    const dir = path.join(media, 'versions', name);
    const v = read(path.join(dir, 'meta.json'));
    const prefix = '../media/versions/' + name;
    v.video = prefix + '/render.mp4';
    v.sidebyside = prefix + '/sidebyside.mp4';
    v.size = stat(v.video);
    v.sbs_size = stat(v.sidebyside);
    v.sheets = fs.readdirSync(path.join(dir, 'sheets')).filter(n => /^sheet_.*\.jpg$/.test(n)).sort().map(n => prefix + '/sheets/' + n);
    v.extras = (v.extras || []).map(x => ({ ...x, src: prefix + '/extras/' + path.basename(x.src) }));
    v.scores = scores.rounds.find(r => r.round === Number(name.slice(1)))?.scores || v.scores;
    if (name === 'v14') v.scores = [6.8, 7.9, 8.4]; // Final judge round documented in media/README.md.
    v.score_sections = scores.sections;
    v.dirty = false; // These files are the archived renders.
    for (const p of [...v.sheets, ...v.extras.map(x => x.src)]) stat(p);
    return v;
  });
if (!versions.length) throw new Error('No archived versions found');
const final = {
  path: '../media/final/claude_v14_2880x2160.mp4',
  sidebyside: '../media/final/claude_v14_sidebyside.mp4',
  resolution: '2880x2160',
  duration: versions[0].duration
};
final.size = stat(final.path);
final.sbs_size = stat(final.sidebyside);
const write = (name, value) => fs.writeFileSync(path.join(root, 'site', name), JSON.stringify(value, null, 2) + '\n');
write('versions.json', versions);
write('data.json', { iteration: versions[0].id, label: versions[0].label, final });
// Render the sanitised session into the two replay pages (static HTML, no runtime fetch).
const session = require('./session-render.js').renderInto(path.join(root, 'site'));
const dist = path.resolve(root, process.argv[2] || process.env.SITE_DIST || 'dist');
fs.mkdirSync(path.join(dist, 'site'), { recursive: true });
const files = ['index.html', 'how-we-made-this.html', 'how-we-made-this.css', 'how-we-made-this.js', 'session.html', 'full-session.css', 'full-session.js', 'replay.css', 'theme.css', 'theme.js', 'versions.json', 'data.json', 'scores.json'];
for (const file of files) fs.copyFileSync(path.join(root, 'site', file), path.join(dist, 'site', file));
fs.cpSync(path.join(root, 'site', 'stills'), path.join(dist, 'site', 'stills'), { recursive: true });
fs.cpSync(media, path.join(dist, 'media'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=site/"><title>Love Motion Recreation</title><a href="site/">Open the showcase</a></html>\n');
console.log(`Built ${path.relative(root, dist) || '.'}/site: showcase, session replay (${session.meta.counts.human} messages, ${session.meta.counts.tools} tool calls), full session, ${versions.length} versions and media.`);
module.exports = { files };
