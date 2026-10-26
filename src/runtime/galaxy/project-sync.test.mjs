// rescueDisplacedWork: every step is checked before the hard reset, commits
// never need a GPG signature, and a rescue carrying a secret stays local.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rescueDisplacedWork, secretFindingsInRange } from './project-sync.mjs';

const ident = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...ident } }).toString().trim();

/** A clone with one pushed commit, one unpushed commit and an uncommitted file. */
function displaced(t) {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-rescue-'));
  t.after(() => {
    try {
      chmodSync(join(root, 'app', 'locked.txt'), 0o644);
    } catch {
      /* not created by this test */
    }
    rmSync(root, { recursive: true, force: true });
  });
  const remote = join(root, 'app.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const app = join(root, 'app');
  git(root, 'clone', '--quiet', remote, app);
  git(app, 'config', 'user.email', 'me@test');
  git(app, 'config', 'user.name', 'me');
  // A user's global ignore file (often listing .env*) must not shape the test.
  git(app, 'config', 'core.excludesFile', join(root, 'no-excludes'));
  writeFileSync(join(app, 'README.md'), '# app\n');
  git(app, 'add', '.');
  git(app, 'commit', '--quiet', '-m', 'init');
  git(app, 'push', '--quiet', '-u', 'origin', 'HEAD:main');
  writeFileSync(join(app, 'committed.txt'), 'unpushed\n');
  git(app, 'add', '.');
  git(app, 'commit', '--quiet', '-m', 'unpushed');
  writeFileSync(join(app, 'draft.txt'), 'uncommitted\n');
  return { root, remote, app, head: git(app, 'rev-parse', 'HEAD') };
}

const now = new Date('2026-10-26T09:30:00Z');

test('rescue commits without a GPG signature even when signing is on, then resets', async (t) => {
  const w = displaced(t);
  git(w.app, 'config', 'commit.gpgsign', 'true');
  git(w.app, 'config', 'gpg.program', 'false');
  const rescue = await rescueDisplacedWork(w.app, '집 맥북', now);
  assert.equal(rescue.ok, true, JSON.stringify(rescue));
  assert.equal(rescue.pushed, true);
  assert.equal(git(w.app, 'branch', '--show-current'), 'main');
  assert.equal(git(w.app, 'rev-parse', 'HEAD'), git(w.app, 'rev-parse', 'origin/main'));
  assert.equal(existsSync(join(w.app, 'draft.txt')), false);
  assert.equal(git(w.app, 'show', `${rescue.branch}:draft.txt`), 'uncommitted');
  assert.equal(git(w.app, 'show', `${rescue.branch}:committed.txt`), 'unpushed');
  assert.equal(git(w.remote, 'show', `${rescue.branch}:draft.txt`), 'uncommitted');
});

test('a failed rescue step stops before the reset and leaves the work where it was', { skip: process.getuid?.() === 0 && 'root reads unreadable files' }, async (t) => {
  const w = displaced(t);
  const locked = join(w.app, 'locked.txt');
  writeFileSync(locked, 'cannot be read\n');
  chmodSync(locked, 0o000);
  const rescue = await rescueDisplacedWork(w.app, 'me', now);
  assert.equal(rescue.ok, false);
  assert.equal(rescue.failed, 'add');
  assert.equal(git(w.app, 'branch', '--show-current'), 'main');
  assert.equal(git(w.app, 'rev-parse', 'HEAD'), w.head, 'the unpushed commit was not reset away');
  assert.equal(readFileSync(join(w.app, 'draft.txt'), 'utf8'), 'uncommitted\n');
  assert.equal(git(w.app, 'branch', '--list', 'cosmos/rescue-*'), '', 'the half-made rescue branch is gone');
});

test('a rescue that would carry a secret stays a local branch', async (t) => {
  const w = displaced(t);
  writeFileSync(join(w.app, '.env.local'), 'DB=1\n');
  writeFileSync(join(w.app, 'notes.txt'), 'token sk-proj-abcdefghijklmnopqrstuvwxyz\n');
  const rescue = await rescueDisplacedWork(w.app, 'me', now);
  assert.equal(rescue.ok, true);
  assert.equal(rescue.pushed, false);
  assert.deepEqual(rescue.secrets.map((finding) => finding.path).sort(), ['.env.local', 'notes.txt']);
  assert.equal(git(w.app, 'show', `${rescue.branch}:draft.txt`), 'uncommitted', 'the work is kept locally');
  assert.equal(git(w.remote, 'branch', '--list', 'cosmos/rescue-*'), '', 'nothing reached the remote');
});

test('secretFindingsInRange looks at the committed content between two commits', async (t) => {
  const w = displaced(t);
  assert.deepEqual(await secretFindingsInRange(w.app, 'origin/main', 'HEAD'), []);
  writeFileSync(join(w.app, 'cfg.txt'), 'key ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
  git(w.app, 'add', 'cfg.txt');
  git(w.app, 'commit', '--quiet', '-m', 'oops');
  assert.deepEqual(await secretFindingsInRange(w.app, 'origin/main', 'HEAD'), [{ path: 'cfg.txt', reason: 'content' }]);
  assert.equal(await secretFindingsInRange(w.app, 'no-such-ref', 'HEAD'), null);
});
