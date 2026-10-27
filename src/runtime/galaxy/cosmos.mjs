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
import { cosmosHome, ensureStar, guestStar, publicStar } from './star.mjs';
import { planetForRoot } from './planet.mjs';
import {
  GalaxyError,
  galaxyDir,
  fetchGalaxy,
  galaxyReader,
  galaxyReady,
  galaxyRemote,
  publishBeat,
  readBeats,
  readGalaxyJson,
  transact,
  writeGalaxyJson,
} from './galaxy-repo.mjs';
import { scrubUrl, scrubUrlsInText } from './secrets.mjs';
import {
  holderLastSeen,
  hostActiveMessage,
  hostStaleMessage,
  leaveTransition,
  normalizeSeat,
  requestTransition,
  seatPath,
  sameMachine,
  seatState,
  sitTransition,
  withdrawTransition,
  seatRefusal,
} from './seat.mjs';
import { readSyncState, syncEnvironmentIn } from './environment.mjs';
import { clearPendingRescue, markPendingRescue, readPendingRescue } from './pending-rescue.mjs';
import { buildConversationExport, listConversationsIn, readConversationIn, writeConversationIn } from './conversations.mjs';
import { bringUpToDate, branchState, rescueDisplacedWork, saveAndPush } from './project-sync.mjs';

const PLANETS_FILE = 'planets.json';

