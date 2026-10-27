// Round-4 UX 7: a dialog opened on its own makes the app inert and keeps Tab
// inside; nested in Settings it leaves both to Settings.
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { installTestDom } from '../test-support/test-dom.mjs';

async function mount(t, { nested }) {
  const { root, document, window } = installTestDom(t, {
    rootId: 'root',
    expose: ['HTMLElement'],
    html: '<!doctype html><html><body><div id="app"><button id="behind">behind</button></div><div id="root"></div></body></html>',
  });
  const { useStandaloneDialogModality } = await import('./use-standalone-dialog.ts');
  function Dialog() {
    const ref = useRef(null);
    useStandaloneDialogModality(ref);
    const section = React.createElement(
      'section',
      { ref, role: 'dialog', 'aria-modal': 'true' },
      React.createElement('button', { id: 'first' }, 'first'),
      React.createElement('button', { id: 'last' }, 'last')
    );
    const layer = React.createElement('div', { className: 'settings-confirm-layer' }, section);
    return nested ? React.createElement('div', { role: 'dialog' }, layer) : layer;
  }
  await act(async () => root.render(React.createElement(Dialog)));
  return { root, document, window };
}

test('on its own: the app goes inert and Tab wraps inside the dialog', async (t) => {
  const { root, document, window } = await mount(t, { nested: false });
  const app = document.getElementById('app');
  assert.equal(app.inert, true);
  assert.equal(app.getAttribute('aria-hidden'), 'true');
  document.getElementById('last').focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.id, 'first');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.id, 'last');
  await act(async () => root.unmount());
  assert.notEqual(app.inert, true);
  assert.equal(app.hasAttribute('aria-hidden'), false);
});

test('nested in Settings: it leaves modality to Settings', async (t) => {
  const { document } = await mount(t, { nested: true });
  assert.notEqual(document.getElementById('app').inert, true);
});
