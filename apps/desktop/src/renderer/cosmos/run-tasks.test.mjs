import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  adoptRuns,
  clearRunTerminalViewState,
  TERMINAL_VIEW_STATE_KEY,
  forgetRun,
  isAdoptedRun,
  normalizeLiveRuns,
  reattachRuns,
  runTerminalTaskTag,
  isRunnableName,
  makeTargets,
  makeTasks,
  orderTasks,
  packageManagerFor,
  packageScriptTasks,
  projectRuns,
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

test('every run gets a fresh PTY; another task that is still running is left alone', async () => {
  const fake = fakeTerminals();
  const project = '/Users/me/app';
  const dev = await startRun(fake.api, project, { id: 'script:dev', command: 'npm run dev' }, null, 'n1');
  // The caller still hands over its last terminal (dev's): it must survive a test run.
  const tested = await startRun(fake.api, project, { id: 'script:test', command: 'npm test' }, dev.terminalId, 'n2');
  assert.notEqual(dev.terminalId, tested.terminalId);
  assert.deepEqual(fake.released, [], 'running test does not kill the dev server');
  assert.equal(tested.restarted, null);
  assert.deepEqual(fake.typed, [
    [dev.terminalId, 'npm run dev\r'],
    [tested.terminalId, 'npm test\r'],
  ]);
  assert.deepEqual([...fake.live].sort(), [dev.terminalId, tested.terminalId].sort());
  assert.deepEqual(projectRuns(project), [
    { taskId: 'script:dev', terminalId: dev.terminalId },
    { taskId: 'script:test', terminalId: tested.terminalId },
  ]);
});

test('re-running the same task restarts it in a fresh PTY', async () => {
  const fake = fakeTerminals();
  const project = '/Users/me/restart';
  const dev = await startRun(fake.api, project, { id: 'script:dev', command: 'npm run dev' }, null, 'n1');
  const tested = await startRun(fake.api, project, { id: 'script:test', command: 'npm test' }, dev.terminalId, 'n2');
  const again = await startRun(fake.api, project, { id: 'script:dev', command: 'npm run dev' }, tested.terminalId, 'n3');
  assert.notEqual(again.terminalId, dev.terminalId);
  assert.equal(again.restarted, dev.terminalId);
  assert.deepEqual(fake.released, [dev.terminalId], 'only the same task is restarted; test keeps running');
  assert.deepEqual([...fake.live].sort(), [tested.terminalId, again.terminalId].sort());
  assert.deepEqual(projectRuns(project).map((run) => run.terminalId).sort(), [tested.terminalId, again.terminalId].sort());
  assert.deepEqual(projectRuns('/Users/me/other'), [], 'runs are kept per project');
});

test('a task without an id keeps the old one-terminal behaviour', async () => {
  const fake = fakeTerminals();
  const first = await startRun(fake.api, '/Users/me/legacy', { command: 'npm run dev' }, null, 'n1');
  const second = await startRun(fake.api, '/Users/me/legacy', { command: 'npm test' }, first.terminalId, 'n2');
  assert.deepEqual(fake.released, [first.terminalId]);
  assert.equal(second.restarted, first.terminalId);
});

test('a failing release of the old PTY never blocks the new run', async () => {
  const fake = fakeTerminals();
  fake.api.release = async () => {
    throw new Error('already gone');
  };
  const result = await startRun(fake.api, '/p', { command: 'make' }, 'term_cosmos_run_old', 'n3');
  assert.deepEqual(fake.typed, [[result.terminalId, 'make\r']]);
});

test('a reloaded pane re-adopts only its own live run terminals, once', () => {
  const project = '/work/adopt-me';
  const base = runTerminalId(project);
  // The service derives the same id prefix from the path (desktop-operations cosmosRunTerminals).
  assert.equal(base, `term_cosmos_run_${createHash('sha256').update(project, 'utf8').digest('hex').slice(0, 16)}`);
  const other = runTerminalId('/work/someone-else', 'x1');
  const adopted = adoptRuns(project, [`${base}_a1`, other, 'term_123_4', null, `${base}_b2`]);
  assert.deepEqual(adopted, [`${base}_a1`, `${base}_b2`]);
  assert.deepEqual(adoptRuns(project, [`${base}_a1`]), [], 'already tracked');
  const runs = projectRuns(project);
  assert.deepEqual(runs.map((entry) => entry.terminalId), [`${base}_a1`, `${base}_b2`]);
  assert.ok(runs.every((entry) => isAdoptedRun(entry.taskId)));
});

// ------------------------------------------------------------------ round 4: runs found again after a reload

test('the service says whether an adopted run still runs; unknown stays unknown', () => {
  assert.deepEqual(
    normalizeLiveRuns(['a', { id: 'b', busy: true, exited: false }, { id: 'c', busy: false, exited: false }, { id: 'd', exited: true }, { id: 'e' }, null, { busy: true }]),
    [
      { id: 'a', running: null },
      { id: 'b', running: true },
      { id: 'c', running: false },
      { id: 'd', running: false },
      { id: 'e', running: null },
    ]
  );
});

