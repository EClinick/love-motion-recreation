#!/usr/bin/env node
// Dependency-free static-site regression checks. Run from any directory.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pages = ['index.html', 'how-we-made-this.html'];
const assets = ['theme.css', 'theme.js', 'how-we-made-this.css', 'how-we-made-this.js'];
const read = file => fs.readFileSync(file, 'utf8');
let server, base;

before(async () => {
  execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { cwd: root });
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // Serving the checkout also exposes dist/ as a nested hosting prefix.
  server = spawn(process.execPath, [path.join(__dirname, 'serve-site.js'), String(port), root], { stdio: ['ignore', 'pipe', 'pipe'] });
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
});

function markup(file) {
  // Keep script attributes for asset checks, but ignore strings inside the JS.
  return read(file).replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
}
function ids(html) { return [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); }

test('both pages and shared assets are copied byte-for-byte', () => {
  for (const name of [...pages, ...assets]) {
    assert.equal(read(path.join(dist, 'site', name)), read(path.join(root, 'site', name)), name);
  }
  assert.match(read(path.join(dist, 'index.html')), /href="site\/"/);
});

test('all static local links, fragments and media resolve in checkout and portable build', () => {
  for (const directory of [root, dist]) {
    for (const name of pages) {
      const file = path.join(directory, 'site', name);
      const html = markup(file);
      const allIds = ids(html);
      assert.equal(new Set(allIds).size, allIds.length, `duplicate IDs in ${name}`);
      for (const [, attr, value] of html.matchAll(/\b(href|src)="([^"]+)"/g)) {
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

test('walkthrough is static, labelled and free of private transcript identifiers', () => {
  const html = read(path.join(root, 'site', 'how-we-made-this.html'));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<main id="main" tabindex="-1">/);
  assert.match(html, /aria-current="page">How I made this/);
  for (const section of ['prompts', 'follow-ups', 'workflow', 'lessons', 'try-it', 'sources']) assert.match(html, new RegExp(`id="${section}"`));
  assert.doesNotMatch(html, /starter-prompt|Suggested prompt|class="steps"|class="chapter-nav"/);
  assert.match(html, /Archive caveat:/);
  assert.doesNotMatch(html, /autoplay|\/home\/|[A-Z]:\\Users\\|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|\.jsonl\b/);
  for (const image of html.matchAll(/<img\b[^>]*>/g)) assert.match(image[0], /alt="[^"]+"/);
  for (const [, target] of html.matchAll(/data-copy="([^"]+)"/g)) assert.ok(ids(html).includes(target));
});

test('actual prompts lead, remain chronological, and precede the AI explanation', () => {
  const html = read(path.join(root, 'site', 'how-we-made-this.html'));
  const initial = html.match(/<blockquote id="initial-prompt">([\s\S]*?)<\/blockquote>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(initial, '[local media folder redacted] analyze the mp4 here and use the mp3 as the video. But replicate this video from scratch, make it identical. Got all out on motion effects, transitions, icons, to mimic this video exactly. have a judge of sonnet 5.5 critics at the end analzye so you can iteratively loop until it looks the same.');
  assert.ok(html.indexOf('id="initial-prompt"') < html.indexOf('id="follow-ups"'));
  const thread = html.slice(html.indexOf('<ol class="prompt-thread"'), html.indexOf('</ol>'));
  const dates = [...thread.matchAll(/datetime="([^"]+)"/g)].map(m => m[1]);
  const quotes = [...thread.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map(m => m[1]);
  assert.equal(quotes.length, 20);
  assert.equal(dates.length, quotes.length);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(dates).size, dates.length);
  assert.equal(quotes[6], 'Few things I noticed, the hand is off and the head shape is off, and the grainyness is off.');
  assert.equal(quotes[7], "Hmm programmatically compare the face and hand shape it's still not there.");
  assert.equal(quotes[9], 'No it still looks like a balloon, we should try to trace the shape of the hand in every frame and replicate that.');
  assert.equal(quotes[10], 'no just trace the actual frames. This is my video');
  assert.equal(quotes[11], 'This is good! No need to do anymore versions');
  assert.equal(quotes[14], 'Okay continue iterating on judges and versions until it gets perfect');
  assert.equal(quotes[17], 'okay run v17');
  assert.ok(html.indexOf('</ol>') < html.indexOf('id="workflow"'));
  assert.ok(html.indexOf('id="workflow"') < html.indexOf('<video'));
  assert.match(thread, /Image attachment omitted\./);
  assert.match(html, /<details id="try-it" class="reproduce">/);
  assert.match(html, /not a finished v17/);
});

test('singular walkthrough framing retains the existing route and historical plural quotes', () => {
  const html = read(path.join(root, 'site', 'how-we-made-this.html'));
  assert.match(html, /<title>How I made this · Love Motion Recreation<\/title>/);
  assert.match(html, /<h1>How I made <span>this\.<\/span><\/h1>/);
  assert.match(html, /<meta name="description" content="How I made Love Motion Recreation:/);
  assert.match(html, /And then I kept directing it\./);
  const authoredText = html.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(authoredText, /\b(?:we|our|ours|us)\b/i);
  assert.match(html, /We should do this for every new version too\./);
  assert.match(html, /Have sonnet do that for us while we do this<\/blockquote>/);
  const showcase = read(path.join(root, 'site', 'index.html'));
  assert.match(showcase, /href="how-we-made-this\.html">How I made this<\/a>/);
  assert.match(showcase, /aria-label="How I made this"/);
  assert.match(showcase, /href="how-we-made-this\.html">Read how I made this →<\/a>/);
});

test('walkthrough uses genuine pinned v18 media without replacing the original reference', () => {
  const { createHash } = require('node:crypto');
  const html = read(path.join(root, 'site', 'how-we-made-this.html'));
  const prefix = '../media/versions/v18/';
  assert.match(html, /<video[^>]+aria-label="Archived v18 original reference versus Claude recreation"[^>]+src="\.\.\/media\/versions\/v18\/sidebyside\.mp4"/);
  assert.ok(html.includes(`src="${prefix}pairs/pair_030.jpg" width="1600" height="600"`));
  assert.ok(html.includes('href="../media/original/original.mp4">Watch the original reference'));
  assert.match(html, /do not extend the prompt snapshot/);
  assert.doesNotMatch(html, /(?:src|href)="[^"\n]*(?:v14|v16)[^"\n]*\.(?:mp4|png|jpg)"/);
  // Git blob hashes verified against the pinned upstream archive, not re-encoded copies.
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
  const html = read(path.join(root, 'site', 'how-we-made-this.html'));
  assert.match(html, /corrected v15\/v16 sheets and pairs/);
  assert.doesNotMatch(html, /v15\/v16 pairs in the showcase predate/);
  for (const args of ['413 431 pen soft', '432 487', '413 431 dark', '487 487 dark']) {
    assert.ok(html.includes(`node scripts/trace-pen.js ${args}`));
  }
});

test('shared theme persists and also works when storage is denied', () => {
  function boot(saved, denied = false) {
    const attrs = new Map();
    const button = { hidden: true };
    const storage = { value: saved, getItem() { if (denied) throw new Error('denied'); return this.value; }, setItem(key, value) { if (denied) throw new Error('denied'); this.value = value; } };
    const context = {
      document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k), hasAttribute: k => attrs.has(k) }, getElementById: () => button },
      localStorage: storage, matchMedia: () => ({ matches: false })
    };
    vm.runInNewContext(read(path.join(root, 'site', 'theme.js')), context);
    return { attrs, button, storage };
  }
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
  vm.runInNewContext(read(path.join(root, 'site', 'how-we-made-this.js')), context);
  assert.equal(button.hidden, false);
  await handler();
  assert.equal(copied, source.textContent);
  assert.equal(status.textContent, 'Copied to clipboard.');
  context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await handler();
  assert.equal(selected, source);
  assert.match(status.textContent, /Text selected/);
});

test('root and nested routes, CSS/JS, video HEAD and byte ranges serve correctly', async () => {
  for (const prefix of ['', '/dist']) {
    for (const name of [...pages, ...assets]) {
      const response = await fetch(`${base}${prefix}/site/${name}`);
      assert.equal(response.status, 200, `${prefix}/${name}`);
      assert.equal(await response.text(), read(path.join(root, 'site', name)));
    }
    for (const file of ['final/claude_v14_sidebyside.mp4', 'versions/v18/sidebyside.mp4']) {
      const media = `${base}${prefix}/media/${file}`;
      const head = await fetch(media, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-type'), 'video/mp4');
      const range = await fetch(media, { headers: { Range: 'bytes=0-31' } });
      assert.equal(range.status, 206);
      assert.match(range.headers.get('content-range'), /^bytes 0-31\//);
      assert.equal((await range.arrayBuffer()).byteLength, 32);
    }
  }
});
