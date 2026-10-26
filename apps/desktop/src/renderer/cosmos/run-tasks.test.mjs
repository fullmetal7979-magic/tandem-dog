import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  isRunnableName,
  makeTargets,
  makeTasks,
  orderTasks,
  packageManagerFor,
  packageScriptTasks,
  runTerminalId,
  scriptCommand,
  sha256Hex,
  skippedScriptNames,
  startRun,
} from './run-tasks.ts';

test('the lockfile picks the package manager', () => {
  assert.equal(packageManagerFor(['package.json', 'pnpm-lock.yaml']), 'pnpm');
  assert.equal(packageManagerFor(['yarn.lock']), 'yarn');
  assert.equal(packageManagerFor(['bun.lockb']), 'bun');
  assert.equal(packageManagerFor(['package.json']), 'npm');
});

test('scripts become commands for that manager; lifecycle hooks stay hidden', () => {
  const json = JSON.stringify({ scripts: { dev: 'vite', test: 'node --test', prebuild: 'rm -rf dist', build: 'vite build', 'lint:fix': 'eslint . --fix', postinstall: 'x' } });
  const tasks = orderTasks(packageScriptTasks(json, 'npm'));
  assert.deepEqual(tasks.map((task) => task.name), ['dev', 'build', 'test', 'lint:fix']);
  assert.equal(tasks[0].command, 'npm run dev');
  assert.equal(tasks[2].command, 'npm test');
  assert.equal(tasks[0].icon, '🚀');
  assert.equal(tasks[1].icon, '🧱');
  assert.equal(scriptCommand('pnpm', 'dev'), 'pnpm dev');
  assert.throws(() => scriptCommand('npm', "a b'c"), /Unsafe/);
  assert.deepEqual(packageScriptTasks('{ not json', 'npm'), []);
});

test('make targets: explicit ones only', () => {
  const makefile = ['.PHONY: build test', 'VERSION := 1.0', 'build: deps', '\tgo build', 'test:', '%.o: %.c', 'deploy/prod: build', 'build: again'].join('\n');
  assert.deepEqual(makeTargets(makefile), ['build', 'test', 'deploy/prod']);
  assert.equal(makeTasks(makefile)[0].command, 'make build');
  assert.equal(makeTasks(makefile, 'Build.mk')[0].command, 'make -f Build.mk build');
});

test('each project gets its own run terminal with a PTY-safe id', () => {
  const a = runTerminalId('/Users/me/app');
  assert.match(a, /^term_[A-Za-z0-9_-]{1,120}$/);
  assert.equal(a, runTerminalId('/Users/me/app'));
  assert.notEqual(a, runTerminalId('/Users/me/other'));
});

test('only shell-safe script names become buttons; the rest are skipped and reported', () => {
  const names = ['dev', 'lint:fix', 'build.prod', 'db/migrate', 'a@b', 'x-y_z'];
  const unsafe = ['--help', '-rf', '@splat', 'a b', "x';rm -rf ~;'", 'a&b', 'a|b', 'a$(id)', 'a`id`', 'a;b', 'a>b', 'a"b', 'a\nb', 'a%PATH%', ''];
  for (const name of names) assert.ok(isRunnableName(name), name);
  for (const name of unsafe) assert.equal(isRunnableName(name), false, JSON.stringify(name));
  const scripts = Object.fromEntries([...names, ...unsafe.filter(Boolean)].map((name) => [name, 'echo hi']));
  const json = JSON.stringify({ scripts });
  assert.deepEqual(packageScriptTasks(json, 'npm').map((task) => task.name).sort(), [...names].sort());
  for (const task of packageScriptTasks(json, 'pnpm')) assert.match(task.command, /^pnpm [\w:.@/-]+$/);
  assert.deepEqual(skippedScriptNames(json).sort(), unsafe.filter(Boolean).sort());
  assert.deepEqual(skippedScriptNames('{ nope'), []);
});

test('make targets and a makefile name get the same check', () => {
  assert.deepEqual(makeTasks('build:\n', 'x;y.mk'), []);
  assert.equal(makeTasks('build:\n', 'Build.mk')[0].command, 'make -f Build.mk build');
});

test('run terminal ids come from a long stable sha256 slice, and each run gets its own', () => {
  assert.equal(sha256Hex(''), createHash('sha256').update('').digest('hex'));
  for (const text of ['abc', '/Users/me/app', '한글/프로젝트', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), text.slice(0, 12));
  }
  const id = runTerminalId('/Users/me/app');
  assert.match(id, /^term_cosmos_run_[0-9a-f]{16}$/);
  assert.equal(id, `term_cosmos_run_${createHash('sha256').update('/Users/me/app').digest('hex').slice(0, 16)}`);
  const first = runTerminalId('/Users/me/app', 'lk3a0');
  assert.match(first, /^term_[A-Za-z0-9_-]{1,120}$/);
  assert.notEqual(first, runTerminalId('/Users/me/app', 'lk3a1'));
  assert.ok(first.startsWith('term_cosmos_run_'));
});

function fakeTerminals() {
  const live = new Set();
  const typed = [];
  const released = [];
  return {
    live,
    typed,
    released,
    api: {
      async termEnsure(id) {
        live.add(id);
        return { id, replay: '' };
      },
      termWrite(id, data) {
        assert.ok(live.has(id), 'a command is only ever typed into a terminal that exists');
        typed.push([id, data]);
      },
      async release(id) {
        live.delete(id);
        released.push(id);
      },
    },
  };
}

test('every run starts in a fresh PTY and releases the previous one first', async () => {
  const fake = fakeTerminals();
  const project = '/Users/me/app';
  const first = await startRun(fake.api, project, { command: 'npm run dev' }, null, 'n1');
  const second = await startRun(fake.api, project, { command: 'npm test' }, first.terminalId, 'n2');
  assert.notEqual(first.terminalId, second.terminalId);
  assert.deepEqual(fake.released, [first.terminalId]);
  assert.deepEqual(fake.typed, [
    [first.terminalId, 'npm run dev\r'],
    [second.terminalId, 'npm test\r'],
  ]);
  assert.deepEqual([...fake.live], [second.terminalId], 'only the newest run stays alive');
});

test('a failing release of the old PTY never blocks the new run', async () => {
  const fake = fakeTerminals();
  fake.api.release = async () => {
    throw new Error('already gone');
  };
  const result = await startRun(fake.api, '/p', { command: 'make' }, 'term_cosmos_run_old', 'n3');
  assert.deepEqual(fake.typed, [[result.terminalId, 'make\r']]);
});
