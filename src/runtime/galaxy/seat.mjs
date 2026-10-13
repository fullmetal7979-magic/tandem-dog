// 조종석 (seat): the baton of the relay. One planet has one session, and only
// one star sits in its seat at a time; nobody else may work on that planet
// until the seat is handed over (교대) or left (달).
//
// The seat is planets/<slug>/seat.json in the Galaxy. Every change goes
// through transact(), so two stars racing for an empty seat cannot both win:
// the second push is rejected, the mutation re-runs, and it sees the winner.
// Liveness comes from beat refs, not from the seat file.
import { GalaxyError, galaxyDir, readGalaxyJson, transact, writeGalaxyJson } from './galaxy-repo.mjs';
import { planetSlug } from './planet.mjs';

export const SEAT_STALE_MS = 30 * 60_000;
const HISTORY_LIMIT = 60;
const MEMO_LIMIT = 300;

export function seatPath(planetId) {
  return `planets/${planetSlug(planetId)}/seat.json`;
}

export function emptySeat(planetId) {
  return { v: 1, planet: planetId, holder: null, requests: [], handoffTo: null, history: [] };
}

export function normalizeSeat(raw, planetId) {
  const seat = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 1,
    planet: planetId,
    holder: seat.holder && seat.holder.star ? seat.holder : null,
    requests: Array.isArray(seat.requests) ? seat.requests.filter((r) => r?.star) : [],
    handoffTo: typeof seat.handoffTo === 'string' ? seat.handoffTo : null,
    history: Array.isArray(seat.history) ? seat.history.slice(-HISTORY_LIMIT) : [],
  };
}

const who = (star) => ({ star: star.id, name: star.name, kind: star.kind, color: star.color });
const memo = (value) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MEMO_LIMIT);

/** Last sign of life of the holder: its beat when newer, else when it sat down. */
export function holderLastSeen(seat, beats = {}) {
  if (!seat?.holder) return 0;
  const beat = beats[seat.holder.star];
  return Math.max(Number(seat.holder.since) || 0, Number(beat?.at) || 0);
}

/** 'empty' | 'mine' | 'occupied' | 'stale' for `starId`. */
export function seatState(seat, starId, { beats = {}, now = Date.now(), staleMs = SEAT_STALE_MS } = {}) {
  if (!seat?.holder) return 'empty';
  if (seat.holder.star === starId) return 'mine';
  return now - holderLastSeen(seat, beats) > staleMs ? 'stale' : 'occupied';
}

// ------------------------------------------------------------------ pure transitions

/** Sit down. Refuses an occupied seat unless `force` and the holder is stale. */
export function sitTransition(seat, star, { beats, now = Date.now(), force = false, via = 'local', host = null } = {}) {
  const state = seatState(seat, star.id, { beats, now });
  if (state === 'mine') return { seat, changed: false, state };
  if (state === 'occupied') {
    return { seat, changed: false, state, refused: 'occupied' };
  }
  if (state === 'stale' && !force) return { seat, changed: false, state, refused: 'stale' };
  if (seat.handoffTo && seat.handoffTo !== star.id && state === 'empty' && !force) {
    // A seat left FOR someone else waits for them a while before anyone may sit.
    const left = seat.history.at(-1)?.to || 0;
    if (now - left < 10 * 60_000) return { seat, changed: false, state, refused: 'reserved' };
  }
  const history = [...seat.history];
  if (seat.holder) {
    const open = history.findLastIndex((entry) => entry.star === seat.holder.star && !entry.to);
    if (open >= 0) history[open] = { ...history[open], to: now, memo: history[open].memo || '응답이 없어 넘겨받음', forced: true };
  }
  history.push({ ...who(star), from: now, to: null, via });
  return {
    seat: {
      ...seat,
      holder: { ...who(star), since: now, via, host },
      requests: seat.requests.filter((request) => request.star !== star.id),
      handoffTo: null,
      history: history.slice(-HISTORY_LIMIT),
    },
    changed: true,
    state,
    took: state === 'stale' ? seat.holder : null,
  };
}

/** Get up (달). `handoffTo` reserves the seat for the star that asked. */
export function leaveTransition(seat, star, { now = Date.now(), note = '', handoffTo = null } = {}) {
  if (!seat.holder || seat.holder.star !== star.id) return { seat, changed: false };
  const history = [...seat.history];
  const open = history.findLastIndex((entry) => entry.star === star.id && !entry.to);
  if (open >= 0) history[open] = { ...history[open], to: now, memo: memo(note) };
  const target = handoffTo || seat.requests[0]?.star || null;
  return {
    seat: { ...seat, holder: null, handoffTo: target, history: history.slice(-HISTORY_LIMIT) },
    changed: true,
    handoffTo: target,
  };
}

/** Ask for the seat (교대 요청). Idempotent per star. */
export function requestTransition(seat, star, { now = Date.now(), note = '' } = {}) {
  if (seat.holder?.star === star.id) return { seat, changed: false };
  if (seat.requests.some((request) => request.star === star.id)) return { seat, changed: false };
  return {
    seat: { ...seat, requests: [...seat.requests, { ...who(star), at: now, note: memo(note) }].slice(-8) },
    changed: true,
  };
}

export function withdrawTransition(seat, star) {
  if (!seat.requests.some((request) => request.star === star.id)) return { seat, changed: false };
  return { seat: { ...seat, requests: seat.requests.filter((request) => request.star !== star.id) }, changed: true };
}

// ------------------------------------------------------------------ io

async function mutateSeat(planetId, transition, message, { dir } = {}) {
  return transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planetId)), planetId);
      const result = await transition(seat);
      if (!result.changed) return { value: result };
      await writeGalaxyJson(galaxy, seatPath(planetId), result.seat);
      return { value: result, message: typeof message === 'function' ? message(result) : message };
    },
    { dir }
  );
}

export async function readSeat(planetId, { dir = galaxyDir() } = {}) {
  return normalizeSeat(await readGalaxyJson(dir, seatPath(planetId)), planetId);
}

export async function sit(planetId, star, options = {}) {
  const result = await mutateSeat(
    planetId,
    (seat) => sitTransition(seat, star, options),
    (r) => `seat: ${star.name} ${r.took ? 'took over' : 'sat down at'} ${planetId}`,
    options
  );
  if (result.refused) {
    const holder = result.seat.holder;
    const messages = {
      occupied: `${holder?.name || '다른 별'}이(가) 조종 중이에요. 교대를 요청해 주세요.`,
      stale: `${holder?.name || '다른 별'}이(가) 오래 응답이 없어요. 강제로 넘겨받을 수 있어요.`,
      reserved: '다른 별을 위해 조종석이 예약되어 있어요.',
    };
    throw new GalaxyError(`seat_${result.refused}`, messages[result.refused], { seat: result.seat });
  }
  return result;
}

export function leave(planetId, star, options = {}) {
  return mutateSeat(planetId, (seat) => leaveTransition(seat, star, options), `seat: ${star.name} left ${planetId}`, options);
}

export function requestSeat(planetId, star, options = {}) {
  return mutateSeat(planetId, (seat) => requestTransition(seat, star, options), `seat: ${star.name} asked for ${planetId}`, options);
}

export function withdrawRequest(planetId, star, options = {}) {
  return mutateSeat(planetId, (seat) => withdrawTransition(seat, star), `seat: ${star.name} withdrew from ${planetId}`, options);
}
