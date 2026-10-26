// COSMOS relay operations for the desktop service: thin, validated wrappers
// around src/runtime/galaxy. A refused verb (seat taken, secrets in the
// project, no remote) is returned as a CosmosRefusal so the renderer can draw
// it as a state, not surface it as a crash.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureGitEnvironment, oneLine, repoRoot } from '../../../../src/runtime/shared/git-process.mjs';
import type {
  CosmosGalaxySetupResult,
  CosmosMoonResult,
  CosmosOutcome,
  CosmosOverview,
  CosmosRefusal,
  CosmosSeat,
  CosmosStar,
  CosmosStarKind,
  CosmosSunResult,
} from '../shared/contract-cosmos';
import { childEnvironment } from './child-environment';
import { requiredRepositoryCwd } from './git-contract.mjs';
import { publicGitRemoteUrl, scrubGitCredentials } from './git-runner';
import { ghRun } from './github-cli';
import { validatedRelayUrl } from './remote-relay-device';
import { packagedRuntimeSourceRoot } from './runtime-layout';

configureGitEnvironment(() => childEnvironment({ GIT_SEQUENCE_EDITOR: 'true' }) as Record<string, string | undefined>);

const NOTE_LIMIT = 300;

// The Galaxy modules reach the runtime config (and through it the keychain
// loader), which cannot live inside the plain-Node service bundle. Load them
// from the runtime source tree at call time, like the settings store does.
type CosmosModule = typeof import('../../../../src/runtime/galaxy/cosmos.mjs');
type GalaxyRepoModule = typeof import('../../../../src/runtime/galaxy/galaxy-repo.mjs');
type StarModule = typeof import('../../../../src/runtime/galaxy/star.mjs');
type CliModule = typeof import('../../../../src/runtime/galaxy/cosmos-cli.mjs');
type ConfigModule = typeof import('../../../../src/runtime/shared/config.mjs');
type PathsModule = typeof import('../../../../src/runtime/shared/plugin-paths.mjs');

export interface CosmosRuntimeLocation {
  packaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
}

export function runtimeModuleUrl(relativePath: string, { packaged = false, resourcesPath = process.resourcesPath, appPath = process.cwd() }: CosmosRuntimeLocation = {}): string {
  const path = packaged
    ? join(packagedRuntimeSourceRoot(resourcesPath), 'runtime', ...relativePath.split('/'))
    : resolve(appPath, '../../src/runtime', ...relativePath.split('/'));
  return pathToFileURL(path).href;
}

let location: CosmosRuntimeLocation = {};
const modules = new Map<string, Promise<unknown>>();
function load<T>(relativePath: string): Promise<T> {
  let pending = modules.get(relativePath);
  if (!pending) {
    pending = import(/* @vite-ignore */ runtimeModuleUrl(relativePath, location));
    modules.set(relativePath, pending);
  }
  return pending as Promise<T>;
}
const cosmosCore = () => load<CosmosModule>('galaxy/cosmos.mjs');
const galaxyRepo = () => load<GalaxyRepoModule>('galaxy/galaxy-repo.mjs');
const starModule = () => load<StarModule>('galaxy/star.mjs');
const cliModule = () => load<CliModule>('galaxy/cosmos-cli.mjs');
const configModule = () => load<ConfigModule>('shared/config.mjs');
const pathsModule = () => load<PathsModule>('shared/plugin-paths.mjs');

/** Where the runtime source lives; the desktop service sets it once at startup. */
export function configureCosmosRuntime(next: CosmosRuntimeLocation): void {
  location = { ...next };
  modules.clear();
}
const GALAXY_REPO_NAME = 'cosmos-galaxy';

/** One relay verb per planet at a time; overlapping clicks join the queue. */
const tails = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  const tail = next.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return next;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, limit: number): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError('Expected text.');
  return oneLine(value).slice(0, limit);
}

