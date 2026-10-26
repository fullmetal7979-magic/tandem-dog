// 은하수 (Galaxy): the user-level git repository every star syncs through.
//
// The working copy lives at ~/.mixdog/galaxy and is owned by COSMOS: nothing
// edits it by hand, every change is one commit, and every commit is pushed at
// once. That discipline is what makes the Galaxy a lock service without a
// server: `transact()` re-reads the remote, applies a mutation, and pushes
// WITHOUT force; a rejected push means another star moved first, so the
// mutation re-runs against the newer state (compare-and-swap over git).
//
// Liveness ("heartbeats") does not go through main: each star force-pushes a
// one-commit ref refs/cosmos/beats/<starId>, so a five-minute pulse never
// grows the history every other star has to fetch.
//
// Every Galaxy commit is COSMOS bookkeeping, never the user's work, so it is
// made with --no-gpg-sign: a user who signs every commit (commit.gpgSign, a
// passphrase prompt, a hardware key) must not have every 이어받기 fail.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { runGit } from '../shared/git-process.mjs';
import { scrubUrl, scrubUrlsInText } from './secrets.mjs';
import { cosmosHome } from './star.mjs';

export { scrubUrl };

export const GALAXY_BRANCH = 'main';
export const BEAT_REF_PREFIX = 'refs/cosmos/beats/';
const BEAT_REFSPEC = `+${BEAT_REF_PREFIX}*:${BEAT_REF_PREFIX}*`;
// A held lock refreshes its mtime every LOCK_REFRESH_MS; only a lock whose
// mtime stood still for LOCK_STALE_MS (its owner is gone) may be stolen.
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_REFRESH_MS = 15_000;
const LOCK_WAIT_MS = 60_000;
// Past this many commits the Galaxy history is squashed to one commit.
export const SQUASH_COMMIT_THRESHOLD = 200;
const IDENT = {
  GIT_AUTHOR_NAME: 'COSMOS',
  GIT_AUTHOR_EMAIL: 'cosmos@localhost',
  GIT_COMMITTER_NAME: 'COSMOS',
  GIT_COMMITTER_EMAIL: 'cosmos@localhost',
};

export class GalaxyError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    Object.assign(this, detail);
  }
}

export function galaxyDir(home = cosmosHome()) {
  return join(home, 'galaxy');
}