/** The planet as callers see it: its remote address never carries credentials. */
function publicPlanet(planet) {
  return planet?.remote?.url ? { ...planet, remote: { ...planet.remote, url: scrubUrl(planet.remote.url) } } : planet;
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
    throw new GalaxyError('no_galaxy', '은하수가 아직 연결되지 않았어요. 설정 → 은하수에서 먼저 연결해 주세요.');
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
 * Who acts: this device's star, or a phone (guest) driving it over the relay.
 * `local` is always this machine — it does the git work and keeps the beat.
 */
async function actorFor(guest, home) {
  const local = await ensureStar(home);
  return { star: guest ? guestStar(guest, local) : local, local };
}

/**
 * This star held the seat last time, but another MACHINE sat down since (a
 * phone driving this PC shares its working copy, so it never displaces it).
 */
function wasDisplaced(seat, star, host) {
  const last = seat.history.at(-1);
  const lastMine = seat.history.findLast((entry) => entry.star === star.id);
  return Boolean(lastMine && last && last.star !== star.id && !sameMachine(last, star, host));
}

/**
 * 해 — sit down at the planet in `root`.
 * `force` replaces a holder that stopped answering (never an active one).
 */
export async function sun({ root, force = false, guest = null, dir = galaxyDir(), home = cosmosHome(), syncEnvironment = true } = {}) {
  await requireGalaxy(dir);
  const { star, local } = await actorFor(guest, home);
  const via = guest ? 'relay' : 'local';
  const host = guest ? local.id : null;
  const planet = await requirePlanet(root);

  let beats = {};
  let before = null;
  let env = null;
  let sat = null;
  await transact(
    async ({ dir: galaxy }) => {
      beats = await readBeats(galaxy);
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      before = seat;
      sat = sitTransition(seat, star, { beats, force, via, host });
      if (sat.refused) return { value: null };
      // Taking the seat from another machine leaves this checkout to be
      // rescued and caught up AFTER the seat push. Mark that first, so a crash
      // in between is finished by the next 이어받기 instead of forgotten.
      if (!guest && wasDisplaced(seat, star, host)) await markPendingRescue(home, planet.id, { star: star.id });
      env = syncEnvironment ? await syncEnvironmentIn(galaxy, { direction: 'pull', home }) : null;
      if (sat.changed) await writeGalaxyJson(galaxy, seatPath(planet.id), sat.seat);
      await writeGalaxyJson(galaxy, `stars/${star.id}.json`, publicStar(star));
      await recordPlanetIn(galaxy, planet, { lastSeat: { star: star.id, name: star.name, at: Date.now() } });
      return { value: null, message: `이어받기: ${star.name} → ${planet.id}${sat.took ? ' (넘겨받음)' : ''}` };
    },
    { dir }
  );
  if (sat?.refused) {
    const holder = sat.seat.holder;
    const lastSeen = holderLastSeen(sat.seat, beats);
    const text = {
      occupied: `${holder?.name || '다른 기기'}에서 작업 중이에요. 넘겨 달라고 요청해 주세요.`,
      stale: `${holder?.name || '다른 기기'}이(가) 오래 응답이 없어요. 강제로 넘겨받을 수 있어요.`,
      reserved: '다른 기기에 넘겨주기로 한 작업 자리예요.',
      host_active: hostActiveMessage(sat.host),
      host_stale: hostStaleMessage(sat.host),
    }[sat.refused];
    throw new GalaxyError(...seatRefusal(sat.refused, text), {
      seat: sat.seat,
      holder,
      lastSeen,
      host: sat.host || null,
      planet: publicPlanet(planet),
      canForce: sat.refused === 'stale' || sat.refused === 'host_stale',
    });
  }
  const environment = env ? await env.commitLocal() : null;
  // The seat is ours now. Only then is it safe to keep this star's stale work
  // on a rescue branch and reset the checkout: this star held the seat last
  // time but another MACHINE sat down since. A phone driving this PC shares
  // its working copy, so nothing to rescue there.
  // An earlier 이어받기 that stopped after its seat push left a marker: finish
  // its rescue now even though the seat already reads as ours.
  const pending = guest ? null : await readPendingRescue(home, planet.id);
  const displaced = wasDisplaced(before, star, host) || Boolean(pending && pending.star === star.id);
  const rescued =
    displaced && !guest && seatState(before, star.id, { beats }) !== 'occupied' ? await rescueDisplacedWork(root, star.name) : null;
  // A rescue that stopped half-way left the work where it was; say so instead of claiming it was kept.
  const rescue = rescued?.ok === false ? null : rescued;
  const rescueFailed = rescued?.ok === false ? rescued : null;
  // A phone's seat lives on its host PC's beat.
  await publishBeat(local.id, { name: local.name, planets: [planet.id] }, { dir }).catch(() => null);
  const project = await bringUpToDate(root);
  // Done only once the checkout really caught up; a failed catch-up keeps the
  // marker so the next 이어받기 tries again.
  if (!guest && rescued?.ok !== false && project?.ok !== false) await clearPendingRescue(home, planet.id);
  const conversation = await readConversationIn(await galaxyReader(dir), planet.id);
  return {
    star,
    planet: publicPlanet(planet),
    seat: sat.seat,
    took: sat.took || null,
    passed: sat.passed || null,
    moved: sat.moved || null,
    rescue,
    rescueFailed,
    environment,
    project,
    conversation,
  };
}

/**
 * 달 — save, sync and get up. `session` (a runtime session object) is the
 * conversation to carry; `handoffTo` names the star the seat is left for.
 */
export async function moon({
  root,
  note = '',
  handoffTo = null,
  session = null,
  guest = null,
  forcePush = false,
  dir = galaxyDir(),
  home = cosmosHome(),
  syncEnvironment = true,
} = {}) {
  await requireGalaxy(dir);
  const { star, local } = await actorFor(guest, home);
  const planet = await requirePlanet(root);
  // Only the star in the seat may leave it, and a phone only through the PC it
  // sits on (that machine holds its work). Nothing overrides this check:
  // `forcePush` ("그래도 내려놓기") only accepts a push that did not land.
  const refuseUnlessHeld = (seat) => {
    const holder = seat.holder;
    if (holder?.star === star.id) {
      if (!guest || (holder.host || null) === local.id) return;
      throw new GalaxyError(
        'seat_other_host',
        `이 폰은 ${hostNames[holder.host]?.name || '다른 기기'}을(를) 통해 작업 중이에요. 그 기기에 연결해서 내려놓아 주세요.`,
        { seat, holder, planet: publicPlanet(planet) }
      );
    }
    throw new GalaxyError(
      holder ? 'seat_occupied' : 'seat_not_held',
      holder ? `${holder.name || '다른 기기'}이(가) 작업 중이라 이 기기에서는 마무리할 수 없어요.` : '이 프로젝트를 이어받지 않아서 내려놓을 게 없어요. 먼저 이어받기를 눌러 주세요.',
      { seat, holder, planet: publicPlanet(planet) }
    );
  };
  // Fail fast, before touching the project. The last fetch is good enough
  // when offline; the transaction below re-checks against the real state.
  await fetchGalaxy(dir).catch(() => null);
  const hostNames = guest ? await readBeats(dir).catch(() => ({})) : {};
  refuseUnlessHeld(normalizeSeat(await (await galaxyReader(dir)).json(seatPath(planet.id)), planet.id));
  const message = `cosmos: ${String(note || '').trim() || `${star.name}에서 작업 마무리`}`.slice(0, 200);
  const project = await saveAndPush(root, { message });
  if (!project.ok && project.error === 'secrets') {
    // Never overridden by `forcePush`: nothing with a secret leaves this machine.
    const text =
      project.secretsIn === 'commits'
        ? '아직 올리지 않은 커밋에 비밀 정보가 들어 있어 올리지 않았어요. 목록의 파일을 커밋에서 빼고 다시 내려놓아 주세요.'
        : '비밀 정보가 들어 있는 파일이 있어 저장을 멈췄어요. 목록을 확인하고 .gitignore에 추가하거나 지워 주세요.';
    throw new GalaxyError('secrets', text, { secrets: project.secrets, secretsIn: project.secretsIn || 'changes' });
  }
  // The seat only moves on once the work is really on the remote: otherwise
  // the next device would sit down at an older project and the work forks.
  // `forcePush` ("그래도 내려놓기") is the explicit override: the seat is freed
  // and the result says the work stayed on this device (`unpushed`).
  if (!project.ok && !forcePush) {
    const reason = {
      behind: '원격 저장소에 더 새로운 커밋이 있어 올리지 못했어요. 먼저 받아서 합친 뒤 다시 내려놓아 주세요.',
      rejected: '원격 저장소가 올리기를 거부했어요. 이 브랜치에 올릴 권한이 없거나 보호된 브랜치일 수 있어요.',
      push: '프로젝트를 원격 저장소에 올리지 못했어요. 연결을 확인하고 다시 내려놓아 주세요.',
      commit: '변경 사항을 커밋하지 못했어요. git 상태를 확인하고 다시 내려놓아 주세요.',
      detached: '지금 브랜치가 아닌 커밋에 있어 올릴 수 없어요. 브랜치로 돌아간 뒤 다시 내려놓아 주세요.',
      scan: '올릴 커밋에 비밀 정보가 있는지 확인하지 못했어요. git 상태를 확인하고 다시 내려놓아 주세요.',
    }[project.error] || `프로젝트를 저장하지 못했어요 (${project.error}).`;
    throw new GalaxyError(
      'push_failed',
      `${reason} 작업 자리는 이 기기에 그대로 있어요. 올리지 않은 채로 내려놓을 수도 있어요.`,
      {
        reason: project.error,
        // The desktop/phone offer "그래도 내려놓기" (moon with forcePush: true).
        canForce: true,
        project,
        planet: publicPlanet(planet),
      }
    );
  }
  const unpushed = project.ok
    ? null
    : {
        reason: project.error,
        detail: scrubUrlsInText(String(project.detail || '')),
        committed: Boolean(project.committed),
        branch: project.branch || null,
        ahead: Number(project.ahead) || 0,
      };
  let env = null;
  let left = null;
  let exported = null;
  await transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      refuseUnlessHeld(seat);
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
      return { value: null, message: `내려놓기: ${star.name} ← ${planet.id}` };
    },
    { dir }
  );
  const environment = env ? await env.commitLocal() : null;
  await publishBeat(local.id, { name: local.name, planets: [] }, { dir }).catch(() => null);
  return {
    star,
    planet: publicPlanet(planet),
    seat: left?.seat || null,
    handoffTo: left?.handoffTo || null,
    project,
    // Set only when `forcePush` freed the seat although the work did not reach
    // the remote: the next device will not see it until this one pushes.
    unpushed,
    environment,
    conversation: exported ? { id: exported.id, messageCount: exported.messageCount, trimmed: exported.trimmed } : null,
  };
}