function refusal(error: unknown): CosmosRefusal {
  const detail = record(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    refused: true,
    code: typeof detail.code === 'string' ? detail.code : 'failed',
    message: scrubGitCredentials(message),
    seat: (detail.seat as CosmosSeat | undefined) ?? null,
    holder: (detail.holder as CosmosRefusal['holder']) ?? null,
    lastSeen: typeof detail.lastSeen === 'number' ? detail.lastSeen : undefined,
    secrets: Array.isArray(detail.secrets) ? (detail.secrets as CosmosRefusal['secrets']) : undefined,
    // push_failed says why ('behind', 'rejected', 'push', …); read defensively, it is free text.
    reason: typeof detail.reason === 'string' && detail.reason ? detail.reason.slice(0, 40) : undefined,
    canForce: typeof detail.canForce === 'boolean' ? detail.canForce : undefined,
  };
}

/** Known, user-facing refusals; anything else is a real error. */
const REFUSAL_CODES = new Set([
  'seat_occupied',
  'seat_not_held',
  'seat_stale',
  'seat_reserved',
  // A phone takeover through this PC while the other host was seen recently.
  'seat_host_active',
  'secrets',
  'no_remote',
  'no_galaxy',
  'busy',
  'contended',
  'offline',
  'push_failed',
  'clone_failed',
]);

async function outcome<T>(run: () => Promise<T>): Promise<CosmosOutcome<T>> {
  try {
    return await run();
  } catch (error) {
    const code = record(error).code;
    if (typeof code === 'string' && REFUSAL_CODES.has(code)) return refusal(error);
    throw new Error(scrubGitCredentials(error instanceof Error ? error.message : String(error)));
  }
}

async function resolveRoot(cwd: unknown): Promise<string> {
  try {
    return await repoRoot(requiredRepositoryCwd(cwd));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new Error('이 폴더는 git 저장소가 아니에요.');
  }
}

/** A relay address without userinfo or secret-looking query values, safe to show on screen or send to a phone. */
export function publicRelayUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return scrubGitCredentials(value);
  }
}

/** Every remote address in an overview, stripped of credentials before it leaves the service. */
export function publicOverview(view: CosmosOverview): CosmosOverview {
  return {
    ...view,
    remote: view.remote ? publicGitRemoteUrl(view.remote) : view.remote,
    planets: Array.isArray(view.planets)
      ? view.planets.map((planet) => ({ ...planet, remote: planet.remote ? publicGitRemoteUrl(planet.remote) : planet.remote }))
      : view.planets,
    planet: view.planet?.remote ? { ...view.planet, remote: { ...view.planet.remote, url: publicGitRemoteUrl(view.planet.remote.url) } } : view.planet,
    relayUrl: view.relayUrl ? publicRelayUrl(view.relayUrl) : view.relayUrl,
  };
}

async function sharedPreferences(): Promise<{ relayUrl: string | null }> {
  const { readConfig } = await configModule();
  const cosmos = record(record(readConfig()).cosmos);
  return {
    relayUrl: typeof cosmos.relayUrl === 'string' && cosmos.relayUrl.trim() ? publicRelayUrl(cosmos.relayUrl.trim()) : null,
  };
}

/** cosmos.relayUrl — synced to every star through the Galaxy. (The retired 심플/고급 uiMode is no longer read or written.) */
export async function cosmosSetPreference(key: unknown, value: unknown): Promise<void> {
  const { updateConfig } = await configModule();
  if (key === 'relayUrl') {
    const raw = typeof value === 'string' ? value.trim() : '';
    // Checked when it is saved, not when the relay first dials: a plain ws://
    // address (anything but this machine) would send pairing traffic in clear.
    let url = '';
    if (raw) {
      try {
        url = validatedRelayUrl(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : '';
        throw new TypeError(
          /credentials/.test(detail)
            ? '릴레이 주소에는 아이디·비밀번호를 넣을 수 없어요.'
            : '릴레이 주소는 wss:// 로 시작해야 해요. (ws:// 는 이 컴퓨터 안에서 개발할 때만 쓸 수 있어요.)'
        );
      }
    }
    updateConfig((config) => {
      const cosmos = { ...record(config.cosmos) };
      if (url) cosmos.relayUrl = url;
      else delete cosmos.relayUrl;
      return { ...config, cosmos };
    });
    return;
  }
  throw new TypeError('Unknown COSMOS preference.');
}

// ------------------------------------------------------------------ phone (guest)

/** A phone driving this PC over the relay; it acts as its own star. */
export interface CosmosGuest {
  id: string;
  name: string | null;
}

/** Only the relay leg passes a guest; local IPC never does. */
export function cosmosGuest(value: unknown): CosmosGuest | null {
  if (value == null) return null;
  const body = record(value);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!/^[\w-]{6,128}$/.test(id)) throw new TypeError('guest id is invalid.');
  const name = typeof body.name === 'string' ? oneLine(body.name).slice(0, 40) || null : null;
  return { id, name };
}

