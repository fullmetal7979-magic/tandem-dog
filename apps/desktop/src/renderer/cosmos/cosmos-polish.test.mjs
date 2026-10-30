// Small things the Galaxy screens must get right: long names, crowded maps,
// long histories, a missing holder name, and a relay address checked before
// it is sent.
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from '../test-support/test-dom.mjs';

const NOW = Date.now();
const star = (id, name, patch = {}) => ({ id, name, kind: 'pc', color: '#60a5fa', beat: { at: NOW }, ...patch });

function view(patch = {}) {
  const me = star('me', '집 맥북', { kind: 'mac', me: true });
  return {
    star: me,
    ready: true,
    remote: 'x',
    syncedAt: NOW,
    stars: [me],
    planets: [],
    planet: { id: 'github.com/me/app', name: 'my-app' },
    seat: { v: 1, planet: 'github.com/me/app', holder: null, requests: [], handoffTo: null, history: [] },
    state: 'empty',
    conversations: [],
    ...patch,
  };
}

test('names are clipped by character, never through an emoji', async () => {
  const { clipName } = await import('./cosmos-format.ts');
  assert.equal(clipName('회사 PC', 7), '회사 PC');
  assert.equal(clipName('아주아주긴기기이름입니다', 7), '아주아주긴기…');
  assert.equal(clipName('🚀🚀🚀🚀', 3), '🚀🚀…');
  assert.equal(clipName(null, 3), '');
});

test('a crowded star map keeps every star apart and names each in a tooltip', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { StarMap } = await import('./StarMap.tsx');
  const stars = [star('me', '집 맥북', { me: true }), ...Array.from({ length: 11 }, (_, i) => star(`s${i}`, `아주 긴 이름의 기기 번호 ${i + 1}`))];
  await act(async () => root.render(React.createElement(StarMap, { view: view({ stars }), active: false })));
  const bodies = [...document.querySelectorAll('.cosmos-star-body')].map((circle) => [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]);
  assert.equal(bodies.length, 12);
  for (let a = 0; a < bodies.length; a += 1) {
    for (let b = a + 1; b < bodies.length; b += 1) {
      const gap = Math.hypot(bodies[a][0] - bodies[b][0], bodies[a][1] - bodies[b][1]);
      assert.ok(gap > 24, `stars ${a} and ${b} overlap (${gap.toFixed(1)})`);
    }
  }
  const names = [...document.querySelectorAll('.cosmos-star-name')].map((node) => node.textContent);
  assert.ok(names.every((name) => Array.from(name).length <= 18), names.join(' | '));
  const titles = [...document.querySelectorAll('.cosmos-star > title')].map((node) => node.textContent);
  assert.ok(titles.some((title) => title.startsWith('아주 긴 이름의 기기 번호 11')), 'the full name is in the tooltip');
});

test('a long history says how much is shown, and a forced turn looks different', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { ConstellationTimeline } = await import('./ConstellationTimeline.tsx');
  const history = Array.from({ length: 20 }, (_, i) => ({
    star: i % 2 ? 'a' : 'b',
    name: i % 2 ? '회사에 있는 아주 긴 이름 PC' : '집 맥북',
    kind: 'pc',
    from: NOW - (20 - i) * 3_600_000,
    to: NOW - (20 - i) * 3_600_000 + 1_800_000,
    ...(i === 19 ? { forced: true } : {}),
  }));
  await act(async () => root.render(React.createElement(ConstellationTimeline, { history, stars: [], now: NOW })));
  assert.match(document.querySelector('.cosmos-timeline-caption').textContent, /전체 20번 중 최근 14번/);
  assert.equal(document.querySelectorAll('.cosmos-turn.is-forced').length, 1);
  const labels = [...document.querySelectorAll('.cosmos-lane-label')];
  assert.ok(labels.some((label) => label.querySelector('title')?.textContent === '회사에 있는 아주 긴 이름 PC'));
  assert.ok(labels.every((label) => !label.textContent.includes('아주 긴 이름 PC회사')), 'the visible label is clipped');
});

test('the seat badge never says "undefined" for a holder without a name', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  window.mixdogDesktop = { cosmosOverview: async () => view({ state: 'occupied', seat: { ...view().seat, holder: { star: 'x', since: NOW } } }) };
  const store = await import('./cosmos-store.ts');
  store.resetCosmosStore();
  t.after(() => store.resetCosmosStore());
  const { SeatBadge } = await import('./SeatBadge.tsx');
  await act(async () => root.render(React.createElement(SeatBadge, { projectPath: '/work/app' })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const text = document.querySelector('.cosmos-seat-badge').textContent;
  assert.match(text, /다른 기기 작업 중/);
  assert.doesNotMatch(text, /undefined/);
});

test('the relay address is checked before it is sent', async () => {
  const { relayUrlProblem } = await import('./CosmosSettingsPanel.tsx');
  assert.equal(relayUrlProblem(''), null);
  assert.equal(relayUrlProblem('wss://relay.example.com'), null);
  assert.equal(relayUrlProblem('ws://localhost:9800'), null);
  assert.match(relayUrlProblem('ws://relay.example.com'), /wss:\/\//);
  assert.match(relayUrlProblem('https://relay.example.com'), /wss:\/\//);
  assert.match(relayUrlProblem('wss://me:pw@relay.example.com'), /아이디·비밀번호/);
  assert.match(relayUrlProblem('relay.example.com'), /주소 모양이 아니에요/);
});
