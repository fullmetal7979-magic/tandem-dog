// Round-3 audit (보안·데이터): push rejections are classified, 내려놓기 can be
// forced past a failed push, Galaxy commits never need a GPG signature, a
// legacy sync base is adopted once, unpushed commits are scanned for secrets,
// and the retired uiMode no longer syncs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectGalaxy, publishBeat, transact, writeGalaxyJson } from './galaxy-repo.mjs';
import { moon, sun } from './cosmos.mjs';
import { runCosmosCli } from './cosmos-cli.mjs';
import { SYNCED_CONFIG_KEYS, baseFor, readSyncState, syncEnvironmentIn } from './environment.mjs';
import { classifyPushFailure, saveAndPush } from './project-sync.mjs';
import { readSeat } from './seat.mjs';
import { updateStar } from './star.mjs';
import { planetForRoot } from './planet.mjs';
import { invalidateConfigReadCache, readConfig, updateConfig } from '../shared/config.mjs';

const ident = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...ident } }).toString().trim();

const previousEnv = { data: process.env.MIXDOG_DATA_DIR, home: process.env.MIXDOG_HOME, backups: process.env.MIXDOG_USER_DATA_BACKUP_ROOT };
const backupRoot = mkdtempSync(join(tmpdir(), 'cosmos-push-backups-'));
process.env.MIXDOG_USER_DATA_BACKUP_ROOT = backupRoot;
test.after(() => {
  for (const [key, value] of [
    ['MIXDOG_DATA_DIR', previousEnv.data],
    ['MIXDOG_HOME', previousEnv.home],
    ['MIXDOG_USER_DATA_BACKUP_ROOT', previousEnv.backups],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateConfigReadCache();
  rmSync(backupRoot, { recursive: true, force: true });
});

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A bare remote whose server hook refuses every push, like a protected branch. */
function protectBranch(remote) {
  const hooks = join(remote, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "GH006: Protected branch update failed for refs/heads/main." >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  // A user's global core.hooksPath must not replace the remote's own hooks.
  git(remote, 'config', 'core.hooksPath', hooks);
}

/** A project clone with one pushed commit (plain git, no Galaxy). */
function project(t) {
  const root = tmp(t, 'cosmos-push-');
  const remote = join(root, 'app.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const app = join(root, 'app');
  git(root, 'clone', '--quiet', remote, app);
  git(app, 'config', 'user.email', 'me@test');
  git(app, 'config', 'user.name', 'me');
  git(app, 'config', 'core.excludesFile', join(root, 'no-excludes'));
  writeFileSync(join(app, 'README.md'), '# app\n');
  git(app, 'add', '.');
  git(app, 'commit', '--quiet', '-m', 'init');
  git(app, 'push', '--quiet', '-u', 'origin', 'HEAD:main');
  return { root, remote, app };
}

/** Two stars sharing a Galaxy and a project remote. */
function world(t) {
  const root = tmp(t, 'cosmos-push-world-');
  const galaxyRemote = join(root, 'galaxy.git');
  const planetRemote = join(root, 'app.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', galaxyRemote);
  git(root, 'init', '--quiet', '--bare', '-b', 'main', planetRemote);
  const seed = join(root, 'seed');
  git(root, 'clone', '--quiet', planetRemote, seed);
  writeFileSync(join(seed, 'README.md'), '# app\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'init');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  const star = (name) => {
    const home = join(root, name, 'home');
    const app = join(root, name, 'app');
    mkdirSync(join(home, 'data'), { recursive: true });
    git(root, 'clone', '--quiet', planetRemote, app);
    git(app, 'config', 'user.email', `${name}@test`);
    git(app, 'config', 'user.name', name);
    return { home, project: app, dir: join(home, 'galaxy'), name };
  };
  return { root, galaxyRemote, planetRemote, a: star('a'), b: star('b') };
}

async function as(star, run) {
  process.env.MIXDOG_HOME = star.home;
  process.env.MIXDOG_DATA_DIR = join(star.home, 'data');
  invalidateConfigReadCache();
  return run();
}

const quiet = () => {
  const lines = [];
  const sink = { write: (text) => lines.push(text) };
  return { lines, sink, text: () => lines.join('') };
};

// ------------------------------------------------------------------ item 2

test('push failures: only non-fast-forward / fetch first are "behind"; a refusal is "rejected"', () => {
  assert.equal(classifyPushFailure(' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push'), 'behind');
  assert.equal(classifyPushFailure(' ! [rejected]        main -> main (fetch first)\nhint: Updates were rejected'), 'behind');
  assert.equal(
    classifyPushFailure('remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)'),
    'rejected'
  );
  assert.equal(classifyPushFailure('remote: Permission to me/app.git denied to someone.\nfatal: unable to access: The requested URL returned error: 403'), 'rejected');
  assert.equal(classifyPushFailure(' ! [remote rejected] main -> main (pre-receive hook declined)'), 'rejected');
  assert.equal(classifyPushFailure('fatal: unable to access: Could not resolve host: github.com'), 'push');
  assert.equal(classifyPushFailure(''), 'push');
});

test('a protected branch is "rejected", and 내려놓기 --force frees the seat saying the work was not pushed', async (t) => {
  const w = world(t);
  await as(w.a, async () => {
    await updateStar({ name: 'a', kind: 'pc' }, w.a.home);
    await connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote });
  });
  const opts = { root: w.a.project, dir: w.a.dir, home: w.a.home };
  await as(w.a, () => sun(opts));
  protectBranch(w.planetRemote);
  writeFileSync(join(w.a.project, 'a-work.txt'), 'work\n');

  await as(w.a, () =>
    assert.rejects(moon(opts), (error) => {
      assert.equal(error.code, 'push_failed');
      assert.equal(error.reason, 'rejected');
      assert.equal(error.canForce, true);
      assert.match(error.message, /거부/);
      assert.match(error.message, /그대로/);
      return true;
    })
  );
  const planetId = (await planetForRoot(w.a.project)).id;
  assert.equal((await readSeat(planetId, { dir: w.a.dir })).holder?.name, 'a', 'without force the seat stays');

  const forced = await as(w.a, () => moon({ ...opts, force: true }));
  assert.equal(forced.seat.holder, null);
  assert.equal(forced.project.ok, false);
  assert.equal(forced.unpushed.reason, 'rejected');
  assert.equal(forced.unpushed.branch, 'main');
  assert.equal(forced.unpushed.ahead, 1, 'the commit made by the first attempt is still only here');
  assert.equal(typeof forced.unpushed.committed, 'boolean');
  assert.match(forced.unpushed.detail, /GH006/);
  assert.throws(() => git(w.planetRemote, 'show', 'main:a-work.txt'), 'nothing reached the protected branch');
});

test('a clean 내려놓기 reports unpushed: null', async (t) => {
  const w = world(t);
  await as(w.a, () => connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote }));
  const opts = { root: w.a.project, dir: w.a.dir, home: w.a.home };
  await as(w.a, () => sun(opts));
  writeFileSync(join(w.a.project, 'ok.txt'), 'ok\n');
  const left = await as(w.a, () => moon(opts));
  assert.equal(left.unpushed, null);
  assert.equal(left.project.pushed, true);
});

