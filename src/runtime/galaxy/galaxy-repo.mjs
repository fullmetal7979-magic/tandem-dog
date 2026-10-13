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
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runGit } from '../tandem/tandem-core.mjs';
import { cosmosHome } from './star.mjs';

export const GALAXY_BRANCH = 'main';
export const BEAT_REF_PREFIX = 'refs/cosmos/beats/';
const BEAT_REFSPEC = `+${BEAT_REF_PREFIX}*:${BEAT_REF_PREFIX}*`;
const LOCK_STALE_MS = 2 * 60_000;
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
    throw new GalaxyError('git_failed', `git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`, { result: r });
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

// One writer per machine: the desktop and a terminal `cosmos` may both run.
async function withLock(dir, run) {
  const lock = join(dir, '.git', 'cosmos.lock');
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, 'owner'), `${process.pid} ${Date.now()}\n`).catch(() => {});
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const info = await stat(lock).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new GalaxyError('busy', '다른 코스모스 작업이 은하수를 쓰고 있어요. 잠시 후 다시 시도해 주세요.');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  try {
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
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
  const hasRepo = await exists(join(dir, '.git'));
  if (!hasRepo) {
    await mkdir(dirname(dir), { recursive: true });
    if (remoteUrl) {
      const r = await runGit(dirname(dir), ['clone', '--quiet', remoteUrl, dir]);
      if (r.code !== 0) {
        throw new GalaxyError('clone_failed', `은하수 저장소를 받지 못했어요: ${(r.stderr || r.stdout).trim()}`);
      }
    } else {
      await mkdir(dir, { recursive: true });
      await git(dir, ['init', '--quiet', '-b', GALAXY_BRANCH]);
    }
  } else if (remoteUrl) {
    const current = await galaxyRemote(dir);
    if (!current) await git(dir, ['remote', 'add', 'origin', remoteUrl]);
    else if (current !== remoteUrl) await git(dir, ['remote', 'set-url', 'origin', remoteUrl]);
  }
  // A cloned empty remote has no branch yet; pin the name we push.
  await runGit(dir, ['symbolic-ref', 'HEAD', `refs/heads/${GALAXY_BRANCH}`]);
  await runGit(dir, ['config', 'core.quotePath', 'false']);
  return { dir, remote: await galaxyRemote(dir) };
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

/**
 * Bring the working copy to the remote's `main` (or leave it alone when the
 * Galaxy is local-only / the remote is still empty). Local uncommitted edits
 * cannot exist outside a transaction, so a hard reset loses nothing.
 */
export async function pullGalaxy(dir = galaxyDir()) {
  const remote = await galaxyRemote(dir);
  if (!remote) return { remote: null, head: (await hasCommits(dir)) ? (await git(dir, ['rev-parse', 'HEAD'])).trim() : null };
  const fetched = await runGit(dir, ['fetch', '--quiet', '--prune', 'origin', `+refs/heads/${GALAXY_BRANCH}:refs/remotes/origin/${GALAXY_BRANCH}`, BEAT_REFSPEC]);
  if (fetched.code !== 0 && !/couldn't find remote ref/i.test(fetched.stderr)) {
    throw new GalaxyError('offline', `은하수에 연결하지 못했어요: ${fetched.stderr.trim()}`);
  }
  if (await hasCommits(dir, `refs/remotes/origin/${GALAXY_BRANCH}`)) {
    await git(dir, ['reset', '--quiet', '--hard', `refs/remotes/origin/${GALAXY_BRANCH}`]);
  } else if (await hasCommits(dir)) {
    await git(dir, ['reset', '--quiet', '--hard', 'HEAD']);
  }
  await runGit(dir, ['clean', '-fdq']);
  return { remote, head: (await hasCommits(dir)) ? (await git(dir, ['rev-parse', 'HEAD'])).trim() : null };
}

/**
 * Compare-and-swap over git. `mutate()` runs against the freshest remote
 * state and returns { value, message } after writing files, or { value } to
 * change nothing. A push rejected because the remote moved re-runs it.
 */
export async function transact(mutate, { dir = galaxyDir(), attempts = 5 } = {}) {
  return withLock(dir, async () => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await pullGalaxy(dir);
      const outcome = await mutate({ dir, attempt });
      const message = outcome?.message;
      if (!message) return outcome?.value;
      await git(dir, ['add', '-A']);
      const staged = await runGit(dir, ['diff', '--cached', '--quiet']);
      if (staged.code === 0) return outcome.value;
      await git(dir, ['commit', '--quiet', '--no-verify', '-m', message]);
      const remote = await galaxyRemote(dir);
      if (!remote) return outcome.value;
      const pushed = await runGit(dir, ['push', '--quiet', 'origin', `HEAD:refs/heads/${GALAXY_BRANCH}`]);
      if (pushed.code === 0) return outcome.value;
      if (!/(rejected|non-fast-forward|fetch first|stale info|cannot lock ref)/i.test(pushed.stderr)) {
        await runGit(dir, ['reset', '--quiet', '--hard', 'HEAD~1']);
        throw new GalaxyError('push_failed', `은하수에 올리지 못했어요: ${pushed.stderr.trim()}`);
      }
      // Lost the race: the next attempt starts from the winner's state.
    }
    throw new GalaxyError('contended', '다른 별이 동시에 은하수를 바꾸고 있어요. 잠시 후 다시 시도해 주세요.');
  });
}

// ------------------------------------------------------------------ beats

/** Publish this star's liveness as refs/cosmos/beats/<starId> (never touches main). */
export async function publishBeat(starId, beat, { dir = galaxyDir(), push = true } = {}) {
  const body = JSON.stringify({ v: 1, star: starId, at: Date.now(), ...beat });
  const blob = (await git(dir, ['hash-object', '-w', '--stdin'], { input: body })).trim();
  const tree = (await git(dir, ['mktree'], { input: `100644 blob ${blob}\tbeat.json\n` })).trim();
  const commit = (await git(dir, ['commit-tree', tree, '-m', `beat ${starId}`])).trim();
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
