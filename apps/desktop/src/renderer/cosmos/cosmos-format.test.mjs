import assert from 'node:assert/strict';
import test from 'node:test';
import { ago, cosmosVerdict, endsWithBatchim, josa, since } from './cosmos-format.ts';

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
  assert.equal(asked.title, '회사 PC가 교대를 원해요');

  const locked = cosmosVerdict(
    view({ state: 'occupied', seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW - 3_600_000 } } }),
    NOW
  );
  assert.equal(locked.level, 'warn');
  assert.equal(locked.action, 'request');
  assert.match(locked.title, /회사 PC가 작업 중이에요 · 1시간째/);

  const stale = cosmosVerdict(
    view({ state: 'stale', holderLastSeen: NOW - 2 * 3_600_000, seat: { ...view().seat, holder: { star: 'work', name: '회사 PC', kind: 'pc', since: NOW - 3 * 3_600_000 } } }),
    NOW
  );
  assert.equal(stale.level, 'bad');
  assert.equal(stale.action, 'force');

  const waiting = cosmosVerdict(view({ seat: { ...view().seat, handoffTo: 'me', history: [{ star: 'work', name: '회사 PC', kind: 'pc', from: NOW - 7_200_000, to: NOW - 60_000, memo: 'API 완료' }] } }), NOW);
  assert.equal(waiting.level, 'ok');
  assert.match(waiting.detail, /회사 PC가 1분 전 내렸어요 — “API 완료”/);
});
