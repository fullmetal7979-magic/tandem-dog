import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComputerNative } from './computer-native-validation.mjs';
const target = { platform: process.platform, arch: process.arch, key: `${process.platform}-${process.arch}` };
test('native runtime preparation rejects a no-op executable and wrong architecture', async () => {
  await assert.rejects(validateComputerNative(process.execPath, target, async () => ({ stdout: '' })), /placeholder/);
  await assert.rejects(validateComputerNative(process.execPath, { ...target, arch: 'unsupported' }), /wrong architecture/);
  if (process.platform === 'darwin') await assert.rejects(validateComputerNative('/usr/bin/true', target), /placeholder/);
});
test('real backend identity includes binary contents so stale assets cannot reuse a runtime fingerprint', async () => {
  const hash = await validateComputerNative(process.execPath, target, async () => ({ stdout: 'mixdog-computer 0.1.0\n' }));
  assert.match(hash, /^[a-f0-9]{64}$/);
});
