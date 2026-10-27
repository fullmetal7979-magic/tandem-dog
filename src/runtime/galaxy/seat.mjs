// 조종석 (seat): the baton of the relay. One planet has one session, and only
// one star sits in its seat at a time; nobody else may work on that planet
// until the seat is handed over (교대) or left (달).
//
// The seat is planets/<slug>/seat.json in the Galaxy. Every change goes
// through transact(), so two stars racing for an empty seat cannot both win:
// the second push is rejected, the mutation re-runs, and it sees the winner.
// Liveness comes from beat refs, not from the seat file.
import { GalaxyError, galaxyDir, galaxyReader, readGalaxyJson, transact, writeGalaxyJson } from './galaxy-repo.mjs';
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

/**
 * Last sign of life of the holder: its beat when newer, else when it sat down.
 * A phone has no beat of its own; it lives as long as the PC it drives (host).
 */
export function holderLastSeen(seat, beats = {}) {
  if (!seat?.holder) return 0;
  const beat = beats[seat.holder.star];
  const hostBeat = seat.holder.host ? beats[seat.holder.host] : null;
  return Math.max(Number(seat.holder.since) || 0, Number(beat?.at) || 0, Number(hostBeat?.at) || 0);
}

/**
 * Is the PC a phone holder drives (holder.host) still alive? Its beat only:
 * the phone's sit time says nothing about the PC (a lid closed right after the
 * phone sat down must not pin the phone to it for half an hour).
 */
export function hostAlive(seat, beats = {}, now = Date.now(), staleMs = SEAT_STALE_MS) {
  const hostId = seat?.holder?.host;
  if (!hostId) return false;
  const seen = Number(beats?.[hostId]?.at) || 0;
  return seen > 0 && now - seen <= staleMs;
}

/**
 * 'empty' | 'mine' | 'occupied' | 'stale' | 'remote' for `starId`.
 * 'remote': a phone sits in the seat through THIS star (the PC it drives).
 */
export function seatState(seat, starId, { beats = {}, now = Date.now(), staleMs = SEAT_STALE_MS } = {}) {
  if (!seat?.holder) return 'empty';
  if (seat.holder.star === starId) return 'mine';
  if (seat.holder.host && seat.holder.host === starId) return 'remote';
  return now - holderLastSeen(seat, beats) > staleMs ? 'stale' : 'occupied';
}

/**
 * A PC and the phone driving it share one working copy, so the baton passes
 * between them directly (폰으로 이어하기 / 이어받기) without a 내려놓기. Anyone else
 * still has to ask.
 */
export function sameMachine(holder, star, host = null) {
  if (!holder) return false;
  if (holder.host && holder.host === star.id) return true;
  return Boolean(host && (holder.star === host || holder.host === host));
}

// ------------------------------------------------------------------ pure transitions

/**
 * Sit down. Refuses an occupied seat unless `force` and the holder is stale,
 * or the holder is on this same machine (a PC and the phone driving it).
 */
