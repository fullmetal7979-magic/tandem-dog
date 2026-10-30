import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from '../test-support/test-dom.mjs';
import {
  COSMOS_VERSES,
  UNIVERSE_LIMIT,
  layoutUniverse,
  lightCaption,
  planetPalette,
  tetheredCount,
  universeChips,
  universeSummary,
  universeVerse,
  verseOfTheDay,
} from './universe-model.ts';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

function commit(index, patch = {}) {
  return {
    hash: `${String(index).padStart(4, '0')}${'a'.repeat(36)}`,
    shortHash: `c${index}`,
    subject: `커밋 ${index}`,
    author: index % 2 ? '하늘' : '바다',
    authoredAt: new Date(NOW - index * 3_600_000).toISOString(),
    pushed: true,
    parents: ['p'],
    tags: [],
    ...patch,
  };
}

const facts = (patch = {}) => ({
  planetName: 'my-app',
  hasProject: true,
  repository: true,
  lights: 12,
  beyond: false,
  nebula: 0,
  tethered: 0,
  ...patch,
});

test('the newest light sits by the planet and the oldest at the horizon, on both arms', () => {
  const commits = Array.from({ length: 30 }, (_, index) => commit(index));
  const lights = layoutUniverse(commits);
  assert.equal(lights.length, 30);
  assert.ok(lights[0].r < 0.25, `newest r=${lights[0].r}`);
  assert.ok(lights.at(-1).r > 0.9, `oldest r=${lights.at(-1).r}`);
  assert.equal(lights[0].age, 0);
  assert.equal(lights.at(-1).age, 1);
  assert.deepEqual(new Set(lights.map((light) => light.arm)), new Set([0, 1]));
  for (const light of lights) {
    assert.ok(light.r > 0 && light.r <= 1);
    assert.ok(Number.isFinite(light.theta));
  }
  // The same history always draws the same sky.
  assert.deepEqual(layoutUniverse(commits), lights);
});

test('a new commit is born without reshuffling the older lights', () => {
  const commits = Array.from({ length: 60 }, (_, index) => commit(index + 1));
  const before = layoutUniverse(commits);
  const after = layoutUniverse([commit(0), ...commits]);
  assert.equal(after[0].hash, commit(0).hash);
  assert.ok(after[0].r < 0.25);
  for (const [index, light] of before.entries()) {
    const moved = after[index + 1];
    assert.equal(moved.hash, light.hash);
    assert.equal(moved.arm, light.arm);
    assert.ok(moved.r >= light.r - 1e-9 && moved.r - light.r < 0.03, `r ${light.r} -> ${moved.r}`);
    assert.ok(Math.abs(moved.theta - light.theta) < 0.2, `theta ${light.theta} -> ${moved.theta}`);
  }
});

test('merges, tags and the first commit are told apart and drawn larger', () => {
  const [tagged, merge, plain, origin] = layoutUniverse([
    commit(0, { tags: ['v1.0'] }),
    commit(1, { parents: ['a', 'b'] }),
    commit(2),
    commit(3, { parents: [] }),
  ]);
  assert.equal(tagged.kind, 'tag');
  assert.equal(tagged.tag, 'v1.0');
  assert.equal(merge.kind, 'merge');
  assert.equal(plain.kind, 'commit');
  assert.equal(origin.kind, 'origin');
  assert.ok(tagged.size > plain.size && merge.size > plain.size && origin.size > plain.size);
  assert.match(lightCaption(origin, NOW).note, /이 우주의 첫 빛/);
  assert.match(lightCaption(tagged, NOW).note, /이름 붙은 빛 · v1\.0/);
  assert.match(lightCaption(merge, NOW).note, /병합/);
  assert.equal(lightCaption(plain, NOW).meta, 'c2 · 바다 · 2시간 전');
});

test('each planet keeps its own colours', () => {
  assert.deepEqual(planetPalette('my-app'), planetPalette('my-app'));
  assert.notEqual(planetPalette('my-app').hue, planetPalette('other-app').hue);
  assert.match(planetPalette('my-app').light, /^hsl\(\d+ \d+% \d+%\)$/);
});

