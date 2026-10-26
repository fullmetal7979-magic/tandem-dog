import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from '../test-support/test-dom.mjs';

const NOW = Date.now();
const me = { id: 'me', name: '집 맥북', kind: 'mac', color: '#fbbf24', me: true, beat: { at: NOW } };
const work = { id: 'work', name: '회사 PC', kind: 'pc', color: '#60a5fa', beat: { at: NOW - 60_000 } };
const laptop = { id: 'laptop', name: '노트북', kind: 'mac', color: '#f472b6', beat: { at: NOW - 3 * 3_600_000 } };

function view(patch = {}) {
  return {
    star: me,
    ready: true,
    remote: 'x',
    syncedAt: NOW,
    stars: [me, work, laptop],
    planets: [],
    planet: { id: 'github.com/me/app', name: 'my-app' },
    seat: {
      v: 1,
      planet: 'github.com/me/app',
      holder: { star: 'me', name: '집 맥북', kind: 'mac', since: NOW - 47 * 60_000 },
      requests: [{ star: 'work', name: '회사 PC', kind: 'pc', at: NOW, note: '회의실에서' }],
      handoffTo: null,
      history: [
        { star: 'laptop', name: '노트북', kind: 'mac', from: NOW - 5 * 3_600_000, to: NOW - 4 * 3_600_000, memo: '뼈대' },
        { star: 'work', name: '회사 PC', kind: 'pc', from: NOW - 3 * 3_600_000, to: NOW - 2 * 3_600_000, memo: 'API 연결' },
        { star: 'me', name: '집 맥북', kind: 'mac', from: NOW - 47 * 60_000, to: null },
      ],
    },
    state: 'mine',
    conversations: [],
    ...patch,
  };
}

test('the star map names every star and its state in words, and draws the request arrow', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { StarMap } = await import('./StarMap.tsx');
  await act(async () => root.render(React.createElement(StarMap, { view: view() })));
  const svg = document.querySelector('.cosmos-starmap svg');
  assert.match(svg.getAttribute('aria-label'), /my-app 우주 지도: 집 맥북이 작업 중\. 다른 기기 2개\./);
  const names = [...document.querySelectorAll('.cosmos-star-name')].map((node) => node.textContent);
  assert.deepEqual(names, ['집 맥북 (이 기기)', '회사 PC', '노트북']);
  const subs = [...document.querySelectorAll('.cosmos-star-sub')].map((node) => node.textContent);
  assert.match(subs[0], /47분째 작업 중/);
  assert.equal(subs[1], '🔁 교대 요청 중');
  assert.match(subs[2], /💤 3시간 전/);
  assert.equal(document.querySelectorAll('.cosmos-ask-line').length, 1);
  assert.equal(document.querySelectorAll('.cosmos-seat-halo').length, 1);
});

test('the constellation lists turns newest first with their memos', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { ConstellationTimeline } = await import('./ConstellationTimeline.tsx');
  const v = view();
  await act(async () => root.render(React.createElement(ConstellationTimeline, { history: v.seat.history, stars: v.stars, now: NOW })));
  assert.equal(document.querySelectorAll('.cosmos-turn').length, 3);
  assert.equal(document.querySelectorAll('.cosmos-turn.is-live').length, 1);
  assert.equal(document.querySelectorAll('.cosmos-constellation').length, 2);
  const rows = [...document.querySelectorAll('.cosmos-timeline-list li')].map((row) => row.textContent);
  assert.match(rows[0], /집 맥북작업 중/);
  assert.match(rows[1], /회사 PC2시간 전 내려놓음API 연결/);
});

test('the seat lock covers an occupied planet and offers a hand-over request', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  const occupied = view({
    state: 'occupied',
    seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW - 60_000 }, requests: [] },
  });
  window.mixdogDesktop = { cosmosOverview: async () => occupied };
  const store = await import('./cosmos-store.ts');
  store.resetCosmosStore();
  const { SeatLock } = await import('./SeatLock.tsx');
  await act(async () => root.render(React.createElement(SeatLock, { projectPath: '/work/app' })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const card = document.querySelector('.cosmos-lock');
  assert.ok(card, 'the lock is shown');
  assert.match(card.textContent, /회사 PC가 작업 중이에요/);
  assert.ok([...card.querySelectorAll('button')].some((button) => /교대 요청/.test(button.textContent)));
  store.resetCosmosStore();
});

test('a phone driving this PC locks it with a reclaim button', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  const remote = view({
    state: 'remote',
    seat: { ...view().seat, holder: { star: 'phone-1', name: '내 폰', kind: 'phone', since: NOW - 5 * 60_000, via: 'relay', host: 'me' }, requests: [] },
  });
  window.mixdogDesktop = { cosmosOverview: async () => remote };
  const store = await import('./cosmos-store.ts');
  store.resetCosmosStore();
  const { SeatLock } = await import('./SeatLock.tsx');
  await act(async () => root.render(React.createElement(SeatLock, { projectPath: '/work/app' })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const card = document.querySelector('.cosmos-lock');
  assert.match(card.textContent, /내 폰이 이 PC에서 원격으로 작업 중이에요/);
  assert.ok([...card.querySelectorAll('button')].some((button) => /이 PC로 되찾기/.test(button.textContent)));
  store.resetCosmosStore();
});

test('seen from the phone, the PC it drives can be continued without a hand-over', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  const phone = { id: 'phone-1', name: '내 폰', kind: 'phone', color: '#22d3ee', me: true, beat: null };
  const here = view({
    star: phone,
    stars: [phone, { ...me, me: false }],
    state: 'occupied',
    here: true,
    seat: { ...view().seat, requests: [] },
  });
  window.mixdogDesktop = { cosmosOverview: async () => here };
  const store = await import('./cosmos-store.ts');
  store.resetCosmosStore();
  const { SeatLock } = await import('./SeatLock.tsx');
  await act(async () => root.render(React.createElement(SeatLock, { projectPath: '/work/app' })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const buttons = [...document.querySelectorAll('.cosmos-lock button')].map((button) => button.textContent);
  assert.ok(buttons.some((label) => /폰으로 이어하기/.test(label)));
  assert.ok(!buttons.some((label) => /교대 요청/.test(label)));
  store.resetCosmosStore();
});
