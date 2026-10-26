// 같은 환경: the user's settings, skills, agents, workflows, hooks and core
// memory, kept identical on every star through the Galaxy.
//
// Unit of sync: one file. A config section counts as one file too
// (environment/config/<key>.json), so changing the model on one PC and a skill
// on another never collide. Each star remembers the content it last agreed on
// with the Galaxy (its "base", in ~/.mixdog/galaxy-state.json); comparing
// local, Galaxy and base tells which side changed — git's three-way rule:
//   local == base  → only the Galaxy changed  → copy it down
//   galaxy == base → only this PC changed     → copy it up
//   both changed   → the direction of the operation wins (해 pulls, 달
//                    pushes) and the losing copy is kept under backups/.
//
// Never synced: provider sign-ins and API keys, built-in install markers
// (each PC downloads its own engines), onboarding state, channel bot tokens,
// machine-only desktop switches, and anything credential-shaped (secrets.mjs).
// Also not synced unless this PC opts in with `cosmos.syncRisky=true` (a
// compromised Galaxy must not be able to run code here): hooks, MCP server
// definitions (they name commands) and `cosmos.relayUrl`. The flag itself is
// per PC and never travels. Whole `env` / `headers` blocks and credentials in
// URLs are redacted. Files that are too big, credential-named, or symlinks
// are left alone on both sides: absent from a snapshot never means deleted.
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { readConfig, updateConfig } from '../shared/config.mjs';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { SECRET_PLACEHOLDER, hasRedactionMark, isSecretFile, redactJson, redactText, restoreSecrets, scrubUrlsInText } from './secrets.mjs';
import { cosmosHome } from './star.mjs';

export const SYNCED_CONFIG_KEYS = Object.freeze([
  'outputStyle',
  'memory',
  'agent.profile',
  'agent.presets',
  'agent.default',
  'agent.modelSettings',
  'agent.webSearchRoute',
  'agent.disabledAgents',
  'agent.disabledSkills',
  'agent.agents',
  'agent.modules',
  'agent.maintenance',
  'agent.recap',
  'agent.mcpServers',
  'desktop.activityRailPins',
  'desktop.uiMode',
  'cosmos',
]);

// Data-dir entries mirrored file by file.
export const SYNCED_PATHS = Object.freeze(['skills', 'agents', 'output-styles', 'workflows', 'hooks', 'hooks.json', 'core-memory.json']);
// Opt-in only (see header): the config sections and data-dir entries that can make another star run code or talk to another host.
export const RISKY_CONFIG_KEYS = Object.freeze(['agent.mcpServers']);
export const RISKY_PATHS = Object.freeze(['hooks', 'hooks.json']);
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ENV_ROOT = 'environment';
// Config blocks that hold credentials as a whole, whatever their entries are named.
const SECRET_BLOCK_KEYS = /^(?:env|envs|headers|http_headers)$/i;
const urlMark = (text) => scrubUrlsInText(text, { mark: true });

/** Per-PC opt-in; read from the LOCAL config only, never from the Galaxy. */
export function syncRiskyEnabled(config = readConfig()) {
  return getPath(config, 'cosmos.syncRisky') === true;
}

const riskyKey = (key) =>
  key === 'config/agent.mcpServers.json' || key === 'files/hooks.json' || key.startsWith('files/hooks/');

/** Is this snapshot key one this PC may sync at all? (Everything else in the Galaxy is ignored.) */
function allowedKey(key, risky) {
  if (riskyKey(key) && !risky) return false;
  if (key.startsWith('files/')) {
    const top = key.slice('files/'.length).split('/')[0];
    return SYNCED_PATHS.includes(top);
  }
  if (key.startsWith('config/')) return SYNCED_CONFIG_KEYS.includes(key.slice('config/'.length).replace(/\.json$/, ''));
  return false;
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);
const posix = (path) => path.split(sep).join('/');

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const out = { ...(object || {}) };
  let cursor = out;
  for (let i = 0; i < keys.length - 1; i += 1) {
    cursor[keys[i]] = { ...(cursor[keys[i]] && typeof cursor[keys[i]] === 'object' ? cursor[keys[i]] : {}) };
    cursor = cursor[keys[i]];
  }
  if (value === undefined) delete cursor[keys.at(-1)];
  else cursor[keys.at(-1)] = value;
  return out;
}

