// One shared view of the Galaxy per project, read by every COSMOS surface
// (titlebar seat badge, home, Galaxy screen, seat lock) so they never
// disagree and never poll twice.
//
// Freshness: a project somebody looks at refreshes every minute and on window
// focus (the service throttles network fetches on its own). The first read of
// a project answers from the last pull at once (no network); the Galaxy fetch
// follows in the background and updates the view when it lands. Seat-bound
// controls wait for that first answer at most SEAT_WAIT_MS. While this star
// holds a seat it sends a heartbeat every five minutes, which is what keeps
// other stars from seeing it as "응답 없음".
//
// Heartbeat policy: it follows the SEAT, not window visibility. The app lives
// on in the tray when its window is hidden (desktop-tray.ts), and that PC is
// still the one holding the seat, so beating must continue or other stars would
// wrongly show it as "응답 없음". Hidden timers are throttled by Chromium, so a
// beat is also sent as soon as the window becomes visible again after a gap.
// Every beat is fire-and-forget: errors are swallowed (the next tick retries)
// and beats never overlap.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type {
  CosmosMoonResult,
  CosmosOverview,
  CosmosRefusal,
  CosmosStarKind,
  CosmosSunResult,
} from '../../shared/contract-cosmos';
import { isCosmosRefusal } from '../../shared/contract-cosmos';
import { cosmosErrorText, josa } from './cosmos-format';

export type CosmosBusy = 'sun' | 'moon' | 'request' | 'withdraw' | 'setup' | 'star' | 'continue' | null;

export interface CosmosEntry {
  view: CosmosOverview | null;
  /** A forced refresh (↻, after an action) is running. Background polls stay quiet. */
  loading: boolean;
  /** The last overview read failed; the next good read clears it. */
  pollError: string;
  /** The last seat action failed; it stays until dismissed or the next action, polls never cover it. */
  actionError: string;
  busy: CosmosBusy;
  refusal: CosmosRefusal | null;
  lastSun: CosmosSunResult | null;
  lastMoon: CosmosMoonResult | null;
  /** The first read took longer than SEAT_WAIT_MS: seat-bound controls stop waiting for it. */
  waitedOut?: boolean;
}

const POLL_MS = 60_000;
const HEARTBEAT_MS = 5 * 60_000;
/** A surface that (re)appears with older data than this asks again. */
const STALE_MS = 15_000;
/** How long the "확인 중" lock may hold a surface before it falls back to what is known locally. */
export const SEAT_WAIT_MS = 2_000;
const EMPTY: CosmosEntry = {
  view: null,
  loading: false,
  pollError: '',
  actionError: '',
  busy: null,
  refusal: null,
  lastSun: null,
  lastMoon: null,
};

const entries = new Map<string, CosmosEntry>();
const listeners = new Map<string, Set<() => void>>();
const watchers = new Map<string, number>();
/** When each key's overview was last read successfully (kept apart so a quiet poll re-renders nothing). */
const checkedAt = new Map<string, number>();
/** One background read per key at a time; a forced read always goes through. */
const inFlight = new Map<string, Promise<void>>();
/** The SEAT_WAIT_MS cap of each key's first read. */
const waitTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** The last 내려놓기 request per key, so 그래도 내려놓기 repeats it with force. */
const leaveRequests = new Map<string, { note: string; handoffTo: string | null; sessionId: string | null }>();
let pollTimer: number | null = null;
let heartbeatTimer: number | null = null;
let beating = false;
let lastBeatAt = 0;
/** Watched project keys, most recently watched last: the target of keyboard / slash COSMOS actions. */
const watchOrder: string[] = [];

const keyOf = (projectPath: string | null | undefined) => String(projectPath || '');
const api = () => (typeof window === 'undefined' ? undefined : window.mixdogDesktop);

function get(key: string): CosmosEntry {
  return entries.get(key) ?? EMPTY;
}

function set(key: string, patch: Partial<CosmosEntry>): void {
  entries.set(key, { ...get(key), ...patch });
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  let group = listeners.get(key);
  if (!group) listeners.set(key, (group = new Set()));
  group.add(listener);
  return () => group?.delete(listener);
}

