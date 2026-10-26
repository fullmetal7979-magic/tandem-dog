// 행성 (planet): a project, identified the same way on every device.
//
// A local path differs between PCs, so the planet id comes from the project's
// git remote: `git@github.com:me/app.git` and `https://github.com/me/app`
// are the same planet `github.com/me/app`. The remote is the branch upstream's
// remote, then an explicit `cosmos.remote`, then `origin`, then the first one —
// never a hard-coded name, because a fork's `origin` is often upstream.
import { runGit } from '../shared/git-process.mjs';

/** `github.com/owner/repo` for any https/ssh/scp-style remote URL; '' when unparseable. */
export function normalizeRemoteUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  let host = '';
  let path = '';
  // A remote on a local or shared disk (file://, /srv/git/app.git, C:\git\app)
  // is still a planet; its id keeps the path under a `local/` host.
  const localPath = /^file:\/\//i.test(raw) ? decodeURI(raw.replace(/^file:\/\//i, '')) : /^(?:\/|[A-Za-z]:[\\/])/.test(raw) ? raw : '';
  const scp = /^(?:[^@\s]+@)?([^:\s/]+):(?!\/)(.+)$/.exec(raw);
  if (localPath) {
    host = 'local';
    path = localPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1');
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return '';
    }
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    return '';
  }
  path = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (!host || !path) return '';
  return `${host.toLowerCase()}/${path}`.replace(/\/{2,}/g, '/');
}

/** A filesystem-safe folder name for a planet inside the Galaxy repository. */
export function planetSlug(planetId) {
  return String(planetId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '__')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

async function gitOut(cwd, args) {
  const r = await runGit(cwd, args);
  return r.code === 0 ? r.stdout.trim() : '';
}

/** The remote this checkout syncs through (see header). */
export async function planetRemote(root) {
  const remotes = (await gitOut(root, ['remote'])).split('\n').filter(Boolean);
  if (!remotes.length) return null;
  const branch = await gitOut(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const upstreamRemote = branch ? await gitOut(root, ['config', `branch.${branch}.remote`]) : '';
  const configured = await gitOut(root, ['config', 'cosmos.remote']);
  const name = [upstreamRemote, configured, 'origin', remotes[0]].find((candidate) => candidate && remotes.includes(candidate));
  if (!name) return null;
  const url = await gitOut(root, ['remote', 'get-url', name]);
  return { name, url };
}

/** { id, slug, name, remote } for the repository at `root`; id is null without a usable remote. */
export async function planetForRoot(root) {
  const remote = await planetRemote(root);
  const id = remote ? normalizeRemoteUrl(remote.url) : '';
  const name = (id.split('/').pop() || root.split(/[\\/]/).pop() || 'project').slice(0, 80);
  return { id: id || null, slug: id ? planetSlug(id) : null, name, remote };
}
