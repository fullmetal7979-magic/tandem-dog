import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DESKTOP_IPC } from '../shared/contract.ts';
import { registerTandemIpc } from './ipc-tandem.ts';
import {
  tandemContext,
  tandemLeave,
  tandemOverview,
  tandemResume,
  tandemSaveSession,
  tandemSetDesk,
} from './tandem-service.ts';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function repoWithOrigin() {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-svc-'));
  const origin = join(dir, 'origin.git');
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  const work = join(dir, 'work');
  git(dir, 'clone', '--quiet', origin, work);
  git(work, 'config', 'user.email', 't@t');
  git(work, 'config', 'user.name', 't');
  await writeFile(join(work, 'README.md'), 'hi\n');
  git(work, 'add', '-A');
  git(work, 'commit', '--quiet', '-m', 'init');
  git(work, 'push', '--quiet', '-u', 'origin', 'main');
  return { dir, work };
}

test('overview reports why Tandem is unavailable instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-svc-plain-'));
  try {
    assert.deepEqual(await tandemOverview(dir, { fetch: false }), { available: false, reason: 'Open a git project to use Tandem.' });
    git(dir, 'init', '--quiet');
    const noOrigin = await tandemOverview(dir, { fetch: false });
    assert.equal(noOrigin.available, false);
    assert.match(noOrigin.reason, /origin remote/);
    await assert.rejects(tandemOverview('relative/path'), TypeError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('desk, leave, resume and session edits validate input and round-trip', async () => {
  const { dir, work } = await repoWithOrigin();
  try {
    await assert.rejects(tandemSetDesk(work, { desk: 'Z' }), /A to H/);
    await assert.rejects(tandemLeave(work, { memo: 'x' }), /desk first/);
    await assert.rejects(tandemResume(work, { branch: '$(id)' }), /invalid/);
    await assert.rejects(tandemLeave(work, { memo: 'x'.repeat(501) }), /too long/);

    const cfg = await tandemSetDesk(work, { desk: 'A', tool: 'Claude 개인' });
    assert.equal(cfg.desk, 'A');
    assert.equal(cfg.tool, 'Claude 개인');

    const saved = await tandemSaveSession(work, { goal: '결제 MVP', next: '폼 UI', decisions: ['금액은 정수'] });
    assert.equal(saved.goal, '결제 MVP');
    assert.deepEqual(saved.decisions, ['금액은 정수']);

    const left = await tandemLeave(work, { memo: '세션 시작', next: '검증 로직' });
    assert.equal(left.branch, 'main');
    assert.ok(left.pushed, left.pushError);

    const ov = await tandemOverview(work);
    assert.equal(ov.available, true);
    assert.equal(ov.config.desk, 'A');
    assert.equal(ov.session.next, '검증 로직');
    assert.equal(ov.desks[0].desk, 'A');

    const resumed = await tandemResume(work, {});
    assert.equal(resumed.branch, 'main');
    assert.match(resumed.prompt, /검증 로직/);
    assert.match(await tandemContext(work), /데스크 A · Claude 개인/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('IPC handlers require an absolute project path and forward plain objects only', async () => {
  const handlers = new Map();
  const calls = [];
  const op = (name) => async (...args) => {
    calls.push([name, ...args]);
    return name;
  };
  const operations = Object.fromEntries(
    ['tandemOverview', 'tandemLeave', 'tandemResume', 'tandemSetDesk', 'tandemContext', 'tandemSaveSession'].map((n) => [n, op(n)])
  );
  registerTandemIpc({ handle: (channel, listener) => handlers.set(channel, listener), operations });
  for (const channel of [DESKTOP_IPC.tandemOverview, DESKTOP_IPC.tandemLeave, DESKTOP_IPC.tandemResume, DESKTOP_IPC.tandemSetDesk, DESKTOP_IPC.tandemContext, DESKTOP_IPC.tandemSaveSession]) {
    assert.ok(handlers.has(channel), channel);
  }
  const abs = join(tmpdir(), 'x');
  assert.equal(await handlers.get(DESKTOP_IPC.tandemLeave)({}, abs, { memo: 'm' }), 'tandemLeave');
  assert.deepEqual(calls.at(-1), ['tandemLeave', abs, { memo: 'm' }]);
  await handlers.get(DESKTOP_IPC.tandemResume)({}, abs, ['not', 'an', 'object']);
  assert.deepEqual(calls.at(-1), ['tandemResume', abs, {}]);
  assert.throws(() => handlers.get(DESKTOP_IPC.tandemOverview)({}, 'relative'), TypeError);
});