test('the CLI passes --force through 내려놓기 and its 달 alias', async (t) => {
  const w = world(t);
  await as(w.a, () => connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote }));
  const opts = { root: w.a.project, dir: w.a.dir, home: w.a.home };
  await as(w.a, () => sun(opts));
  protectBranch(w.planetRemote);
  writeFileSync(join(w.a.project, 'cli.txt'), 'cli\n');

  const refused = quiet();
  const code = await as(w.a, () => runCosmosCli(['내려놓기'], { cwd: w.a.project, out: refused.sink, err: refused.sink }));
  assert.equal(code, 2);
  assert.match(refused.text(), /cosmos 내려놓기 --force/);

  const forced = quiet();
  const ok = await as(w.a, () => runCosmosCli(['달', '--force', '메모'], { cwd: w.a.project, out: forced.sink, err: forced.sink }));
  assert.equal(ok, 0, forced.text());
  assert.match(forced.text(), /올리지 않은 채로 내려놓았어요 \(rejected\)/);
  const planetId = (await planetForRoot(w.a.project)).id;
  const seat = await readSeat(planetId, { dir: w.a.dir });
  assert.equal(seat.holder, null);
  assert.equal(seat.history.at(-1).memo, '메모', 'the flag is not part of the note');
});

// ------------------------------------------------------------------ item 3