test('an adopted run carrying a task tag goes back to that task, so ▶ restarts instead of duplicating', () => {
  const project = '/work/reattach';
  const tagged = runTerminalId(project, 'n1', 'script:dev');
  assert.equal(runTerminalTaskTag(project, tagged).length, 9);
  assert.equal(runTerminalTaskTag(project, runTerminalId(project, 'n2')), '', 'untagged (older) runs carry no tag');
  adoptRuns(project, [{ id: tagged, busy: true, exited: false }]);
  assert.ok(isAdoptedRun(projectRuns(project)[0].taskId));
  assert.deepEqual(reattachRuns(project, ['script:build', 'script:dev']), ['script:dev']);
  assert.deepEqual(projectRuns(project), [{ taskId: 'script:dev', terminalId: tagged }]);
  // Closing its tab forgets it.
  assert.equal(forgetRun(project, tagged), true);
  assert.deepEqual(projectRuns(project), []);
  assert.equal(forgetRun(project, tagged), false);
});

test('closing a run tab clears its saved terminal view', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const id = runTerminalId('/work/view', 'v1');
  storage.setItem(TERMINAL_VIEW_STATE_KEY, JSON.stringify({ [id]: { scroll: 3 }, other: { scroll: 1 } }));
  clearRunTerminalViewState(id, storage);
  assert.deepEqual(JSON.parse(store.get(TERMINAL_VIEW_STATE_KEY)), { other: { scroll: 1 } });
});

test('package.json’s packageManager field wins over a stray lockfile', async () => {
  const { packageManagerField } = await import('./run-tasks.ts');
  assert.equal(packageManagerField('{"packageManager":"pnpm@9.1.0+sha256.abc"}'), 'pnpm');
  assert.equal(packageManagerField('{"packageManager":"yarn@4.1.0"}'), 'yarn');
  assert.equal(packageManagerField('{"packageManager":"deno@2"}'), null);
  assert.equal(packageManagerField('{"name":"x"}'), null);
  assert.equal(packageManagerField('not json'), null);
});

test('justfile recipes that run without arguments become buttons', async () => {
  const { justRecipes, justTasks, justfileName } = await import('./run-tasks.ts');
  const justfile = [
    'set shell := ["bash", "-c"]',
    'alias b := build',
    'version := "1.0"',
    '',
    '# Start the dev server',
    'dev:',
    '    npm run dev',
    '@build mode="release":',
    '    cargo build --{{mode}}',
    'deploy target:',
    '    ./deploy {{target}}',
    'test *args:',
    '    cargo test {{args}}',
    '[private]',
    'helper:',
    '    echo hi',
    '_internal:',
    '    echo no',
    '[group("ops")]',
    'lint:',
    '    cargo clippy',
  ].join('\n');
  assert.deepEqual(justRecipes(justfile), ['dev', 'build', 'test', 'lint']);
  assert.equal(justfileName(['README.md', 'Justfile']), 'Justfile');
  assert.deepEqual(justTasks(justfile).map((task) => task.command), ['just dev', 'just build', 'just test', 'just lint']);
});

test('deno tasks are read from deno.json and deno.jsonc', async () => {
  const { denoConfigName, denoTasks } = await import('./run-tasks.ts');
  const jsonc = `{
    // the dev server
    "tasks": {
      "dev": "deno run -A --watch main.ts", /* watch mode */
      "check": { "command": "deno check main.ts", "description": "types" },
      "bad name": "rm -rf /",
    },
  }`;
  const tasks = denoTasks(jsonc);
  assert.deepEqual(tasks.map((task) => [task.name, task.command, task.detail]), [
    ['dev', 'deno task dev', 'deno run -A --watch main.ts'],
    ['check', 'deno task check', 'deno check main.ts'],
  ]);
  assert.equal(denoConfigName(['deno.jsonc']), 'deno.jsonc');
  assert.deepEqual(denoTasks('{ "url": "https://x//y" }'), [], 'a // inside a string is not a comment');
});

test('a Rust crate and a Go module get their everyday commands', async () => {
  const { cargoTasks, goTasks, orderTasks } = await import('./run-tasks.ts');
  const crate = cargoTasks('[package]\nname = "app"\n');
  assert.deepEqual(crate.map((task) => task.command), ['cargo run', 'cargo build', 'cargo test', 'cargo check', 'cargo clippy']);
  assert.equal(cargoTasks('[workspace]\nmembers = ["a"]\n').some((task) => task.command === 'cargo run'), false, 'a bare workspace has nothing to run');
  const ordered = orderTasks([...goTasks(), ...crate]).map((task) => task.name);
  assert.ok(ordered.indexOf('cargo build') < ordered.indexOf('cargo clippy'), ordered.join(','));
  assert.ok(ordered.indexOf('go test') < ordered.indexOf('go vet'), ordered.join(','));
});
