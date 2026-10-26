import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { migrateLegacyUserData } from './legacy-user-data.ts';

function appData(t) {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-user-data-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('the first launch copies the legacy profile without locks or caches', (t) => {
  const root = appData(t);
  const legacy = join(root, 'tandem-dog-desktop');
  mkdirSync(join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  mkdirSync(join(legacy, 'Code Cache'), { recursive: true });
  writeFileSync(join(legacy, 'Local Storage', 'leveldb', 'LOG'), 'prefs');
  writeFileSync(join(legacy, 'window-state.json'), '{"width":1200}');
  writeFileSync(join(legacy, 'SingletonLock'), 'pid');
  writeFileSync(join(legacy, 'Code Cache', 'blob'), 'cache');

  const result = migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']);

  assert.equal(result.from, legacy);
  const target = join(root, 'cosmos-desktop');
  assert.equal(readFileSync(join(target, 'window-state.json'), 'utf8'), '{"width":1200}');
  assert.equal(readFileSync(join(target, 'Local Storage', 'leveldb', 'LOG'), 'utf8'), 'prefs');
  assert.equal(existsSync(join(target, 'SingletonLock')), false);
  assert.equal(existsSync(join(target, 'Code Cache')), false);
  // The legacy profile is copied, never moved: the old app keeps working.
  assert.ok(existsSync(join(legacy, 'window-state.json')));
});

test('an existing COSMOS profile is never overwritten', (t) => {
  const root = appData(t);
  mkdirSync(join(root, 'tandem-dog-desktop'));
  writeFileSync(join(root, 'tandem-dog-desktop', 'window-state.json'), 'old');
  mkdirSync(join(root, 'cosmos-desktop'));
  writeFileSync(join(root, 'cosmos-desktop', 'window-state.json'), 'new');

  assert.deepEqual(migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']), { from: null });
  assert.equal(readFileSync(join(root, 'cosmos-desktop', 'window-state.json'), 'utf8'), 'new');
});

test('no legacy profile means a fresh start', (t) => {
  const root = appData(t);
  assert.deepEqual(migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']), { from: null });
  assert.equal(existsSync(join(root, 'cosmos-desktop')), false);
});

test('device credentials and the E2EE identity stay behind', (t) => {
  const root = appData(t);
  const legacy = join(root, 'tandem-dog-desktop');
  mkdirSync(legacy);
  for (const name of ['relay-device.json', 'relay-device-revocations.json', 'relay-e2ee.json', 'remote-bridge.token', 'remote-push.json']) {
    writeFileSync(join(legacy, name), 'secret');
  }
  writeFileSync(join(legacy, 'window-state.json'), '{}');
  migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']);
  const target = join(root, 'cosmos-desktop');
  assert.ok(existsSync(join(target, 'window-state.json')));
  for (const name of ['relay-device.json', 'relay-device-revocations.json', 'relay-e2ee.json', 'remote-bridge.token', 'remote-push.json']) {
    assert.equal(existsSync(join(target, name)), false, name);
  }
});

test('a half-finished copy is redone and never shows up as the real profile', (t) => {
  const root = appData(t);
  const legacy = join(root, 'tandem-dog-desktop');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'window-state.json'), 'fresh');
  // A crashed launch left a partial staging folder behind.
  mkdirSync(join(root, 'cosmos-desktop.migrating'));
  writeFileSync(join(root, 'cosmos-desktop.migrating', 'stale.txt'), 'partial');
  assert.equal(existsSync(join(root, 'cosmos-desktop')), false, 'a partial copy is not the profile');

  const result = migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']);

  assert.equal(result.from, legacy);
  assert.equal(readFileSync(join(root, 'cosmos-desktop', 'window-state.json'), 'utf8'), 'fresh');
  assert.equal(existsSync(join(root, 'cosmos-desktop', 'stale.txt')), false);
  assert.equal(existsSync(join(root, 'cosmos-desktop.migrating')), false);
});

test('a stale staging entry of any kind is cleared, never fatal', (t) => {
  const root = appData(t);
  const legacy = join(root, 'tandem-dog-desktop');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'window-state.json'), 'x');
  writeFileSync(join(root, 'cosmos-desktop.migrating'), 'a file where the staging folder goes');
  assert.equal(migrateLegacyUserData(root, 'cosmos-desktop', ['tandem-dog-desktop']).from, legacy);
  assert.ok(existsSync(join(root, 'cosmos-desktop', 'window-state.json')));
});
