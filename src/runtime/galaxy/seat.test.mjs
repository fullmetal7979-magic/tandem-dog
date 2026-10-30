import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectGalaxy, publishBeat, pullGalaxy, readBeats } from './galaxy-repo.mjs';
import {
  emptySeat,
  hostActiveMessage,
  hostAlive,
  leave,
  leaveTransition,
  readSeat,
  requestSeat,
  requestTransition,
  hostStaleMessage,
  seatRefusal,
  seatState,
  sit,
  sitTransition,
} from './seat.mjs';

const PLANET = 'github.com/me/app';
const star = (id, name) => ({ id, name, kind: 'pc', color: '#fbbf24' });
const home = star('11111111-1111-4111-8111-111111111111', '집 맥북');
const work = star('22222222-2222-4222-8222-222222222222', '회사 PC');

test('pure transitions: sit, refuse, request, leave for the requester, then the requester sits', () => {
  let seat = emptySeat(PLANET);
  let result = sitTransition(seat, home, { now: 1_000 });
  assert.equal(result.changed, true);
  seat = result.seat;
  assert.equal(seatState(seat, home.id, { now: 2_000 }), 'mine');
  assert.equal(seatState(seat, work.id, { now: 2_000 }), 'occupied');

  result = sitTransition(seat, work, { now: 2_000 });
  assert.equal(result.refused, 'occupied');

  seat = requestTransition(seat, work, { now: 3_000, note: '회의실에서 이어서' }).seat;
  assert.deepEqual(
    seat.requests.map((request) => request.name),
    ['회사 PC']
  );

  result = leaveTransition(seat, home, { now: 4_000, note: '로그인 화면 마무리' });
  seat = result.seat;
  assert.equal(seat.holder, null);
  assert.equal(seat.handoffTo, work.id, 'leaving hands the seat to the first requester');
  assert.equal(seat.history.at(-1).memo, '로그인 화면 마무리');

  // Someone else cannot jump the queue right after the hand-off…
  const third = star('33333333-3333-4333-8333-333333333333', '노트북');
  assert.equal(sitTransition(seat, third, { now: 5_000 }).refused, 'reserved');
  // …but the requester can.
  seat = sitTransition(seat, work, { now: 5_000 }).seat;
  assert.equal(seat.holder.name, '회사 PC');
  assert.deepEqual(seat.requests, []);
});

test('a silent holder turns stale and can only be replaced on purpose', () => {
  const seat = sitTransition(emptySeat(PLANET), home, { now: 0 }).seat;
  const later = 31 * 60_000;
  assert.equal(seatState(seat, work.id, { now: later }), 'stale');
  assert.equal(sitTransition(seat, work, { now: later }).refused, 'stale');
  // A fresh beat keeps the holder alive.
  assert.equal(seatState(seat, work.id, { now: later, beats: { [home.id]: { at: later - 60_000 } } }), 'occupied');
  const forced = sitTransition(seat, work, { now: later, force: true });
  assert.equal(forced.seat.holder.name, '회사 PC');
  assert.equal(forced.took.name, '집 맥북');
  assert.equal(forced.seat.history.at(-2).forced, true);
});

test('a phone that picks its seat up through another PC moves the seat to that PC', () => {
  const phone = { id: 'browser-1', name: '내 폰', kind: 'phone', color: '#fff' };
  let seat = sitTransition(emptySeat(PLANET), phone, { now: 1_000, via: 'relay', host: home.id }).seat;
  assert.equal(seatState(seat, home.id, { now: 2_000 }), 'remote');
  assert.equal(seatState(seat, work.id, { now: 2_000 }), 'occupied');

  // Same PC again: nothing changes.
  assert.equal(sitTransition(seat, phone, { now: 2_000, via: 'relay', host: home.id }).changed, false);

  // Through 회사 PC once 집 맥북 stopped answering: leaving 집 맥북's work
  // behind takes an explicit force, then the seat follows so 회사 PC's gate
  // accepts the phone.
  const later = 1_000 + 31 * 60_000;
  const asked = sitTransition(seat, phone, { now: later, via: 'relay', host: work.id });
  assert.equal(asked.refused, 'host_stale');
  assert.equal(asked.changed, false);
  const moved = sitTransition(seat, phone, { now: later, via: 'relay', host: work.id, force: true });
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.moved, { from: home.id, to: work.id });
  assert.equal(moved.took, null);
  seat = moved.seat;
  assert.equal(seat.holder.host, work.id);
  assert.equal(seat.holder.since, later);
  assert.equal(seatState(seat, work.id, { now: later + 1_000 }), 'remote');
  assert.equal(seatState(seat, home.id, { now: later + 1_000 }), 'occupied');
  assert.deepEqual(
    seat.history.map((entry) => [entry.host, entry.to, entry.memo ?? null]),
    [
      [home.id, later, '다른 기기로 옮겨 이어감'],
      [work.id, null, null],
    ]
  );
});

