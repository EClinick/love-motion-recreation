// Render the sanitised session (site/session.json) into static HTML at build time, so the replay
// reads without JavaScript. Output is written between marker comments in the two pages.
const fs = require('node:fs');
const path = require('node:path');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const md = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const hhmm = t => t.slice(11, 16);
const day = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const elbow = '<span class="elbow" aria-hidden="true"></span>';
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// Archive stills shown after the exchange that produced them (index = my message number - 1).
const PLATES = {
  1: ['stills/hand-v01.jpg', 'v1, the first full render. Frame at 14.6 s from the archived v1 side-by-side: reference left, recreation right.'],
  7: ['stills/hand-v08.jpg', 'v8, rebuilt after this message with a new head, hand poses and grain. The hand is still drawn from scratch.'],
  8: ['stills/hand-v10.jpg', 'v10, after the programmatic comparison. Measured hand silhouette overlap rose from 0.45 to about 0.80.'],
  11: ['stills/hand-v14.jpg', 'v14, with the hand traced from the source frames. Overlap 0.94 to 0.96 on the frames measured.'],
  20: ['../media/versions/v18/pairs/pair_030.jpg', 'v18, archived after this record ends. Reference left, recreation right, 14.5 s.']
};

function chapters(events) {
  const pre = [], list = [];
  for (const e of events) {
    if (e.k === 'human') list.push({ prompt: e, events: [] });
    else if (list.length) list[list.length - 1].events.push(e);
    else pre.push(e);
  }
  return { pre, list };
}

