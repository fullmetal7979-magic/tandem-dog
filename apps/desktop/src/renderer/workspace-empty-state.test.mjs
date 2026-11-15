import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from './test-support/test-dom.mjs';

test('empty pane shortcut rows with an action are buttons that run it', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root', expose: ['navigator', 'HTMLElement', 'Event'] });
  const { WorkspaceEmptyState } = await import('./WorkspaceEmptyState.tsx');
  const calls = [];
  await act(async () => {
    root.render(
      React.createElement(WorkspaceEmptyState, {
        actions: { 'new-task': () => calls.push('new-task'), settings: () => calls.push('settings') },
      })
    );
  });
  const buttons = [...document.querySelectorAll('.welcome-shortcut-action')];
  assert.equal(buttons.length, 2, 'only rows with a handler become buttons');
  for (const button of buttons) {
    await act(async () => button.click());
  }
  assert.deepEqual(calls, ['new-task', 'settings']);
  // Rows without a handler (sidebar here, tab switching always) stay plain text.
  assert.equal(document.querySelectorAll('.welcome-shortcuts > div').length, 3);
});

test('empty pane renders without actions as plain shortcut text', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root', expose: ['navigator', 'HTMLElement', 'Event'] });
  const { WorkspaceEmptyState } = await import('./WorkspaceEmptyState.tsx');
  await act(async () => root.render(React.createElement(WorkspaceEmptyState)));
  assert.equal(document.querySelectorAll('.welcome-shortcut-action').length, 0);
  assert.equal(document.querySelectorAll('.welcome-shortcuts > div').length, 5);
});
