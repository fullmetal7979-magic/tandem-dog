import { configureGitEnvironment, defaultGitTimeoutMs, runGit, repoRoot, oneLine } from '../shared/git-process.mjs';
export { configureGitEnvironment, defaultGitTimeoutMs, runGit, repoRoot, oneLine };
// Tandem: one coding session that follows you across PCs and AI accounts.
//
// The canonical session lives in the user's repository at .tandem/SESSION.md
// (goal, state, next steps, decisions, work log), so git carries it to every
// PC and any agent (Mixdog, Claude Code, Codex) can read it. Per-PC status
// (branch heads, ahead/behind, dirty files, account) is published to
// refs/tandem/desks/<desk> as a one-file commit, so every PC can see where the
// latest version lives without touching the working branch.
//
// The file format and log lines match the shell kit (.tandem/tandem.sh) so
// both can be used on the same repository.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const SLOTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const SESSION_REL = '.tandem/SESSION.md';
const DESK_REF_PREFIX = 'refs/tandem/desks/';
const SECTIONS = ['목표', '현재 상태', '다음 단계', '결정 사항', '작업 로그'];
const BLANK = { goal: '(미정)', state: '(기록 없음)', next: '(미정)' };

async function git(cwd, args, opts) {
  const r = await runGit(cwd, args, opts);
  if (r.code !== 0) {
    const err = new Error(`git ${args[0]} failed: ${r.stderr.trim() || r.stdout.trim()}`);
    err.code = 'git_failed';
    err.result = r;
    throw err;
  }
  return r.stdout;
}


/** A branch name safe to pass to git and to show in shell one-liners. */
export function isValidBranch(name) {
  const b = String(name ?? '');
  return (
    b.length > 0 &&
    b.length <= 120 &&
    /^[\p{L}\p{N}._/-]+$/u.test(b) &&
    !/(^[/.-]|\/\/|\.\.|@\{|\.lock$|\/$|\.$)/.test(b)
  );
}

export function isValidDesk(desk) {
  return SLOTS.includes(desk);
}

// ---------------------------------------------------------------- session file

/** Parse SESSION.md into fields. Unknown sections are kept in `extra`. */
export function parseSession(md) {
  const sec = new Map();
  const extra = [];
  let cur = null;
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = h[1];
      if (!sec.has(cur)) sec.set(cur, []);
      if (!SECTIONS.includes(cur)) extra.push(cur);
      continue;
    }
    if (cur) sec.get(cur).push(line);
  }
  const text = (k) => (sec.get(k) || []).join('\n').trim();
  const items = (k) =>
    (sec.get(k) || [])
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  const blankToEmpty = (v, k) => (v === BLANK[k] ? '' : v);
  return {
    goal: blankToEmpty(text('목표'), 'goal'),
    state: blankToEmpty(text('현재 상태'), 'state'),
    next: blankToEmpty(text('다음 단계'), 'next'),
    decisions: items('결정 사항'),
    log: (sec.get('작업 로그') || []).map((l) => l.trim()).filter((l) => /^-\s/.test(l)),
    extra: extra.map((name) => ({ name, body: text(name) })),
  };
}

/** Serialize a session back to SESSION.md (stable, round-trips with parseSession). */
export function renderSession(s) {
  const lines = [
    '# Tandem 가상 세션',
    "> 모든 PC·모든 AI(Claude, Codex)가 함께 쓰는 하나의 작업 세션입니다. 시작할 때 읽고, 작업을 끝내면 '현재 상태'·'다음 단계'를 고치고 '작업 로그'에 한 줄을 더하세요.",
    '',
    '## 목표',
    oneLine(s.goal) || BLANK.goal,
    '',
    '## 현재 상태',
    String(s.state ?? '').trim() || BLANK.state,
    '',
    '## 다음 단계',
    String(s.next ?? '').trim() || BLANK.next,
    '',
    '## 결정 사항',
    ...(s.decisions || []).map((d) => `- ${oneLine(d)}`),
    '',
    '## 작업 로그',
    ...(s.log || []).map((l) => (l.startsWith('- ') ? l : `- ${oneLine(l)}`)),
    '',
  ];
  for (const x of s.extra || []) lines.push(`## ${x.name}`, x.body, '');
  return lines.join('\n');
}

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function logLine({ desk, tool, text, date }) {
  return `- ${stamp(date)} · 데스크 ${desk || '?'} · ${oneLine(tool) || '?'} · ${oneLine(text)}`;
}

