// 교신 (conversation) carried between stars.
//
// 달 exports the planet's open conversation into the Galaxy; 해 on another star
// reads it back and continues it under whatever AI account that star is
// signed in to. Only the conversation travels — never the raw session file,
// which holds absolute paths, process ids, provider cache keys and account
// state. Token-shaped strings are redacted on the way out.
import { readdir, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { readGalaxyJson, writeGalaxyJson } from './galaxy-repo.mjs';
import { planetSlug } from './planet.mjs';
import { redactJson } from './secrets.mjs';

export const CONVERSATION_LIMIT_BYTES = 8 * 1024 * 1024;
const KEEP_PER_PLANET = 6;

export function conversationsDir(planetId) {
  return `conversations/${planetSlug(planetId)}`;
}

const conversational = (messages) => (Array.isArray(messages) ? messages : []).filter((message) => message?.role !== 'system');

/** Trim from the oldest end until the document fits, keeping a user turn first. */
function fitMessages(messages, limit) {
  let carried = messages;
  while (carried.length > 2 && Buffer.byteLength(JSON.stringify(carried)) > limit) {
    carried = carried.slice(Math.ceil(carried.length / 8));
    const firstUser = carried.findIndex((message) => message?.role === 'user');
    carried = firstUser > 0 ? carried.slice(firstUser) : carried;
  }
  return carried;
}

/** Pure: the portable document for `session` (a runtime session object). */
export function buildConversationExport(session, { planetId, planetRoot, star, now = Date.now(), limit = CONVERSATION_LIMIT_BYTES } = {}) {
  const messages = conversational(session?.messages);
  const { value: redacted, count } = redactJson(messages);
  const fitted = fitMessages(redacted, limit);
  const cwd = String(session?.cwd || '');
  const rel = planetRoot && cwd ? relative(planetRoot, cwd).split(sep).join('/') : '';
  return {
    v: 1,
    id: String(session?.id || ''),
    planet: planetId,
    title: String(session?.title || '').slice(0, 200),
    provider: String(session?.provider || ''),
    model: String(session?.model || ''),
    cwd: rel.startsWith('..') ? '' : rel,
    star: star ? { id: star.id, name: star.name, kind: star.kind } : null,
    exportedAt: now,
    updatedAt: Number(session?.updatedAt) || now,
    messageCount: fitted.length,
    trimmed: fitted.length < redacted.length,
    redactions: count,
    messages: fitted,
  };
}

/** Write inside a Galaxy transaction; keeps the newest few per planet. */
export async function writeConversationIn(galaxy, doc) {
  if (!doc?.id || !doc.planet) throw new Error('conversation export needs an id and a planet');
  const dir = conversationsDir(doc.planet);
  await writeGalaxyJson(galaxy, `${dir}/${doc.id}.json`, doc);
  await writeGalaxyJson(galaxy, `${dir}/latest.json`, {
    id: doc.id,
    title: doc.title,
    star: doc.star,
    exportedAt: doc.exportedAt,
    messageCount: doc.messageCount,
  });
  const entries = await listConversationsIn(galaxy, doc.planet);
  for (const stale of entries.slice(KEEP_PER_PLANET)) {
    await rm(join(galaxy, dir, `${stale.id}.json`), { force: true });
  }
}

/** Newest first: [{ id, title, star, exportedAt, messageCount }]. */
export async function listConversationsIn(galaxy, planetId) {
  const dir = conversationsDir(planetId);
  let names = [];
  try {
    names = await readdir(join(galaxy, dir));
  } catch {
    return [];
  }
  const docs = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'latest.json') continue;
    const doc = await readGalaxyJson(galaxy, `${dir}/${name}`);
    if (doc?.id) {
      docs.push({ id: doc.id, title: doc.title, star: doc.star, exportedAt: doc.exportedAt, messageCount: doc.messageCount });
    }
  }
  return docs.sort((a, b) => (b.exportedAt || 0) - (a.exportedAt || 0));
}

export async function readConversationIn(galaxy, planetId, id = null) {
  const dir = conversationsDir(planetId);
  const target = id || (await readGalaxyJson(galaxy, `${dir}/latest.json`))?.id;
  if (!target) return null;
  return readGalaxyJson(galaxy, `${dir}/${String(target).replace(/[^\w.-]/g, '')}.json`);
}
