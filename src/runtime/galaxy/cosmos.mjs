// COSMOS orchestration: the user-facing verbs built from the Galaxy parts.
//
//   해 (sun)   take the seat of a planet: catch the project up, pull the
//              shared environment, and hand back the conversation to continue.
//   달 (moon)  leave the seat: save and push the project, push the
//              environment and the conversation, free the seat (or hand it
//              to the star that asked).
//   교대       ask the seated star to hand over.
//   overview   everything the 은하수 screen draws: stars, beats, seats,
//              planets, the last conversation, sync freshness.
//
// Each verb runs as ONE Galaxy transaction, so the seat change, environment
// and conversation land together or not at all.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cosmosHome, ensureStar, publicStar } from './star.mjs';
import { planetForRoot } from './planet.mjs';
import {
  GalaxyError,
  galaxyDir,
  galaxyReady,
  galaxyRemote,
  publishBeat,
  pullGalaxy,
  readBeats,
  readGalaxyJson,
  transact,
  writeGalaxyJson,
} from './galaxy-repo.mjs';
import {
  holderLastSeen,
  leaveTransition,
  normalizeSeat,
  requestTransition,
  seatPath,
  seatState,
  sitTransition,
  withdrawTransition,
} from './seat.mjs';
import { readSyncState, syncEnvironmentIn } from './environment.mjs';
import { buildConversationExport, listConversationsIn, readConversationIn, writeConversationIn } from './conversations.mjs';
import { bringUpToDate, branchState, rescueDisplacedWork, saveAndPush } from './project-sync.mjs';

const PLANETS_FILE = 'planets.json';

function scrubUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return String(url || '');
  }
}

async function requirePlanet(root) {
  const planet = await planetForRoot(root);
  if (!planet.id) {
    throw new GalaxyError(
      'no_remote',
      '이 프로젝트에는 원격 저장소(GitHub 등)가 없어요. 다른 기기와 이어 쓰려면 먼저 원격 저장소에 올려 주세요.',
      { planet }
    );
  }
  return planet;
}

async function requireGalaxy(dir) {
  if (!(await galaxyReady(dir))) {
    throw new GalaxyError('no_galaxy', '은하수가 아직 연결되지 않았어요. 관제실 → 은하수에서 먼저 연결해 주세요.');
  }
}

async function recordPlanetIn(galaxy, planet, patch = {}) {
  const registry = (await readGalaxyJson(galaxy, PLANETS_FILE)) || { v: 1, planets: {} };
  const entry = registry.planets?.[planet.id] || {};
  registry.v = 1;
  registry.planets = {
    ...(registry.planets || {}),
    [planet.id]: {
      ...entry,
      id: planet.id,
      name: planet.name,
      remote: scrubUrl(planet.remote?.url || entry.remote || ''),
      ...patch,
    },
  };
  await writeGalaxyJson(galaxy, PLANETS_FILE, registry);
}

/**
 * 해 — sit down at the planet in `root`.
 * `force` replaces a holder that stopped answering (never an active one).
 */
export async function sun({ root, force = false, via = 'local', host = null, dir = galaxyDir(), home = cosmosHome(), syncEnvironment = true } = {}) {
  await requireGalaxy(dir);
  const star = await ensureStar(home);
  const planet = await requirePlanet(root);
  await pullGalaxy(dir);
  const beats = await readBeats(dir);
  const before = normalizeSeat(await readGalaxyJson(dir, seatPath(planet.id)), planet.id);
  // This star held the seat last time but someone else sat down since: keep
  // whatever it left unpushed on a rescue branch before catching up.
  const lastMine = before.history.findLast((entry) => entry.star === star.id);
  const displaced = Boolean(lastMine && before.history.at(-1)?.star !== star.id);
  const rescue = displaced && seatState(before, star.id, { beats }) !== 'occupied' ? await rescueDisplacedWork(root, star.name) : null;

  let env = null;
  let sat = null;
  await transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      sat = sitTransition(seat, star, { beats, force, via, host });
      if (sat.refused) return { value: null };
      env = syncEnvironment ? await syncEnvironmentIn(galaxy, { direction: 'pull', home }) : null;
      if (sat.changed) await writeGalaxyJson(galaxy, seatPath(planet.id), sat.seat);
      await writeGalaxyJson(galaxy, `stars/${star.id}.json`, publicStar(star));
      await recordPlanetIn(galaxy, planet, { lastSeat: { star: star.id, name: star.name, at: Date.now() } });
      return { value: null, message: `해: ${star.name} → ${planet.id}${sat.took ? ' (넘겨받음)' : ''}` };
    },
    { dir }
  );
  if (sat?.refused) {
    const holder = sat.seat.holder;
    const lastSeen = holderLastSeen(sat.seat, beats);
    const text = {
      occupied: `${holder?.name || '다른 별'}에서 조종 중이에요. 교대를 요청해 주세요.`,
      stale: `${holder?.name || '다른 별'}이(가) 오래 응답이 없어요. 강제로 넘겨받을 수 있어요.`,
      reserved: '다른 별에게 넘겨주기로 예약된 조종석이에요.',
    }[sat.refused];
    throw new GalaxyError(`seat_${sat.refused}`, text, { seat: sat.seat, holder, lastSeen, planet });
  }
  const environment = env ? await env.commitLocal() : null;
  await publishBeat(star.id, { name: star.name, planets: [planet.id] }, { dir }).catch(() => null);
  const project = await bringUpToDate(root);
  const conversation = await readConversationIn(dir, planet.id);
  return {
    star,
    planet,
    seat: sat.seat,
    took: sat.took || null,
    rescue,
    environment,
    project,
    conversation,
  };
}

