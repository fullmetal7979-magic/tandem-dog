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
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { readConfig, updateConfig } from '../shared/config.mjs';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { isSecretFile, redactJson, redactText, restoreSecrets } from './secrets.mjs';
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
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ENV_ROOT = 'environment';

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

// ------------------------------------------------------------------ snapshots

async function walk(root, rel, out) {
  const abs = join(root, rel);
  let info;
  try {
    info = await stat(abs);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    for (const name of await readdir(abs)) {
      if (name === '.git' || name === 'node_modules' || name.startsWith('.cosmos-')) continue;
      await walk(root, join(rel, name), out);
    }
    return;
  }
  if (!info.isFile() || info.size > MAX_FILE_BYTES || isSecretFile(rel)) return;
  out.set(posix(rel), abs);
}

/** Local side: key → text, for every synced file and config key. */
export async function localSnapshot({ dataDir = resolvePluginData(), config = readConfig() } = {}) {
  const files = new Map();
  for (const entry of SYNCED_PATHS) await walk(dataDir, entry, files);
  const snapshot = new Map();
  for (const [rel, abs] of files) {
    const text = await readFile(abs, 'utf8');
    snapshot.set(`files/${rel}`, redactText(text).text);
  }
  for (const key of SYNCED_CONFIG_KEYS) {
    const value = getPath(config, key);
    if (value === undefined) continue;
    snapshot.set(`config/${key}.json`, canonical(redactJson(value).value));
  }
  return snapshot;
}

/** Galaxy side: key → text under environment/. */
export async function galaxySnapshot(galaxy) {
  const files = new Map();
  await walk(join(galaxy, ENV_ROOT), '', files);
  const snapshot = new Map();
  for (const [rel, abs] of files) snapshot.set(rel, await readFile(abs, 'utf8'));
  return snapshot;
}

// ------------------------------------------------------------------ plan

/**
 * Decide, per key, what moves where. `direction` breaks ties when both sides
 * changed since the last agreement: 'pull' keeps the Galaxy, 'push' keeps
 * this PC.
 */
export function planSync(local, galaxy, base, direction) {
  const keys = new Set([...local.keys(), ...galaxy.keys(), ...Object.keys(base)]);
  const plan = { down: [], up: [], conflicts: [], base: {} };
  for (const key of [...keys].sort()) {
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

async function applyDown(plan, { dataDir }) {
  const configChanges = [];
  for (const { key, text } of plan.down) {
    if (key.startsWith('files/')) {
      const target = join(dataDir, key.slice('files/'.length));
      if (relative(dataDir, target).startsWith('..')) continue;
      if (text === null) await rm(target, { force: true });
      else await writeText(target, text);
    } else if (key.startsWith('config/')) {
      const configKey = key.slice('config/'.length).replace(/\.json$/, '');
      if (!SYNCED_CONFIG_KEYS.includes(configKey)) continue;
      configChanges.push({ configKey, value: text === null ? undefined : JSON.parse(text) });
    }
  }
  if (configChanges.length) {
    updateConfig((config) => {
      let next = config;
      for (const { configKey, value } of configChanges) {
        const restored = value === undefined ? undefined : restoreSecrets(value, getPath(config, configKey));
        next = setPath(next, configKey, restored);
      }
      return next;
    });
  }
}

async function applyUp(plan, galaxy) {
  for (const { key, text } of plan.up) {
    const target = join(galaxy, ENV_ROOT, key);
    if (text === null) await rm(target, { force: true });
    else await writeText(target, text);
  }
}

async function keepLosers(plan, home) {
  if (!plan.conflicts.length) return null;
  const dir = join(home, 'backups', 'cosmos-conflicts', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const { key, lost } of plan.conflicts) {
    if (lost === null) continue;
    await writeText(join(dir, key), lost);
  }
  return dir;
}

/**
 * Two-way sync inside a Galaxy transaction. Returns a summary; the caller
 * owns the transaction (so 해/달 can bundle the seat change with it).
 */
export async function syncEnvironmentIn(galaxy, { direction, dataDir = resolvePluginData(), home = cosmosHome() } = {}) {
  const state = await readSyncState(home);
  const plan = planSync(await localSnapshot({ dataDir }), await galaxySnapshot(galaxy), state.base, direction);
  await applyUp(plan, galaxy);
  return {
    plan,
    // Local writes and the new base only happen once the Galaxy commit lands.
    async commitLocal() {
      await applyDown(plan, { dataDir });
      const backupDir = await keepLosers(plan, home);
      await writeSyncState({ base: plan.base, syncedAt: Date.now() }, home);
      return {
        down: plan.down.length,
        up: plan.up.length,
        conflicts: plan.conflicts.map(({ key, kept }) => ({ key, kept })),
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
