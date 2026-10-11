import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { logLine } from '../../runtime/tandem/tandem-core.mjs';
import {
  TANDEM_CONTEXT_MAX_BYTES,
  findTandemRoot,
  fitTandemContext,
  loadTandemContext,
} from './tandem-context.mjs';

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function makeRepo({ session } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-ctx-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init');
  if (session !== undefined) {
    mkdirSync(join(dir, '.tandem'), { recursive: true });
    writeFileSync(join(dir, '.tandem', 'SESSION.md'), session);
  }
  return dir;
}

async function withEnv(name, value, fn) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

const SESSION = [
  '# Tandem 가상 세션',
  '',
  '## 목표',
  '결제 MVP',
  '',
  '## 현재 상태',
  'API 완료',
  '',
  '## 다음 단계',
  '검증 로직',
  '',
  '## 결정 사항',
  '- 금액은 정수 원 단위',
  '',
  '## 작업 로그',
  '- 2026-10-11 23:32 · 데스크 A · Claude · 떠남 (feat/pay): 결제 폼 추가',
  '',
].join('\n');

test('a repo with .tandem/SESSION.md yields the Tandem block, from any subdirectory', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    for (const cwd of [repo, join(repo, 'src', 'deep')]) {
      const out = await loadTandemContext(cwd);
      assert.match(out, /^\[Tandem 가상 세션/);
      assert.match(out, /## 다음 단계\n검증 로직/);
      assert.match(out, /금액은 정수 원 단위/);
      assert.match(out, /브랜치: main/);
    }
    assert.equal(await findTandemRoot(join(repo, 'src', 'deep')), repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('reading the block leaves the checkout untouched', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    writeFileSync(join(repo, 'wip.txt'), 'unsaved\n');
    const before = git(repo, 'status', '--porcelain');
    const head = git(repo, 'rev-parse', 'HEAD');
    await loadTandemContext(repo);
    assert.equal(git(repo, 'status', '--porcelain'), before);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a linked worktree (.git file) is a checkout root too', async () => {
  const repo = makeRepo({ session: SESSION });
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'session');
  const wt = `${repo}-wt`;
  try {
    git(repo, 'worktree', 'add', '--quiet', '-b', 'side', wt);
    assert.equal(await findTandemRoot(wt), wt);
    assert.match(await loadTandemContext(wt), /브랜치: side/);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a repo without SESSION.md injects nothing', async () => {
  const repo = makeRepo();
  try {
    assert.equal(await findTandemRoot(repo), null);
    assert.equal(await loadTandemContext(repo), '');
    mkdirSync(join(repo, '.tandem'));
    writeFileSync(join(repo, '.tandem', 'desk'), 'A\n');
    assert.equal(await loadTandemContext(repo), '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a cwd outside any git repo injects nothing, even next to a SESSION.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-ctx-plain-'));
  try {
    mkdirSync(join(dir, '.tandem'));
    writeFileSync(join(dir, '.tandem', 'SESSION.md'), SESSION);
    assert.equal(await loadTandemContext(dir), '');
    assert.equal(await loadTandemContext(join(dir, 'missing')), '');
    assert.equal(await loadTandemContext(''), '');
    assert.equal(await loadTandemContext(undefined), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the nearest git root decides: a nested repo does not borrow its parent session', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    const inner = join(repo, 'vendor', 'inner');
    mkdirSync(inner, { recursive: true });
    git(inner, 'init', '--quiet');
    assert.equal(await loadTandemContext(inner), '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('MIXDOG_TANDEM_CONTEXT=0 opts out; other values keep it on', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    for (const off of ['0', 'false', 'off', 'no']) {
      assert.equal(await withEnv('MIXDOG_TANDEM_CONTEXT', off, () => loadTandemContext(repo)), '', off);
    }
    for (const on of [undefined, '', '1', 'true']) {
      assert.match(await withEnv('MIXDOG_TANDEM_CONTEXT', on, () => loadTandemContext(repo)), /Tandem 가상 세션/, String(on));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a block over 12 KB drops the oldest log entries first and stays within the byte cap', async () => {
  const log = Array.from({ length: 400 }, (_, i) => logLine({ desk: 'A', tool: 'Claude', text: `작업 ${i} ${'한글 로그 '.repeat(6)}` }));
  const session = SESSION.replace(/## 작업 로그[\s\S]*$/, `## 작업 로그\n${log.join('\n')}\n`);
  const repo = makeRepo({ session });
  try {
    const out = await loadTandemContext(repo);
    assert.equal(Buffer.byteLength(out, 'utf8') <= TANDEM_CONTEXT_MAX_BYTES, true);
    assert.equal(Buffer.byteLength(out, 'utf8') > TANDEM_CONTEXT_MAX_BYTES - 2048, true);
    assert.match(out, /## 목표\n결제 MVP/);
    assert.match(out, /## 다음 단계\n검증 로직/);
    assert.match(out, /오래된 작업 로그 \d+줄 생략/);
    assert.match(out, /작업 399 /);
    assert.doesNotMatch(out, /작업 0 /);
    assert.match(out, /브랜치: main/);
    assert.equal(out.includes(REPLACEMENT_CHAR), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('text that still does not fit is cut on a character boundary with a marker', () => {
  const huge = `[Tandem]\n## 현재 상태\n${'한글 상태 문장 '.repeat(4000)}\n## 작업 로그\n- 2026-10-11 23:32 · 데스크 A · Claude · 한 줄\n`;
  const out = fitTandemContext(huge);
  assert.equal(Buffer.byteLength(out, 'utf8') <= TANDEM_CONTEXT_MAX_BYTES, true);
  assert.equal(out.endsWith('\n- ...'), true);
  assert.equal(out.includes(REPLACEMENT_CHAR), false);
  assert.equal(fitTandemContext('짧은 글'), '짧은 글');
  assert.equal(fitTandemContext('가'.repeat(100), 20).endsWith('\n- ...'), true);
});

test('a SESSION.md over 1 MiB is not a session note and is skipped', async () => {
  const repo = makeRepo({ session: `${SESSION}\n## 메모\n${'x'.repeat(1024 * 1024 + 1)}\n` });
  try {
    assert.equal(await loadTandemContext(repo), '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a slow checkout is skipped when the timeout elapses', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    assert.equal(await loadTandemContext(repo, { timeoutMs: 1 }), '');
    assert.match(await loadTandemContext(repo, { timeoutMs: 20_000 }), /Tandem 가상 세션/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
