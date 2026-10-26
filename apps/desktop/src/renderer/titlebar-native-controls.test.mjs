import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installTestDom } from './test-support/test-dom.mjs';

const { dom } = installTestDom(null, {
  html: '<!doctype html><body><main></main></body>', jsdom: { url: 'https://cosmos.test/' },
  expose: ['navigator'],
});
window.mixdogDesktop = {};
const { DesktopTitlebar } = await import('./titlebar.tsx');

test('native titlebar reserves the correct side only for Electron, not Mac browsers', async () => {
  const root = createRoot(document.querySelector('main'));
  try {
    for (const [ua, expected] of [
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/41.10.3', 'mac'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/41.10.3', 'windows'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/144 Safari/537.36', null],
      ['Mozilla/5.0 (X11; Linux x86_64) Electron/41.10.3', null],
    ]) {
      Object.defineProperty(dom.window.navigator, 'userAgent', { configurable: true, value: ua });
      await act(async () => root.render(React.createElement(DesktopTitlebar)));
      assert.equal(document.querySelector('.topbar').getAttribute('data-native-controls'), expected);
      assert.equal(Boolean(document.querySelector('.titlebar-caption-space')), expected === 'windows');
    }
  } finally { await act(async () => root.unmount()); }
});