test('the verse names what the sky is made of, in plain words too', () => {
  assert.match(universeVerse(facts({ hasProject: false })).line, /행성을 고르면/);
  assert.match(universeVerse(facts({ repository: false })).detail, /git을 시작하면/);
  assert.match(universeVerse(facts({ lights: 0 })).line, /아직 아무 빛도/);
  const busy = universeVerse(facts({ lights: UNIVERSE_LIMIT, beyond: true, nebula: 7, tethered: 2 }));
  assert.equal(busy.line, `이 우주의 빛 ${UNIVERSE_LIMIT}+개는 모두 my-app에서 태어났어요.`);
  assert.equal(busy.detail, '성운 7개가 빛이 되기를 기다려요 · 빛 2개가 아직 행성에 매여 있어요.');
  assert.equal(universeVerse(facts()).detail, '모든 빛이 제자리에 있어요.');
  assert.deepEqual(
    universeChips(facts({ nebula: 7, tethered: 2 })).map((chip) => `${chip.name} ${chip.value} · ${chip.plain}`),
    ['빛 12 · 커밋', '성운 7 · 커밋 전 변경', '매인 빛 2 · 푸시 전']
  );
  assert.deepEqual(universeChips(facts({ repository: false })), []);
  assert.equal(
    universeSummary(facts({ nebula: 3, tethered: 1 })),
    'my-app의 우주: 커밋 12개가 빛으로 그려져 있어요, 커밋 전 변경 3개가 행성 곁을 돌아요, 푸시 전 커밋 1개가 행성에 이어져 있어요.'
  );
});

test('without an upstream nothing is called unpushed', () => {
  const lights = layoutUniverse([commit(0, { pushed: false }), commit(1, { pushed: false })]);
  assert.equal(tetheredCount(lights, false), null);
  assert.equal(tetheredCount(lights, true), 2);
});

test('the verse of the day changes with the day, not with every render', () => {
  const today = verseOfTheDay('my-app', NOW);
  assert.equal(verseOfTheDay('my-app', NOW + 3_600_000), today);
  assert.ok(COSMOS_VERSES.includes(today));
  const week = new Set(Array.from({ length: 7 }, (_, day) => verseOfTheDay('my-app', NOW + day * 86_400_000)));
  assert.ok(week.size > 1);
});

test('the universe hero reads the planet history and writes the picture in words', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  const calls = [];
  window.mixdogDesktop = {
    gitStatus: async (cwd, options) => {
      calls.push(['status', cwd, options]);
      return { repository: true, upstream: true, files: [{}, {}, {}] };
    },
    gitLog: async (cwd, query, skip, limit) => {
      calls.push(['log', cwd, query, skip, limit]);
      return [commit(0, { pushed: false }), commit(1), commit(2, { parents: [] })];
    },
  };
  const { CosmosUniverse } = await import('./CosmosUniverse.tsx');
  await act(async () =>
    root.render(React.createElement(CosmosUniverse, { projectPath: '/work/app', planetName: 'my-app', subtitle: '이어가세요.' }))
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.deepEqual(calls, [
    ['status', '/work/app', { skipLineStats: true }],
    ['log', '/work/app', '', 0, UNIVERSE_LIMIT],
  ]);
  assert.equal(document.querySelector('.cosmos-universe h1').textContent, 'my-app');
  assert.equal(document.querySelector('.cosmos-universe-wordmark').textContent, '코스모스 코드');
  assert.equal(document.querySelector('.cosmos-universe-canvas').getAttribute('aria-hidden'), 'true');
  assert.equal(document.querySelector('.cosmos-universe-line').textContent, '이 우주의 빛 3개는 모두 my-app에서 태어났어요.');
  assert.deepEqual(
    [...document.querySelectorAll('.cosmos-universe-chips li')].map((chip) => chip.textContent),
    ['빛 3 · 커밋', '성운 3 · 커밋 전 변경', '매인 빛 1 · 푸시 전']
  );
  assert.match(document.querySelector('.cosmos-universe .sr-only').textContent, /^my-app의 우주: 커밋 3개가 빛으로/);
  // The hero adds no live region: the home keeps exactly one for the seat.
  assert.equal(document.querySelectorAll('.cosmos-universe [aria-live], .cosmos-universe [role=status]').length, 0);
});

test('with no project chosen the hero waits without asking git anything', async (t) => {
  const { root, document, window } = installTestDom(t, { rootId: 'root' });
  let asked = false;
  window.mixdogDesktop = {
    gitStatus: async () => {
      asked = true;
    },
    gitLog: async () => {
      asked = true;
      return [];
    },
  };
  const { CosmosUniverse } = await import('./CosmosUniverse.tsx');
  await act(async () => root.render(React.createElement(CosmosUniverse, { projectPath: '', planetName: '새 작업' })));
  assert.equal(asked, false);
  assert.match(document.querySelector('.cosmos-universe-line').textContent, /행성을 고르면/);
  assert.equal(document.querySelectorAll('.cosmos-universe-chips').length, 0);
});