/** Parse "떠남 (branch): memo" / "이어받음 (branch)" handoff entries out of a log line. */
export function parseLogLine(line) {
  const m = /^-\s*(\d{4}-\d\d-\d\d \d\d:\d\d) · 데스크 (\S+) · (.*?) · (.*)$/.exec(String(line ?? '').trim());
  if (!m) return null;
  const hop = /^(떠남|이어받음) \(([^)\s]+)\)(?::\s*(.*))?$/.exec(m[4]);
  return {
    at: m[1],
    desk: m[2],
    tool: m[3],
    text: m[4],
    kind: hop ? (hop[1] === '떠남' ? 'leave' : 'resume') : 'note',
    branch: hop ? hop[2] : null,
    memo: hop ? hop[3] || '' : m[4],
  };
}

// ---------------------------------------------------------------- repo + config


async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

export async function readSession(root) {
  const md = await readText(join(root, SESSION_REL));
  return md == null ? null : parseSession(md);
}

export async function writeSession(root, session) {
  await mkdir(join(root, '.tandem'), { recursive: true });
  await writeAtomic(join(root, SESSION_REL), renderSession(session));
}

/** This PC's desk letter, account label and base branch (same files as the shell kit). */
export async function readDeskConfig(root) {
  const read = async (f) => oneLine((await readText(join(root, '.tandem', f))) ?? '');
  const desk = await read('desk');
  return {
    desk: isValidDesk(desk) ? desk : null,
    tool: (await read('tool')) || null,
    base: (await read('base')) || 'main',
    host: hostname(),
  };
}

export async function writeDeskConfig(root, { desk, tool, base }) {
  if (desk != null && !isValidDesk(desk)) throw new Error(`desk must be one of ${SLOTS.join(', ')}`);
  await mkdir(join(root, '.tandem'), { recursive: true });
  if (desk != null) await writeFile(join(root, '.tandem', 'desk'), `${desk}\n`);
  if (tool != null) await writeFile(join(root, '.tandem', 'tool'), `${oneLine(tool).slice(0, 60)}\n`);
  if (base != null) await writeFile(join(root, '.tandem', 'base'), `${oneLine(base)}\n`);
  await ensureGitignore(root);
}

/**
 * Keep the per-PC files out of git through the clone-local exclude list, never
 * the tracked .gitignore: a new PC writing .gitignore before its first resume
 * would make `git switch` refuse to overwrite the untracked file.
 */
export async function ensureGitignore(root) {
  const rel = (await runGit(root, ['rev-parse', '--git-path', 'info/exclude'])).stdout.trim() || '.git/info/exclude';
  const path = join(root, rel);
  await mkdir(join(path, '..'), { recursive: true });
  const cur = (await readText(path)) ?? '';
  const want = ['.tandem/desk', '.tandem/tool', '.tandem/*.tmp'];
  const missing = want.filter((w) => !cur.split(/\r?\n/).includes(w));
  if (missing.length) await writeFile(path, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

// ---------------------------------------------------------------- local status

export function parseTrack(track) {
  const a = /ahead (\d+)/.exec(track || '');
  const b = /behind (\d+)/.exec(track || '');
  return { ahead: a ? Number(a[1]) : 0, behind: b ? Number(b[1]) : 0, gone: /gone/.test(track || '') };
}

/** Branch heads, ahead/behind and dirty files of this checkout. */
export async function localStatus(root) {
  const fmt = '%(refname:short)%09%(objectname:short=10)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)%09%(subject)';
  // Three independent reads, run together: status -b carries the branch name.
  const [st, rev, refs] = await Promise.all([
    runGit(root, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-b']),
    runGit(root, ['rev-parse', '--short=10', 'HEAD']),
    runGit(root, ['for-each-ref', '--sort=-committerdate', '--count=60', `--format=${fmt}`, 'refs/heads']),
  ]);
  const lines = st.stdout.split('\n').filter(Boolean);
  const header = lines[0]?.startsWith('## ') ? lines.shift().slice(3) : '';
  const branch = /^HEAD \(no branch\)/.test(header) ? 'HEAD' : header.replace(/^No commits yet on /, '').split('...')[0].split(' ')[0];
  const head = rev.stdout.trim();
  const branches = refs.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, sha, upstream, track, ts, ...subj] = l.split('\t');
      return { name, head: sha, upstream: upstream || null, ...parseTrack(track), ts: Number(ts) || 0, subject: subj.join(' ').slice(0, 120) };
    });
  const dirty = lines.slice(0, 200);
  return { branch, head, branches, dirty, at: Date.now() };
}

