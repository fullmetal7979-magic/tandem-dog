// 별 (star): this device's identity in the Galaxy.
//
// Every PC/Mac (and every phone, through the PC it drives) is one star with a
// stable random id, a user-chosen name and a colour. The record lives outside
// the Galaxy repository (~/.mixdog/star.json) because it describes THIS
// machine; the Galaxy keeps a published copy under stars/<id>.json.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { mixdogHome } from '../shared/plugin-paths.mjs';

// Eight distinct, colour-blind-separable hues; a star keeps the one it got.
export const STAR_COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9'];
export const STAR_KINDS = ['pc', 'mac', 'phone'];

export function cosmosHome() {
  return mixdogHome();
}

export function starFilePath(home = cosmosHome()) {
  return join(home, 'star.json');
}

export function defaultStarKind() {
  return platform() === 'darwin' ? 'mac' : 'pc';
}

export function defaultStarName() {
  const host = hostname().replace(/\.local$/i, '');
  return platform() === 'darwin' ? `${host} 맥` : `${host} PC`;
}

function cleanName(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function normalizeStar(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  const id = /^[0-9a-f-]{36}$/i.test(String(record.id || '')) ? String(record.id) : randomUUID();
  const color = STAR_COLORS.includes(record.color) ? record.color : STAR_COLORS[parseInt(id.slice(0, 2), 16) % STAR_COLORS.length];
  return {
    v: 1,
    id,
    name: cleanName(record.name) || defaultStarName(),
    color,
    kind: STAR_KINDS.includes(record.kind) ? record.kind : defaultStarKind(),
    os: platform(),
    host: hostname(),
    createdAt: Number(record.createdAt) || Date.now(),
  };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

/** This device's star, created on first use. */
export async function ensureStar(home = cosmosHome()) {
  const path = starFilePath(home);
  let raw = null;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    raw = null;
  }
  const star = normalizeStar(raw);
  if (!raw || JSON.stringify(raw) !== JSON.stringify(star)) await writeJsonAtomic(path, star);
  return star;
}

export async function updateStar(patch, home = cosmosHome()) {
  const current = await ensureStar(home);
  const next = normalizeStar({ ...current, ...patch, id: current.id, createdAt: current.createdAt });
  await writeJsonAtomic(starFilePath(home), next);
  return next;
}

/** The fields other stars see (stars/<id>.json in the Galaxy). */
export function publicStar(star, extra = {}) {
  return {
    v: 1,
    id: star.id,
    name: star.name,
    color: star.color,
    kind: star.kind,
    os: star.os,
    host: star.host,
    seenAt: Date.now(),
    ...extra,
  };
}
