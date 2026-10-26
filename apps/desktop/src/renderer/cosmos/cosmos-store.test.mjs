import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from '../test-support/test-dom.mjs';

const NOW = Date.now();
const me = { id: 'me', name: '집 맥북', kind: 'mac', color: '#fbbf24', me: true, beat: { at: NOW } };
const work = { id: 'work', name: '회사 PC', kind: 'pc', color: '#60a5fa', beat: { at: NOW } };

function view(patch = {}) {
  return {
    star: me,
    ready: true,
    remote: 'x',
    syncedAt: NOW,
    stars: [me, work],
    planets: [],
    planet: { id: 'github.com/me/app', name: 'my-app' },
    seat: { v: 1, planet: 'github.com/me/app', holder: null, requests: [], handoffTo: null, history: [] },
    state: 'empty',
    conversations: [],
    ...patch,
  };
}

const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function freshStore() {
  const store = await import('./cosmos-store.ts');
  store.resetCosmosStore();
  return store;
}

test('a hidden Galaxy pane watches nothing; showing it reads once', async (t) => {
  const { root, window } = installTestDom(t, { rootId: 'root' });
  let reads = 0;
  window.mixdogDesktop = {
    cosmosOverview: async () => {
      reads += 1;
      return view();
    },
  };
  const store = await freshStore();
  t.after(() => store.resetCosmosStore());
  const { GalaxyPane } = await import('./GalaxyPane.tsx');
  await act(async () => root.render(React.createElement(GalaxyPane, { projectPath: '/work/app', active: false })));
  await tick();
  assert.equal(reads, 0, 'an inactive dock tab does not poll');
  await act(async () => root.render(React.createElement(GalaxyPane, { projectPath: '/work/app', active: true })));
  await tick();
  assert.equal(reads, 1);
  await act(async () => root.render(React.createElement(GalaxyPane, { projectPath: '/work/app', active: false })));
  await act(async () => root.render(React.createElement(GalaxyPane, { projectPath: '/work/app', active: true })));
  await tick();
  assert.equal(reads, 1, 'reopening within the freshness window reuses the cached view');
});

test('a failed first read shows the reason and a retry instead of an endless spinner', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  let fail = true;
  window.mixdogDesktop = {
    cosmosOverview: async () => {
      if (fail) throw new Error("Error invoking remote method 'mixdog:cosmos-overview': Error: git을 찾지 못했어요");
      return view();
    },
    invokeCapability: async () => ({ value: { api: [], oauth: [] } }),
  };
  const store = await freshStore();
  t.after(() => store.resetCosmosStore());
  const { GalaxyPane } = await import('./GalaxyPane.tsx');
  await act(async () => root.render(React.createElement(GalaxyPane, { projectPath: '/work/app', active: true })));
  await tick();
  const pending = document.querySelector('.cosmos-pending');
  assert.ok(pending, 'the failure is shown');
  assert.match(pending.textContent, /불러오지 못했어요/);
  assert.match(pending.textContent, /git을 찾지 못했어요/);
  assert.doesNotMatch(pending.textContent, /invoking remote method/);
  fail = false;
  const retry = [...pending.querySelectorAll('button')].find((button) => /다시 시도/.test(button.textContent));
  await act(async () => retry.click());
  await tick();
  assert.equal(document.querySelector('.cosmos-pending'), null);
  assert.ok(document.querySelector('.cosmos-hero'));
});

test('a background poll never covers an action error, and an unchanged poll re-renders nothing', async (t) => {
  const { root, window } = installTestDom(t, { rootId: 'root' });
  let pollFails = false;
  window.mixdogDesktop = {
    cosmosOverview: async () => {
      if (pollFails) throw new Error('offline');
      return view();
    },
    cosmosSun: async () => {
      throw new Error("Error invoking remote method 'mixdog:cosmos-sun': Error: 푸시하지 못했어요");
    },
  };
  const store = await freshStore();
  t.after(() => store.resetCosmosStore());
  let renders = 0;
  let latest = null;
  function Probe() {
    latest = store.useCosmos('/work/app');
    renders += 1;
    return null;
  }
  await act(async () => root.render(React.createElement(Probe)));
  await tick();
  await act(async () => store.cosmosSit('/work/app'));
  assert.equal(latest.actionError, '푸시하지 못했어요');
  const before = renders;
  await act(async () => store.refreshCosmos('/work/app'));
  assert.equal(renders, before, 'same view: no new render');
  assert.equal(latest.loading, false, 'a background poll is not shown as loading');
  pollFails = true;
  await act(async () => store.refreshCosmos('/work/app'));
  assert.equal(latest.pollError, 'offline');
  assert.equal(latest.actionError, '푸시하지 못했어요', 'the action error survives polling');
  assert.ok(latest.view, 'the last good view is kept');
});