const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ------------------------------------------------------------------ state

export function statePath(home = cosmosHome()) {
  return join(home, 'galaxy-state.json');
}

export async function readSyncState(home = cosmosHome()) {
  try {
    const state = JSON.parse(await readFile(statePath(home), 'utf8'));
    return { base: state.base && typeof state.base === 'object' ? state.base : {}, syncedAt: state.syncedAt || 0 };
  } catch {
    return { base: {}, syncedAt: 0 };
  }
}

async function writeSyncState(state, home = cosmosHome()) {
  const path = statePath(home);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, canonical(state), 'utf8');
  await rename(tmp, path);
}

// ------------------------------------------------------------------ redaction

/** Replace whole env/headers blocks by the placeholder (whatever their entries are named). */
function redactBlocks(value) {
  if (Array.isArray(value)) return value.map(redactBlocks);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const filled = item && typeof item === 'object' ? Object.keys(item).length > 0 : typeof item === 'string' && item !== '';
    out[key] = SECRET_BLOCK_KEYS.test(key) && filled ? SECRET_PLACEHOLDER : redactBlocks(item);
  }
  return out;
}

function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

/** What a config section looks like in the Galaxy: no env/headers blocks, no credential keys, no URL credentials. */
export function redactConfigValue(value) {
  return mapStrings(redactJson(redactBlocks(value)).value, urlMark);
}

/** Fill the local real values back in where the incoming copy only has placeholders or scrubbed URLs. */
function restoreConfigValue(incoming, local) {
  const restored = restoreSecrets(incoming, local);
  const back = (value, mine) => {
    if (typeof value === 'string') return typeof mine === 'string' && mine !== value && urlMark(mine) === value ? mine : value;
    if (Array.isArray(value)) return value.map((item, index) => back(item, Array.isArray(mine) ? mine[index] : undefined));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, back(v, mine && typeof mine === 'object' ? mine[k] : undefined)]));
    }
    return value;
  };
  return back(restored, local);
}

/** The `cosmos` section minus what stays per PC: the opt-in flag, and (unless opted in) the relay address. */
function cosmosForSync(value, risky) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { syncRisky: _flag, relayUrl, ...rest } = value;
  return risky && relayUrl !== undefined ? { ...rest, relayUrl } : rest;
}

/** Incoming `cosmos` section merged over the local one: per-PC fields always stay local. */
function cosmosFromSync(incoming, local, risky) {
  const mine = local && typeof local === 'object' && !Array.isArray(local) ? local : {};
  const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? { ...incoming } : {};
  delete next.syncRisky;
  if (!risky) delete next.relayUrl;
  if (!risky && mine.relayUrl !== undefined) next.relayUrl = mine.relayUrl;
  if (mine.syncRisky !== undefined) next.syncRisky = mine.syncRisky;
  return Object.keys(next).length ? next : undefined;
}

// ------------------------------------------------------------------ snapshots

/**
 * Collect the syncable files under root/rel. Files that cannot be synced
 * (symlinks, over the size cap, credential-named) are listed in `skipped`
 * instead of simply not appearing: the planner must never read "absent" as
 * "deleted".
 */
async function walk(root, rel, out, skipped) {
  const abs = join(root, rel);
  let info;
  try {
    info = await lstat(abs);
  } catch {
    return;
  }
  if (info.isSymbolicLink()) {
    skipped.add(posix(rel));
    return;
  }
  if (info.isDirectory()) {
    for (const name of await readdir(abs)) {
      if (name === '.git' || name === 'node_modules' || name.startsWith('.cosmos-')) continue;
      await walk(root, join(rel, name), out, skipped);
    }
    return;
  }
  if (!info.isFile()) return;
  if (info.size > MAX_FILE_BYTES || isSecretFile(rel)) {
    skipped.add(posix(rel));
    return;
  }
  out.set(posix(rel), abs);
}

