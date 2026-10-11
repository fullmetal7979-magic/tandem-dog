import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { installTestDom } from './test-support/test-dom.mjs';

// React DOM decides ONCE, at module evaluation, whether the host supports
// native input events, so the DOM globals land first and react-dom/client plus
// the pane are imported afterwards (same order as explorer-tree.test.mjs).
const { restore } = installTestDom(null, {
  html: '<!doctype html><html><body></body></html>',
  jsdom: { url: 'http://localhost/', pretendToBeVisual: true },
  expose: ['navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event'],
});
after(restore);

const { createRoot } = await import('react-dom/client');
const { TandemPane } = await import('./TandemPane.tsx');

const PROJECT = '/work/app';
const BRANCH = 'feature/login';

function branchInfo(overrides = {}) {
  return {
    name: BRANCH,
    head: 'abc1234567',
    upstream: `origin/${BRANCH}`,
    ahead: 0,
    behind: 0,
    gone: false,
    ts: 1_760_000_000,
    subject: 'Add login form',
    ...overrides,
  };
}

function cannedOverview({ deskConfig = 'B', holder = 'A' } = {}) {
  return {
    available: true,
    root: PROJECT,
    config: { desk: deskConfig, tool: deskConfig ? 'Codex' : null, base: 'main', host: 'home-mac' },
    session: {
      goal: 'Ship the login form',
      state: 'in progress',
      next: 'Wire the submit handler',
      decisions: ['Use session cookies', 'No social login in v1'],
      log: [],
    },
    desks: [
      { desk: 'A', tool: 'Claude', host: 'office-pc', holding: holder === 'A' ? BRANCH : null, branch: BRANCH },
      { desk: 'B', tool: 'Codex', host: 'home-mac', holding: holder === 'B' ? BRANCH : null, branch: BRANCH },
    ],
    remote: [],
    focus: {
      branch: BRANCH,
      gh: { name: BRANCH, head: 'abc1234567', ts: 1_760_000_000, subject: 'Add login form' },
      rows: [
        {
          desk: 'A',
          tool: 'Claude',
          host: 'office-pc',
          at: Date.now() - 120_000,
          holding: holder === 'A' ? BRANCH : null,
          branch: branchInfo({ ahead: 2 }),
          rel: { k: 'ahead', label: '↑2 푸시 필요' },
          current: true,
          dirty: 3,
        },
        {
          desk: 'B',
          tool: 'Codex',
          host: 'home-mac',
          at: Date.now() - 3_600_000,
          holding: holder === 'B' ? BRANCH : null,
          branch: branchInfo({ behind: 1 }),
          rel: { k: 'behind', label: '↓1 pull 필요' },
          current: true,
          dirty: 0,
        },
      ],
      latest: { where: ['A'], localOnly: true },
      holder,
      verdict: { level: 'warn', text: 'Desk A has unpushed commits' },
    },
    handoffs: [
      { at: '2026-10-11 09:00', desk: 'A', tool: 'Claude', text: '', kind: 'leave', branch: BRANCH, memo: 'Form skeleton done' },
      { at: '2026-10-11 18:30', desk: 'B', tool: 'Codex', text: '', kind: 'resume', branch: BRANCH, memo: '' },
    ],
  };
}

function installHost(t, api) {
  window.mixdogDesktop = api;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete window.mixdogDesktop;
  });
  return root;
}

