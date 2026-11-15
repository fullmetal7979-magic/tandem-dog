import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installTestDom } from './test-support/test-dom.mjs';
import { ModelCatalog } from './model-catalog.tsx';
import { modelAliasId, modelCapabilityLabels } from './provider-display.tsx';

const base = { effortOptions: [], fastCapable: false, fastPreferred: false };

test('alias id appears only when the shown name is not the id itself', () => {
  assert.equal(modelAliasId({ ...base, provider: 'openai', model: 'gpt-5', display: 'GPT-5' }), '');
  assert.equal(modelAliasId({ ...base, provider: 'anthropic', model: 'claude-opus-4-5', display: '' }), '');
  assert.equal(
    modelAliasId({ ...base, provider: 'custom-x', model: 'vendor/coder-7b', display: 'Team coder' }),
    'vendor/coder-7b'
  );
  assert.equal(modelAliasId({ ...base, provider: 'openai', model: '', display: 'Nothing' }), '');
});

test('capability labels share one order: context, images, fast', () => {
  assert.deepEqual(
    modelCapabilityLabels({ ...base, provider: 'openai', model: 'm', display: 'm', contextWindow: 128000, supportsVision: true, fastCapable: true }),
    ['128k Context', 'Images', 'Fast']
  );
  assert.deepEqual(modelCapabilityLabels({ ...base, provider: 'openai', model: 'm', display: 'm' }), []);
});

test('catalog row shows the real id beside an alias and as its tooltip', async () => {
  const { dom, restore } = installTestDom(null, {
    html: '<!doctype html><body><main></main></body>', jsdom: { url: 'https://cosmos.test/' },
    expose: ['HTMLElement', 'Node'],
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = createRoot(document.querySelector('main'));
  try {
    const models = [
      { ...base, provider: 'custom-x', model: 'vendor/coder-7b', display: 'Team coder', fastCapable: true },
      { ...base, provider: 'openai', model: 'gpt-5', display: 'GPT-5', contextWindow: 400000 },
    ];
    await act(async () => root.render(React.createElement(ModelCatalog, {
      models, provider: 'openai', model: 'gpt-5', onSelect() {}, onClose() {},
    })));
    const rows = [...document.querySelectorAll('[role="option"]')];
    const alias = rows.find((row) => row.textContent.includes('Team coder'));
    assert.equal(alias.getAttribute('title'), 'vendor/coder-7b');
    assert.equal(alias.querySelector('.model-row-id').textContent, 'vendor/coder-7b');
    assert.match(alias.querySelector('.model-capabilities').textContent, /Fast/);
    const plain = rows.find((row) => row.textContent.includes('GPT-5'));
    assert.equal(plain.getAttribute('title'), null);
    assert.equal(plain.querySelector('.model-row-id'), null);
    assert.match(plain.querySelector('.model-capabilities').textContent, /400k Context/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restore();
  }
});
