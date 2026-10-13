// The relay leg's 조종석 gate: writes from a phone go through only when the
// gate says so, reads never ask, and terminals are judged by the folder they
// were opened in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { gateRemoteWrites, SEAT_GATED_GIT_METHODS } from './remote-seat-gate.ts';

function table(calls) {
  const record = (name) => (params) => {
    calls.push([name, ...params]);
    return name === 'termEnsure' ? { id: 't1', replay: '' } : 'ok';
  };
  return Object.fromEntries(
    ['gitCommit', 'gitStatus', 'writeProjectFile', 'readProjectFile', 'submitToSession', 'submitNewTask', 'termEnsure', 'termWrite', 'termDispose'].map((name) => [name, record(name)])
  );
}

test('writes ask the seat for the right folder; reads never ask', async () => {
  const calls = [];
  const asked = [];
  const methods = gateRemoteWrites(table(calls), {
    gate: async (cwd) => {
      asked.push(cwd);
      return cwd === '/locked' ? '🔒 집 맥북이 조종 중이에요.' : null;
    },
    projectDirectory: async (id) => (id === 'p-locked' ? '/locked' : '/free'),
    sessionCwd: async (id) => (id === 's-locked' ? '/locked' : '/free'),
  });

  assert.equal(await methods.gitCommit(['/free', 'msg']), 'ok');
  await assert.rejects(methods.gitCommit(['/locked', 'msg']), /집 맥북이 조종 중/);
  await assert.rejects(methods.writeProjectFile(['p-locked', 'a.txt', 'x']), (error) => error.code === 'seat_refused');
  await assert.rejects(methods.submitToSession(['s-locked', 'hi']), /조종 중/);
  await assert.rejects(methods.submitNewTask(['hi', {}, { projectPath: 'p-locked' }]), /조종 중/);
  assert.equal(await methods.submitNewTask(['hi', {}, {}]), 'ok');

  asked.length = 0;
  assert.equal(methods.gitStatus(['/locked']), 'ok');
  assert.equal(methods.readProjectFile(['p-locked', 'a.txt']), 'ok');
  assert.deepEqual(asked, [], 'reads do not consult the seat');
  assert.equal(calls.some(([name, cwd]) => name === 'gitCommit' && cwd === '/locked'), false, 'a refused write never runs');
});

test('a terminal is judged by the folder it was opened in', async () => {
  const calls = [];
  const methods = gateRemoteWrites(table(calls), {
    gate: async (cwd) => (cwd === '/locked' ? 'locked' : null),
    projectDirectory: async () => null,
    sessionCwd: async () => null,
  });
  await methods.termEnsure([null, '/locked', null]);
  await assert.rejects(methods.termWrite(['t1', 'rm -rf build\n']), /locked/);
  await methods.termDispose(['t1']);
  assert.equal(await methods.termWrite(['t1', 'ls\n']), 'ok', 'a forgotten terminal falls back to the open gate');
});

test('every git lane that moves the checkout or the remote is gated', () => {
  for (const name of ['gitCommit', 'gitPush', 'gitPull', 'gitCheckoutBranch', 'gitResetToCommit', 'gitStashPop']) {
    assert.ok(SEAT_GATED_GIT_METHODS.includes(name), name);
  }
  for (const name of ['gitStatus', 'gitLog', 'gitDiff', 'gitShow']) assert.ok(!SEAT_GATED_GIT_METHODS.includes(name), name);
});
