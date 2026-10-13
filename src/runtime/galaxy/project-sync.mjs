// The planet's own git work during 해/달: bring the checkout up to date when
// taking the seat, save and push it when leaving. Deliberately conservative:
//  - 해 only fast-forwards; a diverged branch is reported, never rebased away.
//  - 달 stages with .gitignore respected and REFUSES to commit secret files.
//  - A star that lost its seat while offline keeps its unpushed work on a
//    cosmos/rescue-* branch instead of silently overwriting the new holder.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from '../tandem/tandem-core.mjs';
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
 * Keep this star's unpushed work on its own branch and line the working
 * branch up with the remote, for a star whose seat was taken while it was away.
 */
export async function rescueDisplacedWork(root, starName, now = new Date()) {
  const state = await branchState(root);
  if (!state.upstream || (state.ahead === 0 && state.dirty === 0)) return null;
  const safeName = String(starName || 'star')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const stampText = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const rescue = `cosmos/rescue-${safeName || 'star'}-${stampText}`;
  const env = (await hasIdentity(root)) ? {} : IDENT_FALLBACK;
  await runGit(root, ['switch', '--quiet', '-c', rescue]);
  if (state.dirty) {
    await runGit(root, ['add', '-A']);
    await runGit(root, ['commit', '--quiet', '--no-verify', '-m', `cosmos: ${starName}의 보관된 작업`], { env });
  }
  const remote = await planetRemote(root);
  if (remote) await runGit(root, ['push', '--quiet', '-u', remote.name, rescue]);
  await runGit(root, ['switch', '--quiet', state.branch]);
  await runGit(root, ['reset', '--quiet', '--hard', state.upstream]);
  return { branch: rescue, commits: state.ahead, dirty: state.dirty };
}

/** 달: commit everything (gitignore respected) and push. Refuses secrets. */
export async function saveAndPush(root, { message }) {
  const paths = await changedPaths(root);
  const secrets = await secretFindings(root, paths);
  if (secrets.length) return { ok: false, error: 'secrets', secrets, ...(await branchState(root)) };
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
    return { ok: false, error: /rejected|non-fast-forward|fetch first/i.test(pushed.stderr) ? 'behind' : 'push', detail: pushed.stderr.trim(), committed, ...(await branchState(root)) };
  }
  return { ok: true, committed, pushed: true, ...(await branchState(root)) };
}