/** Remote branch heads as last fetched (origin/*). */
export async function remoteBranches(root) {
  const fmt = '%(refname:short)%09%(objectname:short=10)%09%(committerdate:unix)%09%(subject)';
  const r = await runGit(root, ['for-each-ref', '--sort=-committerdate', '--count=200', `--format=${fmt}`, 'refs/remotes/origin']);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [ref, head, ts, ...subj] = l.split('\t');
      return { name: ref.replace(/^origin\//, ''), head, ts: Number(ts) || 0, subject: subj.join(' ').slice(0, 120) };
    })
    .filter((b) => b.name && b.name !== 'HEAD' && b.name !== 'origin');
}

// ---------------------------------------------------------------- desk refs

const GIT_IDENT = {
  GIT_AUTHOR_NAME: 'Tandem',
  GIT_AUTHOR_EMAIL: 'tandem@localhost',
  GIT_COMMITTER_NAME: 'Tandem',
  GIT_COMMITTER_EMAIL: 'tandem@localhost',
};

/**
 * Publish this PC's status as refs/tandem/desks/<desk> (a commit holding
 * desk.json) and push it. The working tree and index are never touched.
 */
export async function publishDesk(root, { desk, tool, status, holding = null, push = true }) {
  if (!isValidDesk(desk)) throw new Error('desk not set');
  const body = JSON.stringify({ v: 1, desk, tool: oneLine(tool).slice(0, 60), host: hostname(), holding, ...status }, null, 1);
  const blob = (await git(root, ['hash-object', '-w', '--stdin'], { input: body })).trim();
  const tree = (await git(root, ['mktree'], { input: `100644 blob ${blob}\tdesk.json\n` })).trim();
  const commit = (await git(root, ['commit-tree', tree, '-m', `tandem desk ${desk}`], { env: GIT_IDENT })).trim();
  const ref = `${DESK_REF_PREFIX}${desk}`;
  await git(root, ['update-ref', ref, commit]);
  if (push) {
    const r = await runGit(root, ['push', '--quiet', '--force', 'origin', `${ref}:${ref}`]);
    return { ref, commit, pushed: r.code === 0, error: r.code === 0 ? null : r.stderr.trim() };
  }
  return { ref, commit, pushed: false, error: null };
}

const DESK_REFSPEC = `+${DESK_REF_PREFIX}*:${DESK_REF_PREFIX}*`;
const BRANCH_REFSPEC = '+refs/heads/*:refs/remotes/origin/*';

/** One network round-trip for branches and every PC's status record. */
export async function fetchAll(root) {
  return runGit(root, ['fetch', '--quiet', '--prune', 'origin', BRANCH_REFSPEC, DESK_REFSPEC]);
}

/** Every PC's published status, read with a single `git cat-file --batch`. */
export async function fetchDesks(root, { fetch = true } = {}) {
  if (fetch) await runGit(root, ['fetch', '--quiet', '--prune', 'origin', DESK_REFSPEC]);
  const refs = (await runGit(root, ['for-each-ref', '--format=%(refname)', DESK_REF_PREFIX])).stdout.split('\n').filter(Boolean);
  if (!refs.length) return [];
  const batch = await runGit(root, ['cat-file', '--batch'], { input: refs.map((ref) => `${ref}:desk.json\n`).join('') });
  const desks = [];
  const buf = Buffer.from(batch.stdout, 'utf8');
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    pos = nl + 1;
    const m = /^\S+ blob (\d+)$/.exec(header);
    if (!m) continue; // "<ref> missing"
    const size = Number(m[1]);
    const body = buf.subarray(pos, pos + size).toString('utf8');
    pos += size + 1;
    try {
      const d = JSON.parse(body);
      if (isValidDesk(d.desk)) desks.push(d);
    } catch {
      /* ignore a malformed desk record */
    }
  }
  return desks.sort((a, b) => a.desk.localeCompare(b.desk));
}

// ---------------------------------------------------------------- overview model

/**
 * Where is the latest version of `branch`, and is each PC in sync?
 * Mirrors the dashboard rules: unpushed local commits win ("local only"),
 * otherwise GitHub is the reference, and a PC that is behind is never latest.
 */
