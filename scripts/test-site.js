#!/usr/bin/env node
// Dependency-free static-site regression checks. Run from any directory.
// The build goes to a temporary directory so tests never touch a live dist/.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'lmr-site-'));
const pages = ['index.html', 'how-we-made-this.html', 'session.html'];
const assets = ['theme.css', 'theme.js', 'replay.css', 'how-we-made-this.css', 'how-we-made-this.js', 'full-session.css', 'full-session.js'];
const read = file => fs.readFileSync(file, 'utf8');
const site = name => read(path.join(root, 'site', name));
const messages = JSON.parse(read(path.join(__dirname, 'session-messages.json')));
const session = JSON.parse(site('session.json'));
let server, base;

before(async () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build-site.js'), dist], { cwd: root });
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // Serving the checkout's parent of site/ and the temporary build exercises both layouts.
  server = spawn(process.execPath, [path.join(__dirname, 'serve-site.js'), String(port), dist], { stdio: ['ignore', 'pipe', 'pipe'] });
  base = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server did not start')), 5000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Static server exited: ${code}`)); });
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
});
after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  fs.rmSync(dist, { recursive: true, force: true });
});

function markup(file) {
  // Keep script attributes for asset checks, but ignore strings inside the JS.
  return read(file).replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
}
function ids(html) { return [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); }
const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const prompts = html => [...html.matchAll(/<h[23] class="t-prompt" id="m(\d+)">[\s\S]*?<span class="t-ptext">([\s\S]*?)<\/span><time datetime="([^"]+)"/g)].map(m => ({ n: +m[1], text: text(m[2]), t: m[3] }));

test('pages, styles, scripts and stills are copied byte-for-byte', () => {
  for (const name of [...pages, ...assets]) assert.equal(read(path.join(dist, 'site', name)), site(name), name);
  for (const still of fs.readdirSync(path.join(root, 'site', 'stills'))) {
    assert.deepEqual(fs.readFileSync(path.join(dist, 'site', 'stills', still)), fs.readFileSync(path.join(root, 'site', 'stills', still)));
  }
  assert.match(read(path.join(dist, 'index.html')), /href="site\/"/);
});

