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