// Mechanical selection for the condensed replay: Claude's first and last visible reply, up to two more
// spread between them, every question and subagent launch, the first new script and the last commit.
function pick(evs) {
  const says = evs.filter(e => e.k === 'say'), tools = evs.filter(e => e.k === 'tool'), keep = new Set();
  if (says.length) for (const i of [0, says.length - 1, Math.floor(says.length / 3), Math.floor(2 * says.length / 3)]) keep.add(says[i].id);
  for (const e of tools) if (e.name === 'AskUserQuestion' || e.name === 'Agent') keep.add(e.id);
  const script = tools.find(e => e.name === 'Write' && /^(scripts|src)\//.test(e.arg));
  if (script) keep.add(script.id);
  const commits = tools.filter(e => e.name === 'Bash' && /git commit/.test(e.detail || ''));
  if (commits.length) keep.add(commits[commits.length - 1].id);
  for (const e of evs) if (e.k === 'omit' || e.k === 'compact') keep.add(e.id);
  return keep;
}

function prompt(e, n, tag) {
  const text = esc(e.text).replace('[local media folder redacted]', '<span class="redact">[local media folder redacted]</span>');
  return `<${tag} class="t-prompt" id="m${n}"><span class="caret" aria-hidden="true">&gt;</span><span class="t-ptext">${text}</span>` +
    `<time datetime="${e.t}">${day(e.t)}, ${hhmm(e.t)} UTC</time>` +
    (e.via === 'queued' ? '<span class="q">Typed while Claude was still working, so Claude Code queued it.</span>' : '') + `</${tag}>`;
}

function line(e, full) {
  if (e.k === 'say') return `<div class="t-line t-say" id="e${e.id}"><span class="t-dot" aria-hidden="true">●</span><div class="t-body">${md(e.text)}</div></div>`;
  if (e.k === 'tool') {
    const head = e.name === 'Bash' ? (e.detail || '').split('\n')[0] : e.arg;
    const arg = head.length > 74 ? head.slice(0, 73) + '…' : head;
    const sub = e.name === 'Agent' && e.detail ? `<div class="t-out">${elbow}<span>Subagent: ${esc(e.detail)}</span></div>` : '';
    const opts = e.name === 'AskUserQuestion' ? `<div class="t-out">${elbow}<span>Options: ${esc(e.detail)}</span></div>` : '';
    const out = e.out ? `<div class="t-out">${elbow}<span>${esc(e.out)}</span></div>` : '';
    const more = e.n > 1 ? `<div class="t-more">… +${e.n - 1} lines</div>` : '';
    const label = `${e.err ? 'Tool call failed' : 'Tool call'}: ${e.name}`;
    const call = `<span class="t-name">${esc(e.name)}</span>(<span class="t-arg">${esc(arg)}</span>)`;
    const cls = `t-line t-tool${e.err ? ' err' : ''}`;
    if (full && e.name === 'Bash' && e.detail) {
      return `<details class="${cls}" id="e${e.id}"><summary><span class="t-dot" role="img" aria-label="${label}">●</span><span class="t-call">${call} <span class="t-toggle">command</span>${out}${more}</span></summary>` +
        `<pre class="t-cmd" aria-label="Command, private values redacted">${esc(e.detail)}</pre></details>`;
    }
    return `<div class="${cls}" id="e${e.id}"><span class="t-dot" role="img" aria-label="${label}">●</span><div>${call}${sub}${opts}${out}${more}</div></div>`;
  }
  if (e.k === 'omit') {
    const why = e.why === 'memory'
      ? 'Claude updating its own memory notes, which is unrelated to the project'
      : `My operational ${e.reasons.length > 1 ? 'messages' : 'message'} (${e.reasons.join(', ')}) and the work ${e.reasons.length > 1 ? 'they' : 'it'} started`;
    return `<p class="ed" id="e${e.id}"><b>Left out of this replay.</b> ${esc(why)}, ${plural(e.steps, 'step')}.</p>`;
  }
  if (e.k === 'compact') return `<p class="ed" id="e${e.id}"><b>Context compacted.</b> Claude Code summarised the conversation so far to keep working. The summary is not shown.</p>`;
  return '';
}

function banner(meta, pre) {
  let h = `<div class="t-head"><span class="mark" aria-hidden="true">✻</span> <b>Claude Code</b> ${esc(meta.claude_code)}<br>${esc(meta.model)}, ${esc(meta.effort)} effort, ${esc(meta.permission_mode)} mode<br>${esc(meta.cwd)}</div>`;
  for (const e of pre.filter(x => x.k === 'slash')) {
    h += `<div class="t-slash"><span class="caret" aria-hidden="true">&gt;</span> ${esc(e.text)}</div><div class="t-out t-slash-out">${elbow}<span>${esc(e.out)}</span></div>`;
  }
  return h;
}

function plate([src, caption]) {
  return `<figure class="plate"><img src="${src}" width="1200" height="450" loading="lazy" alt="Side-by-side frame of the hand shot: the reference on the left and the recreation on the right."><figcaption><b>From the version archive.</b> ${esc(caption)}</figcaption></figure>`;
}

// Old walkthrough anchors keep working: each lands on the matching message or section.
const OLD_ANCHORS = { 1: ['prompts', 'initial-prompt'], 2: ['follow-ups'], 9: ['prompt-measure'], 11: ['prompt-trace'], 14: ['prompt-archive'] };

function condensed(data) {
  const { pre, list } = chapters(data.events);
  let h = banner(data.meta, pre), lastDay = '';
  list.forEach((c, i) => {
    const n = i + 1, d = day(c.prompt.t);
    if (lastDay && d !== lastDay) h += '<p class="day">The next morning</p>';
    lastDay = d;
    h += `<section class="t-chapter" aria-labelledby="m${n}">` + (OLD_ANCHORS[n] || []).map(id => `<span class="anchor" id="${id}"></span>`).join('') + prompt(c.prompt, n, 'h3');
    const keep = pick(c.events);
    let skipped = [];
    const flush = () => {
      if (!skipped.length) return;
      const says = skipped.filter(e => e.k === 'say').length;
      h += `<a class="gap" href="session.html#e${skipped[0].id}">⋮ ${plural(skipped.length, 'more step')} here${says ? `, including ${plural(says, 'Claude message')}` : ''}. Open ${skipped.length > 1 ? 'them' : 'it'} in the full session.</a>`;
      skipped = [];
    };
    for (const e of c.events) { if (keep.has(e.id)) { flush(); h += line(e, false); } else skipped.push(e); }
    flush();
    if (PLATES[i]) h += plate(PLATES[i]);
    h += '</section>';
  });
  h += `<p class="ed"><b>The record ends here,</b> on ${day(data.meta.end)} at ${hhmm(data.meta.end)} UTC, while v17 was still being built. Later versions, including v18, were archived afterwards.</p>`;
  return h;
}

function full(data) {
  const { pre, list } = chapters(data.events);
  let h = banner(data.meta, pre), lastDay = '';
  for (const e of pre) if (e.k !== 'slash') h += line(e, true);
  list.forEach((c, i) => {
    const d = day(c.prompt.t);
    if (lastDay && d !== lastDay) h += `<p class="day">${d}</p>`;
    lastDay = d;
    h += `<section class="t-chapter" aria-labelledby="m${i + 1}">${prompt(c.prompt, i + 1, 'h2')}${c.events.map(e => line(e, true)).join('')}</section>`;
  });
  h += `<p class="ed"><b>End of the recorded session,</b> ${day(data.meta.end)} at ${hhmm(data.meta.end)} UTC.</p>`;
  return h;
}

function messageList(data) {
  const { list } = chapters(data.events);
  return list.map((c, i) => {
    const words = c.prompt.text.replace('[local media folder redacted] ', '');
    const next = i > 0 && day(c.prompt.t) !== day(list[i - 1].prompt.t) ? '<li class="nextday" aria-hidden="true">Next day</li>' : '';
    return `${next}<li><a href="#m${i + 1}"><time class="t" datetime="${c.prompt.t}">${hhmm(c.prompt.t)}</time><span class="w">${esc(words)}</span></a></li>`;
  }).join('');
}

function jumpOptions(data) {
  return chapters(data.events).list.map((c, i) => `<option value="m${i + 1}">${hhmm(c.prompt.t)}  ${esc(c.prompt.text.replace('[local media folder redacted] ', '').slice(0, 60))}</option>`).join('');
}

function inject(file, name, html) {
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(src)) throw new Error(`${path.basename(file)} has no ${name} markers`);
  const out = src.replace(re, (_, a, b) => `${a}${html}${b}`);
  if (out !== src) fs.writeFileSync(file, out);
}

function renderInto(siteDir) {
  const data = JSON.parse(fs.readFileSync(path.join(siteDir, 'session.json'), 'utf8'));
  const c = data.meta.counts;
  const how = path.join(siteDir, 'how-we-made-this.html'), sess = path.join(siteDir, 'session.html');
  inject(how, 'replay', condensed(data));
  inject(how, 'messages', messageList(data));
  inject(sess, 'session', full(data));
  inject(sess, 'jump', jumpOptions(data));
  inject(sess, 'counts', `my ${c.human} messages, Claude’s ${c.replies} visible replies and all ${c.tools} tool calls`);
  return data;
}

module.exports = { renderInto, pick, chapters };
