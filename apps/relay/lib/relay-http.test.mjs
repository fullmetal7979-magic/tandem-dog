import assert from 'node:assert/strict';
import test from 'node:test';

import { authenticateLeg, browserSocketOriginAllowed, clientIp } from './relay-http.mjs';

test('browser websocket upgrades require the relay origin', () => {
  assert.equal(
    browserSocketOriginAllowed({
      headers: { origin: 'https://relay.example', host: 'relay.example' },
      socket: { encrypted: true },
    }),
    true
  );
  assert.equal(
    browserSocketOriginAllowed({
      headers: { origin: 'http://127.0.0.1:9800', host: '127.0.0.1:9800' },
      socket: { encrypted: false },
    }),
    true
  );
  assert.equal(
    browserSocketOriginAllowed({
      headers: { origin: 'https://evil.example', host: 'relay.example' },
      socket: { encrypted: true },
    }),
    false
  );
  assert.equal(
    browserSocketOriginAllowed({
      headers: { host: 'relay.example' },
      socket: { encrypted: true },
    }),
    false
  );
  assert.equal(
    browserSocketOriginAllowed({
      headers: { origin: 'https://relay.example/path', host: 'relay.example' },
      socket: { encrypted: true },
    }),
    false
  );
});

test('caller identity falls back when the socket has no address', () => {
  assert.equal(clientIp({ socket: { remoteAddress: '203.0.113.9' } }), '203.0.113.9');
  assert.equal(clientIp({ socket: {} }), 'unknown');
  assert.equal(clientIp({}), 'unknown');
});

test('trust-on-first-use upgrades charge unknown ids and failed secrets', () => {
  const store = {
    secrets: new Map(),
    isKnown(id) {
      return this.secrets.has(id);
    },
    authenticate(id, secret) {
      if (!this.secrets.has(id)) {
        this.secrets.set(id, secret);
        return true;
      }
      return this.secrets.get(id) === secret;
    },
  };
  const registerHits = [];
  const unauthorizedHits = [];
  const registerLimiter = {
    allow: (key) => {
      registerHits.push(key);
      return true;
    },
  };
  const unauthorizedLimiter = {
    allow: (key) => {
      unauthorizedHits.push(key);
      return true;
    },
  };
  const request = { socket: { remoteAddress: '198.51.100.4' } };
  const deviceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  assert.equal(authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, 'nope', '0123456789abcdef'), 401);
  assert.equal(registerHits.length, 0);

  assert.equal(authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, deviceId, 'short'), 401);
  assert.equal(authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, deviceId, '0123456789abcdef'), 0);
  assert.deepEqual(registerHits, ['198.51.100.4']);
  assert.equal(authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, deviceId, '0123456789abcdef'), 0);
  assert.equal(registerHits.length, 1);
  assert.equal(
    authenticateLeg(store, registerLimiter, unauthorizedLimiter, request, deviceId, 'ffffffffffffffff'),
    401
  );
  assert.deepEqual(unauthorizedHits, ['auth:198.51.100.4']);
});

test('behind a trusted proxy the scheme and the caller come from X-Forwarded-*', async (t) => {
  const { configureProxyTrust } = await import('./relay-http.mjs');
  t.after(() => configureProxyTrust(false));
  const request = {
    headers: { origin: 'https://relay.example.com', host: 'relay.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' },
    socket: { encrypted: false, remoteAddress: '172.18.0.2' },
  };
  assert.equal(browserSocketOriginAllowed(request), false, 'off by default: a plain socket is not https');
  assert.equal(clientIp(request), '172.18.0.2');
  configureProxyTrust(true);
  assert.equal(browserSocketOriginAllowed(request), true);
  assert.equal(clientIp(request), '203.0.113.7');
});