test('a phone cannot move to another PC while the PC it drove is alive (내려놓기 there first)', () => {
  const phone = { id: 'browser-2', name: '내 폰', kind: 'phone', color: '#fff' };
  const seat = sitTransition(emptySeat(PLANET), phone, { now: 1_000, via: 'relay', host: home.id }).seat;
  const later = 40 * 60_000;
  // 집 맥북 keeps beating: the phone's work is still there, so the move is refused.
  const beats = { [home.id]: { at: later - 60_000, name: '집 맥북' } };
  const refused = sitTransition(seat, phone, { now: later, via: 'relay', host: work.id, beats });
  assert.equal(refused.changed, false);
  assert.equal(refused.refused, 'host_active');
  assert.deepEqual(refused.host, { id: home.id, name: '집 맥북' });
  assert.equal(refused.seat.holder.host, home.id);
  assert.equal(hostAlive(seat, beats, later), true);
  // Even `force` does not leave a live PC's work behind.
  assert.equal(sitTransition(seat, phone, { now: later, via: 'relay', host: work.id, beats, force: true }).refused, 'host_active');
  // Liveness is the beat only: the phone's own sit time says nothing about the
  // PC (a lid closed right after the phone sat down must not pin it there).
  assert.equal(hostAlive(seat, {}, 2_000), false);
  assert.equal(sitTransition(seat, phone, { now: 2_000, via: 'relay', host: work.id }).refused, 'host_stale');
  // A stale host is left behind only on purpose (force), never by default.
  const stale = { [home.id]: { at: later - 31 * 60_000 } };
  assert.equal(hostAlive(seat, stale, later), false);
  assert.equal(sitTransition(seat, phone, { now: later, via: 'relay', host: work.id, beats: stale }).refused, 'host_stale');
  assert.deepEqual(sitTransition(seat, phone, { now: later, via: 'relay', host: work.id, beats: stale, force: true }).moved, { from: home.id, to: work.id });
  // A stale host surfaces as seat_stale (with force offered) like any silent holder.
  assert.deepEqual(seatRefusal('host_stale', 'x'), ['seat_stale', 'x']);
  assert.deepEqual(seatRefusal('host_active', 'x'), ['seat_host_active', 'x']);
  assert.match(hostStaleMessage({ name: '집 맥북' }), /집 맥북에 남은 작업은 그대로 두고/);

  const message = hostActiveMessage({ id: home.id, name: '집 맥북' });
  assert.match(message, /집 맥북에서 먼저 내려놓기/);
  assert.match(message, /이어받아/);
});

function galaxyFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-galaxy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  return { root, remote, homeDir: join(root, 'home', 'galaxy'), workDir: join(root, 'work', 'galaxy') };
}

test('two stars racing for an empty seat over a real git remote: exactly one wins', async (t) => {
  const f = galaxyFixture(t);
  await connectGalaxy({ dir: f.homeDir, remoteUrl: f.remote });
  await connectGalaxy({ dir: f.workDir, remoteUrl: f.remote });

  const outcomes = await Promise.allSettled([sit(PLANET, home, { dir: f.homeDir }), sit(PLANET, work, { dir: f.workDir })]);
  const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const lost = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, 'seat_occupied');

  await pullGalaxy(f.homeDir);
  await pullGalaxy(f.workDir);
  const fromHome = await readSeat(PLANET, { dir: f.homeDir });
  const fromWork = await readSeat(PLANET, { dir: f.workDir });
  assert.equal(fromHome.holder.star, fromWork.holder.star, 'both stars agree on who holds the seat');
});

