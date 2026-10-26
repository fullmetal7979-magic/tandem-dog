import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installTestDom } from './test-support/test-dom.mjs';
import { ModelCatalog } from './model-catalog.tsx';
import { ModelSelector } from './model-controls.tsx';
import { ExecutionBudgetControl } from './ExecutionBudgetControl.tsx';
import { ComposerFooter } from './ComposerFooter.tsx';
import { invalidateSharedModelCatalogRequest } from './model-catalog-cache.ts';
import { isMacShortcutPlatform } from './workbench-shortcuts.ts';

// The workbench `mod` key: ⌘ alone on macOS, Ctrl elsewhere.
const mod = () => (isMacShortcutPlatform() ? { metaKey: true } : { ctrlKey: true });

const models = [
  { provider: 'openai', model: 'test-coder', display: 'Coder', contextWindow: 128000, supportsVision: true },
  { provider: 'anthropic', model: 'test-builder', display: 'Builder', contextWindow: 200000 },
].map(model => ({ ...model, effortOptions: ['low', 'medium', 'high'].map(value => ({ value, label: value })), fastCapable: true, fastPreferred: false }));

async function withDom(run) {
  const { dom, restore } = installTestDom(null, {
    html: '<!doctype html><body><main></main></body>', jsdom: { url: 'https://cosmos.test/' },
    expose: ['HTMLElement', 'Node'],
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  const mutations = [];
  window.mixdogDesktop = {
    rendererDiagnostic() {}, listProviderModels: async () => models,
    invokeCapability: async () => ({ value: { api: models.map(m => ({ id: m.provider, authenticated: true })) }, snapshot: null }),
    setModelRoute: async (...args) => { mutations.push(args); return { ...args[0] }; },
  };
  invalidateSharedModelCatalogRequest();
  const root = createRoot(document.querySelector('main'));
  try { await run({ root, mutations }); }
  finally { await act(async () => root.unmount()); dom.window.close(); restore(); }
}

const inputText = async (input, text) => act(async () => {
  input.focus();
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keyup', { key: '1', bubbles: true }));
});

test('catalog searches providers, persists favorites, keeps capabilities and supports keyboard selection', async () => {
  await withDom(async ({ root }) => {
    const selected = [];
    const render = async active => act(async () => root.render(React.createElement(ModelCatalog, {
      models, provider: 'openai', model: 'test-coder', active,
      onSelect: option => selected.push(option.model), onClose() {},
    })));
    await render(true);
    await act(async () => document.querySelector('[aria-label="Pin current model"]').click());
    assert.equal(document.querySelector('.model-group--favorite [role="option"]').textContent.includes('Coder'), true);
    assert.equal(document.querySelector('.model-capabilities').textContent.includes('128'), true);
    await render(false);
    await render(true);
    assert.equal(document.querySelector('[aria-label="Unpin current model"]').getAttribute('aria-pressed'), 'true');
    const input = document.querySelector('input');
    await inputText(input, 'anthropic');
    const rows = [...document.querySelectorAll('[role="option"]')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /Builder/);
    await act(async () => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.deepEqual(selected, ['test-builder']);
    await inputText(input, '');
    await act(async () => document.querySelector('[aria-label="Unpin current model"]').click());
    assert.equal(document.querySelector('.model-group--favorite'), null);
  });
});

test('footer routes new-conversation model selections to the draft, never the control session', async () => {
  await withDom(async ({ root, mutations }) => {
    const drafts = [];
    const footer = ComposerFooter({
      ...models[0], effort: 'high', fast: true, fastCapable: true, contextPercent: 100,
      onDraftModelSelection: selection => drafts.push(selection),
      onOpenSettings() {}, invokeResult: action => action(), applySnapshot() {},
      dictation: { dictationInstalled: false }, paneActive: true,
      draft: '', attachments: [],
    });
    // Render the actual selector element produced by the footer: this checks
    // the public Composer prop wiring, not a separately reconstructed callback.
    const footerRow = React.Children.toArray(footer.props.children).find(child => child.props?.className === 'composer-footer');
    const selector = React.Children.toArray(footerRow.props.children).find(child => child.type === ModelSelector);
    assert.ok(selector);
    await act(async () => root.render(selector));
    const event = new window.KeyboardEvent('keydown', { key: 'M', ...mod(), shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => window.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    const modelRow = [...document.querySelectorAll('[role="option"]')].find(row => row.textContent.includes('Builder'));
    assert.ok(modelRow);
    await act(async () => modelRow.click());
    assert.equal(drafts.at(-1).provider, 'anthropic');
    assert.equal(drafts.at(-1).model, 'test-builder');
    assert.deepEqual(mutations, []);
    assert.equal(document.querySelector('.work-preset-select'), null, 'one reasoning control replaces duplicate presets');
  });
});

test('only the focused pane handles the model keyboard shortcut', async () => {
  await withDom(async ({ root }) => {
    await act(async () => root.render(React.createElement(ModelSelector, {
      provider: 'openai', model: 'test-coder', effort: 'high', fast: false, fastCapable: true,
      modelDisabled: false, tuningDisabled: false, answersModelPickerRequests: false,
      invokeResult: action => action(), applySnapshot() {}, onOpenSettings() {},
    })));
    const event = new window.KeyboardEvent('keydown', { key: 'M', ...mod(), shiftKey: true, cancelable: true });
    await act(async () => window.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(document.querySelector('.model-trigger').getAttribute('aria-expanded'), 'false');
  });
});


test('a populated chat switches providers through continuation instead of changing the source route', async () => {
  await withDom(async ({ root, mutations }) => {
    const continuations = [];
    await act(async () => root.render(React.createElement(ModelSelector, {
      provider: 'openai', model: 'test-coder', effort: 'high', fast: false, fastCapable: true,
      modelDisabled: false, tuningDisabled: false, answersModelPickerRequests: true,
      sessionId: 'existing', hasConversation: true,
      onContinueWithModel: async route => { continuations.push(route); return true; },
      invokeResult: action => action(), applySnapshot() {}, onOpenSettings() {},
    })));
    await act(async () => window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'M', ...mod(), shiftKey: true, cancelable: true,
    })));
    const other = [...document.querySelectorAll('[role="option"]')].find(row => row.textContent.includes('Builder'));
    await act(async () => other.click());
    assert.equal(continuations.length, 1);
    assert.equal(continuations[0].provider, 'anthropic');
    assert.deepEqual(mutations, []);
  });
});


test('request limits follow restored task settings, validate input and close with Escape', async () => {
  await withDom(async ({ root }) => {
    const changes = [];
    const render = value => act(async () => root.render(React.createElement(ExecutionBudgetControl, {
      value, disabled: false, onChange: value => changes.push(value),
    })));
    await render({});
    await render({ maxTokens: 2000, maxRequests: 3 });
    const trigger = document.querySelector('.execution-budget-control > button');
    await act(async () => trigger.click());
    const inputs = [...document.querySelectorAll('.execution-budget-panel input')];
    assert.equal(inputs[0].value, '2000');
    assert.equal(inputs[2].value, '3');
    await inputText(inputs[0], '-1');
    assert.equal(document.querySelector('.execution-budget-panel button').disabled, true);
    await inputText(inputs[0], '1000');
    await inputText(inputs[1], '.05');
    await act(async () => document.querySelector('.execution-budget-panel button').click());
    assert.deepEqual(changes, [{ maxTokens: 1000, maxCostUsd: .05, maxRequests: 3 }]);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await act(async () => trigger.click());
    await act(async () => document.querySelector('.execution-budget-panel input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('.execution-budget-panel'), null);
    assert.equal(document.activeElement, trigger);
  });
});

test('a click outside the request limit applies a valid edit and keeps an invalid one open', async () => {
  await withDom(async ({ root }) => {
    const changes = [];
    await act(async () => root.render(React.createElement(ExecutionBudgetControl, {
      value: {}, disabled: false, onChange: value => changes.push(value),
    })));
    const trigger = document.querySelector('.execution-budget-control > button');
    const help = document.getElementById(trigger.getAttribute('aria-describedby'));
    assert.match(help.textContent, /tool loops|도구/);
    const outside = () => act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
    await act(async () => trigger.click());
    const inputs = [...document.querySelectorAll('.execution-budget-panel input')];
    await inputText(inputs[2], '0');
    await outside();
    assert.ok(document.querySelector('.execution-budget-panel'), 'invalid input is not discarded');
    assert.ok(document.querySelector('.execution-budget-panel [role="alert"]'));
    assert.equal(inputs[2].getAttribute('aria-invalid'), 'true');
    await inputText(inputs[2], '4');
    await outside();
    assert.equal(document.querySelector('.execution-budget-panel'), null);
    assert.deepEqual(changes, [{ maxRequests: 4 }]);
  });
});
