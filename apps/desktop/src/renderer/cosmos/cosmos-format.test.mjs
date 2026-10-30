import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTION_LABEL, ago, cosmosErrorText, cosmosVerdict, endsWithBatchim, josa, since } from './cosmos-format.ts';

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const me = { id: 'me', name: '집 맥북', kind: 'mac', color: '#fbbf24' };
const work = { id: 'work', name: '회사 PC', kind: 'pc', color: '#60a5fa' };

function view(patch = {}) {
  return {
    star: me,
    ready: true,
    remote: 'https://github.com/me/cosmos-galaxy.git',
    syncedAt: NOW,
    stars: [me, work],
    planets: [],
    planet: { id: 'github.com/me/app', name: 'app' },
    seat: { v: 1, planet: 'github.com/me/app', holder: null, requests: [], handoffTo: null, history: [] },
    state: 'empty',
    conversations: [],
    project: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, dirty: 0 },
    ...patch,
  };
}

test('Korean particles follow how the name is read', () => {
  assert.equal(josa('집 맥북', '이가'), '집 맥북이');
  assert.equal(josa('내 폰', '이가'), '내 폰이');
  assert.equal(josa('노트북', '을를'), '노트북을');
  assert.equal(josa('회사 PC', '이가'), '회사 PC가');
  assert.equal(josa('맥', '은는'), '맥은');
  assert.equal(josa('서버2', '이가'), '서버2가');
  assert.equal(endsWithBatchim('🚀'), null);
  assert.equal(josa('🚀', '이가'), '🚀이(가)');
});

test('relative time reads naturally', () => {
  assert.equal(ago(NOW - 20_000, NOW), '방금');
  assert.equal(ago(NOW - 47 * 60_000, NOW), '47분 전');
  assert.equal(ago(NOW - 5 * 3_600_000, NOW), '5시간 전');
  assert.equal(since(NOW - 47 * 60_000, NOW), '47분째');
  assert.equal(since(NOW - 3 * 3_600_000, NOW), '3시간째');
});

test('one verdict per relay state, each with one action', () => {
  assert.equal(cosmosVerdict(view({ ready: false }), NOW).action, 'setup');
  // An 이어받기 that stopped half-way is finished by pressing it again.
  const stopped = cosmosVerdict(view({ state: 'mine', pendingRescue: true }), NOW);
  assert.equal(stopped.action, 'sun');
  assert.match(stopped.title, /중간에 멈췄어요/);
  assert.equal(cosmosVerdict(view({ state: 'no_remote', planet: { id: null, name: 'app' } }), NOW).action, null);

  const empty = cosmosVerdict(view({ project: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 3, dirty: 0 } }), NOW);
  assert.equal(empty.action, 'sun');
  assert.match(empty.detail, /새 커밋 3개/);

  const mine = cosmosVerdict(
    view({ state: 'mine', seat: { ...view().seat, holder: { star: 'me', name: '집 맥북', kind: 'mac', since: NOW - 47 * 60_000 } } }),
    NOW
  );
  assert.equal(mine.action, 'moon');
  assert.match(mine.title, /47분째/);
  assert.equal(mine.live, '지금 이 기기에서 작업 중이에요', 'the live text has no ticking clock');

  const asked = cosmosVerdict(
    view({
      state: 'mine',
      seat: {
        ...view().seat,
        holder: { star: 'me', name: '집 맥북', kind: 'mac', since: NOW },
        requests: [{ star: 'work', name: '회사 PC', kind: 'pc', at: NOW, note: '회의실에서' }],
      },
    }),
    NOW
  );
  assert.equal(asked.action, 'handoff');
  assert.equal(asked.title, '회사 PC가 넘겨 달라고 요청했어요');

  const locked = cosmosVerdict(
    view({ state: 'occupied', seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW - 3_600_000 } } }),
    NOW
  );
  assert.equal(locked.level, 'warn');
  assert.equal(locked.action, 'request');
  assert.match(locked.title, /회사 PC가 작업 중이에요 · 1시간째/);
  assert.equal(locked.live, '회사 PC가 작업 중이에요');

  const stale = cosmosVerdict(
    view({ state: 'stale', holderLastSeen: NOW - 2 * 3_600_000, seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW - 3 * 3_600_000 } } }),
    NOW
  );
  assert.equal(stale.level, 'bad');
  assert.equal(stale.action, 'force');

  const waiting = cosmosVerdict(view({ seat: { ...view().seat, handoffTo: 'me', history: [{ star: 'work', name: '회사 PC', kind: 'pc', from: NOW - 7_200_000, to: NOW - 60_000, memo: 'API 완료' }] } }), NOW);
  assert.equal(waiting.level, 'ok');
  assert.match(waiting.detail, /회사 PC가 1분 전 내려놓았어요 — “API 완료”/);
});

