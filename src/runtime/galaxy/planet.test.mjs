import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeRemoteUrl, planetForRoot, planetSlug } from './planet.mjs';

test('the same repository is one planet whatever URL style a PC cloned it with', () => {
  for (const url of [
    'https://github.com/Me/app.git',
    'https://github.com/Me/app',
    'git@github.com:Me/app.git',
    'ssh://git@github.com/Me/app.git',
    'https://user:token@github.com/Me/app.git/',
  ]) {
    assert.equal(normalizeRemoteUrl(url), 'github.com/Me/app', url);
  }
  assert.equal(normalizeRemoteUrl(''), '');
  assert.equal(normalizeRemoteUrl('/srv/git/repo.git'), 'local/srv/git/repo');
  assert.equal(normalizeRemoteUrl('file:///srv/git/repo.git'), 'local/srv/git/repo');
  assert.equal(normalizeRemoteUrl('C:\\git\\repo'), 'local/C/git/repo');
  assert.equal(planetSlug('github.com/Me/app'), 'github.com__me__app');
});

test('the planet follows the branch upstream remote, not a hard-coded origin', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-planet-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/upstream/app.git');
  git('remote', 'add', 'fork', 'git@github.com:me/app.git');
  git('config', 'branch.main.remote', 'fork');
  return planetForRoot(root).then((planet) => {
    assert.equal(planet.id, 'github.com/me/app');
    assert.equal(planet.remote.name, 'fork');
    assert.equal(planet.name, 'app');
  });
});