export function branchOverview(branch, { remote = [], desks = [] }) {
  const gh = remote.find((b) => b.name === branch) || null;
  const rows = desks.map((d) => {
    const b = (d.branches || []).find((x) => x.name === branch) || null;
    let rel;
    if (!b) rel = { k: 'none', label: '브랜치 없음' };
    else if (!b.upstream) rel = { k: 'ahead', label: '이 PC에만 있음 · 푸시 필요' };
    else if (b.ahead && b.behind) rel = { k: 'diverged', label: `갈라짐 ↑${b.ahead} ↓${b.behind}` };
    else if (b.ahead) rel = { k: 'ahead', label: `↑${b.ahead} 푸시 필요` };
    else if (b.behind) rel = { k: 'behind', label: `↓${b.behind} pull 필요` };
    else if (gh && b.head !== gh.head) rel = { k: 'stale', label: '기록이 오래됨' };
    else rel = { k: 'ok', label: 'GitHub와 같음' };
    return { desk: d.desk, tool: d.tool, host: d.host, at: d.at, holding: d.holding, branch: b, rel, current: d.branch === branch, dirty: d.branch === branch ? (d.dirty || []).length : 0 };
  });
  const localNew = rows.filter((r) => r.branch && (r.branch.ahead || !r.branch.upstream)).sort((a, b) => b.branch.ts - a.branch.ts);
  let latest;
  if (localNew.length) latest = { where: localNew.map((r) => r.desk), localOnly: true };
  else if (gh) latest = { where: ['github', ...rows.filter((r) => r.branch?.head === gh.head && !r.branch.behind).map((r) => r.desk)], localOnly: false };
  else {
    const best = rows.filter((r) => r.branch && !r.branch.behind).sort((a, b) => b.branch.ts - a.branch.ts)[0];
    latest = { where: best ? [best.desk] : [], localOnly: false };
  }
  const holder = rows.find((r) => r.holding === branch)?.desk || null;
  let verdict;
  const hr = rows.find((r) => r.desk === holder);
  if (hr && (hr.rel.k === 'behind' || hr.rel.k === 'diverged')) verdict = { level: 'bad', text: `이어받은 데스크 ${holder}가 최신이 아니에요` };
  else if (rows.some((r) => r.rel.k === 'diverged')) verdict = { level: 'bad', text: 'GitHub와 갈라진 PC가 있어요' };
  else if (localNew.length) verdict = { level: 'warn', text: `데스크 ${localNew.map((r) => r.desk).join(', ')}에 푸시 안 한 커밋` };
  else if (rows.some((r) => r.rel.k === 'behind')) verdict = { level: 'warn', text: `${rows.filter((r) => r.rel.k === 'behind').map((r) => r.desk).join(', ')}가 뒤처짐` };
  else if (holder) verdict = { level: 'ok', text: `데스크 ${holder}에서 잘 이어가는 중` };
  else verdict = { level: 'ok', text: '모두 최신이에요' };
  return { branch, gh, rows, latest, holder, verdict };
}

// ---------------------------------------------------------------- commands

/** Text an agent should read at session start: fresh pull + session + status. */
export async function context(root, { pull = true } = {}) {
  const notes = [];
  if (pull) {
    await runGit(root, ['fetch', '--quiet', 'origin']);
    const r = await runGit(root, ['pull', '--ff-only', '--quiet']);
    if (r.code !== 0) notes.push('(Tandem: 자동 pull을 못 했어요. 충돌이나 커밋 안 한 변경을 확인하세요.)');
  }
  const cfg = await readDeskConfig(root);
  const md = (await readText(join(root, SESSION_REL))) ?? '(아직 .tandem/SESSION.md 가 없어요)';
  const st = await localStatus(root);
  const log = (await runGit(root, ['log', '--oneline', '-5'])).stdout.trim();
  return [
    `[Tandem 가상 세션 · 지금 데스크 ${cfg.desk || '?'} · ${cfg.tool || '?'}]`,
    "아래는 모든 PC·AI가 이어 쓰는 같은 세션입니다. 이전 대화처럼 여기고 '다음 단계'부터 이어가세요. 작업을 마치면 .tandem/SESSION.md 의 현재 상태·다음 단계·작업 로그를 갱신하세요.",
    ...notes,
    md.trim(),
    '',
    `브랜치: ${st.branch} · 최근 커밋:`,
    log,
  ].join('\n');
}