/** 교대 요청 — ask the seated star to hand over. */
export async function requestTurn({ root, note = '', withdraw = false, guest = null, dir = galaxyDir(), home = cosmosHome() } = {}) {
  await requireGalaxy(dir);
  const { star } = await actorFor(guest, home);
  const planet = await requirePlanet(root);
  let result = null;
  await transact(
    async ({ dir: galaxy }) => {
      const seat = normalizeSeat(await readGalaxyJson(galaxy, seatPath(planet.id)), planet.id);
      result = withdraw ? withdrawTransition(seat, star) : requestTransition(seat, star, { note });
      if (!result.changed) return { value: null };
      await writeGalaxyJson(galaxy, seatPath(planet.id), result.seat);
      return { value: null, message: `넘겨 달라는 요청${withdraw ? ' 취소' : ''}: ${star.name} → ${planet.id}` };
    },
    { dir }
  );
  return { star, planet: publicPlanet(planet), seat: result.seat };
}

/** Keep this star's seat alive (desktop: every few minutes while seated). */
export async function heartbeat({ planets = [], dir = galaxyDir(), home = cosmosHome() } = {}) {
  if (!(await galaxyReady(dir))) return null;
  const star = await ensureStar(home);
  return publishBeat(star.id, { name: star.name, planets }, { dir });
}

