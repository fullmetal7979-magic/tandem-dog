import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseModelContinuations } from './task-session-history.ts';
import { switchUiMode, adoptSyncedUiMode, readUiMode } from './cosmos/ui-mode.ts';
import { desktopFeatureEnabled } from './desktop-feature-config.ts';
import { matchesWorkbenchShortcut, WORKBENCH_SHORTCUTS, shortcutLabel } from './workbench-shortcuts.ts';

test('model continuations share one row, with selected and working history preserved', () => {
  const rows = [{ id: 'a', updatedAt: 1 }, { id: 'b', taskId: 'a', updatedAt: 2 },
    { id: 'c', updatedAt: 3 }, { id: 'archived', archived: true, updatedAt: 4 }];
  assert.deepEqual(collapseModelContinuations(rows).map(row => row.id), ['b', 'c', 'archived']);
  assert.deepEqual(collapseModelContinuations(rows, 'a').map(row => row.id), ['a', 'c', 'archived']);
  assert.deepEqual(collapseModelContinuations(rows.map(row => row.id === 'a' ? { ...row, working: true } : row)).map(row => row.id), ['a', 'b', 'c', 'archived']);
});
test('legacy mode changes never reload or hide development tools', () => {
  switchUiMode('simple'); adoptSyncedUiMode('simple');
  assert.equal(readUiMode(), 'advanced');
  for (const feature of ['agents', 'sourceControl', 'extensions', 'usage']) assert.equal(desktopFeatureEnabled(feature), true);
});
test('shortcut reference and handlers share exact modifier requirements', () => {
  const event = { key: 'M', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false };
  assert.equal(matchesWorkbenchShortcut(event, 'models'), true);
  assert.equal(matchesWorkbenchShortcut({ ...event, altKey: true }, 'models'), false);
  assert.equal(shortcutLabel(WORKBENCH_SHORTCUTS.find(row => row.id === 'models').keys, true), '⇧+⌘+M');
});