test('committed replay HTML is exactly what the renderer produces from session.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmr-render-'));
  try {
    for (const name of ['session.json', 'how-we-made-this.html', 'session.html']) fs.copyFileSync(path.join(root, 'site', name), path.join(tmp, name));
    require('./session-render.js').renderInto(tmp);
    for (const name of ['how-we-made-this.html', 'session.html']) assert.equal(read(path.join(tmp, name)), site(name), `${name} is stale: run npm run site:build`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('all static local links, fragments and media resolve in checkout and portable build', () => {
  for (const directory of [root, dist]) {
    for (const name of pages) {
      const file = path.join(directory, 'site', name);
      const html = markup(file);
      const allIds = ids(html);
      assert.equal(new Set(allIds).size, allIds.length, `duplicate IDs in ${name}`);
      for (const [, attr, value] of html.matchAll(/\b(href|src|poster)="([^"]+)"/g)) {
        if (/^(?:https?:|data:|mailto:)/.test(value)) continue;
        assert.ok(!value.startsWith('/'), `${name}: ${attr} must be portable: ${value}`);
        const url = new URL(value.replace(/&amp;/g, '&'), pathToFileURL(file));
        const target = fileURLToPath(url);
        assert.ok(fs.existsSync(target), `${name}: missing ${value}`);
        if (url.hash && target.endsWith('.html')) {
          assert.ok(ids(markup(target)).includes(decodeURIComponent(url.hash.slice(1))), `${name}: missing fragment ${value}`);
        }
      }
    }
  }
});

test('every manifest version and final media file exists', () => {
  const dir = path.join(dist, 'site');
  const versions = JSON.parse(read(path.join(dir, 'versions.json')));
  const expected = fs.readdirSync(path.join(root, 'media', 'versions')).filter(n => /^v\d+$/.test(n)).length;
  assert.equal(versions.length, expected);
  assert.ok(versions.length >= 18);
  const data = JSON.parse(read(path.join(dir, 'data.json')));
  assert.equal(data.iteration, versions[0].id);
  assert.equal(data.label, versions[0].label);
  const v18 = versions.find(v => v.label === 'v18');
  assert.equal(v18.hash, 'fda013a');
  assert.deepEqual(v18.scores, [7.5, 7.0, 8.5]);
  assert.deepEqual(versions.find(v => v.label === 'v16').scores, [6.0, 6.0, 7.5]);
  const files = [data.final.path, data.final.sidebyside];
  for (const version of versions) files.push(version.video, version.sidebyside, ...version.sheets, ...(version.extras || []).map(x => x.src));
  for (const file of files) assert.ok(fs.statSync(path.resolve(dir, file)).size > 0, file);
});

test('published session data and pages carry no private data or hidden reasoning', () => {
  const { BANNED, check } = require('./session-extract.js');
  check(JSON.stringify(session));
  assert.throws(() => check('/home/someone/dev'), /banned/);
  assert.throws(() => check('see 100.64.1.2'), /banned/);
  assert.throws(() => check('Authorization: Bearer abc'), /banned/);
  const files = [...pages, ...assets].map(name => path.join(dist, 'site', name)).concat(path.join(root, 'site', 'session.json'));
  for (const file of files) {
    const body = read(file);
    for (const re of BANNED) assert.doesNotMatch(body, re, `${path.basename(file)} matches ${re}`);
    assert.doesNotMatch(body, /\.jsonl\b|signature"|"thinking"/, path.basename(file));
  }
  assert.ok(!fs.existsSync(path.join(dist, 'site', 'session.json')), 'raw session data is not part of the public build');
  for (const e of session.events) assert.ok(['human', 'say', 'tool', 'omit', 'compact', 'slash'].includes(e.k), `unexpected event kind ${e.k}`);
});

test('my 21 approved messages appear verbatim, in order, in the replay and the full session', () => {
  for (const name of ['how-we-made-this.html', 'session.html']) {
    const found = prompts(site(name));
    assert.equal(found.length, messages.approved.length, name);
    found.forEach((p, i) => {
      assert.equal(p.n, i + 1);
      assert.equal(p.text, messages.approved[i].text, `${name} message ${i + 1}`);
      assert.equal(p.t, messages.approved[i].t);
    });
    assert.deepEqual(found.map(p => p.t), found.map(p => p.t).sort());
  }
  const first = prompts(site('how-we-made-this.html'))[0].text;
  assert.equal(first, '[local media folder redacted] analyze the mp4 here and use the mp3 as the video. But replicate this video from scratch, make it identical. Got all out on motion effects, transitions, icons, to mimic this video exactly. have a judge of sonnet 5.5 critics at the end analzye so you can iteratively loop until it looks the same.');
  assert.equal(messages.approved.filter(m => m.via === 'queued').length, (site('how-we-made-this.html').match(/Claude Code queued it\./g) || []).length);
});

test('the replay is labelled as a rebuilt record, readable without JS, and complete in the full session', () => {
  const how = site('how-we-made-this.html'), full = site('session.html');
  for (const html of [how, full]) {
    assert.match(html, /Rebuilt from the session record\. Not a live terminal\./);
    assert.match(html, /Claude Code<\/b> 2\.1\.285/);
    assert.match(html, /Context compacted\./);
    assert.match(html, /Left out of this replay\./);
    assert.doesNotMatch(html, /<input[^>]+class="t-|Thinking…|esc to interrupt/);
  }
  const tools = session.events.filter(e => e.k === 'tool').length, replies = session.events.filter(e => e.k === 'say').length;
  assert.equal((full.match(/class="t-line t-tool/g) || []).length, tools);
  assert.equal((full.match(/class="t-line t-say"/g) || []).length, replies);
  assert.ok((how.match(/class="t-line t-tool/g) || []).length < tools / 2, 'the condensed replay is a selection');
  // Every condensed gap is counted and links to a real step in the full session.
  const gaps = [...how.matchAll(/<a class="gap" href="session\.html#(e\d+)">⋮ (\d+) more steps?/g)];
  assert.ok(gaps.length > 20);
  for (const [, id] of gaps) assert.ok(ids(full).includes(id), id);
  const shown = (how.match(/id="e\d+"/g) || []).length;
  assert.equal(shown + gaps.reduce((n, g) => n + Number(g[2]), 0), session.events.filter(e => e.k !== 'human' && e.k !== 'slash').length);
});

test('old walkthrough anchors still land on the matching message or section', () => {
  const how = site('how-we-made-this.html');
  for (const id of ['prompts', 'initial-prompt', 'follow-ups', 'workflow', 'lessons', 'try-it', 'sources', 'prompt-measure', 'prompt-trace', 'prompt-archive']) assert.ok(ids(how).includes(id), id);
  const before = (anchor, n) => assert.match(how, new RegExp(`id="${anchor}"></span>(?:<span class="anchor" id="[^"]+"></span>)*<h3 class="t-prompt" id="m${n}"`));
  before('initial-prompt', 1); before('follow-ups', 2); before('prompt-measure', 9); before('prompt-trace', 11); before('prompt-archive', 14);
  assert.match(prompts(how)[8].text, /programmatically compare/);
  assert.match(prompts(how)[10].text, /looks like a balloon/);
  assert.match(prompts(how)[13].text, /web sendable mp4s/);
  assert.match(site('index.html'), /href="how-we-made-this\.html#lessons"/);
});

test('singular framing, route, labels and navigation are kept on every page', () => {
  const how = site('how-we-made-this.html');
  assert.match(how, /<title>How I made this · Love Motion Recreation<\/title>/);
  assert.equal((how.match(/<h1\b/g) || []).length, 1);
  assert.match(how, /<h1 id="title">How I made <span class="nowrap">this<span class="cursor"/);
  assert.match(how, /<meta name="description" content="How I made Love Motion Recreation:/);
  const authored = how.replace(/<!-- replay:start -->[\s\S]*?<!-- replay:end -->/, '').replace(/<!-- messages:start -->[\s\S]*?<!-- messages:end -->/, '').replace(/<pre\b[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(authored, /\b(?:we|our|ours|us)\b/i);
  for (const name of pages) {
    const html = site(name);
    assert.match(html, /<a href="how-we-made-this\.html"(?: aria-current="page")?>How I made this<\/a>/, name);
    assert.match(html, /<a href="session\.html"(?: aria-current="page")?>Full session<\/a>/, name);
    assert.match(html, /<a class="skip-link" href="#[^"]+">/, name);
    assert.doesNotMatch(html, /prefers-color-scheme/, name);
  }
  assert.match(site('index.html'), /aria-label="How I made this"/);
  assert.doesNotMatch(how + site('session.html') + site('index.html'), /autoplay/);
});

test('walkthrough uses genuine pinned v18 media without replacing the original reference', () => {
  const { createHash } = require('node:crypto');
  const html = site('how-we-made-this.html');
  assert.match(html, /<video[^>]+poster="\.\.\/media\/versions\/v18\/pairs\/pair_030\.jpg"[^>]+aria-label="Archived v18 original reference versus Claude recreation"[^>]+src="\.\.\/media\/versions\/v18\/sidebyside\.mp4"/);
  assert.ok(html.includes('href="../media/original/original.mp4">Watch the original reference'));
  assert.match(html, /do not extend the prompt snapshot/);
  assert.doesNotMatch(html, /(?:src|href)="\.\.\/media\/[^"\n]*(?:v14|v16)[^"\n]*\.(?:mp4|png|jpg)"/);
  for (const v of ['v01', 'v08', 'v10', 'v14']) assert.ok(html.includes(`src="stills/hand-${v}.jpg"`), v);
  const expected = {
    'media/versions/v18/sidebyside.mp4': 'a1658642350a640d2728f994f2602b15ec69c2c1',
    'media/versions/v18/pairs/pair_030.jpg': 'fbf72335faca86065d8683353ba2760f433c88d0',
    'media/original/original.mp4': '1f5968622259667dbd890809c4a1889b0564548d'
  };
  for (const [file, hash] of Object.entries(expected)) {
    for (const directory of [root, dist]) {
      const bytes = fs.readFileSync(path.join(directory, file));
      const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      assert.equal(actual, hash, `${directory}: ${file}`);
    }
  }
});

test('walkthrough caveats and preparation commands reflect the merged archive', () => {
  const html = site('how-we-made-this.html');
  assert.match(html, /Archive caveat:/);
  assert.match(html, /corrected v15\/v16 sheets and pairs/);
  assert.match(html, /not a finished v17/);
  assert.match(html, /<details id="try-it" class="reproduce">/);
  for (const args of ['413 431 pen soft', '432 487', '413 431 dark', '487 487 dark']) assert.ok(html.includes(`node scripts/trace-pen.js ${args}`));
  for (const [, target] of html.matchAll(/data-copy="([^"]+)"/g)) assert.ok(ids(html).includes(target));
  for (const image of markup(path.join(root, 'site', 'how-we-made-this.html')).matchAll(/<img\b[^>]*>/g)) assert.match(image[0], /alt="[^"]+"/);
});

test('theme defaults to off-white, persists a choice, and works when storage is denied', () => {
  function boot(saved, denied = false) {
    const attrs = new Map(), battrs = new Map();
    const button = { hidden: true, setAttribute: (k, v) => battrs.set(k, v) };
    const storage = { value: saved, getItem() { if (denied) throw new Error('denied'); return this.value; }, setItem(key, value) { if (denied) throw new Error('denied'); this.value = value; } };
    const context = {
      document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k), hasAttribute: k => attrs.has(k) }, getElementById: () => button },
      localStorage: storage, matchMedia: () => ({ matches: true })
    };
    vm.runInNewContext(site('theme.js'), context);
    return { attrs, button, battrs, storage };
  }
  const fresh = boot(null);
  assert.equal(fresh.attrs.get('data-theme'), undefined, 'no theme attribute means off-white, even if the system prefers dark');
  fresh.button.onclick();
  assert.equal(fresh.attrs.get('data-theme'), 'dark');
  assert.equal(fresh.battrs.get('aria-pressed'), 'true');
  const first = boot('dark');
  assert.equal(first.attrs.get('data-theme'), 'dark');
  assert.equal(first.button.hidden, false);
  first.button.onclick();
  assert.equal(first.storage.value, 'light');
  assert.equal(boot(first.storage.value).attrs.get('data-theme'), 'light');
  const denied = boot(null, true);
  denied.button.onclick();
  assert.equal(denied.attrs.get('data-theme'), 'dark');
});

test('copy buttons enhance static text and handle denied clipboard access', async () => {
  const status = { textContent: '' };
  const source = { textContent: 'npm run site:build' };
  let copied, handler, selected;
  const button = { dataset: { copy: 'example' }, hidden: true, addEventListener: (event, callback) => { handler = callback; }, closest: () => ({ querySelector: () => status }) };
  const context = {
    document: { querySelectorAll: () => [button], getElementById: () => source, createRange: () => ({ selectNodeContents: node => { selected = node; } }) },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) }
  };
  vm.runInNewContext(site('how-we-made-this.js'), context);
  assert.equal(button.hidden, false);
  await handler();
  assert.equal(copied, source.textContent);
  assert.equal(status.textContent, 'Copied to clipboard.');
  context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await handler();
  assert.equal(selected, source);
  assert.match(status.textContent, /Text selected/);
});

test('pages, CSS/JS, stills, video HEAD and byte ranges serve correctly', async () => {
  for (const name of [...pages, ...assets, 'stills/hand-v14.jpg']) {
    const response = await fetch(`${base}/site/${name}`);
    assert.equal(response.status, 200, name);
    if (!name.endsWith('.jpg')) assert.equal(await response.text(), site(name));
  }
  for (const file of ['final/claude_v14_sidebyside.mp4', 'versions/v18/sidebyside.mp4']) {
    const media = `${base}/media/${file}`;
    const head = await fetch(media, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'video/mp4');
    const range = await fetch(media, { headers: { Range: 'bytes=0-31' } });
    assert.equal(range.status, 206);
    assert.match(range.headers.get('content-range'), /^bytes 0-31\//);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
  }
});
