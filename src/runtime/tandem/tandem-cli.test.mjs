import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyCliInvocation } from '../../headless-command.mjs';
import { TANDEM_AGENT_SECTION, runTandemCli } from './tandem-cli.mjs';

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

async function twoClones() {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-cli-'));
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

/** Run the CLI and capture what it printed. */
async function tandem(cwd, ...args) {
  let out = '';
  let err = '';
  const code = await runTandemCli(args, {
    cwd,
    stdout: { write: (t) => ((out += t), true) },
    stderr: { write: (t) => ((err += t), true) },
  });
  return { code, out, err };
}

const count = (text, needle) => text.split(needle).length - 1;

test('mixdog tandem is classified as its own command that skips the TUI prelude', () => {
  const inv = classifyCliInvocation(['tandem', 'leave', '--memo-like', '한 일']);
  assert.equal(inv.kind, 'tandem');
  assert.deepEqual(inv.tandem.args, ['leave', '--memo-like', '한 일']);
  assert.equal(inv.skipHostPrelude, true);
  assert.equal(classifyCliInvocation(['Tandem', '--help']).kind, 'tandem');
  assert.equal(classifyCliInvocation(['tandem']).kind, 'tandem');
  assert.equal(classifyCliInvocation(['--help']).kind, 'help');
  assert.equal(classifyCliInvocation([]).kind, 'general');
});

test('init → leave on one PC → resume on another continues one session', async () => {
  const { dir, a, b } = await twoClones();
  try {
    // init: session template, desk config, agent instructions, next steps.
    await writeFile(join(a, 'AGENTS.md'), '# Project rules\n- be nice');
    const init = await tandem(a, 'init', 'A', 'Claude 개인');
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /다음 단계:/);
    assert.match(init.out, /mixdog tandem resume/);
    const session = await readFile(join(a, '.tandem', 'SESSION.md'), 'utf8');
    assert.match(session, /## 목표\n\(미정\)/);
    assert.equal((await readFile(join(a, '.tandem', 'desk'), 'utf8')).trim(), 'A');
    assert.equal((await readFile(join(a, '.tandem', 'tool'), 'utf8')).trim(), 'Claude 개인');
    assert.equal((await readFile(join(a, '.tandem', 'base'), 'utf8')).trim(), 'main');
    assert.match(await readFile(join(a, '.git', 'info', 'exclude'), 'utf8'), /\.tandem\/desk/);
    const agents = await readFile(join(a, 'AGENTS.md'), 'utf8');
    assert.equal(agents, `# Project rules\n- be nice\n\n${TANDEM_AGENT_SECTION}`);
    assert.equal(await readFile(join(a, 'CLAUDE.md'), 'utf8'), TANDEM_AGENT_SECTION);
    assert.match(TANDEM_AGENT_SECTION, /mixdog tandem leave "한 일" "다음 할 일"/);

    // init is idempotent and never clobbers the session.
    await writeFile(join(a, '.tandem', 'SESSION.md'), session.replace('(미정)', '결제 MVP'));
    const again = await tandem(a, 'init');
    assert.equal(again.code, 0, again.err);
    assert.match(await readFile(join(a, '.tandem', 'SESSION.md'), 'utf8'), /## 목표\n결제 MVP/);
    assert.equal(count(await readFile(join(a, 'AGENTS.md'), 'utf8'), '## Tandem 가상 세션'), 1);
    assert.equal(count(await readFile(join(a, 'CLAUDE.md'), 'utf8'), '## Tandem 가상 세션'), 1);
    assert.equal((await readFile(join(a, '.tandem', 'desk'), 'utf8')).trim(), 'A');

    // leave on PC A.
    sh(a, 'switch', '--quiet', '-c', 'feat/pay');
    await writeFile(join(a, 'pay.js'), 'export const pay = 1;\n');
    const left = await tandem(a, 'leave', '결제 폼 추가', '검증 로직');
    assert.equal(left.code, 0, left.err);
    assert.match(left.out, /feat\/pay 에 커밋했어요/);
    assert.match(left.out, /푸시했어요/);
    assert.match(left.out, /상태를 공개했어요/);
    assert.equal(sh(a, 'status', '--porcelain'), '');
    assert.match(sh(a, 'log', '-1', '--format=%s'), /^tandem: 결제 폼 추가$/);

    // PC B: name it, resume the branch, read the prompt.
    const desk = await tandem(b, 'desk', 'b', 'Codex');
    assert.equal(desk.code, 0, desk.err);
    assert.match(desk.out, /데스크 B \(Codex\)/);
    const resumed = await tandem(b, 'resume', 'feat/pay');
    assert.equal(resumed.code, 0, resumed.err);
    assert.match(resumed.out, /^\[같은 작업 이어하기 · Tandem\]/);
    assert.match(resumed.out, /## 다음 단계\n검증 로직/);
    assert.match(resumed.out, /결제 폼 추가/);
    assert.match(resumed.err, /feat\/pay 를 최신으로/);
    assert.equal(sh(b, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/pay');
    assert.equal(await readFile(join(b, 'pay.js'), 'utf8'), 'export const pay = 1;\n');

    // context and status see the same session from B and from A.
    const ctx = await tandem(b, 'context', '--no-pull');
    assert.equal(ctx.code, 0, ctx.err);
    assert.match(ctx.out, /^\[Tandem 가상 세션 · 지금 데스크 B · Codex\]/);
    assert.match(ctx.out, /브랜치: feat\/pay/);
    const pulledCtx = await tandem(a, 'context');
    assert.equal(pulledCtx.code, 0, pulledCtx.err);
    assert.match(pulledCtx.out, /데스크 A · Claude 개인/);

    const status = await tandem(a, 'status');
    assert.equal(status.code, 0, status.err);
    assert.match(status.out, /^Tandem 상태 · 이 PC: 데스크 A · Claude 개인/);
    assert.match(status.out, /브랜치 feat\/pay — \[(좋음|주의|문제)\]/);
    assert.match(status.out, /이어받은 데스크: B/);
    assert.match(status.out, /^A\s+Claude 개인\s+.*이 PC/m);
    assert.match(status.out, /^B\s+Codex\s+/m);
    assert.match(status.out, /떠남 \(feat\/pay\): 결제 폼 추가/);
    assert.equal((await tandem(a, 'status', '--no-fetch')).code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('init keeps an existing Tandem section and creates missing agent files', async () => {
  const { dir, a } = await twoClones();
  try {
    await writeFile(join(a, 'CLAUDE.md'), `${TANDEM_AGENT_SECTION}`);
    await writeFile(join(a, 'AGENTS.md'), '# Rules\r\n- x\r\n');
    const r = await tandem(a, 'init');
    assert.equal(r.code, 0, r.err);
    assert.equal(await readFile(join(a, 'CLAUDE.md'), 'utf8'), TANDEM_AGENT_SECTION);
    assert.equal(
      await readFile(join(a, 'AGENTS.md'), 'utf8'),
      `# Rules\r\n- x\r\n\r\n${TANDEM_AGENT_SECTION.replace(/\n/g, '\r\n')}`,
    );
    assert.match(r.out, /이 PC: 데스크 미지정/);
    assert.match(r.out, /mixdog tandem desk A/);
    assert.equal(existsSync(join(a, '.tandem', 'desk')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('arguments are validated before anything touches git or the files', async () => {
  const { dir, a } = await twoClones();
  try {
    for (const branch of ['x;rm -rf', '$(id)', '-x', 'a..b', 'a b']) {
      const r = await tandem(a, 'resume', branch);
      assert.equal(r.code, 2, branch);
      assert.match(r.err, /invalid branch name/);
    }
    assert.equal(sh(a, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');

    for (const desk of ['Z', 'AA', '1']) {
      const r = await tandem(a, 'desk', desk);
      assert.equal(r.code, 2, desk);
      assert.match(r.err, /desk must be one of A, B, C, D, E, F, G, H/);
    }
    assert.equal((await tandem(a, 'init', 'Z')).code, 2);
    assert.equal(existsSync(join(a, '.tandem')), false);

    assert.equal((await tandem(a, 'leave')).code, 2);
    assert.equal((await tandem(a, 'leave', '  ')).code, 2);
    assert.equal((await tandem(a, 'leave', 'a', 'b', 'c')).code, 2);
    assert.equal((await tandem(a, 'status', 'extra')).code, 2);
    assert.equal(existsSync(join(a, '.tandem')), false);

    const unknown = await tandem(a, 'frobnicate');
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /unknown command "frobnicate"/);
    const bare = await tandem(a);
    assert.equal(bare.code, 2);
    assert.match(bare.err, /Usage: mixdog tandem/);
    const help = await tandem(a, '--help');
    assert.equal(help.code, 0);
    assert.match(help.out, /leave "<memo>" \["<next>"\]/);
    assert.match(help.out, /desk <A-H>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('outside a git repository the command explains itself and fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-cli-plain-'));
  try {
    const r = await tandem(dir, 'context');
    assert.equal(r.code, 1);
    assert.match(r.err, /git 저장소 안에서 실행하세요/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('leave reports a failed push with a non-zero exit, and --no-push stays local', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-cli-local-'));
  try {
    sh(dir, 'init', '--quiet', '--initial-branch=main');
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) sh(dir, 'config', k, v);
    await writeFile(join(dir, 'README.md'), 'hi\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '--quiet', '-m', 'init');
    assert.equal((await tandem(dir, 'desk', 'C', 'Claude')).code, 0);

    const failed = await tandem(dir, 'leave', '로컬 작업');
    assert.equal(failed.code, 1);
    assert.match(failed.err, /푸시 실패/);
    assert.match(sh(dir, 'log', '-1', '--format=%s'), /^tandem: 로컬 작업$/);

    const local = await tandem(dir, 'leave', '한 번 더', '다음 일', '--no-push');
    assert.equal(local.code, 0, local.err);
    assert.match(local.out, /푸시하지 않았어요/);
    const session = await readFile(join(dir, '.tandem', 'SESSION.md'), 'utf8');
    assert.match(session, /## 다음 단계\n다음 일/);
    assert.match(session, /데스크 C · Claude · 떠남 \(main\): 한 번 더/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
