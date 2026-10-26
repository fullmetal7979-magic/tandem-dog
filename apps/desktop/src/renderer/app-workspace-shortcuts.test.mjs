import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installTestDom } from './test-support/test-dom.mjs';

installTestDom(null, {
  html: '<!doctype html><html><body></body></html>',
  jsdom: {
    url: 'https://mixdog.test/',
  },
  expose: ['navigator'],
});

const { useWorkspaceShortcuts } = await import('./app-workspace-shortcuts.ts');

function Harness({ actions }) {
  useWorkspaceShortcuts(actions);
  return null;
}

test('Ctrl+T and Ctrl+` remain unclaimed', async (t) => {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  let actionCalls = 0;
  const noop = () => {
    actionCalls += 1;
  };
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        actions: {
          tabs: [],
          activeTabKey: '',
          navigateTab: noop,
          startTask: noop,
          openSettings: noop,
          toggleSidebar: noop,
          toggleDock: noop,
          togglePanel: noop,
          openQuickAccess: noop,
          openCommandPalette: noop,
          openFindInFiles: noop,
          openTabSwitcher: noop,
          focusSiblingPane: noop,
          focusVerticalPane: noop,
          navigateBack: noop,
          navigateForward: noop,
        },
      })
    );
  });

  const events = [];
  for (const key of ['t', '`']) {
    await act(async () => {
      const event = new window.KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      events.push(event);
      window.dispatchEvent(event);
    });
  }
  assert.equal(actionCalls, 0);
  assert.deepEqual(
    events.map((event) => event.defaultPrevented),
    [false, false]
  );
});

test('a focused code editor keeps Ctrl+Arrow for word jumps and line scrolling', async (t) => {
  const host = document.createElement('main');
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  const editorInput = document.createElement('div');
  editor.append(editorInput);
  const plain = document.createElement('div');
  document.body.append(host, editor, plain);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    editor.remove();
    plain.remove();
  });

  const navigated = [];
  const vertical = [];
  const noop = () => {};
  const tabs = [{ key: 'a' }, { key: 'b' }];
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        actions: {
          tabs,
          activeTabKey: 'a',
          navigateTab: (tab) => navigated.push(tab.key),
          startTask: noop,
          openSettings: noop,
          toggleSidebar: noop,
          toggleDock: noop,
          togglePanel: noop,
          openQuickAccess: noop,
          openCommandPalette: noop,
          openFindInFiles: noop,
          openTabSwitcher: noop,
          focusSiblingPane: noop,
          focusVerticalPane: (direction) => vertical.push(direction),
          navigateBack: noop,
          navigateForward: noop,
        },
      })
    );
  });

  const press = async (target, key) => {
    const event = new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  assert.equal(await press(editorInput, 'ArrowRight'), false);
  assert.equal(await press(editorInput, 'ArrowDown'), false);
  assert.deepEqual(navigated, []);
  assert.deepEqual(vertical, []);

  assert.equal(await press(plain, 'ArrowRight'), true);
  assert.equal(await press(plain, 'ArrowDown'), true);
  assert.deepEqual(navigated, ['b']);
  assert.deepEqual(vertical, ['down']);
});

test('COSMOS keys: mod+/ yields to Monaco, mod+Shift+S/L/E/D reach their actions', async (t) => {
  const host = document.createElement('main');
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  const editorInput = document.createElement('textarea');
  editor.append(editorInput);
  document.body.append(host, editor);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    editor.remove();
  });
  const calls = [];
  const noop = () => {};
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        actions: {
          tabs: [],
          activeTabKey: '',
          navigateTab: noop,
          startTask: noop,
          openSettings: noop,
          openShortcuts: () => calls.push('shortcuts'),
          openTandem: () => calls.push('galaxy'),
          cosmosSeat: (action) => calls.push(action),
          openRun: () => calls.push('run'),
          toggleSidebar: noop,
          toggleDock: noop,
          togglePanel: noop,
          openQuickAccess: noop,
          openCommandPalette: noop,
          openFindInFiles: noop,
          openTabSwitcher: noop,
          focusSiblingPane: noop,
          focusVerticalPane: noop,
          navigateBack: noop,
          navigateForward: noop,
        },
      })
    );
  });
  const press = async (target, key, shiftKey = false) => {
    const event = new window.KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  assert.equal(await press(editorInput, '/'), false);
  assert.equal(await press(editorInput, 'L', true), false);
  assert.equal(await press(host, '/'), true);
  assert.equal(await press(host, 'D', true), true);
  assert.equal(await press(host, 'S', true), true);
  assert.equal(await press(host, 'L', true), true);
  assert.equal(await press(host, 'E', true), true);
  assert.deepEqual(calls, ['shortcuts', 'galaxy', 'sit', 'leave', 'run']);
});