test('until the seat is known the composer is held with a checking banner', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  let answer;
  window.mixdogDesktop = { cosmosOverview: () => new Promise((resolve) => (answer = resolve)) };
  const store = await freshStore();
  t.after(() => store.resetCosmosStore());
  const { SeatLock } = await import('./SeatLock.tsx');
  function Pane() {
    return React.createElement(
      'section',
      null,
      React.createElement('form', { className: 'composer' }, React.createElement('textarea')),
      React.createElement(SeatLock, { projectPath: '/work/app' })
    );
  }
  await act(async () => root.render(React.createElement(Pane)));
  const composer = document.querySelector('form.composer');
  assert.ok(document.querySelector('.cosmos-lock--checking'), 'checking banner');
  assert.ok(composer.hasAttribute('inert'), 'composer held while checking');
  await act(async () => answer(view()));
  await tick();
  assert.equal(document.querySelector('.cosmos-lock'), null);
  assert.ok(!composer.hasAttribute('inert'), 'released once the seat is free');
});

test('the compact home input button is disabled while another device holds the seat', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  const occupied = view({ state: 'occupied', seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW } } });
  window.mixdogDesktop = { cosmosOverview: async () => occupied };
  const store = await freshStore();
  t.after(() => store.resetCosmosStore());
  const { CosmosHome } = await import('./CosmosHome.tsx');
  await act(async () => root.render(React.createElement(CosmosHome, { projectPath: '/work/app' })));
  await tick();
  const chat = [...document.querySelectorAll('.cosmos-home-actions button')].find((button) => /메시지 입력/.test(button.textContent));
  assert.ok(chat.disabled);
  assert.match(document.querySelector('.cosmos-home-status').textContent, /회사 PC/);
  assert.equal(document.querySelector('.cosmos-home').getAttribute('aria-label'), '코스모스 홈');
  // The compact home exposes one accessible live status for the seat holder.
  const live = [...document.querySelectorAll('[aria-live], [role=status]')];
  assert.equal(live.length, 1);
  assert.match(live[0].textContent, /회사 PC가 작업 중이에요/);
});

test('the 이어받기 outcome tells a local-only or failed backup and a seat moved from the phone', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { RelayOutcome } = await import('./CosmosParts.tsx');
  const base = { view: null, loading: false, pollError: '', actionError: '', busy: null, refusal: null, lastMoon: null };
  const lastSun = {
    planet: { id: 'p', name: 'app' },
    seat: null,
    took: null,
    moved: { from: 'phone', to: 'me' },
    rescue: { branch: 'cosmos/rescue-me-1', commits: 1, dirty: 0, pushed: false },
    rescueFailed: null,
    environment: null,
    project: { ok: true },
    conversation: null,
  };
  await act(async () => root.render(React.createElement(RelayOutcome, { projectPath: '/a', entry: { ...base, lastSun } })));
  const text = document.querySelector('.cosmos-outcome').textContent;
  assert.match(text, /폰의 작업 자리를 이 PC로 옮김/);
  assert.match(text, /비밀 정보가 있어 이 기기에만 둠/);
  await act(async () =>
    root.render(React.createElement(RelayOutcome, { projectPath: '/a', entry: { ...base, lastSun: { ...lastSun, moved: null, rescue: null, rescueFailed: { failed: 'commit' } } } }))
  );
  assert.match(document.querySelector('.cosmos-outcome').textContent, /남은 작업 보관 실패 · 작업은 손대지 않고/);
  const refusal = { refused: true, code: 'push_failed', message: '프로젝트를 원격 저장소에 올리지 못했어요. 작업 자리는 이 기기에 그대로 있어요.' };
  await act(async () => root.render(React.createElement(RelayOutcome, { projectPath: '/a', entry: { ...base, lastSun: null, refusal } })));
  const refused = document.querySelector('.cosmos-outcome--refused');
  assert.match(refused.querySelector('b').textContent, /내려놓지 못했어요/);
  assert.match(refused.textContent, /작업 자리는 이 기기에 그대로 있어요/);
});