/** Local side: { snapshot: key → text, skipped: Set of keys that exist but must not sync }. */
export async function localSnapshotDetailed({ dataDir = resolvePluginData(), config = readConfig(), risky = syncRiskyEnabled(config) } = {}) {
  const files = new Map();
  const skippedFiles = new Set();
  for (const entry of SYNCED_PATHS) {
    if (!risky && RISKY_PATHS.includes(entry)) continue;
    await walk(dataDir, entry, files, skippedFiles);
  }
  const snapshot = new Map();
  const skipped = new Set([...skippedFiles].map((rel) => `files/${rel}`));
  for (const [rel, abs] of files) {
    const text = await readFile(abs, 'utf8').catch(() => null);
    if (text === null) {
      skipped.add(`files/${rel}`);
      continue;
    }
    snapshot.set(`files/${rel}`, urlMark(redactText(text).text));
  }
  for (const key of SYNCED_CONFIG_KEYS) {
    if (!risky && RISKY_CONFIG_KEYS.includes(key)) continue;
    let value = getPath(config, key);
    if (key === 'cosmos') value = cosmosForSync(value, risky);
    if (value === undefined || (key === 'cosmos' && value && typeof value === 'object' && !Object.keys(value).length)) continue;
    snapshot.set(`config/${key}.json`, canonical(redactConfigValue(value)));
  }
  return { snapshot, skipped };
}

/** Local side: key → text, for every synced file and config key. */
export async function localSnapshot(options = {}) {
  return (await localSnapshotDetailed(options)).snapshot;
}

/** Galaxy side: key → text under environment/ (plus keys it holds that must not be applied here). */
export async function galaxySnapshotDetailed(galaxy) {
  const files = new Map();
  const skipped = new Set();
  await walk(join(galaxy, ENV_ROOT), '', files, skipped);
  const snapshot = new Map();
  for (const [rel, abs] of files) {
    const text = await readFile(abs, 'utf8').catch(() => null);
    if (text === null) skipped.add(rel);
    else snapshot.set(rel, text);
  }
  return { snapshot, skipped };
}

export async function galaxySnapshot(galaxy) {
  return (await galaxySnapshotDetailed(galaxy)).snapshot;
}

// ------------------------------------------------------------------ plan

/**
 * Decide, per key, what moves where. `direction` breaks ties when both sides
 * changed since the last agreement: 'pull' keeps the Galaxy, 'push' keeps
 * this PC. Keys in `skip` are left exactly as they are on both sides (and
 * dropped from the agreement): they are unsyncable here, which is not a deletion.
 */
export function planSync(local, galaxy, base, direction, { skip = new Set() } = {}) {
  const keys = new Set([...local.keys(), ...galaxy.keys(), ...Object.keys(base)]);
  const plan = { down: [], up: [], conflicts: [], base: {} };
  for (const key of [...keys].sort()) {
    if (skip.has(key)) continue;
    const l = local.has(key) ? sha(local.get(key)) : null;
    const g = galaxy.has(key) ? sha(galaxy.get(key)) : null;
    const b = base[key] ?? null;
    if (l === g) {
      if (l) plan.base[key] = l;
      continue;
    }
    if (l === b) {
      plan.down.push({ key, text: galaxy.get(key) ?? null });
      if (g) plan.base[key] = g;
    } else if (g === b) {
      plan.up.push({ key, text: local.get(key) ?? null });
      if (l) plan.base[key] = l;
    } else {
      const keepGalaxy = direction === 'pull';
      plan.conflicts.push({ key, kept: keepGalaxy ? 'galaxy' : 'local', lost: keepGalaxy ? local.get(key) ?? null : galaxy.get(key) ?? null });
      if (keepGalaxy) {
        plan.down.push({ key, text: galaxy.get(key) ?? null });
        if (g) plan.base[key] = g;
      } else {
        plan.up.push({ key, text: local.get(key) ?? null });
        if (l) plan.base[key] = l;
      }
    }
  }
  return plan;
}

// ------------------------------------------------------------------ apply

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

async function present(path) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

