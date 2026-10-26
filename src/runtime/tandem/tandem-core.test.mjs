import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  branchOverview,
  context,
  fetchDesks,
  isValidBranch,
  leave,
  localStatus,
  logLine,
  overview,
  parseLogLine,
  parseSession,
  publishDesk,
  readDeskConfig,
  renderSession,
  resume,
  runGit,
  defaultGitTimeoutMs,
  writeDeskConfig,
  writeSession,
} from './tandem-core.mjs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

async function twoClones() {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-'));
  const origin = join(dir, 'origin.git');
  sh(dir, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  const a = join(dir, 'a');
  sh(dir, 'clone', '--quiet', origin, a);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) sh(a, 'config', k, v);
  await writeFile(join(a, 'README.md'), 'hi\n');
  sh(a, 'add', '-A');
  sh(a, 'commit', '--quiet', '-m', 'init');
  sh(a, 'push', '--quiet', '-u', 'origin', 'main');
  const b = join(dir, 'b');
  sh(dir, 'clone', '--quiet', origin, b);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) sh(b, 'config', k, v);
  return { dir, a, b };
}

test('session file round-trips through parse/render', () => {
  const s = { goal: '결제 MVP', state: 'API 완료\n폼 진행 중', next: '검증 로직', decisions: ['금액은 정수 원 단위'], log: [logLine({ desk: 'A', tool: 'Claude', text: '떠남 (feat/pay): 폼 추가' })] };
  const back = parseSession(renderSession(s));
  assert.equal(back.goal, s.goal);
  assert.equal(back.state, s.state);
  assert.equal(back.next, s.next);
  assert.deepEqual(back.decisions, s.decisions);
  assert.deepEqual(back.log, s.log);
  assert.deepEqual(parseSession(renderSession({})).decisions, []);
  assert.equal(parseSession(renderSession({})).goal, '');
});

test('log lines expose handoffs', () => {
  const l = parseLogLine('- 2026-10-11 23:32 · 데스크 A · Claude 개인 · 떠남 (feat/pay): 결제 폼 추가');
  assert.equal(l.kind, 'leave');
  assert.equal(l.branch, 'feat/pay');
  assert.equal(l.memo, '결제 폼 추가');
  assert.equal(parseLogLine('- 2026-10-11 23:33 · 데스크 B · Codex · 이어받음 (feat/pay)').kind, 'resume');
  assert.equal(parseLogLine('not a log line'), null);
});

test('branch names are validated before reaching git or a shell line', () => {
  for (const ok of ['main', 'feat/pay', 'a/결제-ui', 'v1.2']) assert.ok(isValidBranch(ok), ok);
  for (const bad of ['', '-x', 'a..b', 'a b', 'x;rm -rf', '$(id)', 'a/', 'x.lock', 'a@{1}']) assert.ok(!isValidBranch(bad), bad);
});

test('overview: unpushed commits win, behind PCs are never latest', () => {
  const remote = [{ name: 'feat', head: 'g1', ts: 100 }];
  const desks = [
    { desk: 'A', branch: 'feat', branches: [{ name: 'feat', head: 'a2', upstream: 'origin/feat', ahead: 2, behind: 0, ts: 200 }], holding: 'feat' },
    { desk: 'B', branch: 'main', branches: [{ name: 'feat', head: 'b0', upstream: 'origin/feat', ahead: 0, behind: 3, ts: 300 }] },
  ];
  const o = branchOverview('feat', { remote, desks });
  assert.deepEqual(o.latest, { where: ['A'], localOnly: true });
  assert.equal(o.holder, 'A');
  assert.equal(o.rows.find((r) => r.desk === 'B').rel.k, 'behind');
  assert.equal(o.verdict.level, 'warn');
  const synced = branchOverview('feat', { remote, desks: [{ desk: 'A', branches: [{ name: 'feat', head: 'g1', upstream: 'origin/feat', ahead: 0, behind: 0, ts: 100 }] }] });
  assert.deepEqual(synced.latest.where, ['github', 'A']);
  assert.equal(synced.verdict.level, 'ok');
});

