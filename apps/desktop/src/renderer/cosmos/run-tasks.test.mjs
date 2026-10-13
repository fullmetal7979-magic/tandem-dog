import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTargets, makeTasks, orderTasks, packageManagerFor, packageScriptTasks, runTerminalId, scriptCommand } from './run-tasks.ts';

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
  assert.equal(scriptCommand('npm', "a b'c"), "npm run 'a b'\\''c'");
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