test('relay over git: request, hand-off and beats travel between stars', async (t) => {
  const f = galaxyFixture(t);
  await connectGalaxy({ dir: f.homeDir, remoteUrl: f.remote });
  await connectGalaxy({ dir: f.workDir, remoteUrl: f.remote });

  await sit(PLANET, home, { dir: f.homeDir });
  await publishBeat(home.id, { planets: [PLANET] }, { dir: f.homeDir });
  await assert.rejects(sit(PLANET, work, { dir: f.workDir }), (error) => error.code === 'seat_occupied');
  await requestSeat(PLANET, work, { dir: f.workDir, note: '이제 회사에서 할게요' });

  await pullGalaxy(f.homeDir);
  const seen = await readSeat(PLANET, { dir: f.homeDir });
  assert.equal(seen.requests[0].name, '회사 PC');
  assert.ok((await readBeats(f.homeDir))[home.id]);

  const left = await leave(PLANET, home, { dir: f.homeDir, note: 'API 연결까지 완료' });
  assert.equal(left.handoffTo, work.id);
  const sat = await sit(PLANET, work, { dir: f.workDir });
  assert.equal(sat.seat.holder.name, '회사 PC');
  const history = sat.seat.history.map((entry) => [entry.name, Boolean(entry.to)]);
  assert.deepEqual(history, [
    ['집 맥북', true],
    ['회사 PC', false],
  ]);
});

test('a reserved seat names who it waits for and for how long', async () => {
  const { HANDOFF_HOLD_MS, reservedUntil, seatRefusalText } = await import('./seat.mjs');
  const seat = {
    ...emptySeat('github.com/me/app'),
    handoffTo: 'star-b',
    requests: [{ star: 'star-b', name: '집 맥북', at: 900 }],
    history: [{ star: 'star-a', name: '회사 PC', from: 0, to: 1_000 }],
  };
  assert.equal(reservedUntil(seat), 1_000 + HANDOFF_HOLD_MS);
  assert.equal(reservedUntil({ ...seat, handoffTo: null }), 0);
  const text = seatRefusalText('reserved', { seat, now: 1_000 + 3 * 60_000 });
  assert.match(text, /^집 맥북을 위해 비워 둔 작업 자리예요\. 7분 뒤에는 누구나 이어받을 수 있어요\.$/);
  assert.match(seatRefusalText('occupied', { seat: { holder: { star: 'x', name: '회사 PC' } } }), /^회사 PC가 작업 중이에요/);
  assert.match(seatRefusalText('stale', { seat: { holder: { star: 'x', name: '내 폰' } } }), /^내 폰이 오래 응답이 없어요/);
});

test('asking again with a new note replaces the note, not the place in line', async () => {
  const { requestTransition } = await import('./seat.mjs');
  const first = { id: 'star-b', name: '집 맥북', kind: 'mac', color: '#fff' };
  const second = { id: 'star-c', name: '폰', kind: 'phone', color: '#000' };
  let seat = { ...emptySeat('p'), holder: { star: 'star-a', name: 'A', since: 0 } };
  seat = requestTransition(seat, first, { now: 1, note: '회의 끝나고' }).seat;
  seat = requestTransition(seat, second, { now: 2 }).seat;
  assert.equal(requestTransition(seat, first, { now: 3, note: '회의 끝나고' }).changed, false);
  assert.equal(requestTransition(seat, first, { now: 3 }).changed, false, 'an empty note keeps the old one');
  const updated = requestTransition(seat, first, { now: 4, note: '지금 바로요' });
  assert.equal(updated.changed, true);
  assert.deepEqual(updated.seat.requests.map((request) => [request.star, request.note]), [['star-b', '지금 바로요'], ['star-c', '']]);
});

test('reading a seat drops malformed turns and requests nobody answered for half a day', async () => {
  const { REQUEST_TTL_MS, normalizeSeat } = await import('./seat.mjs');
  const now = 10 * REQUEST_TTL_MS;
  const raw = {
    holder: { star: 'star-a', name: 'A', since: now - 1 },
    requests: [{ star: 'old', at: now - REQUEST_TTL_MS - 1 }, { star: 'new', at: now - 60_000 }, { name: 'nobody' }],
    history: [{ star: 'star-a', from: 1, to: null }, { star: 7, from: 1 }, null, { star: 'x', from: 'soon' }, { star: 'y', from: 2, to: 3 }],
  };
  const seat = normalizeSeat(raw, 'p', { now });
  assert.deepEqual(seat.requests.map((request) => request.star), ['new']);
  assert.deepEqual(seat.history.map((turn) => turn.star), ['star-a', 'y']);
  assert.equal(normalizeSeat(raw, 'p').requests.length, 2, 'without a clock nothing expires');
});