// ------------------------------------------------------------------ overview

const FETCH_INTERVAL_MS = 20_000;
/** When the last Galaxy fetch started (0: the next overview fetches). */
let lastFetchAt = 0;
/** Bumped by every verb: a fetch started before it may miss what the verb pushed. */
let fetchEpoch = 0;
/** The one Galaxy fetch in flight; every watched planet joins it instead of starting its own. */
let fetchFlight: { epoch: number; done: Promise<string | null> } | null = null;
const overviewFlights = new Map<string, Promise<CosmosOverview>>();

async function runGalaxyFetch(): Promise<string | null> {
  const { fetchGalaxy, galaxyDir, galaxyReady } = await galaxyRepo();
  const dir = galaxyDir();
  if (!(await galaxyReady(dir))) return null;
  try {
    await fetchGalaxy(dir);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The Galaxy is one repository whatever planet is being looked at, so one
 * fetch serves every overview. Resolves to the offline reason, or null. The
 * throttle starts with the fetch: a slow fetch must not let the next poll (or
 * the next watched planet) start a second one.
 */
function sharedGalaxyFetch(): Promise<string | null> {
  if (fetchFlight && fetchFlight.epoch === fetchEpoch) return fetchFlight.done;
  // A verb invalidated the running fetch: queue a fresh one behind it, never
  // two `git fetch`es on one repository at once.
  const prior = fetchFlight?.done ?? Promise.resolve(null);
  lastFetchAt = Date.now();
  const flight = { epoch: fetchEpoch, done: prior.catch(() => null).then(runGalaxyFetch) };
  fetchFlight = flight;
  void flight.done
    .catch(() => null)
    .then(() => {
      if (fetchFlight === flight) fetchFlight = null;
    });
  return flight.done;
}

export async function cosmosOverview(cwd: unknown, options?: unknown, guestInput?: unknown): Promise<CosmosOverview> {
  const opts = record(options);
  const guest = cosmosGuest(guestInput);
  const force = opts.force === true;
  const joinable = fetchFlight !== null && fetchFlight.epoch === fetchEpoch;
  const fetch = opts.fetch !== false && (force || joinable || Date.now() - lastFetchAt >= FETCH_INTERVAL_MS);
  let root: string | null = null;
  if (typeof cwd === 'string' && cwd.trim()) {
    try {
      root = await resolveRoot(cwd);
    } catch {
      root = null;
    }
  }
  const key = `${root ?? ''}\0${fetch}\0${guest?.id ?? ''}`;
  const pending = overviewFlights.get(key);
  if (pending) return pending;
  const run = (async () => {
    const offline = fetch ? await sharedGalaxyFetch() : null;
    // The fetch already happened (or was joined) above; the read never fetches.
    const view = (await (await cosmosCore()).overview({ root, fetch: false, guest })) as CosmosOverview;
    const merged = fetch && view.ready ? { ...view, offline } : view;
    return publicOverview({ ...merged, ...(await sharedPreferences()) });
  })();
  overviewFlights.set(key, run);
  try {
    return await run;
  } finally {
    overviewFlights.delete(key);
  }
}

function invalidateOverview(): void {
  lastFetchAt = 0;
  fetchEpoch += 1;
}

// ------------------------------------------------------------------ verbs

export async function cosmosSun(cwd: unknown, request?: unknown, guestInput?: unknown): Promise<CosmosOutcome<CosmosSunResult>> {
  const force = record(request).force === true;
  const guest = cosmosGuest(guestInput);
  const root = await resolveRoot(cwd);
  return serialized(root, () =>
    outcome(async () => {
      const result = await (await cosmosCore()).sun({ root, force, guest });
      invalidateOverview();
      const conversation = result.conversation
        ? {
            id: result.conversation.id,
            title: result.conversation.title,
            star: result.conversation.star,
            exportedAt: result.conversation.exportedAt,
            messageCount: result.conversation.messageCount,
          }
        : null;
      return {
        planet: result.planet,
        seat: result.seat,
        took: result.took,
        passed: result.passed ?? null,
        rescue: result.rescue,
        environment: result.environment,
        project: result.project,
        conversation,
      } as CosmosSunResult;
    })
  );
}

/** The conversation to carry: the named session's saved file, else the newest one for the planet. */
async function sessionToCarry(root: string, sessionId: string | null): Promise<unknown> {
  if (sessionId && /^[\w-]+$/.test(sessionId)) {
    try {
      const { resolvePluginData } = await pathsModule();
      return JSON.parse(await readFile(join(resolvePluginData(), 'sessions', `${sessionId}.json`), 'utf8'));
    } catch {
      /* fall through to the newest session of the planet */
    }
  }
  return (await cliModule()).latestSessionFor(root);
}

export async function cosmosMoon(cwd: unknown, request?: unknown, guestInput?: unknown): Promise<CosmosOutcome<CosmosMoonResult>> {
  const body = record(request);
  const guest = cosmosGuest(guestInput);
  const note = text(body.note, NOTE_LIMIT);
  const handoffTo = typeof body.handoffTo === 'string' && body.handoffTo ? body.handoffTo : null;
  const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;
  // 그래도 내려놓기: release the seat even though the push failed; the
  // unpushed work stays on this device. Only an explicit `true` counts.
  const force = body.force === true;
  const root = await resolveRoot(cwd);
  return serialized(root, () =>
    outcome(async () => {
      const session = await sessionToCarry(root, sessionId);
      const result = await (await cosmosCore()).moon({ root, note, handoffTo, session, guest, force });
      invalidateOverview();
      return result as CosmosMoonResult;
    })
  );
}

export async function cosmosRequest(cwd: unknown, request?: unknown, guestInput?: unknown): Promise<CosmosOutcome<{ seat: CosmosSeat }>> {
  const body = record(request);
  const guest = cosmosGuest(guestInput);
  const root = await resolveRoot(cwd);
  return serialized(root, () =>
    outcome(async () => {
      const result = await (await cosmosCore()).requestTurn({ root, note: text(body.note, NOTE_LIMIT), withdraw: body.withdraw === true, guest });
      invalidateOverview();
      return { seat: result.seat as CosmosSeat };
    })
  );
}

export async function cosmosHeartbeat(planets: unknown): Promise<void> {
  const list = Array.isArray(planets) ? planets.filter((value): value is string => typeof value === 'string').slice(0, 20) : [];
  await (await cosmosCore()).heartbeat({ planets: list }).catch(() => null);
}

/**
 * May a paired phone change this project right now? Only while a phone holds
 * the planet's seat through this PC ('remote'). Without a Galaxy, or for a
 * folder that is no shared planet, the relay works as before. Returns the
 * refusal text, or null when the write may go ahead. Reads the last pull
 * only: the windows poll keeps it fresh, and a write must not wait on git.
 *
 * `{ scope: 'held' }` is the every-registered-project rule's question, asked
 * for each project when a write has no folder or one outside every project:
 * it refuses only while another device (this PC included) holds the seat, so
 * an empty seat elsewhere does not block a folder-less terminal.
 */
export async function cosmosRemoteWriteRefusal(cwd: string | null, options?: unknown): Promise<string | null> {
  if (!cwd) return null;
  const heldOnly = record(options).scope === 'held';
  let root: string;
  try {
    root = await resolveRoot(cwd);
  } catch {
    return null;
  }
  const view = (await (await cosmosCore()).overview({ root, fetch: false })) as CosmosOverview;
  if (!view.ready || !view.planet?.id || view.state === 'remote') return null;
  const holder = view.seat?.holder;
  if (heldOnly) {
    if (!holder) return null;
    const project = view.planet.name || '다른 프로젝트';
    return view.state === 'mine'
      ? `🔒 이 PC(${holder.name})가 ${project} 프로젝트에서 작업 중이라, 프로젝트 밖 폴더에서는 바꿀 수 없어요. 폰에서 ${project}을(를) 이어받아 주세요.`
      : `🔒 ${holder.name}이(가) ${project} 프로젝트에서 작업 중이라, 프로젝트 밖 폴더에서는 바꿀 수 없어요.`;
  }
  if (view.state === 'mine') return `🔒 이 PC(${holder?.name ?? '이 기기'})가 작업 중이에요. 폰에서 이어받기를 누르면 이어서 할 수 있어요.`;
  if (holder) return `🔒 ${holder.name}이(가) 작업 중이에요. 폰에서 넘겨 달라고 요청해 주세요.`;
  return '☄️ 지금은 아무도 작업하지 않아요. 폰에서 먼저 이어받기를 눌러 주세요.';
}

const STAR_KIND_SET = new Set<CosmosStarKind>(['pc', 'mac', 'phone']);

export async function cosmosSetStar(request: unknown): Promise<CosmosStar> {
  const body = record(request);
  const patch: Record<string, string> = {};
  if (body.name != null) patch.name = text(body.name, 40);
  if (typeof body.kind === 'string' && STAR_KIND_SET.has(body.kind as CosmosStarKind)) patch.kind = body.kind;
  if (typeof body.color === 'string') patch.color = body.color;
  invalidateOverview();
  return (await (await starModule()).updateStar(patch)) as CosmosStar;
}

// ------------------------------------------------------------------ galaxy setup

async function ghLogin(): Promise<string> {
  const who = await ghRun(['api', 'user', '--jq', '.login']);
  if (!who) throw Object.assign(new Error('GitHub CLI(gh)가 필요해요. 설정 → Git에서 설치하고 로그인해 주세요.'), { code: 'no_gh' });
  if (who.code !== 0 || !who.stdout.trim()) {
    throw Object.assign(new Error('GitHub에 로그인되어 있지 않아요. 설정 → Git에서 로그인해 주세요.'), { code: 'no_gh' });
  }
  return who.stdout.trim();
}

/**
 * Connect the Galaxy. With `remoteUrl`, adopt that repository. With
 * `create`, find or create the signed-in user's private `cosmos-galaxy`.
 */
export async function cosmosSetupGalaxy(request: unknown): Promise<CosmosOutcome<CosmosGalaxySetupResult>> {
  const body = record(request);
  return serialized('\0galaxy', async () => {
    try {
      let remoteUrl = typeof body.remoteUrl === 'string' ? body.remoteUrl.trim() : '';
      let created = false;
      if (!remoteUrl && body.create === true) {
        const login = await ghLogin();
        const slug = `${login}/${GALAXY_REPO_NAME}`;
        const existing = await ghRun(['repo', 'view', slug, '--json', 'url,isPrivate', '--jq', '.url + " " + (.isPrivate|tostring)']);
        if (existing?.code === 0 && existing.stdout.trim()) {
          const [url, isPrivate] = existing.stdout.trim().split(' ');
          if (isPrivate !== 'true') {
            throw Object.assign(new Error(`${slug} 저장소가 공개 상태예요. 비공개로 바꾼 뒤 다시 연결해 주세요.`), { code: 'public_repo' });
          }
          remoteUrl = `${url}.git`;
        } else {
          const made = await ghRun(['repo', 'create', GALAXY_REPO_NAME, '--private', '--description', 'COSMOS 은하수: 기기 사이 환경·교신 동기화 (자동 관리)'], 120_000);
          if (!made || made.code !== 0) {
            throw new Error(`은하수 저장소를 만들지 못했어요: ${(made?.stderr || '').trim()}`);
          }
          remoteUrl = `https://github.com/${slug}.git`;
          created = true;
        }
      }
      const { connectGalaxy, galaxyDir, galaxyReady } = await galaxyRepo();
      if (!remoteUrl && !(await galaxyReady(galaxyDir()))) {
        // Local-only start: still useful on one PC; a remote can be added later.
        const local = await connectGalaxy({});
        invalidateOverview();
        return { remote: local.remote ? publicGitRemoteUrl(local.remote) : null, created: false };
      }
      const result = await connectGalaxy({ remoteUrl: remoteUrl || null });
      invalidateOverview();
      return { remote: result.remote ? publicGitRemoteUrl(result.remote) : null, created };
    } catch (error) {
      const code = record(error).code;
      if (typeof code === 'string') return refusal(error);
      return refusal(Object.assign(new Error(error instanceof Error ? error.message : String(error)), { code: 'failed' }));
    }
  });
}
