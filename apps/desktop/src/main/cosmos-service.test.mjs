import assert from 'node:assert/strict';
import test from 'node:test';
import { cosmosSetPreference, publicOverview, publicRelayUrl } from './cosmos-service.ts';

test('a relay address is validated when it is saved', async () => {
  for (const bad of ['ws://relay.example.com', 'http://relay.example.com', 'wss://user:pw@relay.example.com', 'not a url', 'ws://192.168.0.5:9800']) {
    await assert.rejects(cosmosSetPreference('relayUrl', bad), TypeError, bad);
  }
  await assert.rejects(cosmosSetPreference('relayUrl', 'ws://relay.example.com'), /wss:\/\//);
  await assert.rejects(cosmosSetPreference('relayUrl', 'wss://a:b@relay.example.com'), /아이디·비밀번호/);
});

test('remote addresses lose their credentials before they reach the renderer or a phone', () => {
  assert.equal(publicRelayUrl('wss://me:secret@relay.example.com/?token=abc'), 'wss://relay.example.com/');
  const view = publicOverview({
    star: {},
    ready: true,
    remote: 'https://x-access-token:ghp_SECRET@github.com/me/cosmos-galaxy.git',
    syncedAt: 0,
    stars: [],
    planets: [{ id: 'p', name: 'p', remote: 'https://me:pw@github.com/me/app.git?token=zzz' }],
    planet: { id: 'p', name: 'p', remote: { name: 'origin', url: 'https://me:pw@github.com/me/app.git' } },
    seat: null,
    state: null,
    conversations: [],
    relayUrl: 'wss://me:pw@relay.example.com/',
  });
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /ghp_SECRET|:pw@|secret|zzz|me:/);
  assert.equal(view.remote, 'https://github.com/me/cosmos-galaxy.git');
  assert.equal(view.planets[0].remote, 'https://github.com/me/app.git');
  assert.equal(view.planet.remote.url, 'https://github.com/me/app.git');
  assert.equal(view.relayUrl, 'wss://relay.example.com/');
});

test('COSMOS never sends people to the old 관제실 screen', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./cosmos-service.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('관제실'), false);
});

test('overviews of different planets share one Galaxy fetch, throttled from when it starts', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { configureCosmosRuntime, cosmosOverview } = await import('./cosmos-service.ts');
  const base = await mkdtemp(join(tmpdir(), 'cosmos-fetch-'));
  try {
    // A stand-in runtime tree: appPath/../../src/runtime is where the service loads Galaxy modules from.
    const runtime = join(base, 'src', 'runtime');
    await mkdir(join(runtime, 'galaxy'), { recursive: true });
    await mkdir(join(runtime, 'shared'), { recursive: true });
    await mkdir(join(base, 'apps', 'desktop'), { recursive: true });
    await writeFile(
      join(runtime, 'galaxy', 'galaxy-repo.mjs'),
      `export const galaxyDir = () => '/galaxy';
export const galaxyReady = async () => true;
export async function fetchGalaxy() {
  globalThis.__cosmosFetches.started += 1;
  await new Promise((resolve) => setTimeout(resolve, 40));
}
`
    );
    await writeFile(
      join(runtime, 'galaxy', 'cosmos.mjs'),
      `export async function overview({ root, fetch }) {
  globalThis.__cosmosFetches.overviewFetchArgs.push(fetch);
  return { star: {}, ready: true, remote: null, syncedAt: 0, stars: [], planets: [], planet: null, seat: null, state: null, conversations: [], root };
}
`
    );
    await writeFile(join(runtime, 'shared', 'config.mjs'), 'export const readConfig = () => ({});\n');
    const roots = [];
    for (const name of ['a', 'b', 'c']) {
      const dir = join(base, 'planets', name);
      await mkdir(dir, { recursive: true });
      execFileSync('git', ['init', '-q', dir]);
      roots.push(dir);
    }
    globalThis.__cosmosFetches = { started: 0, overviewFetchArgs: [] };
    configureCosmosRuntime({ appPath: join(base, 'apps', 'desktop') });

    const views = await Promise.all(roots.map((root) => cosmosOverview(root)));
    assert.equal(globalThis.__cosmosFetches.started, 1, 'three watched planets, one git fetch');
    assert.deepEqual(globalThis.__cosmosFetches.overviewFetchArgs, [false, false, false], 'the overview read itself never fetches');
    for (const view of views) assert.equal(view.offline, null);

    // Inside the throttle window nothing fetches again, even once the first fetch is done.
    await cosmosOverview(roots[0]);
    assert.equal(globalThis.__cosmosFetches.started, 1);

    // A fetch still running when the next poll lands is joined, not repeated, and the
    // throttle already counts from its start.
    const forced = cosmosOverview(roots[1], { force: true });
    const follower = cosmosOverview(roots[2]);
    await Promise.all([forced, follower]);
    assert.equal(globalThis.__cosmosFetches.started, 2, 'a forced refresh fetches once and the concurrent poll joins it');
  } finally {
    configureCosmosRuntime({});
    delete globalThis.__cosmosFetches;
    await rm(base, { recursive: true, force: true });
  }
});
