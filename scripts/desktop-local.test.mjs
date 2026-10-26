import test from 'node:test';
import assert from 'node:assert/strict';
import { localDesktopScript } from './desktop-local.mjs';

test('local updates route to macOS shell scripts and Windows PowerShell scripts', () => {
  assert.equal(localDesktopScript('deploy', 'darwin'), 'update:dev:mac');
  assert.equal(localDesktopScript('plan', 'darwin'), 'update:dev:mac:plan');
  assert.equal(localDesktopScript('deploy', 'win32'), 'update:dev:fast');
  assert.equal(localDesktopScript('plan', 'win32'), 'update:dev:plan');
  assert.throws(() => localDesktopScript('deploy', 'linux'), /build:local/);
  assert.throws(() => localDesktopScript('invalid', 'darwin'), /Unknown/);
});
