// 별 (star): this device's identity in the Galaxy.
//
// Every PC/Mac (and every phone, through the PC it drives) is one star with a
// stable random id, a user-chosen name and a colour. The record lives outside
// the Galaxy repository (~/.mixdog/star.json) because it describes THIS
// machine; the Galaxy keeps a published copy under stars/<id>.json.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { hostname, platform } from 'node:os';
import { join } from 'node:path';
import { mixdogHome } from '../shared/plugin-paths.mjs';
import { writeJsonAtomic } from './fs-atomic.mjs';

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

export const STAR_NAME_LIMIT = 40;
const STAR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first `limit` user-perceived characters: an emoji or a Hangul syllable is never cut in half. */
export function clipText(value, limit) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  if (typeof Intl?.Segmenter === 'function') {
    let out = '';
    let count = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      if (count === limit) break;
      out += segment;
      count += 1;
    }
    return out;
  }
  return Array.from(text).slice(0, limit).join('');
}

function cleanName(value) {
  return clipText(String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim(), STAR_NAME_LIMIT).trim();
}

export function isStarId(value) {
  return STAR_ID.test(String(value ?? ''));
}

export function normalizeStar(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  const id = isStarId(record.id) ? String(record.id) : randomUUID();
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

/**
 * A star.json that no longer parses (a crash mid-write on an old version, a
 * bad hand edit) still names this device: keep a copy of it, and keep its id
 * when one can be read out of it, so the device does not silently become a
 * stranger to its own seat.
 */
async function salvageStar(path, text) {
  await copyFile(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
  const id = /"id"\s*:\s*"([0-9a-fA-F-]{36})"/.exec(text)?.[1];
  const name = /"name"\s*:\s*"([^"\\]{1,80})"/.exec(text)?.[1];
  return isStarId(id) ? { id, ...(name ? { name } : {}) } : null;
}

/** This device's star, created on first use. */
export async function ensureStar(home = cosmosHome()) {
  const path = starFilePath(home);
  let raw = null;
  let text = null;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    // Missing: a new star. Unreadable for another reason: do not overwrite it.
    if (error?.code !== 'ENOENT') throw error;
  }
  if (text !== null) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = await salvageStar(path, text);
    }
  }
  const star = normalizeStar(raw);
  if (!raw || JSON.stringify(raw) !== JSON.stringify(star)) await writeJsonAtomic(path, star);
  return star;
}

/** Only fields that validate are applied; a bad colour or kind keeps the current one instead of resetting it. */
export async function updateStar(patch, home = cosmosHome()) {
  const current = await ensureStar(home);
  const change = patch && typeof patch === 'object' ? patch : {};
  const accepted = {};
  if (change.name !== undefined && cleanName(change.name)) accepted.name = change.name;
  if (STAR_COLORS.includes(change.color)) accepted.color = change.color;
  if (STAR_KINDS.includes(change.kind)) accepted.kind = change.kind;
  const next = normalizeStar({ ...current, ...accepted, id: current.id, createdAt: current.createdAt });
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

/**
 * The star of a phone driving this PC over the relay. Phones have no
 * ~/.mixdog of their own: the id is derived from the phone's browser id, so
 * the same phone is the same star on every PC it pairs with.
 */
export function guestStar(guest, hostStar = null) {
  const browserId = String(guest?.id ?? '').trim();
  if (!browserId) throw new TypeError('guest id is required.');
  const digest = createHash('sha256').update(`cosmos-phone:${browserId}`).digest('hex');
  return {
    v: 1,
    id: `phone-${digest.slice(0, 16)}`,
    name: cleanName(guest?.name) || '내 폰',
    color: STAR_COLORS[parseInt(digest.slice(0, 2), 16) % STAR_COLORS.length],
    kind: 'phone',
    os: 'phone',
    host: hostStar?.name || null,
    createdAt: 0,
  };
}
