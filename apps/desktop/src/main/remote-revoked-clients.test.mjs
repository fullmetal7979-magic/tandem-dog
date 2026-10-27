// A revoked browser stays out even when its hello proves the shared pairing
// secret, until the user approves a new pairing for it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRelayClientLifecycle } from './remote-relay-client-lifecycle.ts';
import { loadRevokedClientStore } from './remote-revoked-clients.ts';

test('the revoked list survives a restart and a new approved pairing lifts it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'revoked-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = await loadRevokedClientStore(dir);
  await store.revoke('browser-1');
  assert.equal(store.has('browser-1'), true);
  const again = await loadRevokedClientStore(dir);
  assert.equal(again.has('browser-1'), true);
  await again.restore('browser-1');
  assert.equal((await loadRevokedClientStore(dir)).has('browser-1'), false);
});

test('a revoked browser is closed at open, before any challenge is sent', () => {
  const sent = [];
  const opened = [];
  const lifecycle = createRelayClientLifecycle({
    clients: {
      open: (clientId) => {
        opened.push(clientId);
        return true;
      },
      close: () => {},
    },
    e2eeIdentity: {},
    pairing: {},
    relayBinaryFrames: () => false,
    viewSyncSupported: () => false,
    relayRoutingCapsPayload: () => ({}),
    sendEnvelope: (payload) => sent.push(payload),
    sendEncryptedFrame: async () => {},
    dispatchClientCall: async () => ({}),
    resyncClient: () => {},
    isRevoked: (clientId) => clientId === 'browser-revoked',
  });
  lifecycle.open('browser-revoked');
  assert.deepEqual(opened, []);
  assert.deepEqual(sent, [{ type: 'close-client', clientId: 'browser-revoked', reason: 'remote client revoked' }]);
  lifecycle.open('browser-ok');
  assert.deepEqual(opened, ['browser-ok']);
});