function sameView(a: CosmosOverview | null, b: CosmosOverview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function refreshCosmos(projectPath: string | null | undefined, { force = false } = {}): Promise<void> {
  const key = keyOf(projectPath);
  const read = api()?.cosmosOverview;
  if (!read) return Promise.resolve();
  const running = inFlight.get(key);
  if (running && !force) return running;
  if (force) set(key, { loading: true });
  const first = !force && !get(key).view && !checkedAt.has(key);
  if (first) capSeatWait(key);
  const apply = (view: CosmosOverview) => {
    checkedAt.set(key, Date.now());
    const before = get(key);
    const changed = !sameView(before.view, view);
    // An unchanged answer to a background poll touches nothing on screen.
    if (changed || before.pollError || (force && before.loading)) {
      set(key, { ...(changed ? { view } : {}), pollError: '', ...(force ? { loading: false } : {}) });
    }
    syncHeartbeat();
  };
  const task = (async () => {
    try {
      if (first) {
        // Local state first: the seat is known without waiting on the network.
        try {
          apply(await read(key || null, { fetch: false }));
        } catch {
          /* the full read below reports the failure */
        }
      }
      apply(await read(key || null, { force }));
    } catch (error) {
      set(key, { pollError: cosmosErrorText(error), ...(force ? { loading: false } : {}) });
    }
  })();
  if (!force) {
    inFlight.set(key, task);
    void task.finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });
  }
  return task;
}

/** After SEAT_WAIT_MS without a first answer, seat-bound surfaces stop holding (see cosmosSeatUnknown). */
function capSeatWait(key: string): void {
  if (typeof window === 'undefined' || waitTimers.has(key)) return;
  waitTimers.set(
    key,
    setTimeout(() => {
      waitTimers.delete(key);
      if (!get(key).view) set(key, { waitedOut: true });
    }, SEAT_WAIT_MS)
  );
}

function startPolling(): void {
  if (pollTimer !== null || typeof window === 'undefined') return;
  pollTimer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const key of watchers.keys()) void refreshCosmos(key);
  }, POLL_MS);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener(COSMOS_SEAT_ACTION_EVENT, onSeatAction);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShown);
}

function stopPolling(): void {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('online', onOnline);
  window.removeEventListener(COSMOS_SEAT_ACTION_EVENT, onSeatAction);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShown);
}

function isStale(key: string): boolean {
  return Date.now() - (checkedAt.get(key) ?? 0) > STALE_MS;
}

function onFocus(): void {
  for (const key of watchers.keys()) if (isStale(key)) void refreshCosmos(key);
}

/**
 * The window comes back from the tray or another desktop without taking focus
 * (polls skip hidden windows): what it shows may be minutes old, so ask again.
 */
function onShown(): void {
  if (document.visibilityState === 'visible') onFocus();
}

/**
 * The network is back: every watched view was read while offline, and a held
 * seat missed its beats. Refresh at once instead of waiting for the next poll.
 */
function onOnline(): void {
  for (const key of watchers.keys()) void refreshCosmos(key);
  if (seatedPlanets().length) beat();
}

/**
 * Planets this star is seated at, across every watched project — including a
 * seat a phone holds through this PC ('remote'): the phone's seat lives on this
 * machine's beat.
 */
function seatedPlanets(): string[] {
  const planets = new Set<string>();
  for (const entry of entries.values()) {
    const state = entry.view?.state;
    if ((state === 'mine' || state === 'remote') && entry.view?.planet?.id) planets.add(entry.view.planet.id);
  }
  return [...planets];
}

