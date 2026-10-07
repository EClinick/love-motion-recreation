#!/usr/bin/env node
// Turn a private Claude Code session transcript into the sanitised, publishable site/session.json.
// usage: node scripts/session-extract.js <transcript.jsonl> [out=site/session.json] [--private-terms <terms.json>]
// --private-terms names a JSON array of extra words to redact as [org] and ban, kept outside the
// repository so the words themselves are never published.
// The transcript itself is never committed. Hidden reasoning ("thinking" blocks) is never read.
// The script refuses to write if any banned pattern survives sanitising.
const fs = require('node:fs');
const path = require('node:path');

const SUBS = [
  [/C:\\\\?Users\\\\?[^\\\s"'`]+\\\\?Downloads\\\\?x-\d+\\\\?/g, '[local media folder] '],
  [/Downloads\\\\?x-\d+/g, '[local media folder]'],
  [/\/mnt\/c\/Program Files\/Tailscale\//g, ''],
  [/\/mnt\/c\/Users\/[^\s"'`]*/g, '[local media folder]'],
  [/jordanarchivess-\d+/g, '[source]'],
  [/\/tmp\/claude-\d+\/[^\s"'`]*?\/scratchpad/g, '$SCRATCH'],
  [/\/tmp\/claude-\d+\/[^\s"'`]*/g, '[session temp path]'],
  [/\/home\/[a-z_][\w-]*/g, '~'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '[session id]'],
  [/\b100\.\d+\.\d+\.\d+\b/g, '[tailnet IP]'],
  [/\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b/g, '[LAN IP]'],
  [/[\w.-]+\.ts\.net/g, '[tailnet host]'],
  [/https:\/\/cdn\.fontshare\.com\/[^\s"'`]+/g, 'https://cdn.fontshare.com/…'],
  [/\ba[0-9a-f]{16}\b/g, '[agent]'],
  [/toolu_[A-Za-z0-9]+/g, '[call]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, '[email]'],
  [/~\/\.claude\/[^\s"'`]*/g, '[claude config]'],
  [/\b\d{1,2}:\d{2}:\d{2} up [^\n]*?load average:[^\n]*/g, 'up …, load average …'],
  [/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{1,2}:\d{2}\b/g, '[date]'],
  [/Ethan Clinick|Ethan <\[email\]>/g, '[author]'],
  [/((?:^|\s)[-dlrwxs]{10}\s+\d+)\s+ethan\s+ethan/gm, '$1 [owner]'],
  [/\bethan ethan\b/g, '[owner]'],
  [/\bethan-dev-pc\b/g, '[machine]']
];
// Anything matching these after sanitising stops the build of the data file.
const BANNED = [
  /\/home\//, /\/mnt\//, /[A-Z]:\\/, /\/tmp\/claude/, /\.ts\.net/, /\b100\.\d+\.\d+\.\d+\b/, /\b192\.168\./,
  /\b172\.(?:1[6-9]|2\d|3[01])\./, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, /toolu_/,
  /agentId/, /internal metadata/i, /<tool_use_error>/, /tool_use_id/, /[\w.+-]+@[\w-]+\.(?:com|net|org|io)\b/,
  /\bghp_|\bgho_|github_pat_|sk-ant|\bAKIA[0-9A-Z]{12}/, /jordanarchiv/i, /x-2107/, /\bethan\b/i, /"thinking"/,
  /\b10\.\d+\.\d+\.\d+\b/, /Bearer\s|Authorization:|password\s*[=:]|BEGIN [A-Z ]*PRIVATE KEY|xox[abp]-|AIza[\w-]{20}/i,
  /\.claude\//, /\d+ users?,\s+load average/, /system-reminder/
];
const clean = s => SUBS.reduce((acc, [re, to]) => acc.replace(re, to), String(s));
const clip = (s, n) => { s = s.trim(); return s.length > n ? s.slice(0, n).trimEnd() + ' […]' : s; };
// Tool protocol text the Claude Code TUI never displays, replaced by what it means.
const FIXED = { Agent: 'Running in the background', SendMessage: 'Message sent to the subagent', ToolSearch: 'Loaded tool definitions', TaskStop: 'Stopped a background task', Monitor: 'Watching a background task' };
const isMemory = input => /\/memory\/|MEMORY\.md/.test(JSON.stringify(input));

function extract(transcript, messages) {
  const approved = new Map(messages.approved.map(m => [m.t, m]));
  const omittedWhy = new Map(messages.omitted.map(m => [m.t, m.why]));
  const raw = [], pending = new Map();
  let first, last;
  for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line), t = r.timestamp || '', type = r.type;
    if (t) { first = first || t; last = t; }
    const content = (r.message || {}).content;
    if (approved.has(t) && (type === 'user' || type === 'queue-operation')) {
      const m = approved.get(t);
      if (!raw.some(e => e.k === 'human' && e.t === t)) raw.push({ k: 'human', t, text: m.text, via: m.via });
      continue;
    }
    if (type === 'user' && typeof content === 'string') {
      if (content.startsWith('This session is being continued')) raw.push({ k: 'compact', t });
      else if (content.includes('<command-name>/model')) raw.push({ k: 'slash', t, text: '/model', out: 'Set model to Opus 5.5 (default)' });
      else if (content.includes('<command-name>/effort')) raw.push({ k: 'slash', t, text: '/effort high', out: 'Set effort level to high' });
      else if (omittedWhy.has(t)) raw.push({ k: 'omit', t, why: omittedWhy.get(t), human: true });
      // Slash-command echoes, subagent hand-backs, task notifications and image notices are automated, not human prompts.
      continue;
    }
    if (type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text.trim()) raw.push({ k: 'say', t, text: clip(clean(b.text), 700) });
        if (b.type !== 'tool_use') continue;
        const input = b.input || {}, name = b.name;
        if (['Bash', 'Read', 'Write', 'Edit'].includes(name) && isMemory(input)) { raw.push({ k: 'omit', t, why: 'memory' }); continue; }
        const e = { k: 'tool', t, name, arg: '', detail: '' };
        if (name === 'Bash') { e.arg = input.description || clip(String(input.command || '').split('\n')[0], 90); e.detail = clip(clean(input.command || ''), 400); }
        else if (['Read', 'Write', 'Edit'].includes(name)) { e.arg = clean(input.file_path || '').replace('~/dev/love-motion-recreation/', ''); if (name === 'Write') e.lines = String(input.content || '').split('\n').length; }
        else if (name === 'Agent') { e.arg = input.description || ''; e.detail = [input.subagent_type, input.model].filter(Boolean).join(' · '); }
        else if (name === 'SendMessage') e.arg = 'to a subagent';
        else if (name === 'AskUserQuestion') { const q = input.questions[0]; e.arg = q.question; e.detail = q.options.map(o => o.label).join(' | '); }
        else e.arg = input.description || input.query || name;
        e.arg = clean(e.arg);
        raw.push(e); pending.set(b.id, e);
      }
    }
    if (type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
        const e = pending.get(b.tool_use_id); pending.delete(b.tool_use_id);
        const rc = b.content, image = Array.isArray(rc) && rc.some(x => x.type !== 'text');
        const text = typeof rc === 'string' ? rc : (rc || []).map(x => x.type === 'text' ? x.text : '[image]').join(' ');
        const lines = clean(text).split('\n').filter(x => x.trim());
        e.err = Boolean(b.is_error);
        e.out = clip(lines[0] || '(no output)', 140); e.n = lines.length;
        if (e.err) e.out = 'Error: ' + e.out.replace(/<\/?tool_use_error>/g, '');
        else if (FIXED[e.name]) { e.out = FIXED[e.name]; e.n = 1; }
        else if (e.name === 'Read') { e.out = image ? 'Read image' : `Read ${lines.length} lines`; e.n = 1; }
        else if (e.name === 'Write') { e.out = `Wrote ${e.lines} lines to ${e.arg}`; e.n = 1; }
      }
    }
  }
  // Collapse each left-out human message and the steps it started (until the next approved message)
  // into one counted mark; collapse consecutive memory-housekeeping calls the same way.
  const events = []; let open = null;
  for (const e of raw) {
    delete e.lines;
    if (e.k === 'omit' && e.human) {
      if (!open) { open = { k: 'omit', t: e.t, why: 'operational', reasons: [], steps: 0 }; events.push(open); }
      if (!open.reasons.includes(e.why)) open.reasons.push(e.why);
      continue;
    }
    if (open && e.k === 'compact') { events.push(e); continue; }
    if (open && e.k !== 'human') { open.steps++; continue; }
    if (e.k === 'human') open = null;
    const prev = events[events.length - 1];
    if (e.k === 'omit' && prev && prev.k === 'omit' && prev.why === 'memory') { prev.steps++; continue; }
    if (e.k === 'omit') e.steps = 1;
    events.push(e);
  }
  events.forEach((e, i) => { e.id = i; });
  const count = k => events.filter(e => e.k === k).length;
  return {
    meta: {
      note: 'Sanitised extract of the recorded Claude Code session. Private paths, addresses and IDs are replaced by labels in brackets.',
      claude_code: '2.1.285', model: 'Opus 5.5', effort: 'high', permission_mode: 'auto', cwd: '~/dev',
      start: first, end: last,
      counts: { human: count('human'), replies: count('say'), tools: count('tool'), omitted: count('omit') }
    },
    events
  };
}

function check(json) {
  const hits = BANNED.filter(re => re.test(json)).map(String);
  if (hits.length) throw new Error('Refusing to write: banned patterns survived sanitising: ' + hits.join(', '));
}

if (require.main === module) {
  const args = process.argv.slice(2), at = args.indexOf('--private-terms');
  if (at > -1) {
    for (const term of JSON.parse(fs.readFileSync(args[at + 1], 'utf8'))) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      SUBS.push([re, '[org]']); BANNED.push(new RegExp(re.source, 'i'));
    }
    args.splice(at, 2);
  }
  const [transcript, out = path.join(__dirname, '..', 'site', 'session.json')] = args;
  if (!transcript) { console.error('usage: node scripts/session-extract.js <transcript.jsonl> [out]'); process.exit(2); }
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, 'session-messages.json'), 'utf8'));
  const data = extract(transcript, messages);
  if (data.meta.counts.human !== messages.approved.length) throw new Error(`Expected ${messages.approved.length} approved messages, found ${data.meta.counts.human}`);
  const json = JSON.stringify(data, null, 1) + '\n';
  check(json);
  fs.writeFileSync(out, json);
  console.log(`Wrote ${out}: ${JSON.stringify(data.meta.counts)}`);
}
module.exports = { BANNED, check, clean };