/** Everything the 은하수 screen draws. `fetch: false` reads the last pull only. */
export async function overview({ root = null, fetch = true, guest = null, dir = galaxyDir(), home = cosmosHome() } = {}) {
  const { star, local } = await actorFor(guest, home);
  const ready = await galaxyReady(dir);
  const sync = await readSyncState(home);
  const remoteUrl = ready ? await galaxyRemote(dir) : null;
  const base = { star, ready, remote: remoteUrl ? scrubUrl(remoteUrl) : null, syncedAt: sync.syncedAt || 0 };
  if (!ready) return { ...base, stars: [], planets: [], planet: null, seat: null, state: 'no_galaxy', conversations: [] };
  // Read-only by construction: fetch refs, then read files out of the object
  // store. The working copy belongs to the transaction holding the lock.
  let offline = null;
  if (fetch) {
    try {
      await fetchGalaxy(dir);
    } catch (error) {
      offline = error instanceof Error ? error.message : String(error);
    }
  }
  const reader = await galaxyReader(dir);
  const beats = await readBeats(dir);
  const registry = (await reader.json(PLANETS_FILE)) || { planets: {} };
  const stars = [];
  for (const name of await reader.names('stars')) {
    if (!name.endsWith('.json')) continue;
    const record = await reader.json(`stars/${name}`);
    if (record?.id) stars.push({ ...record, beat: beats[record.id] || null, me: record.id === star.id });
  }
  if (!stars.some((entry) => entry.id === star.id)) stars.push({ ...publicStar(star), beat: beats[star.id] || null, me: true });

  let planet = null;
  let seat = null;
  let state = null;
  let conversations = [];
  let project = null;
  let pendingRescue = false;
  if (root) {
    planet = publicPlanet(await planetForRoot(root));
    if (planet.id) {
      seat = normalizeSeat(await reader.json(seatPath(planet.id)), planet.id);
      state = seatState(seat, star.id, { beats });
      conversations = await listConversationsIn(reader, planet.id);
      // An 이어받기 stopped half-way: the seat is ours but the checkout was
      // never rescued/caught up. The screens offer to finish it (sun again).
      if (!guest && state === 'mine' && (await readPendingRescue(home, planet.id))?.star === star.id) pendingRescue = true;
    } else {
      state = 'no_remote';
    }
    project = await branchState(root).catch(() => null);
  }
  return {
    ...base,
    offline,
    stars: stars.sort((a, b) => Number(b.me) - Number(a.me) || (b.beat?.at || 0) - (a.beat?.at || 0)),
    planets: Object.values(registry.planets || {}).map((entry) => (entry?.remote ? { ...entry, remote: scrubUrl(entry.remote) } : entry)),
    planet,
    seat,
    state,
    holderLastSeen: seat ? holderLastSeen(seat, beats) : 0,
    // The holder works on this very machine (this PC ⇄ the phone driving it):
    // the baton passes directly, no 교대 needed.
    here: Boolean(seat?.holder && seat.holder.star !== star.id && sameMachine(seat.holder, star, guest ? local.id : null)),
    conversations,
    project,
    pendingRescue,
  };
}