async function appendLog(root, cfg, text, mutate) {
  const s = (await readSession(root)) || parseSession('');
  s.log = [...s.log, logLine({ desk: cfg.desk, tool: cfg.tool, text })];
  if (mutate) mutate(s);
  await writeSession(root, s);
  return s;
}

/** Leave this PC: log + next step, commit everything, push, publish status. */
export async function leave(root, { memo = '', next = '', push = true } = {}) {
  const cfg = await readDeskConfig(root);
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  await appendLog(root, cfg, `떠남 (${branch}): ${oneLine(memo)}`, (s) => {
    if (String(next).trim()) s.next = String(next).trim();
  });
  await git(root, ['add', '-A']);
  const c = await runGit(root, ['commit', '--quiet', '-m', `tandem: ${oneLine(memo) || '작업 중간 저장'}`]);
  let pushed = false;
  let pushError = null;
  if (push) {
    const p = await runGit(root, ['push', '--quiet', '-u', 'origin', 'HEAD']);
    pushed = p.code === 0;
    pushError = pushed ? null : p.stderr.trim();
  }
  let published = null;
  if (cfg.desk) published = await publishDesk(root, { desk: cfg.desk, tool: cfg.tool, status: await localStatus(root), holding: null, push });
  return { branch, committed: c.code === 0, pushed, pushError, published };
}

/** Resume on this PC: fetch, switch/track, rebase-pull, log, publish, return the prompt. */
export async function resume(root, { branch = null, push = true } = {}) {
  if (branch != null && !isValidBranch(branch)) throw new Error('invalid branch name');
  const cfg = await readDeskConfig(root);
  await runGit(root, ['fetch', '--prune', '--quiet', 'origin']);
  if (branch) {
    const sw = await runGit(root, ['switch', branch]);
    if (sw.code !== 0) await git(root, ['switch', '-c', branch, '--track', `origin/${branch}`]);
  }
  const pull = await runGit(root, ['pull', '--rebase', '--autostash', '--quiet']);
  const cur = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const s = await appendLog(root, cfg, `이어받음 (${cur})`);
  let published = null;
  if (cfg.desk) published = await publishDesk(root, { desk: cfg.desk, tool: cfg.tool, status: await localStatus(root), holding: cur, push });
  const log = (await runGit(root, ['log', '--oneline', '-5'])).stdout.trim();
  const prompt = [
    '[같은 작업 이어하기 · Tandem]',
    "아래 세션 기록을 이전 대화처럼 여기고 '다음 단계'부터 이어가세요.",
    renderSession(s).trim(),
    '',
    log,
  ].join('\n');
  return { branch: cur, pulled: pull.code === 0, pullError: pull.code === 0 ? null : pull.stderr.trim(), published, prompt };
}

/** Refresh this PC's published status (call on a timer or after git operations). */
export async function heartbeat(root, { push = true } = {}) {
  const cfg = await readDeskConfig(root);
  if (!cfg.desk) return null;
  const prev = (await fetchDesks(root, { fetch: false })).find((d) => d.desk === cfg.desk);
  return publishDesk(root, { desk: cfg.desk, tool: cfg.tool, status: await localStatus(root), holding: prev?.holding ?? null, push });
}

/** Everything the Tandem panel needs in one call. */
export async function overview(root, { fetch = true } = {}) {
  if (fetch) await fetchAll(root);
  const [cfg, session, desks, remote, local] = await Promise.all([
    readDeskConfig(root),
    readSession(root),
    fetchDesks(root, { fetch: false }),
    remoteBranches(root),
    localStatus(root),
  ]);
  const meIdx = desks.findIndex((d) => d.desk === cfg.desk);
  const merged = [...desks];
  const mine = { v: 1, desk: cfg.desk, tool: cfg.tool, host: cfg.host, holding: meIdx >= 0 ? desks[meIdx].holding : null, ...local };
  if (cfg.desk) meIdx >= 0 ? (merged[meIdx] = mine) : merged.push(mine);
  const holding = merged.map((d) => d.holding).filter(Boolean);
  const focus = holding[0] || local.branch;
  return { config: cfg, session, desks: merged, remote, local, focus: branchOverview(focus, { remote, desks: merged }), handoffs: (session?.log || []).map(parseLogLine).filter(Boolean).slice(-20) };
}
