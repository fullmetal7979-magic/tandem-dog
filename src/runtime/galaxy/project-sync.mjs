// The planet's own git work during 해/달: bring the checkout up to date when
// taking the seat, save and push it when leaving. Deliberately conservative:
//  - 해 only fast-forwards; a diverged branch is reported, never rebased away.
//  - 달 stages with .gitignore respected and REFUSES to commit secret files.
//  - A star that lost its seat while offline keeps its unpushed work on a
//    cosmos/rescue-* branch instead of silently overwriting the new holder.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '../shared/git-process.mjs';
import { planetRemote } from './planet.mjs';
import { containsSecret, isSecretFile } from './secrets.mjs';

const IDENT_FALLBACK = {
  GIT_AUTHOR_NAME: 'COSMOS',
  GIT_AUTHOR_EMAIL: 'cosmos@localhost',
  GIT_COMMITTER_NAME: 'COSMOS',
  GIT_COMMITTER_EMAIL: 'cosmos@localhost',
};

async function out(root, args) {
  const r = await runGit(root, args);
  return r.code === 0 ? r.stdout.trim() : '';
}

async function hasIdentity(root) {
  return Boolean(await out(root, ['config', 'user.email']));
}

/** Changed paths from `git status --porcelain` (renames give the new path). */
export async function changedPaths(root) {
  const r = await runGit(root, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '--untracked-files=all']);
  if (r.code !== 0) return [];
  const parts = r.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const code = entry.slice(0, 2);
    paths.push({ code, path: entry.slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i += 1; // the source path follows
  }
  return paths;
}

/** Changed files that must never be committed: credential files or token-shaped content. */
export async function secretFindings(root, paths) {
  const findings = [];
  for (const { code, path } of paths) {
    if (code.includes('D')) continue;
    if (isSecretFile(path)) {
      findings.push({ path, reason: 'file' });
      continue;
    }
    try {
      const info = await stat(join(root, path));
      if (!info.isFile() || info.size > 512 * 1024) continue;
      const text = await readFile(join(root, path), 'utf8');
      if (containsSecret(text)) findings.push({ path, reason: 'content' });
    } catch {
      /* unreadable: nothing to scan */
    }
  }
  return findings;
}

export async function branchState(root) {
  const branch = await out(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const upstream = branch ? await out(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) : '';
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = (await out(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).split(/\s+/);
    ahead = Number(counts[0]) || 0;
    behind = Number(counts[1]) || 0;
  }
  const dirty = (await changedPaths(root)).length;
  return { branch: branch || null, upstream: upstream || null, ahead, behind, dirty };
}

/** 해: fetch and fast-forward. Never rewrites local work. */
export async function bringUpToDate(root) {
  const remote = await planetRemote(root);
  if (!remote) return { ok: true, skipped: 'no-remote', ...(await branchState(root)) };
  const fetched = await runGit(root, ['fetch', '--quiet', '--prune', remote.name]);
  if (fetched.code !== 0) return { ok: false, error: 'offline', detail: fetched.stderr.trim(), ...(await branchState(root)) };
  const state = await branchState(root);
  if (!state.upstream) return { ok: true, skipped: 'no-upstream', ...state };
  if (state.behind === 0) return { ok: true, pulled: 0, ...state };
  if (state.ahead > 0) return { ok: false, error: 'diverged', ...state };
  const merged = await runGit(root, ['merge', '--ff-only', '--quiet', state.upstream]);
  if (merged.code !== 0) return { ok: false, error: 'blocked', detail: merged.stderr.trim(), ...state };
  return { ok: true, pulled: state.behind, ...(await branchState(root)) };
}

/**
 * Changed files between two commits that must not leave this machine:
 * credential-named files, or token-shaped content in the `to` version.
 */
export async function secretFindingsInRange(root, from, to) {
  const r = await runGit(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '--diff-filter=d', '-z', from, to]);
  if (r.code !== 0) return null;
  const findings = [];
  for (const path of r.stdout.split('\0').filter(Boolean)) {
    if (isSecretFile(path)) {
      findings.push({ path, reason: 'file' });
      continue;
    }
    const size = Number(await out(root, ['cat-file', '-s', `${to}:${path}`])) || 0;
    if (!size || size > 512 * 1024) continue;
    const blob = await runGit(root, ['cat-file', 'blob', `${to}:${path}`]);
    if (blob.code === 0 && containsSecret(blob.stdout)) findings.push({ path, reason: 'content' });
  }
  return findings;
}

