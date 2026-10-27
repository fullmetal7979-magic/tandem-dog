// A Mac never reads "Ctrl" for a key it presses with ⌘ (round-4 UX 1–2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modKeyCap, platformShortcut, shortcutKeyCaps } from './shortcut-display.ts';

test('labels follow the platform', () => {
  assert.equal(platformShortcut('Ctrl+S', true), '⌘S');
  assert.equal(platformShortcut('Ctrl+S', false), 'Ctrl+S');
  assert.equal(platformShortcut('Ctrl+Shift+M', true), '⇧⌘M');
  assert.equal(platformShortcut('Ctrl+Space', true), '⌃Space', 'Monaco keeps Control for suggest');
  assert.equal(platformShortcut('F12', true), 'F12');
  assert.equal(modKeyCap(true), '⌘');
  assert.deepEqual(shortcutKeyCaps('Ctrl+Shift+D', true), ['⇧', '⌘', 'D']);
  assert.deepEqual(shortcutKeyCaps('Ctrl+Shift+D', false), ['Ctrl', 'Shift', 'D']);
});

test('no screen hard-codes a Ctrl label any more', () => {
  for (const file of ['WorkspaceEmptyState.tsx', 'app-workbench-commands.ts', 'editor-breadcrumbs.tsx', 'ExplorerTree.tsx', 'DraftTokenBudget.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/platformShortcut\('[^']*'\)|shortcutKeyCaps\('[^']*'\)/g, '');
    assert.doesNotMatch(source, /<kbd>Ctrl<\/kbd>|'[^']*Ctrl[+ ][^']*'/, file);
  }
});