test('leave on PC A and resume on PC B continue one session over git', async () => {
  const { dir, a, b } = await twoClones();
  try {
    await writeDeskConfig(a, { desk: 'A', tool: 'Claude 개인', base: 'main' });
    await writeSession(a, { goal: '결제 MVP', state: 'API 완료', next: '폼 UI', decisions: ['금액은 정수'], log: [] });
    sh(a, 'switch', '--quiet', '-c', 'feat/pay');
    await writeFile(join(a, 'pay.js'), 'export const pay = 1;\n');
    const left = await leave(a, { memo: '결제 폼 추가', next: '검증 로직' });
    assert.equal(left.branch, 'feat/pay');
    assert.ok(left.committed);
    assert.ok(left.pushed, left.pushError);
    assert.ok(left.published?.pushed, left.published?.error);
    assert.deepEqual((await readDeskConfig(a)).desk, 'A');
    assert.match(await readFile(join(a, '.git', 'info', 'exclude'), 'utf8'), /\.tandem\/desk/);
    assert.equal(sh(a, 'ls-files', '.tandem/desk'), '');

    await writeDeskConfig(b, { desk: 'B', tool: 'Codex' });
    const resumed = await resume(b, { branch: 'feat/pay' });
    assert.equal(resumed.branch, 'feat/pay');
    assert.ok(resumed.pulled, resumed.pullError);
    assert.match(resumed.prompt, /검증 로직/);
    assert.match(resumed.prompt, /금액은 정수/);
    assert.equal(await readFile(join(b, 'pay.js'), 'utf8'), 'export const pay = 1;\n');

    const desks = await fetchDesks(a);
    assert.deepEqual(desks.map((d) => d.desk), ['A', 'B']);
    assert.equal(desks.find((d) => d.desk === 'B').holding, 'feat/pay');

    const ov = await overview(a);
    assert.equal(ov.focus.branch, 'feat/pay');
    assert.equal(ov.focus.holder, 'B');
    // A learns about B's takeover from B's published desk record; B's own log
    // line rides along with B's next commit.
    assert.equal(ov.handoffs.at(-1).kind, 'leave');
    assert.equal((await overview(b, { fetch: false })).handoffs.at(-1).kind, 'resume');

    const ctx = await context(b, { pull: false });
    assert.match(ctx, /데스크 B · Codex/);
    assert.match(ctx, /## 다음 단계\n검증 로직/);
    assert.equal(sh(b, 'status', '--porcelain', '--', 'pay.js'), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publishing a desk never touches the working tree or index', async () => {
  const { dir, a } = await twoClones();
  try {
    await writeFile(join(a, 'wip.txt'), 'unsaved\n');
    const before = sh(a, 'status', '--porcelain');
    const st = await localStatus(a);
    const p = await publishDesk(a, { desk: 'C', tool: 'x', status: st, push: false });
    assert.match(p.commit, /^[0-9a-f]{40}$/);
    assert.equal(sh(a, 'status', '--porcelain'), before);
    assert.equal(sh(a, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    await assert.rejects(publishDesk(a, { desk: 'Z', status: st }), /desk not set/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runGit kills a command that outlives its timeout and resolves non-zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-timeout-'));
  try {
    const started = Date.now();
    const r = await runGit(dir, ['-c', 'alias.slow=!sleep 5', 'slow'], { timeoutMs: 300 });
    assert.notEqual(r.code, 0);
    assert.equal(r.timedOut, true);
    assert.match(r.stderr, /timed out/);
    assert.ok(Date.now() - started < 3000, 'did not wait for the grandchild');
    const ok = await runGit(dir, ['--version']);
    assert.equal(ok.code, 0);
    assert.equal(defaultGitTimeoutMs(['-c', 'k=v', 'fetch', '--quiet']), 60_000);
    assert.equal(defaultGitTimeoutMs(['rev-parse', 'HEAD']), 0, 'local commands run without a default limit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
