import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DeviceStore } from './device-store.mjs';
import { PAIRED_CLIENT_EVICTABLE_IDLE_MS, PAIRED_CLIENT_IDLE_EXPIRY_MS, pruneIdleClients } from './device-store-auth.mjs';

const HASH = (char) => char.repeat(64);

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mixdog-relay-device-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a paired browser idle for over a year loses its token when the relay starts', (t) => {
  const dir = tempDir(t);
  const now = Date.now();
  const deviceId = randomUUID();
  writeFileSync(
    join(dir, 'devices.json'),
    JSON.stringify({
      [deviceId]: {
        secretHash: HASH('a'),
        clientTokenHash: HASH('b'),
        clients: {
          f0000001: { tokenHash: HASH('c'), name: 'Phone', createdAt: now - 400 * 86_400_000, lastSeenAt: now - 86_400_000 },
          f0000002: { tokenHash: HASH('d'), name: 'Old phone', createdAt: now - 800 * 86_400_000, lastSeenAt: now - PAIRED_CLIENT_IDLE_EXPIRY_MS - 1 },
        },
      },
    })
  );
  const silence = t.mock.method(console, 'log', () => {});
  const store = new DeviceStore(dir);
  assert.equal(silence.mock.callCount(), 1);
  assert.deepEqual(Object.keys(store.devices.get(deviceId).clients), ['f0000001']);
  assert.equal(store.clientTokenIndex.has(HASH('d')), false, 'the dropped token no longer authenticates');
  assert.equal(store.clientTokenIndex.has(HASH('c')), true);
  assert.equal(store.tokenIndex.get(HASH('b')), deviceId, 'the desktop registration itself stays');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8'))[deviceId].clients), ['f0000001']);
});

test('pruning keeps everything seen recently', () => {
  const devices = new Map([['d', { clients: { a: { lastSeenAt: 2000 }, b: { lastSeenAt: 0, createdAt: 900 } } }]]);
  assert.equal(pruneIdleClients(devices, 1500, 1000), 0);
  assert.equal(pruneIdleClients(devices, 2500, 1000), 1);
  assert.deepEqual(Object.keys(devices.get('d').clients), ['a']);
});

test('a full pairing list makes room only by dropping a browser idle for a month', (t) => {
  const dir = tempDir(t);
  const store = new DeviceStore(dir);
  const deviceId = randomUUID();
  assert.equal(store.authenticate(deviceId, '0123456789abcdef'), true);
  const clients = store.devices.get(deviceId).clients;
  const now = Date.now();
  for (let index = 0; index < 256; index += 1) {
    const id = `c${index.toString(16).padStart(7, '0')}`;
    clients[id] = { tokenHash: HASH((index % 10).toString()).slice(0, 61) + String(index).padStart(3, '0'), name: id, createdAt: now, lastSeenAt: now - index * 1000 };
    store.clientTokenIndex.set(clients[id].tokenHash, { deviceId, clientId: id });
  }
  assert.equal(store.registerClient(deviceId, 'e0000001'), null, 'every paired browser is in use: still refused');

  const oldest = clients.c00000ff;
  oldest.lastSeenAt = now - PAIRED_CLIENT_EVICTABLE_IDLE_MS - 1000;
  const registered = store.registerClient(deviceId, 'e0000001');
  assert.ok(registered?.token);
  assert.equal(clients.c00000ff, undefined, 'the longest-unseen browser made room');
  assert.equal(store.clientTokenIndex.has(oldest.tokenHash), false);
  assert.equal(Object.keys(clients).length, 256);
});
