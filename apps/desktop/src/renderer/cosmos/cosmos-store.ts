// One shared view of the Galaxy per project, read by every COSMOS surface
// (titlebar seat badge, home, Galaxy screen, seat lock) so they never
// disagree and never poll twice.
//
// Freshness: a project somebody looks at refreshes every minute and on window
// focus (the service throttles network fetches on its own). While this star
// holds a seat it sends a heartbeat every five minutes, which is what keeps
// other stars from seeing it as "응답 없음".
import { useEffect, useSyncExternalStore } from 'react';
import type {
  CosmosMoonResult,
  CosmosOverview,
  CosmosRefusal,
  CosmosStarKind,
  CosmosSunResult,
} from '../../shared/contract-cosmos';
import { isCosmosRefusal } from '../../shared/contract-cosmos';

export type CosmosBusy = 'sun' | 'moon' | 'request' | 'withdraw' | 'setup' | 'star' | 'continue' | null;

export interface CosmosEntry {
  view: CosmosOverview | null;
  loading: boolean;
  error: string;
  busy: CosmosBusy;
  refusal: CosmosRefusal | null;
  lastSun: CosmosSunResult | null;
  lastMoon: CosmosMoonResult | null;
  /** Seat changed hands since the last look: drives the comet animation. */
  comet: { from: string | null; to: string | null; at: number } | null;
  loadedAt: number;
}

const POLL_MS = 60_000;
const HEARTBEAT_MS = 5 * 60_000;
const EMPTY: CosmosEntry = {
  view: null,
  loading: false,
  error: '',
  busy: null,
  refusal: null,
  lastSun: null,
  lastMoon: null,
  comet: null,
  loadedAt: 0,
};

const entries = new Map<string, CosmosEntry>();
const listeners = new Map<string, Set<() => void>>();
const watchers = new Map<string, number>();
let pollTimer: number | null = null;
let heartbeatTimer: number | null = null;

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

function holderOf(view: CosmosOverview | null): string | null {
  return view?.seat?.holder?.star ?? null;
}

export async function refreshCosmos(projectPath: string | null | undefined, { force = false } = {}): Promise<void> {
  const key = keyOf(projectPath);
  const desktop = api();
  if (!desktop?.cosmosOverview) return;
  const before = get(key);
  set(key, { loading: true });
  try {
    const view = await desktop.cosmosOverview(key || null, { force });
    const previous = holderOf(before.view);
    const next = holderOf(view);
    const changed = before.view && before.view.planet?.id === view.planet?.id && previous !== next;
    set(key, {
      view,
      loading: false,
      error: '',
      loadedAt: Date.now(),
      comet: changed ? { from: previous, to: next, at: Date.now() } : before.comet,
    });
    syncHeartbeat();
  } catch (error) {
    set(key, { loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function startPolling(): void {
  if (pollTimer !== null || typeof window === 'undefined') return;
  pollTimer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const key of watchers.keys()) void refreshCosmos(key);
  }, POLL_MS);
  window.addEventListener('focus', onFocus);
}

function stopPolling(): void {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
  window.removeEventListener('focus', onFocus);
}

function onFocus(): void {
  for (const key of watchers.keys()) {
    if (Date.now() - get(key).loadedAt > 15_000) void refreshCosmos(key);
  }
}

/** Planets this star is seated at, across every watched project. */
function seatedPlanets(): string[] {
  const planets = new Set<string>();
  for (const entry of entries.values()) {
    if (entry.view?.state === 'mine' && entry.view.planet?.id) planets.add(entry.view.planet.id);
  }
  return [...planets];
}

function syncHeartbeat(): void {
  if (typeof window === 'undefined') return;
  const planets = seatedPlanets();
  if (!planets.length) {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    return;
  }
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(() => {
    const current = seatedPlanets();
    if (current.length) void api()?.cosmosHeartbeat?.(current);
  }, HEARTBEAT_MS);
}

function watch(key: string): () => void {
  watchers.set(key, (watchers.get(key) ?? 0) + 1);
  startPolling();
  if (!get(key).loadedAt && !get(key).loading) void refreshCosmos(key);
  return () => {
    const count = (watchers.get(key) ?? 1) - 1;
    if (count <= 0) watchers.delete(key);
    else watchers.set(key, count);
    if (!watchers.size) stopPolling();
  };
}

/** Live Galaxy state for a project ('' = no project open). */
export function useCosmos(projectPath: string | null | undefined): CosmosEntry {
  const key = keyOf(projectPath);
  useEffect(() => watch(key), [key]);
  return useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => get(key),
    () => get(key)
  );
}

// ------------------------------------------------------------------ actions

async function run<T>(key: string, busy: Exclude<CosmosBusy, null>, call: () => Promise<T | CosmosRefusal | undefined> | undefined) {
  if (get(key).busy) return null;
  set(key, { busy, refusal: null, error: '' });
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
    set(key, { busy: null, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function cosmosSit(projectPath: string, { force = false } = {}) {
  const key = keyOf(projectPath);
  const result = await run<CosmosSunResult>(key, 'sun', () => api()?.cosmosSun?.(key, { force }));
  if (result) set(key, { lastSun: result, lastMoon: null });
  return result;
}

export async function cosmosLeave(projectPath: string, { note = '', handoffTo = null as string | null, sessionId = null as string | null } = {}) {
  const key = keyOf(projectPath);
  const result = await run<CosmosMoonResult>(key, 'moon', () => api()?.cosmosMoon?.(key, { note, handoffTo, sessionId }));
  if (result) set(key, { lastMoon: result, lastSun: null });
  return result;
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

export function clearCosmosNotice(projectPath: string | null | undefined): void {
  set(keyOf(projectPath), { refusal: null, error: '', lastSun: null, lastMoon: null });
}

/** Test seam: forget every cached entry. */
export function resetCosmosStore(): void {
  entries.clear();
  stopPolling();
  if (heartbeatTimer !== null && typeof window !== 'undefined') window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}