function beat(): void {
  if (beating) return;
  const current = seatedPlanets();
  const send = api()?.cosmosHeartbeat;
  if (!current.length || !send) return;
  beating = true;
  lastBeatAt = Date.now();
  try {
    Promise.resolve(send(current))
      .catch(() => undefined)
      .finally(() => {
        beating = false;
      });
  } catch {
    beating = false;
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible' && Date.now() - lastBeatAt > HEARTBEAT_MS) beat();
}

function syncHeartbeat(): void {
  if (typeof window === 'undefined') return;
  const planets = seatedPlanets();
  if (!planets.length) {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    }
    heartbeatTimer = null;
    return;
  }
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(beat, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
}

function watch(key: string): () => void {
  watchers.set(key, (watchers.get(key) ?? 0) + 1);
  if (key) {
    const at = watchOrder.indexOf(key);
    if (at >= 0) watchOrder.splice(at, 1);
    watchOrder.push(key);
  }
  startPolling();
  // A surface that comes back (a dock tab reopened) shows the cached view at
  // once and asks again only when that view is getting old.
  if (isStale(key)) void refreshCosmos(key);
  return () => {
    const count = (watchers.get(key) ?? 1) - 1;
    if (count <= 0) {
      watchers.delete(key);
      const at = watchOrder.indexOf(key);
      if (at >= 0) watchOrder.splice(at, 1);
    } else watchers.set(key, count);
    if (!watchers.size) stopPolling();
  };
}

const noop = () => undefined;

/**
 * Live Galaxy state for a project ('' = no project open). `null` (or
 * undefined) watches nothing: a hidden surface passes it so it stops polling,
 * and gets an empty entry until it watches again.
 */
export function useCosmos(projectPath: string | null | undefined): CosmosEntry {
  const off = projectPath === null || projectPath === undefined;
  const key = keyOf(projectPath);
  useEffect(() => (off ? undefined : watch(key)), [key, off]);
  const listen = useCallback((listener: () => void) => (off ? noop : subscribe(key, listener)), [key, off]);
  const read = () => (off ? EMPTY : get(key));
  return useSyncExternalStore(listen, read, read);
}

/**
 * The open project's seat is not known yet (first read still running):
 * seat-bound controls wait, but at most SEAT_WAIT_MS. After that they fall
 * back to the last known view (none yet: treated as free), and the lock
 * returns only if the answer, when it lands, says another device holds it.
 */
export function cosmosSeatUnknown(entry: CosmosEntry, projectPath: string | null | undefined): boolean {
  return Boolean(projectPath) && !entry.view && !entry.pollError && !entry.waitedOut && Boolean(api()?.cosmosOverview);
}

/** Another device (or the phone driving this PC) holds the seat: this device must not edit. */
export function cosmosSeatHeldElsewhere(view: CosmosOverview | null): boolean {
  const state = view?.state;
  return state === 'occupied' || state === 'stale' || state === 'remote';
}

// ------------------------------------------------------------------ actions

async function run<T>(key: string, busy: Exclude<CosmosBusy, null>, call: () => Promise<T | CosmosRefusal | undefined> | undefined) {
  if (get(key).busy) return null;
  set(key, { busy, refusal: null, actionError: '' });
  try {
    const result = await call();
    if (result === undefined) throw new Error('이 화면에서는 은하수를 쓸 수 없어요.');
    if (isCosmosRefusal(result)) {
      set(key, { busy: null, refusal: result });
      await refreshCosmos(key, { force: true });
      return null;
    }
    set(key, { busy: null });
    await refreshCosmos(key, { force: true });
    return result as T;
  } catch (error) {
    set(key, { busy: null, actionError: cosmosErrorText(error) });
    return null;
  }
}

export async function cosmosSit(projectPath: string, { force = false } = {}) {
  const key = keyOf(projectPath);
  const result = await run<CosmosSunResult>(key, 'sun', () => api()?.cosmosSun?.(key, { force }));
  if (result) set(key, { lastSun: result, lastMoon: null });
  return result;
}

export async function cosmosLeave(
  projectPath: string,
  { note = '', handoffTo = null as string | null, sessionId = null as string | null, force = false } = {}
) {
  const key = keyOf(projectPath);
  leaveRequests.set(key, { note, handoffTo, sessionId });
  const result = await run<CosmosMoonResult>(key, 'moon', () =>
    api()?.cosmosMoon?.(key, force ? { note, handoffTo, sessionId, force: true } : { note, handoffTo, sessionId })
  );
  if (result) {
    leaveRequests.delete(key);
    set(key, { lastMoon: result, lastSun: null });
  }
  return result;
}

/**
 * 그래도 내려놓기: after a push_failed refusal, release the seat anyway with the
 * same note and hand-over. The unpushed work stays on this device.
 */
export function cosmosLeaveAnyway(projectPath: string) {
  const key = keyOf(projectPath);
  const last = leaveRequests.get(key) ?? { note: '', handoffTo: null, sessionId: null };
  return cosmosLeave(key, { ...last, force: true });
}

export function cosmosAskTurn(projectPath: string, note = '') {
  const key = keyOf(projectPath);
  return run(key, 'request', () => api()?.cosmosRequest?.(key, { note }));
}

export function cosmosWithdraw(projectPath: string) {
  const key = keyOf(projectPath);
  return run(key, 'withdraw', () => api()?.cosmosRequest?.(key, { withdraw: true }));
}

export async function cosmosSetupGalaxy(projectPath: string | null, request: { remoteUrl?: string | null; create?: boolean }) {
  const key = keyOf(projectPath);
  const result = await run(key, 'setup', () => api()?.cosmosSetupGalaxy?.(request));
  // Every watched project depends on the Galaxy; refresh them all.
  for (const watched of watchers.keys()) if (watched !== key) void refreshCosmos(watched, { force: true });
  return result;
}

export async function cosmosRenameStar(projectPath: string | null, request: { name?: string; kind?: CosmosStarKind; color?: string }) {
  const key = keyOf(projectPath);
  return run(key, 'star', async () => api()?.cosmosSetStar?.(request));
}

/** Open a new session carrying the planet's Galaxy conversation; announces it to the shell. */
export async function cosmosContinue(projectPath: string, conversationId: string | null = null) {
  const key = keyOf(projectPath);
  const result = await run<{ sessionId: string }>(key, 'continue', async () =>
    api()?.cosmosContinueConversation?.(key, conversationId)
  );
  if (result?.sessionId) window.dispatchEvent(new CustomEvent('cosmos:open-session', { detail: { sessionId: result.sessionId } }));
  return result;
}

// ------------------------------------------------- keyboard / slash entry

export const COSMOS_SEAT_ACTION_EVENT = 'cosmos:seat-action';
export type CosmosSeatShortcut = 'galaxy' | 'sit' | 'leave';

/** ⌘⇧S / ⌘⇧L / ⌘⇧D and /이어받기 /내려놓기 /은하수 all arrive here. */
export function dispatchCosmosSeatAction(action: CosmosSeatShortcut): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(COSMOS_SEAT_ACTION_EVENT, { detail: { action } }));
}