/**
 * 달 — save, sync and get up. `session` (a runtime session object) is the
 * conversation to carry; `handoffTo` names the star the seat is left for.
 */
export async function moon({ root, note = '', handoffTo = null, session = null, dir = galaxyDir(), home = cosmosHome(), syncEnvironment = true } = {}) {
  await requireGalaxy(dir);
  const star = await ensureStar(home);
  const planet = await requirePlanet(root);
  const message = `cosmos: ${String(note || '').trim() || `${star.name}에서 작업 마무리`}`.slice(0, 200);
  const project = await saveAndPush(root, { message });
  if (!project.ok && project.error === 'secrets') {
    throw new GalaxyError('secrets', '비밀 정보가 들어 있는 파일이 있어 저장을 멈췄어요. 목록을 확인하고 .gitignore에 추가하거나 지워 주세요.', {
      secrets: project.secrets,
    });
  }
  let env = null;
  let left = null;
  let exported = null;
  await transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      left = leaveTransition(seat, star, { note, handoffTo });
      env = syncEnvironment ? await syncEnvironmentIn(galaxy, { direction: 'push', home }) : null;
      if (session) {
        exported = buildConversationExport(session, { planetId: planet.id, planetRoot: root, star });
        if (exported.messageCount > 0) await writeConversationIn(galaxy, exported);
        else exported = null;
      }
      if (left.changed) await writeGalaxyJson(galaxy, seatPath(planet.id), left.seat);
      await writeGalaxyJson(galaxy, `stars/${star.id}.json`, publicStar(star));
      await recordPlanetIn(galaxy, planet, {
        lastMoon: { star: star.id, name: star.name, at: Date.now(), note: String(note || '').slice(0, 300) },
      });
      return { value: null, message: `달: ${star.name} ← ${planet.id}` };
    },
    { dir }
  );
  const environment = env ? await env.commitLocal() : null;
  await publishBeat(star.id, { name: star.name, planets: [] }, { dir }).catch(() => null);
  return {
    star,
    planet,
    seat: left?.seat || null,
    handoffTo: left?.handoffTo || null,
    project,
    environment,
    conversation: exported ? { id: exported.id, messageCount: exported.messageCount, trimmed: exported.trimmed } : null,
  };
}

/** 교대 요청 — ask the seated star to hand over. */
export async function requestTurn({ root, note = '', withdraw = false, dir = galaxyDir(), home = cosmosHome() } = {}) {
  await requireGalaxy(dir);
  const star = await ensureStar(home);
  const planet = await requirePlanet(root);
  let result = null;
  await transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      result = withdraw ? withdrawTransition(seat, star) : requestTransition(seat, star, { note });
      if (!result.changed) return { value: null };
      await writeGalaxyJson(galaxy, seatPath(planet.id), result.seat);
      return { value: null, message: `교대 ${withdraw ? '취소' : '요청'}: ${star.name} → ${planet.id}` };
    },
    { dir }
  );
  return { star, planet, seat: result.seat };
}

/** Keep this star's seat alive (desktop: every few minutes while seated). */
export async function heartbeat({ planets = [], dir = galaxyDir(), home = cosmosHome() } = {}) {
  if (!(await galaxyReady(dir))) return null;
  const star = await ensureStar(home);
  return publishBeat(star.id, { name: star.name, planets }, { dir });
}

/** Everything the 은하수 screen draws. `fetch: false` reads the last pull only. */
export async function overview({ root = null, fetch = true, dir = galaxyDir(), home = cosmosHome() } = {}) {
  const star = await ensureStar(home);
  const ready = await galaxyReady(dir);
  const sync = await readSyncState(home);
  const base = { star, ready, remote: ready ? await galaxyRemote(dir) : null, syncedAt: sync.syncedAt || 0 };
  if (!ready) return { ...base, stars: [], planets: [], planet: null, seat: null, state: 'no_galaxy', conversations: [] };
  let offline = null;
  if (fetch) {
    try {
      await pullGalaxy(dir);
    } catch (error) {
      offline = error instanceof Error ? error.message : String(error);
    }
  }
  const beats = await readBeats(dir);
  const registry = (await readGalaxyJson(dir, PLANETS_FILE)) || { planets: {} };
  const stars = [];
  try {
    for (const name of await readdir(join(dir, 'stars'))) {
      if (!name.endsWith('.json')) continue;
      const record = await readGalaxyJson(dir, `stars/${name}`);
      if (record?.id) stars.push({ ...record, beat: beats[record.id] || null, me: record.id === star.id });
    }
  } catch {
    /* no stars published yet */
  }
  if (!stars.some((entry) => entry.id === star.id)) stars.push({ ...publicStar(star), beat: beats[star.id] || null, me: true });

  let planet = null;
  let seat = null;
  let state = null;
  let conversations = [];
  let project = null;
  if (root) {
    planet = await planetForRoot(root);
    if (planet.id) {
      seat = normalizeSeat(await readGalaxyJson(dir, seatPath(planet.id)), planet.id);
      state = seatState(seat, star.id, { beats });
      conversations = await listConversationsIn(dir, planet.id);
    } else {
      state = 'no_remote';
    }
    project = await branchState(root).catch(() => null);
  }
  return {
    ...base,
    offline,
    stars: stars.sort((a, b) => Number(b.me) - Number(a.me) || (b.beat?.at || 0) - (a.beat?.at || 0)),
    planets: Object.values(registry.planets || {}),
    planet,
    seat,
    state,
    holderLastSeen: seat ? holderLastSeen(seat, beats) : 0,
    conversations,
    project,
  };
}
