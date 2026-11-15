import assert from 'node:assert/strict';
import test from 'node:test';

import { runningVersion, runningVersionLabel } from './running-version.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) COSMOS/1.0.12 Chrome/142.0.7444.59 Electron/39.2.0 Safari/537.36';

test('runningVersion reads the bundle version and the Electron runtime', () => {
  const version = runningVersion('1.0.12', UA);
  assert.deepEqual(version, { app: '1.0.12', electron: '39.2.0', chrome: '142.0.7444.59' });
  assert.equal(runningVersionLabel(version), 'v1.0.12 · Electron 39.2.0');
});

test('runningVersionLabel degrades without a user agent', () => {
  assert.equal(runningVersionLabel(runningVersion('1.0.12', '')), 'v1.0.12');
  assert.equal(runningVersionLabel(runningVersion('', '')), '');
});