test('Command+Q reaches the native Quit action while Command+W and Ctrl+Q close tabs', async (t) => {
  const host = document.createElement('main');
  document.body.append(host);
  const root = createRoot(host);
  const noop = () => {};
  const closes = [];
  const onClose = () => closes.push('close');
  window.addEventListener('mixdog:close-active-tab', onClose);
  t.after(async () => {
    await act(async () => root.unmount());
    window.removeEventListener('mixdog:close-active-tab', onClose);
    host.remove();
  });
  await act(async () => root.render(React.createElement(Harness, { actions: {
    tabs: [], activeTabKey: '', navigateTab: noop, startTask: noop, openSettings: noop,
    toggleSidebar: noop, toggleDock: noop, togglePanel: noop, openQuickAccess: noop,
    openCommandPalette: noop, openFindInFiles: noop, openTabSwitcher: noop,
    focusSiblingPane: noop, focusVerticalPane: noop, navigateBack: noop, navigateForward: noop,
  } })));
  const press = async (key, modifiers) => {
    const event = new window.KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
    await act(async () => host.dispatchEvent(event));
    return event.defaultPrevented;
  };
  assert.equal(await press('q', { metaKey: true }), false);
  assert.deepEqual(closes, []);
  assert.equal(await press('w', { metaKey: true }), true);
  assert.equal(await press('q', { ctrlKey: true }), true);
  assert.deepEqual(closes, ['close', 'close']);
});

test('Command+Arrow stays with macOS text editing while non-input panes keep navigation', async (t) => {
  const host = document.createElement('main');
  const textarea = document.createElement('textarea');
  const input = document.createElement('input');
  const richText = document.createElement('div');
  richText.setAttribute('contenteditable', 'true');
  document.body.append(host, textarea, input, richText);
  const root = createRoot(host);
  const calls = [];
  const noop = () => {};
  t.after(async () => {
    await act(async () => root.unmount());
    for (const node of [host, textarea, input, richText]) node.remove();
  });
  await act(async () => root.render(React.createElement(Harness, { actions: {
    tabs: [], activeTabKey: '', navigateTab: noop, startTask: noop, openSettings: noop,
    toggleSidebar: noop, toggleDock: noop, togglePanel: noop, openQuickAccess: noop,
    openCommandPalette: noop, openFindInFiles: noop, openTabSwitcher: noop,
    focusSiblingPane: noop, focusVerticalPane: () => calls.push('pane'), navigateBack: noop, navigateForward: noop,
  } })));
  for (const target of [textarea, input, richText]) for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const event = new window.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(calls, []);
  const event = new window.KeyboardEvent('keydown', { key: 'ArrowDown', metaKey: true, bubbles: true, cancelable: true });
  await act(async () => host.dispatchEvent(event));
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, ['pane']);
});

test('mod+Shift+M opens the model picker everywhere except Monaco’s Ctrl chord', async (t) => {
  const host = document.createElement('main');
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  const editorInput = document.createElement('textarea');
  editor.append(editorInput);
  document.body.append(host, editor);
  const root = createRoot(host);
  const calls = [];
  const noop = () => {};
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    editor.remove();
  });
  await act(async () => root.render(React.createElement(Harness, { actions: {
    tabs: [], activeTabKey: '', navigateTab: noop, startTask: noop, openSettings: noop,
    openModelPicker: () => calls.push('models'),
    toggleSidebar: noop, toggleDock: noop, togglePanel: noop, openQuickAccess: noop,
    openCommandPalette: noop, openFindInFiles: noop, openTabSwitcher: noop,
    focusSiblingPane: noop, focusVerticalPane: noop, navigateBack: noop, navigateForward: noop,
  } })));
  const press = async (target, modifiers) => {
    const event = new window.KeyboardEvent('keydown', { key: 'M', shiftKey: true, ...modifiers, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  assert.equal(await press(host, { ctrlKey: true }), true);
  assert.equal(await press(host, { metaKey: true }), true);
  assert.equal(await press(editorInput, { metaKey: true }), true);
  assert.equal(await press(editorInput, { ctrlKey: true }), false);
  assert.deepEqual(calls, ['models', 'models', 'models']);
});