/**
 * Keep this star's unpushed work on its own branch and line the working
 * branch up with the remote, for a star whose seat was taken while it was away.
 *
 * Every step is checked: the hard reset only runs once the rescue branch
 * provably holds the old HEAD and every change, and the checkout is back on
 * the working branch. Any failure stops there and leaves the work in place
 * (`{ ok: false, failed: <step> }`). A rescue that would carry a secret stays
 * a local branch (`pushed: false, secrets`).
 */
export async function rescueDisplacedWork(root, starName, now = new Date()) {
  const state = await branchState(root);
  if (!state.upstream || !state.branch || (state.ahead === 0 && state.dirty === 0)) return null;
  const safeName = String(starName || 'star')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const stampText = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const rescue = `cosmos/rescue-${safeName || 'star'}-${stampText}`;
  const summary = { branch: rescue, commits: state.ahead, dirty: state.dirty };
  const fail = (failed, result) => ({ ok: false, failed, detail: String(result?.stderr || result?.stdout || '').trim(), ...summary });
  const head = await out(root, ['rev-parse', '--verify', 'HEAD']);
  if (!head) return fail('head');
  const env = (await hasIdentity(root)) ? {} : IDENT_FALLBACK;
  // Back to the working branch after a failed step; the changes travel along
  // (both branches point at the same commit until the rescue commit lands).
  const back = async () => {
    await runGit(root, ['switch', '--quiet', state.branch]);
    await runGit(root, ['branch', '--quiet', '-D', rescue]);
  };
  const switched = await runGit(root, ['switch', '--quiet', '-c', rescue]);
  if (switched.code !== 0) return fail('switch', switched);
  if (state.dirty) {
    const added = await runGit(root, ['add', '-A']);
    if (added.code !== 0) {
      await back();
      return fail('add', added);
    }
    const commit = await runGit(root, ['commit', '--quiet', '--no-verify', '--no-gpg-sign', '-m', `cosmos: ${starName}의 보관된 작업`], { env });
    if (commit.code !== 0) {
      await back();
      return fail('commit', commit);
    }
  }
  // The rescue branch must hold the old HEAD and leave nothing uncommitted behind.
  const tip = await out(root, ['rev-parse', '--verify', `refs/heads/${rescue}`]);
  const holdsHead = tip && (await runGit(root, ['merge-base', '--is-ancestor', head, tip])).code === 0;
  if (!holdsHead || (await changedPaths(root)).length) return fail('verify');
  const secrets = await secretFindingsInRange(root, state.upstream, tip);
  let pushed = false;
  const remote = await planetRemote(root);
  if (remote && secrets && !secrets.length) {
    pushed = (await runGit(root, ['push', '--quiet', '-u', remote.name, rescue])).code === 0;
  }
  const returned = await runGit(root, ['switch', '--quiet', state.branch]);
  if (returned.code !== 0 || (await out(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) !== state.branch) {
    return fail('switch-back', returned);
  }
  const reset = await runGit(root, ['reset', '--quiet', '--hard', state.upstream]);
  if (reset.code !== 0) return fail('reset', reset);
  return { ok: true, ...summary, pushed, ...(secrets?.length ? { secrets } : {}) };
}

/**
 * Why a push failed, from git's stderr:
 *  - 'behind'   the remote has commits this branch lacks (non-fast-forward,
 *               "fetch first"): fetch and merge, then push again.
 *  - 'rejected' the remote refused the push itself: no permission, a
 *               protected branch, a server hook. Pulling will not help.
 *  - 'push'     anything else (offline, authentication, an unknown host…).
 */
export function classifyPushFailure(stderr) {
  const text = String(stderr ?? '');
  if (/non-fast-forward|fetch first|tip of your current branch is behind|remote contains work that you do/i.test(text)) return 'behind';
  if (
    /remote rejected|protected branch|hook declined|permission to .* denied|permission denied|access denied|denied to|not allowed to push|\b403\b|forbidden|GH006|GH013|pre-receive|\[rejected\]/i.test(
      text
    )
  ) {
    return 'rejected';
  }
  return 'push';
}

/**
 * Where the commits about to be pushed start: the upstream when the branch
 * tracks one, else the merge-base with the remote's default branch (a new
 * branch), else the empty tree (a first push: everything goes).
 */
async function pushRangeStart(root, remoteName, state) {
  if (state.upstream) {
    return (await out(root, ['merge-base', 'HEAD', state.upstream])) || state.upstream;
  }
  const candidates = [];
  const remoteHead = await out(root, ['symbolic-ref', '--quiet', `refs/remotes/${remoteName}/HEAD`]);
  if (remoteHead) candidates.push(remoteHead);
  candidates.push(`refs/remotes/${remoteName}/main`, `refs/remotes/${remoteName}/master`);
  for (const ref of candidates) {
    if (!(await out(root, ['rev-parse', '--verify', '--quiet', ref]))) continue;
    const base = await out(root, ['merge-base', 'HEAD', ref]);
    if (base) return base;
  }
  return emptyTree(root);
}

/** The empty tree's id in this repository's hash (sha1 or sha256). */
async function emptyTree(root) {
  const r = await runGit(root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' });
  return r.code === 0 ? r.stdout.trim() : null;
}

/** 달: commit everything (gitignore respected) and push. Refuses secrets. */
export async function saveAndPush(root, { message }) {
  const paths = await changedPaths(root);
  const secrets = await secretFindings(root, paths);
  if (secrets.length) return { ok: false, error: 'secrets', secretsIn: 'changes', secrets, ...(await branchState(root)) };
  const env = (await hasIdentity(root)) ? {} : IDENT_FALLBACK;
  let committed = false;
  if (paths.length) {
    await runGit(root, ['add', '-A']);
    const commit = await runGit(root, ['commit', '--quiet', '--no-verify', '-m', message], { env });
    if (commit.code !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      return { ok: false, error: 'commit', detail: commit.stderr.trim(), ...(await branchState(root)) };
    }
    committed = commit.code === 0;
  }
  const remote = await planetRemote(root);
  if (!remote) return { ok: true, committed, pushed: false, skipped: 'no-remote', ...(await branchState(root)) };
  const state = await branchState(root);
  if (!state.branch) return { ok: false, error: 'detached', committed, ...state };
  if (state.upstream && state.ahead === 0) return { ok: true, committed, pushed: false, ...state };
  // The working tree was scanned before the commit; the commits themselves
  // (made earlier, by hand or by an agent) are scanned here, before they leave.
  const from = await pushRangeStart(root, remote.name, state);
  const pending = from ? await secretFindingsInRange(root, from, 'HEAD') : null;
  if (!pending) return { ok: false, error: 'scan', committed, ...state };
  if (pending.length) return { ok: false, error: 'secrets', secretsIn: 'commits', secrets: pending, committed, ...state };
  let args = ['push', '--quiet', '-u', remote.name, state.branch];
  if (state.upstream) {
    // Push where the branch actually tracks, which may be a remote other than
    // the planet's (a fork's upstream, say).
    const upstreamRemote = (await out(root, ['config', `branch.${state.branch}.remote`])) || remote.name;
    const mergeRef = (await out(root, ['config', `branch.${state.branch}.merge`])) || `refs/heads/${state.branch}`;
    args = ['push', '--quiet', upstreamRemote, `HEAD:${mergeRef}`];
  }
  const pushed = await runGit(root, args);
  if (pushed.code !== 0) {
    return { ok: false, error: classifyPushFailure(pushed.stderr), detail: pushed.stderr.trim(), committed, ...(await branchState(root)) };
  }
  return { ok: true, committed, pushed: true, ...(await branchState(root)) };
}