const settle = async () => {
  for (let turn = 0; turn < 3; turn += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
const buttonByText = (text) => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
const click = async (element) => {
  assert.ok(element, 'element to click exists');
  await act(async () => element.click());
  await settle();
};
const setValue = async (element, value) => {
  assert.ok(element, 'field exists');
  const prototype = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};

test('shows the verdict and the latest marker, and Resume calls tandemResume with the focus branch', async (t) => {
  const calls = { overview: [], resume: [] };
  const root = installHost(t, {
    async tandemOverview(cwd, options) {
      calls.overview.push([cwd, options]);
      return cannedOverview();
    },
    async tandemResume(cwd, request) {
      calls.resume.push([cwd, request]);
      return { branch: BRANCH, pulled: true, pullError: null, prompt: 'PASTE THIS PROMPT' };
    },
  });
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: true })));
  await settle();

  assert.deepEqual(calls.overview[0], [PROJECT, { fetch: true }]);
  const verdict = document.querySelector('[data-tandem-verdict]');
  assert.equal(verdict.textContent, 'Desk A has unpushed commits');
  assert.equal(verdict.dataset.tandemVerdict, 'warn');
  assert.ok(document.querySelector('[data-tandem-dot="warn"]'));
  assert.match(document.querySelector('[data-tandem-checked]').textContent, /^Checked /);

  // The latest version is unpushed on desk A: amber "latest · local only" there, nowhere else.
  const markers = [...document.querySelectorAll('[data-tandem-latest]')];
  assert.equal(markers.length, 1);
  assert.equal(markers[0].dataset.tandemLatest, 'local');
  assert.ok(markers[0].textContent.includes('♛'));
  assert.ok(markers[0].textContent.includes('latest · local only'));
  assert.ok(document.querySelector('[data-tandem-row="A"] [data-tandem-latest]'));
  assert.equal(document.querySelector('[data-tandem-row="B"] [data-tandem-latest]'), null);
  assert.equal(document.querySelector('[data-tandem-row="A"] [data-tandem-rel]').textContent, '↑2');
  assert.equal(document.querySelector('[data-tandem-row="B"] [data-tandem-rel]').textContent, '↓1');
  assert.match(document.querySelector('[data-tandem-row="A"]').textContent, /3 modified/);
  assert.match(document.querySelector('[data-tandem-row="A"]').textContent, /holding/);
  assert.ok(document.querySelector('[data-tandem-row="github"]'));

  // Session card and handoff timeline (newest first).
  assert.match(document.querySelector('[data-tandem-session]').textContent, /Ship the login form/);
  assert.match(document.querySelector('[data-tandem-session]').textContent, /Wire the submit handler/);
  assert.match(document.querySelector('[data-tandem-session]').textContent, /No social login in v1/);
  const handoffs = [...document.querySelectorAll('[data-tandem-handoff]')];
  assert.deepEqual(
    handoffs.map((entry) => entry.dataset.tandemHandoff),
    ['resume', 'leave']
  );

  // Desk B does not hold the branch, so the primary action is Resume.
  assert.equal(buttonByText('Leave this PC'), undefined);
  await click(buttonByText('Resume here'));
  assert.deepEqual(calls.resume, [[PROJECT, { branch: BRANCH }]]);
  assert.equal(document.querySelector('[data-tandem-prompt]').textContent, 'PASTE THIS PROMPT');
  assert.ok(buttonByText('Copy'));
  // A resume refreshes against the remote afterwards.
  assert.deepEqual(calls.overview.at(-1), [PROJECT, { fetch: true }]);
});

test('Leave collects a memo and the next step for the desk that holds the branch', async (t) => {
  const calls = { leave: [] };
  const root = installHost(t, {
    async tandemOverview() {
      return cannedOverview({ deskConfig: 'A', holder: 'A' });
    },
    async tandemLeave(cwd, request) {
      calls.leave.push([cwd, request]);
      return { branch: BRANCH, committed: true, pushed: true, pushError: null };
    },
  });
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: true })));
  await settle();

  assert.equal(buttonByText('Resume here'), undefined);
  await click(buttonByText('Leave this PC'));
  const memo = document.querySelector('[aria-label="Handoff memo"]');
  const next = document.querySelector('[aria-label="Next step"]');
  assert.equal(next.value, 'Wire the submit handler');
  await setValue(memo, 'Submit handler half done');
  await setValue(next, 'Add error states');
  await click(buttonByText('Commit, push and leave'));
  assert.deepEqual(calls.leave, [[PROJECT, { memo: 'Submit handler half done', next: 'Add error states' }]]);
  assert.match(document.querySelector('[data-tandem-notice="leave"]').textContent, /Committed and pushed feature\/login/);
  assert.equal(document.querySelector('[data-tandem-form="leave"]'), null);
});

test('a PC without a desk picks a free letter and an account label', async (t) => {
  const calls = { setDesk: [] };
  const root = installHost(t, {
    async tandemOverview() {
      return cannedOverview({ deskConfig: null, holder: 'A' });
    },
    async tandemSetDesk(cwd, request) {
      calls.setDesk.push([cwd, request]);
      return { desk: request.desk, tool: request.tool, base: 'main', host: 'home-mac' };
    },
  });
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: true })));
  await settle();

  assert.equal(buttonByText('Resume here'), undefined);
  await click(buttonByText("Set this PC's desk"));
  const letters = [...document.querySelectorAll('[role="radio"]')].map((button) => button.textContent);
  // A and B are published by other PCs.
  assert.deepEqual(letters, ['C', 'D', 'E', 'F', 'G', 'H']);
  await click(buttonByText('D'));
  await setValue(document.querySelector('[aria-label="Account label"]'), 'Claude work');
  await click(buttonByText('Save desk'));
  assert.deepEqual(calls.setDesk, [[PROJECT, { desk: 'D', tool: 'Claude work' }]]);
});

test('shows the reason when Tandem is unavailable and a disabled state when the host lacks the API', async (t) => {
  const root = installHost(t, {
    async tandemOverview() {
      return { available: false, reason: 'Open a git project with an origin remote' };
    },
  });
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: true })));
  await settle();
  assert.equal(
    document.querySelector('[data-tandem-unavailable]').textContent.includes('Open a git project with an origin remote'),
    true
  );

  // An older host exposes no Tandem members at all.
  window.mixdogDesktop = {};
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: false })));
  assert.match(document.body.textContent, /Tandem is not available in this app version\./);
  assert.equal(document.querySelector('button'), null);
});

test('an inactive Tandem tab reads nothing', async (t) => {
  let reads = 0;
  const root = installHost(t, {
    async tandemOverview() {
      reads += 1;
      return cannedOverview();
    },
  });
  await act(async () => root.render(React.createElement(TandemPane, { projectPath: PROJECT, active: false })));
  await settle();
  assert.equal(reads, 0);
});