function openGalaxyScreen(): void {
  window.dispatchEvent(new CustomEvent('cosmos:open-galaxy'));
}

/**
 * Runs the seat action on the most recently watched project (the titlebar seat
 * badge watches the active project, so that is the one in front of the user).
 * Anything that is not a plain, safe move (someone else seated, no Galaxy yet)
 * opens the Galaxy screen, where the full explanation and note field live.
 */
async function onSeatAction(event: Event): Promise<void> {
  const action = (event as CustomEvent<{ action?: CosmosSeatShortcut }>).detail?.action;
  const key = watchOrder[watchOrder.length - 1];
  if (!key || !action) return;
  const view = get(key).view;
  if (action === 'galaxy' || !view) {
    openGalaxyScreen();
    return;
  }
  const state = view.state;
  const holder = view.seat?.holder?.name;
  let done: unknown = null;
  if (action === 'leave') {
    if (state === 'mine') {
      done = await cosmosLeave(key, { note: '' });
      // A refusal (push_failed and its 그래도 내려놓기 among them) is explained on the Galaxy screen.
      if (!done && get(key).refusal) openGalaxyScreen();
    } else openGalaxyScreen();
  } else if (state === 'empty' || (state === 'occupied' && view.here)) {
    done = await cosmosSit(key);
  } else if (state === 'stale') {
    if (window.confirm(`${josa(holder || '다른 기기', '이가')} 응답이 없어요. 작업 자리를 넘겨받을까요?\n그 기기에 남은 작업은 나중에 별도 브랜치로 보관돼요.`)) {
      done = await cosmosSit(key, { force: true });
    }
  } else if (state === 'remote') {
    if (window.confirm(`${josa(holder || '폰', '이가')} 작업 중이에요. 이 기기로 이어받을까요?\n폰은 잠기고, 폰에서 하던 작업은 이 기기에 그대로 있어요.`)) {
      done = await cosmosSit(key);
    }
  } else openGalaxyScreen(); // already seated, or someone else is: show where things stand
  // The outcome (최신 작업 요약 / 남긴 메모) is shown on the Galaxy screen.
  if (done) openGalaxyScreen();
}

export function clearCosmosNotice(projectPath: string | null | undefined): void {
  set(keyOf(projectPath), { refusal: null, actionError: '', lastSun: null, lastMoon: null });
}

/** Test seam: forget every cached entry. */
export function resetCosmosStore(): void {
  entries.clear();
  checkedAt.clear();
  inFlight.clear();
  for (const timer of waitTimers.values()) clearTimeout(timer);
  waitTimers.clear();
  leaveRequests.clear();
  stopPolling();
  if (heartbeatTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(heartbeatTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  heartbeatTimer = null;
  beating = false;
  watchOrder.length = 0;
}
