import assert from 'node:assert/strict';
import { test } from 'node:test';
import { START_TRUST, TIERS, adjustTrust, classifyCommand, decide, effectiveTier, tierOf } from './policy.mjs';

test('commands are sorted by risk', () => {
  for (const command of ['ls -la', 'cat notes.md | grep 할 일 | wc -l', 'find . -name "*.md"', 'pwd', '']) assert.equal(classifyCommand(command), 'read', command);
  for (const command of ['python3 make_chart.py', 'mkdir 결과', 'echo hi > a.txt', 'ls; rm a.txt', 'cat $(ls)', 'find . -name x -delete', 'rm -rf build']) assert.equal(classifyCommand(command), 'write', command);
  for (const command of ['curl https://example.com', 'pip install pandas', 'npm install', 'git clone https://x/y', 'ssh host']) assert.equal(classifyCommand(command), 'network', command);
  for (const command of ['sudo ls', 'rm -rf /', 'rm -rf ~', 'rm -fr $HOME', 'mkfs.ext4 /dev/sda', 'dd if=/dev/zero of=/dev/disk2', ':(){ :|:& };:', 'shutdown -h now',
    'launchctl unload x', 'osascript -e "beep"', 'killall Finder', 'defaults write com.apple.dock x', 'security find-generic-password -s x', 'csrutil disable']) {
    assert.equal(classifyCommand(command), 'refuse', command);
  }
});

test('trust tiers grow with trust and are capped by the user', () => {
  assert.equal(tierOf(0).tier, 1);
  assert.equal(tierOf(START_TRUST).tier, 1);
  assert.equal(tierOf(25).tier, 2);
  assert.equal(tierOf(74.9).tier, 3);
  assert.equal(tierOf(100).tier, 4);
  assert.deepEqual(TIERS.map((tier) => tier.min), [0, 25, 50, 75]);
  const character = { userBond: { trust: 90 } };
  assert.equal(effectiveTier(character, {}), 2, 'default cap is 2');
  assert.equal(effectiveTier(character, { autonomyCap: 4 }), 4);
  assert.equal(effectiveTier(character, { autonomyCap: 9 }), 4, 'the cap is clamped');
  assert.equal(effectiveTier({ userBond: { trust: 30 } }, { autonomyCap: 4 }), 2, 'earned trust still limits');
});

test('trust is bounded and reports tier changes', () => {
  const character = { userBond: { trust: 20 } };
  assert.equal(adjustTrust(character, 2), null);
  const change = adjustTrust(character, 4);
  assert.equal(change.from.tier, 1);
  assert.equal(change.to.tier, 2);
  adjustTrust(character, 500);
  assert.equal(character.userBond.trust, 100);
  adjustTrust(character, -500);
  assert.equal(character.userBond.trust, 0);
});

test('the browser: reading is free, acting needs tier 2 or a task URL', () => {
  const ctx = (tier, extra = {}) => ({ tier, ...extra });
  assert.equal(decide('browser', { name: 'screenshot' }, ctx(1)), 'auto');
  assert.equal(decide('browser', { name: 'read_page' }, ctx(1)), 'auto');
  assert.equal(decide('browser', { name: 'scroll' }, ctx(1)), 'auto');
  assert.equal(decide('browser', { name: 'left_click' }, ctx(1)), 'ask');
  assert.equal(decide('browser', { name: 'left_click' }, ctx(2)), 'auto');
  assert.equal(decide('browser', { name: 'left_click' }, ctx(1, { allowAll: true })), 'auto');
  assert.equal(decide('browser', { name: 'browser_open', fromTask: true }, ctx(1)), 'auto');
  assert.equal(decide('browser', { name: 'browser_open', fromTask: false }, ctx(1)), 'ask');
});

test('the real desktop asks for everything but looking until tier 4', () => {
  for (const name of ['screenshot', 'zoom', 'cursor_position', 'wait']) assert.equal(decide('desktop', { name }, { tier: 1 }), 'auto', name);
  for (const tier of [1, 2, 3]) assert.equal(decide('desktop', { name: 'left_click' }, { tier }), 'ask');
  assert.equal(decide('desktop', { name: 'type' }, { tier: 4 }), 'auto');
  assert.equal(decide('desktop', { name: 'key' }, { tier: 1, allowAll: true }), 'auto');
});

test('files and shell depend on the folder, the sandbox and the risk', () => {
  assert.equal(decide('files', { command: 'view' }, { tier: 1 }), 'auto');
  assert.equal(decide('files', { command: 'create' }, { tier: 1 }), 'ask');
  assert.equal(decide('files', { command: 'create' }, { tier: 2, ownFolder: true }), 'auto');
  assert.equal(decide('files', { command: 'create' }, { tier: 2, ownFolder: false }), 'ask', 'a lent folder needs tier 3');
  assert.equal(decide('files', { command: 'str_replace' }, { tier: 3, ownFolder: false }), 'auto');

  const sandboxed = { tier: 2, sandboxed: true, ownFolder: true };
  assert.equal(decide('shell', { command: 'ls' }, { tier: 1 }), 'auto', 'read-only runs even unsandboxed');
  assert.equal(decide('shell', { command: 'python3 a.py' }, sandboxed), 'auto');
  assert.equal(decide('shell', { command: 'python3 a.py' }, { ...sandboxed, sandboxed: false }), 'ask', 'no sandbox: always ask');
  assert.equal(decide('shell', { command: 'python3 a.py' }, { ...sandboxed, ownFolder: false }), 'ask');
  assert.equal(decide('shell', { command: 'curl https://x' }, sandboxed), 'ask', 'network needs tier 3');
  assert.equal(decide('shell', { command: 'curl https://x' }, { ...sandboxed, tier: 3 }), 'auto');
  assert.equal(decide('shell', { command: 'sudo rm -rf /' }, { ...sandboxed, tier: 4, allowAll: true }), 'refuse', 'refused whatever was allowed');
  assert.equal(decide('mystery', {}, { tier: 4 }), 'ask');
});