/** Returns the keys it deliberately did not apply. */
async function applyDown(plan, { dataDir, risky }) {
  const configChanges = [];
  const withheld = [];
  for (const { key, text } of plan.down) {
    if (!allowedKey(key, risky)) continue;
    if (key.startsWith('files/')) {
      const target = join(dataDir, key.slice('files/'.length));
      if (relative(dataDir, target).startsWith('..')) continue;
      if (isSecretFile(target)) continue;
      const here = await present(target);
      // Never write through a symlink (it could point anywhere).
      if (here?.isSymbolicLink()) continue;
      if (text === null) {
        await rm(target, { force: true });
        continue;
      }
      // The Galaxy copy has secrets blanked out. Over a real file that would destroy them.
      if (here && hasRedactionMark(text)) {
        withheld.push(key);
        continue;
      }
      await writeText(target, text);
    } else if (key.startsWith('config/')) {
      const configKey = key.slice('config/'.length).replace(/\.json$/, '');
      let value;
      try {
        value = text === null ? undefined : JSON.parse(text);
      } catch {
        continue;
      }
      configChanges.push({ configKey, value });
    }
  }
  if (configChanges.length) {
    updateConfig((config) => {
      let next = config;
      for (const { configKey, value } of configChanges) {
        const local = getPath(config, configKey);
        const restored = configKey === 'cosmos' ? cosmosFromSync(restoreConfigValue(value, local), local, risky) : value === undefined ? undefined : restoreConfigValue(value, local);
        next = setPath(next, configKey, restored);
      }
      return next;
    });
  }
  return withheld;
}

async function applyUp(plan, galaxy) {
  for (const { key, text } of plan.up) {
    const target = join(galaxy, ENV_ROOT, key);
    if (text === null) await rm(target, { force: true });
    else await writeText(target, text);
  }
}

/** Keep what a conflict overwrote (the real local file, when this PC's side lost). */
async function keepLosers(plan, home, dataDir) {
  if (!plan.conflicts.length) return null;
  const dir = join(home, 'backups', 'cosmos-conflicts', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const { key, kept, lost } of plan.conflicts) {
    let text = lost;
    if (kept === 'galaxy' && key.startsWith('files/') && lost !== null) {
      // The snapshot copy is redacted; the file itself is what is about to be replaced.
      text = await readFile(join(dataDir, key.slice('files/'.length)), 'utf8').catch(() => lost);
    }
    if (text === null) continue;
    await writeText(join(dir, key), text);
  }
  return dir;
}

/**
 * Two-way sync inside a Galaxy transaction. Returns a summary; the caller
 * owns the transaction (so 해/달 can bundle the seat change with it).
 */
export async function syncEnvironmentIn(galaxy, { direction, dataDir = resolvePluginData(), home = cosmosHome(), config = readConfig() } = {}) {
  const risky = syncRiskyEnabled(config);
  const state = await readSyncState(home);
  const mine = await localSnapshotDetailed({ dataDir, config, risky });
  const theirs = await galaxySnapshotDetailed(galaxy);
  const skip = new Set([...mine.skipped, ...theirs.skipped]);
  for (const key of [...mine.snapshot.keys(), ...theirs.snapshot.keys(), ...Object.keys(state.base)]) {
    if (!allowedKey(key, risky)) skip.add(key);
  }
  const plan = planSync(mine.snapshot, theirs.snapshot, state.base, direction, { skip });
  await applyUp(plan, galaxy);
  return {
    plan,
    // Local writes and the new base only happen once the Galaxy commit lands.
    async commitLocal() {
      const backupDir = await keepLosers(plan, home, dataDir);
      const withheld = await applyDown(plan, { dataDir, risky });
      // A withheld key stays "agreed" at this PC's own content, so the next
      // sync offers it again instead of uploading the redacted local copy.
      for (const key of withheld) {
        if (mine.snapshot.has(key)) plan.base[key] = sha(mine.snapshot.get(key));
        else delete plan.base[key];
      }
      await writeSyncState({ base: plan.base, syncedAt: Date.now() }, home);
      return {
        down: plan.down.length - withheld.length,
        up: plan.up.length,
        conflicts: plan.conflicts.map(({ key, kept }) => ({ key, kept })),
        withheld,
        backupDir,
      };
    },
  };
}

/** Copy a whole data-dir entry aside before a risky apply (used by the desktop's "되돌리기"). */
export async function backupEnvironment({ dataDir = resolvePluginData(), home = cosmosHome() } = {}) {
  const dir = join(home, 'backups', 'cosmos-environment', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const entry of SYNCED_PATHS) {
    await cp(join(dataDir, entry), join(dir, entry), { recursive: true, force: false, errorOnExist: false }).catch(() => {});
  }
  return dir;
}