async function git(cwd, args, opts) {
  const r = await runGit(cwd, args, { ...opts, env: { ...IDENT, ...(opts?.env || {}) } });
  if (r.code !== 0) {
    throw new GalaxyError('git_failed', `git ${args[0]} failed: ${scrubUrlsInText((r.stderr || r.stdout).trim())}`, { result: r });
  }
  return r.stdout;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ lock

async function readOwner(lock) {
  try {
    const owner = JSON.parse(await readFile(join(lock, 'owner'), 'utf8'));
    return owner && typeof owner === 'object' ? owner : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** Move a lock directory out of the way atomically, then delete it. */
async function discardLock(lock) {
  const grave = `${lock}.gone-${randomUUID()}`;
  try {
    await rename(lock, grave);
  } catch {
    return;
  }
  await rm(grave, { recursive: true, force: true });
}

/**
 * Take a lock from its owner: only when the mtime stood still past `staleMs`
 * (the owner refreshes it while alive), or when the owner is a dead process of
 * this very machine. Returns true when a lock was removed.
 */
async function stealIfStale(lock, staleMs) {
  const info = await stat(lock).catch(() => null);
  if (!info) return true;
  const seen = await readOwner(lock);
  const deadHere = Boolean(seen?.pid && seen.host === hostname() && !pidAlive(seen.pid));
  if (!deadHere && Date.now() - info.mtimeMs <= staleMs) return false;
  // rename is atomic: of several stealers exactly one gets the directory.
  const grave = `${lock}.stale-${randomUUID()}`;
  try {
    await rename(lock, grave);
  } catch {
    return true;
  }
  const taken = await readOwner(grave);
  if ((taken?.token ?? null) !== (seen?.token ?? null)) {
    // What we moved is not the lock we judged (a fresh one slipped in): put it back.
    try {
      await rename(grave, lock);
      return true;
    } catch {
      /* someone locked meanwhile; the moved copy is dead either way */
    }
  }
  await rm(grave, { recursive: true, force: true });
  return true;
}

// One writer per machine: the desktop and a terminal `cosmos` may both run.
// The lock is a directory holding an owner token; it is only ever removed by
// the token's owner (or stolen once its mtime stopped being refreshed).
export async function withLock(dir, run, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS, refreshMs = LOCK_REFRESH_MS } = {}) {
  const lock = join(dir, '.git', 'cosmos.lock');
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await mkdir(lock);
      try {
        await writeFile(join(lock, 'owner'), JSON.stringify({ token, pid: process.pid, host: hostname(), at: Date.now() }));
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (await stealIfStale(lock, staleMs)) continue;
      if (Date.now() > deadline) throw new GalaxyError('busy', '다른 코스모스 작업이 은하수를 쓰고 있어요. 잠시 후 다시 시도해 주세요.');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  const refresh = setInterval(() => {
    const now = new Date();
    utimes(lock, now, now).catch(() => {});
  }, refreshMs);
  refresh.unref?.();
  try {
    return await run();
  } finally {
    clearInterval(refresh);
    // Never remove a lock somebody else holds (ours may have been stolen).
    if ((await readOwner(lock))?.token === token) await discardLock(lock);
  }
}

// ------------------------------------------------------------------ setup

/** Remote URL of the Galaxy, or null when it is local-only. */
export async function galaxyRemote(dir = galaxyDir()) {
  if (!(await exists(join(dir, '.git')))) return null;
  const r = await runGit(dir, ['remote', 'get-url', 'origin']);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

export async function galaxyReady(dir = galaxyDir()) {
  return exists(join(dir, '.git'));
}

/**
 * Create or adopt the Galaxy. With `remoteUrl`, an empty directory clones it
 * (an empty remote is fine: the first transact pushes `main`). Without one
 * the Galaxy is local-only until `connectGalaxy` gives it a remote.
 */
export async function connectGalaxy({ dir = galaxyDir(), remoteUrl = null } = {}) {
  if (remoteUrl !== null && remoteUrl !== undefined) assertSafeRemoteUrl(remoteUrl);
  const hasRepo = await exists(join(dir, '.git'));
  if (!hasRepo) {
    await mkdir(dirname(dir), { recursive: true });
    if (remoteUrl) {
      // `--` ends option parsing: a URL can never be read as a git option.
      const r = await runGit(dirname(dir), ['clone', '--quiet', '--', remoteUrl, dir]);
      if (r.code !== 0) {
        throw new GalaxyError('clone_failed', `은하수 저장소를 받지 못했어요: ${scrubUrlsInText((r.stderr || r.stdout).trim())}`);
      }
    } else {
      await mkdir(dir, { recursive: true });
      await git(dir, ['init', '--quiet', '-b', GALAXY_BRANCH]);
    }
    await configureRepo(dir);
  } else {
    // The working copy is owned by whoever holds the lock.
    await withLock(dir, async () => {
      if (remoteUrl) {
        const current = await galaxyRemote(dir);
        if (!current) await git(dir, ['remote', 'add', 'origin', '--', remoteUrl]);
        else if (current !== remoteUrl) await git(dir, ['remote', 'set-url', 'origin', '--', remoteUrl]);
      }
      await configureRepo(dir);
    });
  }
  return { dir, remote: await galaxyRemote(dir) };
}

async function configureRepo(dir) {
  // A cloned empty remote has no branch yet; pin the name we push.
  await runGit(dir, ['symbolic-ref', 'HEAD', `refs/heads/${GALAXY_BRANCH}`]);
  await runGit(dir, ['config', 'core.quotePath', 'false']);
}

/** A remote URL is data, never an option: no leading '-', no whitespace/control characters. */
export function assertSafeRemoteUrl(url) {
  const value = String(url ?? '');
  if (!value.trim() || value.startsWith('-') || value.trim().startsWith('-') || /[\u0000-\u001f\u007f\s]/.test(value)) {
    throw new GalaxyError('bad_url', '저장소 주소가 올바르지 않아요. https:// 또는 git@ 로 시작하는 주소를 넣어 주세요.');
  }
  return value;
}

// ------------------------------------------------------------------ files

export async function readGalaxyJson(dir, rel, fallback = null) {
  try {
    return JSON.parse(await readFile(join(dir, rel), 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeGalaxyJson(dir, rel, value) {
  await writeGalaxyText(dir, rel, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeGalaxyText(dir, rel, text) {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

// ------------------------------------------------------------------ sync

async function hasCommits(dir, ref = 'HEAD') {
  return (await runGit(dir, ['rev-parse', '--verify', '--quiet', ref])).code === 0;
}

const remoteRef = `refs/remotes/origin/${GALAXY_BRANCH}`;

/**
 * Fetch the remote's `main` and every beat into the object store. Touches
 * refs only, never the working copy, so it is safe without the lock (the 20s
 * overview poll uses it). A local-only Galaxy has nothing to fetch.
 */
export async function fetchGalaxy(dir = galaxyDir()) {
  const remote = await galaxyRemote(dir);
  if (!remote) return { remote: null, fetched: false };
  const args = ['fetch', '--quiet', '--prune', 'origin', `+refs/heads/${GALAXY_BRANCH}:${remoteRef}`, BEAT_REFSPEC];
  let fetched = await runGit(dir, args);
  // Two processes fetching at once can collide on a ref lock; once more is enough.
  if (fetched.code !== 0 && /cannot lock ref|Unable to create .*\.lock/i.test(fetched.stderr)) fetched = await runGit(dir, args);
  if (fetched.code !== 0 && !/couldn't find remote ref/i.test(fetched.stderr)) {
    throw new GalaxyError('offline', `은하수에 연결하지 못했어요: ${scrubUrlsInText(fetched.stderr.trim())}`);
  }
  return { remote, fetched: true };
}

/**
 * Line the working copy up with the fetched `main` (or HEAD when the Galaxy is
 * local-only / the remote is still empty). Only call with the lock held. Does
 * nothing when the tree already is there: no reset, no clean.
 */
async function syncWorktree(dir) {
  const target = (await hasCommits(dir, remoteRef)) ? remoteRef : (await hasCommits(dir)) ? 'HEAD' : null;
  const dirty = (await git(dir, ['status', '--porcelain', '--untracked-files=all'])).trim() !== '';
  if (target) {
    const head = (await hasCommits(dir)) ? (await git(dir, ['rev-parse', 'HEAD'])).trim() : null;
    const want = (await git(dir, ['rev-parse', target])).trim();
    if (head === want && !dirty) return;
    await git(dir, ['reset', '--quiet', '--hard', target]);
  } else if (!dirty) {
    return;
  }
  await runGit(dir, ['clean', '-fdq']);
}

async function headOf(dir) {
  return (await hasCommits(dir)) ? (await git(dir, ['rev-parse', 'HEAD'])).trim() : null;
}

/**
 * Bring the working copy to the remote's `main`. Local uncommitted edits
 * cannot exist outside a transaction, so a hard reset loses nothing; it runs
 * under the lock so it can never race a transaction that is writing files.
 */
export async function pullGalaxy(dir = galaxyDir()) {
  return withLock(dir, async () => {
    const { remote } = await fetchGalaxy(dir);
    await syncWorktree(dir);
    return { remote, head: await headOf(dir) };
  });
}

/**
 * Read-only view of the Galaxy as of the last fetch: files come out of the
 * git object store (`git show <ref>:<path>`), never from the working copy, so
 * a transaction writing files cannot be seen half-done, and reading can never
 * disturb it. No lock needed.
 */
export async function galaxyReader(dir = galaxyDir()) {
  const remote = await galaxyRemote(dir);
  const ref = remote && (await hasCommits(dir, remoteRef)) ? remoteRef : (await hasCommits(dir)) ? 'HEAD' : null;
  const reader = {
    ref,
    async text(rel) {
      if (!ref) return null;
      const r = await runGit(dir, ['show', `${ref}:${rel}`]);
      return r.code === 0 ? r.stdout : null;
    },
    async json(rel, fallback = null) {
      const text = await reader.text(rel);
      if (text === null) return fallback;
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    },
    /** File names (not paths) directly inside `relDir`. */
    async names(relDir) {
      if (!ref) return [];
      const sub = relDir.replace(/^\.?\/?|\/+$/g, '');
      const r = await runGit(dir, ['ls-tree', '-z', '--name-only', sub ? `${ref}:${sub}` : ref]);
      return r.code === 0 ? r.stdout.split('\0').filter(Boolean) : [];
    },
  };
  return reader;
}

const squashBackoff = new Map();

/**
 * Collapse a long history into one commit holding the same tree. Runs under
 * the lock right after our own successful push; `--force-with-lease` pinned to
 * that very commit means a star that pushed meanwhile is never overwritten.
 * Best effort: a remote that refuses force pushes just keeps its history.
 */
async function squashHistory(dir, threshold = SQUASH_COMMIT_THRESHOLD) {
  if (Date.now() < (squashBackoff.get(dir) || 0)) return false;
  const count = Number((await runGit(dir, ['rev-list', '--count', 'HEAD'])).stdout.trim()) || 0;
  if (count <= threshold) return false;
  const head = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const flat = (await git(dir, ['commit-tree', '--no-gpg-sign', `${head}^{tree}`, '-m', `cosmos: 기록 정리 (${count}개 → 1개)`])).trim();
  const pushed = await runGit(dir, ['push', '--quiet', `--force-with-lease=refs/heads/${GALAXY_BRANCH}:${head}`, 'origin', `${flat}:refs/heads/${GALAXY_BRANCH}`]);
  if (pushed.code !== 0) {
    squashBackoff.set(dir, Date.now() + 60 * 60_000);
    return false;
  }
  await git(dir, ['reset', '--quiet', '--soft', flat]);
  await runGit(dir, ['update-ref', remoteRef, flat]);
  return true;
}

/**
 * Compare-and-swap over git. `mutate()` runs against the freshest remote
 * state and returns { value, message } after writing files, or { value } to
 * change nothing. A push rejected because the remote moved re-runs it.
 */
export async function transact(mutate, { dir = galaxyDir(), attempts = 5, squashAfter = SQUASH_COMMIT_THRESHOLD, lock } = {}) {
  return withLock(
    dir,
    async () => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        await fetchGalaxy(dir);
        await syncWorktree(dir);
        const outcome = await mutate({ dir, attempt });
        const message = outcome?.message;
        if (!message) return outcome?.value;
        await git(dir, ['add', '-A']);
        const staged = await runGit(dir, ['diff', '--cached', '--quiet']);
        if (staged.code === 0) return outcome.value;
        await git(dir, ['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', message]);
        const remote = await galaxyRemote(dir);
        if (!remote) return outcome.value;
        const pushed = await runGit(dir, ['push', '--quiet', 'origin', `HEAD:refs/heads/${GALAXY_BRANCH}`]);
        if (pushed.code === 0) {
          await squashHistory(dir, squashAfter).catch(() => false);
          return outcome.value;
        }
        if (!/(rejected|non-fast-forward|fetch first|stale info|cannot lock ref)/i.test(pushed.stderr)) {
          await runGit(dir, ['reset', '--quiet', '--hard', 'HEAD~1']);
          throw new GalaxyError('push_failed', `은하수에 올리지 못했어요: ${scrubUrlsInText(pushed.stderr.trim())}`);
        }
        // Lost the race: the next attempt starts from the winner's state.
      }
      throw new GalaxyError('contended', '다른 기기가 동시에 은하수를 바꾸고 있어요. 잠시 후 다시 시도해 주세요.');
    },
    lock
  );
}

// ------------------------------------------------------------------ beats

/** Publish this star's liveness as refs/cosmos/beats/<starId> (never touches main). */
export async function publishBeat(starId, beat, { dir = galaxyDir(), push = true } = {}) {
  const body = JSON.stringify({ v: 1, star: starId, at: Date.now(), ...beat });
  const blob = (await git(dir, ['hash-object', '-w', '--stdin'], { input: body })).trim();
  const tree = (await git(dir, ['mktree'], { input: `100644 blob ${blob}\tbeat.json\n` })).trim();
  const commit = (await git(dir, ['commit-tree', '--no-gpg-sign', tree, '-m', `beat ${starId}`])).trim();
  const ref = `${BEAT_REF_PREFIX}${starId}`;
  await git(dir, ['update-ref', ref, commit]);
  if (!push || !(await galaxyRemote(dir))) return { ref, pushed: false };
  const r = await runGit(dir, ['push', '--quiet', '--force', 'origin', `${ref}:${ref}`]);
  return { ref, pushed: r.code === 0, error: r.code === 0 ? null : r.stderr.trim() };
}

/** Every star's last beat, keyed by star id (reads the refs fetched by pullGalaxy). */
export async function readBeats(dir = galaxyDir()) {
  const refs = (await runGit(dir, ['for-each-ref', '--format=%(refname)', BEAT_REF_PREFIX])).stdout
    .split('\n')
    .filter(Boolean);
  const beats = {};
  for (const ref of refs) {
    const r = await runGit(dir, ['cat-file', 'blob', `${ref}:beat.json`]);
    if (r.code !== 0) continue;
    try {
      const beat = JSON.parse(r.stdout);
      if (beat?.star) beats[beat.star] = beat;
    } catch {
      /* a malformed beat is ignored, never fatal */
    }
  }
  return beats;
}