test('no retired relay words reach the screen', () => {
  const texts = [
    ...Object.values(ACTION_LABEL),
    ...[
      view({ ready: false }),
      view({ state: 'no_remote', planet: { id: null, name: 'app' } }),
      view({ seat: { ...view().seat, handoffTo: 'work' } }),
      view({ seat: { ...view().seat, history: [{ star: 'work', name: '회사 PC', kind: 'pc', from: NOW - 7_200_000, to: NOW - 60_000 }] } }),
      view({ state: 'mine', seat: { ...view().seat, holder: { star: 'me', name: '집 맥북', kind: 'mac', since: NOW }, requests: [{ star: 'work', name: '회사 PC', kind: 'pc', at: NOW }] } }),
      view({ state: 'occupied', seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW }, requests: [{ star: 'me', name: '집 맥북', kind: 'mac', at: NOW }] } }),
      view({ state: 'occupied', here: true, seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW } } }),
    ].flatMap((v) => {
      const verdict = cosmosVerdict(v, NOW);
      return [verdict.title, verdict.detail];
    }),
  ];
  for (const text of texts) assert.doesNotMatch(text, /교대|우주 지도|우주 홈|행성|교신|앉지 않으면|내렸어요/, text);
});

test('errors read without the IPC wrapper', () => {
  assert.equal(cosmosErrorText(new Error("Error invoking remote method 'mixdog:cosmos-sun': Error: 은하수에 연결하지 못했어요")), '은하수에 연결하지 못했어요');
  assert.equal(cosmosErrorText(new Error("Error invoking remote method 'x': TypeError: boom")), 'boom');
  assert.equal(cosmosErrorText('plain'), 'plain');
  assert.equal(cosmosErrorText(new Error('')), '알 수 없는 문제가 생겼어요.');
});

test('names ending in an emoji, an acronym or an English word take the particle they are read with', () => {
  assert.equal(josa('집 맥북 💻', '이가'), '집 맥북 💻이');
  assert.equal(josa('Mac', '이가'), 'Mac이');
  assert.equal(josa('server', '이가'), 'server가');
  assert.equal(josa('HTML', '으로'), 'HTML로');
  assert.equal(josa('iPhone', '으로'), 'iPhone으로');
  assert.equal(josa('서울', '으로'), '서울로');
});

test('the desktop and the terminal read names the same way', async () => {
  const words = await import('../../../../../src/runtime/galaxy/words.mjs');
  const names = ['회사 PC', '집 맥북', '집 맥북 💻', '내 폰', 'Mac', 'MacBook', 'iPhone', 'Galaxy', 'server', 'Pixel', 'HTML', 'LG', 'PC 7', '서버2', '서울', '🚀', '', 'game', 'Chromebook', 'blog', 'ThinkPad'];
  for (const name of names) {
    for (const pair of ['이가', '을를', '은는', '와과', '으로']) assert.equal(josa(name, pair), words.josa(name, pair), `${name} ${pair}`);
  }
  const day = 86_400_000;
  for (const offset of [0, 30_000, 47 * 60_000, 5 * 3_600_000, 3 * day, 20 * day, 100 * day, 800 * day]) {
    assert.equal(ago(NOW - offset, NOW), words.ago(NOW - offset, NOW), String(offset));
  }
});

test('long spans read in weeks, months and years', () => {
  const day = 86_400_000;
  assert.equal(ago(NOW - 20 * day, NOW), '2주 전');
  assert.equal(ago(NOW - 100 * day, NOW), '3개월 전');
  assert.equal(ago(NOW - 400 * day, NOW), '1년 전');
  assert.equal(since(NOW - 5 * day, NOW), '5일째');
  assert.equal(since(NOW - 15 * day, NOW), '2주째');
});

test('a reserved seat says how long it still waits', () => {
  const reserved = view({
    seat: { ...view().seat, handoffTo: 'work', history: [{ star: 'me', name: '집 맥북', from: NOW - 60_000, to: NOW - 2 * 60_000 }] },
    reservedUntil: NOW + 8 * 60_000,
  });
  const verdict = cosmosVerdict(reserved, NOW);
  assert.match(verdict.title, /회사 PC를 위해 자리를 비워 두었어요/);
  assert.match(verdict.detail, /^8분 뒤에도/);
  // Once the hold is over the seat simply reads as free.
  assert.match(cosmosVerdict({ ...reserved, reservedUntil: NOW - 1 }, NOW).title, /아무도 작업하지 않아요/);
});

test('stacked error prefixes are all stripped', () => {
  assert.equal(cosmosErrorText(new Error("Error invoking remote method 'cosmos:sun': Error: TypeError: 주소가 이상해요")), '주소가 이상해요');
});
