import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { desktopIdentity } from './desktop-identity.ts';
import { APP_ID, APP_NAME } from '../shared/fork-identity.ts';

test('installed COSMOS keeps its own identity, not upstream Mixdog; dev/probes cannot collide', () => {
  assert.deepEqual(desktopIdentity('installed'), { appId: APP_ID, name: APP_NAME });
  assert.equal(APP_ID, 'app.cosmos.desktop');
  assert.equal(APP_NAME, 'COSMOS');
  for (const identity of ['installed', 'development', 'probe'].map(desktopIdentity)) {
    assert.doesNotMatch(identity.appId, /mixdog/i);
    assert.doesNotMatch(identity.name, /mixdog/i);
  }
  const identities = ['installed', 'development', 'probe'].map(desktopIdentity);
  assert.equal(new Set(identities.map((identity) => identity.appId)).size, 3);
  assert.equal(new Set(identities.map((identity) => identity.name)).size, 3);
  assert.equal(desktopIdentity('development').name, 'COSMOS Dev');
  assert.equal(desktopIdentity('probe').name, 'COSMOS Notification Test');
});

test('the native probe rejects a production identity override before launching Electron', async () => {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/notification-probe.mjs', import.meta.url)), `--app-id=${APP_ID}`],
      { timeout: 10_000 }
    ),
    (error) => {
      assert.match(error.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION/);
      return true;
    }
  );
});