test('Galaxy commits, history squash and beats never need a GPG signature', async (t) => {
  const root = tmp(t, 'cosmos-gpg-');
  const remote = join(root, 'galaxy.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const dir = join(root, 'galaxy');
  await connectGalaxy({ dir, remoteUrl: remote });
  git(dir, 'config', 'commit.gpgSign', 'true');
  git(dir, 'config', 'gpg.program', 'false');
  for (let i = 0; i < 3; i += 1) {
    await transact(
      async ({ dir: galaxy }) => {
        await writeGalaxyJson(galaxy, `f${i}.json`, { i });
        return { value: null, message: `c${i}` };
      },
      { dir, squashAfter: 2 }
    );
  }
  assert.equal(git(remote, 'rev-list', '--count', 'main'), '1', 'the squash commit was made too');
  const beat = await publishBeat('star-1', { name: 'x' }, { dir });
  assert.equal(beat.pushed, true);
  assert.doesNotMatch(git(remote, 'cat-file', '-p', 'main'), /gpgsig/);
});

// ------------------------------------------------------------------ item 4

function envWorld(t) {
  const root = tmp(t, 'cosmos-legacy-');
  const home = join(root, 'home');
  const dataDir = join(home, 'data');
  const galaxy = join(root, 'galaxy');
  mkdirSync(join(dataDir, 'skills'), { recursive: true });
  mkdirSync(join(galaxy, 'environment', 'files', 'skills'), { recursive: true });
  process.env.MIXDOG_HOME = home;
  process.env.MIXDOG_DATA_DIR = dataDir;
  invalidateConfigReadCache();
  return { root, home, dataDir, galaxy };
}

test('a legacy base without galaxyId is accepted once, then stamped; a mismatched id still drops it', async (t) => {
  const w = envWorld(t);
  // Both sides already agreed on a.md before Galaxy ids existed; only the Galaxy changed b.md since.
  writeFileSync(join(w.dataDir, 'skills', 'a.md'), 'a\n');
  writeFileSync(join(w.dataDir, 'skills', 'b.md'), 'b-old\n');
  writeFileSync(join(w.galaxy, 'environment', 'files', 'skills', 'a.md'), 'a\n');
  writeFileSync(join(w.galaxy, 'environment', 'files', 'skills', 'b.md'), 'b-old\n');
  const seed = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await seed.commitLocal();
  const agreed = (await readSyncState(w.home)).base;
  // Rewrite the state the way an old build left it: a base, no identity.
  writeFileSync(join(w.home, 'galaxy-state.json'), `${JSON.stringify({ base: agreed, syncedAt: 1 }, null, 2)}\n`);
  rmSync(join(w.galaxy, 'galaxy.json'), { force: true });
  writeFileSync(join(w.galaxy, 'environment', 'files', 'skills', 'b.md'), 'b-new\n');
  writeFileSync(join(w.dataDir, 'skills', 'c.md'), 'c\n');

  const sync = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(sync.plan.conflicts, [], 'no conflicts: the old agreement was used');
  assert.deepEqual(sync.plan.down.map((entry) => entry.key), ['files/skills/b.md']);
  const summary = await sync.commitLocal();
  assert.equal(summary.adopted, true);
  assert.equal(summary.rebased, false);
  const stamped = await readSyncState(w.home);
  assert.ok(stamped.galaxyId, 'the base now carries this Galaxy id');
  assert.equal(stamped.galaxyId, JSON.parse(readFileSync(join(w.galaxy, 'galaxy.json'), 'utf8')).id);

  // From now on the normal rule applies: another Galaxy id drops the base.
  assert.deepEqual(baseFor(stamped, { galaxyId: 'someone-else', remote: stamped.remote }), {});
  const again = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  assert.equal((await again.commitLocal()).adopted, false);
});

// ------------------------------------------------------------------ item 5

test('saveAndPush scans unpushed commits for secrets before pushing', async (t) => {
  const p = project(t);
  writeFileSync(join(p.app, 'cfg.txt'), 'key ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
  git(p.app, 'add', 'cfg.txt');
  git(p.app, 'commit', '--quiet', '-m', 'committed by hand');
  const result = await saveAndPush(p.app, { message: 'cosmos: x' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'secrets');
  assert.equal(result.secretsIn, 'commits');
  assert.deepEqual(result.secrets, [{ path: 'cfg.txt', reason: 'content' }]);
  assert.throws(() => git(p.remote, 'show', 'main:cfg.txt'), 'nothing was pushed');
});

test('a new branch is scanned from its merge-base with the default branch', async (t) => {
  const p = project(t);
  git(p.app, 'remote', 'set-head', 'origin', 'main');
  git(p.app, 'switch', '--quiet', '-c', 'feature');
  writeFileSync(join(p.app, '.env.production'), 'X=1\n');
  git(p.app, 'add', '-f', '.env.production');
  git(p.app, 'commit', '--quiet', '-m', 'oops');
  const refused = await saveAndPush(p.app, { message: 'cosmos: x' });
  assert.equal(refused.error, 'secrets');
  assert.deepEqual(refused.secrets.map((finding) => finding.path), ['.env.production']);
  assert.equal(git(p.remote, 'branch', '--list', 'feature'), '');

  // A clean new branch goes out; README.md (already on main) is not rescanned as new.
  git(p.app, 'switch', '--quiet', 'main');
  git(p.app, 'switch', '--quiet', '-c', 'clean');
  writeFileSync(join(p.app, 'feature.txt'), 'fine\n');
  const pushed = await saveAndPush(p.app, { message: 'cosmos: clean' });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  assert.equal(pushed.pushed, true);
  assert.equal(git(p.remote, 'show', 'clean:feature.txt'), 'fine');
});

// ------------------------------------------------------------------ uiMode

test('the retired desktop.uiMode is not synced and an old Galaxy copy is ignored', async (t) => {
  assert.equal(SYNCED_CONFIG_KEYS.includes('desktop.uiMode'), false);
  const w = envWorld(t);
  updateConfig((config) => ({ ...config, desktop: { ...(config.desktop || {}), uiMode: 'advanced' } }));
  invalidateConfigReadCache();
  mkdirSync(join(w.galaxy, 'environment', 'config'), { recursive: true });
  writeFileSync(join(w.galaxy, 'environment', 'config', 'desktop.uiMode.json'), '"simple"\n');
  const sync = await syncEnvironmentIn(w.galaxy, { direction: 'pull', dataDir: w.dataDir, home: w.home });
  assert.equal(sync.plan.down.some((entry) => entry.key.includes('uiMode')), false);
  assert.equal(sync.plan.up.some((entry) => entry.key.includes('uiMode')), false);
  await sync.commitLocal();
  invalidateConfigReadCache();
  assert.equal(readConfig().desktop?.uiMode, 'advanced', 'the local value is left alone');
  assert.equal(Object.keys((await readSyncState(w.home)).base).some((key) => key.includes('uiMode')), false);
});