export function sitTransition(seat, star, { beats, now = Date.now(), force = false, via = 'local', host = null } = {}) {
  const state = seatState(seat, star.id, { beats, now });
  if (state === 'mine') {
    // A phone picks its seat up again through ANOTHER PC: the seat moves to
    // that machine (its gate and beat now carry it), recorded like a handover.
    const from = seat.holder.host ?? null;
    const to = host ?? null;
    if (from === to) return { seat, changed: false, state };
    // The PC the phone drove still holds that phone's uncommitted work. While
    // it is alive the move is refused, even with `force` (its user has to
    // 내려놓기 there first); a PC that stopped answering may be left behind,
    // but only on purpose (`force`), like any stale holder.
    if (from) {
      const hostInfo = { id: from, name: beats?.[from]?.name || null };
      if (hostAlive(seat, beats, now)) return { seat, changed: false, state, refused: 'host_active', host: hostInfo };
      if (!force) return { seat, changed: false, state, refused: 'host_stale', host: hostInfo };
    }
    const history = [...seat.history];
    const open = history.findLastIndex((entry) => entry.star === star.id && !entry.to);
    if (open >= 0) history[open] = { ...history[open], to: now, memo: history[open].memo || '다른 기기로 옮겨 이어감' };
    history.push({ ...who(star), from: now, to: null, via, ...(to ? { host: to } : {}) });
    return {
      seat: {
        ...seat,
        holder: { ...seat.holder, ...who(star), since: now, via, host: to },
        requests: seat.requests.filter((request) => request.star !== star.id),
        handoffTo: null,
        history: history.slice(-HISTORY_LIMIT),
      },
      changed: true,
      state,
      took: null,
      passed: null,
      moved: { from, to },
    };
  }
  const sibling = sameMachine(seat.holder, star, host);
  if (state === 'occupied' && !sibling) {
    return { seat, changed: false, state, refused: 'occupied' };
  }
  if (state === 'stale' && !force && !sibling) return { seat, changed: false, state, refused: 'stale' };
  if (seat.handoffTo && seat.handoffTo !== star.id && state === 'empty' && !force) {
    // A seat left FOR someone else waits for them a while before anyone may sit.
    const left = seat.history.at(-1)?.to || 0;
    if (now - left < 10 * 60_000) return { seat, changed: false, state, refused: 'reserved' };
  }
  const history = [...seat.history];
  if (seat.holder) {
    const open = history.findLastIndex((entry) => entry.star === seat.holder.star && !entry.to);
    if (open >= 0) {
      history[open] = sibling
        ? { ...history[open], to: now, memo: history[open].memo || (star.kind === 'phone' ? '폰으로 이어감' : '이 기기로 이어받음') }
        : { ...history[open], to: now, memo: history[open].memo || '응답이 없어 넘겨받음', forced: true };
    }
  }
  history.push({ ...who(star), from: now, to: null, via, ...(host ? { host } : {}) });
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
    took: state === 'stale' && !sibling ? seat.holder : null,
    passed: sibling ? seat.holder : null,
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

/** The PC a phone drove stopped answering: the phone may move with force. */
export function hostStaleMessage(host) {
  const name = host?.name || '이전 기기';
  return `${name}이(가) 오래 응답이 없어요. ${name}에 남은 작업은 그대로 두고 이 기기에서 강제로 이어받을 수 있어요.`;
}

/** Why a phone may not move to another PC while the one it drove is alive. */
export function hostActiveMessage(host) {
  const name = host?.name || '이전 기기';
  return `${name}에 아직 작업이 남아 있어요. ${name}에서 먼저 내려놓기를 한 뒤 이 기기에서 이어받아 주세요.`;
}

/**
 * The error code of a refused sit. A stale host is reported as `seat_stale`
 * (with canForce) so every caller that offers "강제로 이어받기" for a stale
 * holder offers it here too.
 */
export function seatRefusal(refused, message) {
  return [refused === 'host_stale' ? 'seat_stale' : `seat_${refused}`, message];
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
  // Out of the object store, not the working copy: a transaction may be writing it.
  return normalizeSeat(await (await galaxyReader(dir)).json(seatPath(planetId)), planetId);
}

export async function sit(planetId, star, options = {}) {
  const result = await mutateSeat(
    planetId,
    (seat) => sitTransition(seat, star, options),
    (r) => `seat: ${star.name} ${r.took ? 'took over' : r.moved ? 'moved' : 'sat down at'} ${planetId}`,
    options
  );
  if (result.refused) {
    const holder = result.seat.holder;
    const messages = {
      occupied: `${holder?.name || '다른 기기'}이(가) 작업 중이에요. 넘겨 달라고 요청해 주세요.`,
      stale: `${holder?.name || '다른 기기'}이(가) 오래 응답이 없어요. 강제로 넘겨받을 수 있어요.`,
      reserved: '다른 기기를 위해 작업 자리를 비워 두었어요.',
      host_active: hostActiveMessage(result.host),
      host_stale: hostStaleMessage(result.host),
    };
    throw new GalaxyError(...seatRefusal(result.refused, messages[result.refused]), { seat: result.seat, host: result.host || null, canForce: result.refused === 'host_stale' || result.refused === 'stale' });
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
