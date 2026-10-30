// A local marker for an 이어받기 that took the seat but may not have finished.
//
// Taking the seat from another machine is two steps: the seat push in the
// Galaxy, then this checkout's rescue (unpushed work → cosmos/rescue-*) and
// catch-up. A crash between them leaves a seat that reads as ours over a
// checkout nobody rescued, and the next 이어받기 would see nothing displaced.
// The marker lives on this machine only (~/.mixdog/galaxy-pending-rescue.json)
// and is cleared once the checkout caught up.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './fs-atomic.mjs';
import { cosmosHome } from './star.mjs';

export function pendingRescuePath(home = cosmosHome()) {
  return join(home, 'galaxy-pending-rescue.json');
}

async function readAll(home) {
  try {
    const value = JSON.parse(await readFile(pendingRescuePath(home), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function writeAll(home, value) {
  await writeJsonAtomic(pendingRescuePath(home), value);
}

export async function markPendingRescue(home, planetId, { star, at = Date.now() } = {}) {
  const all = await readAll(home);
  all[planetId] = { star: String(star || ''), at };
  await writeAll(home, all);
}

/** { star, at } or null. */
export async function readPendingRescue(home, planetId) {
  const entry = (await readAll(home))[planetId];
  return entry && typeof entry.star === 'string' ? entry : null;
}

export async function clearPendingRescue(home, planetId) {
  const all = await readAll(home);
  if (!(planetId in all)) return;
  delete all[planetId];
  await writeAll(home, all);
}
