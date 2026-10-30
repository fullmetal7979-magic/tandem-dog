// The relay process: a PORT that is not a port stops it at once, and SIGTERM
// (docker stop, systemd) closes it cleanly instead of dropping device writes.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { installRelayShutdown, relayPortFrom } from '../server.mjs';

test('PORT is a whole number 0–65535, or the default when unset', () => {
  assert.equal(relayPortFrom(undefined), 9800);
  assert.equal(relayPortFrom(''), 9800);
  assert.equal(relayPortFrom('8443'), 8443);
  assert.equal(relayPortFrom(' 0 '), 0);
  for (const bad of ['abc', '80a', '-1', '65536', '1e3', '3.5']) assert.equal(relayPortFrom(bad), null, bad);
});

function fakeProcess() {
  const proc = new EventEmitter();
  proc.exits = [];
  proc.exit = (code) => proc.exits.push(code);
  return proc;
}
const quiet = { log: () => {}, error: () => {} };

test('SIGTERM closes the relay once and exits cleanly', async () => {
  const proc = fakeProcess();
  let closes = 0;
  installRelayShutdown({ close: async () => void (closes += 1) }, { proc, log: quiet });
  proc.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closes, 1);
  assert.deepEqual(proc.exits, [0]);
});

test('a second signal during a slow close exits at once; a failed close exits non-zero', async () => {
  const slow = fakeProcess();
  installRelayShutdown({ close: () => new Promise(() => {}) }, { proc: slow, log: quiet, graceMs: 60_000 });
  slow.emit('SIGINT');
  slow.emit('SIGINT');
  assert.deepEqual(slow.exits, [1]);

  const failing = fakeProcess();
  installRelayShutdown({ close: async () => { throw new Error('disk full'); } }, { proc: failing, log: quiet });
  failing.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(failing.exits, [1]);
});

test('a close that hangs is cut off after the grace period', async () => {
  const proc = fakeProcess();
  installRelayShutdown({ close: () => new Promise(() => {}) }, { proc, log: quiet, graceMs: 20 });
  proc.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(proc.exits, [1]);
});
