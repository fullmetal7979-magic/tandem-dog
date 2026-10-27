// 교신 (conversation) carried between stars.
//
// 달 exports the planet's open conversation into the Galaxy; 해 on another star
// reads it back and continues it under whatever AI account that star is
// signed in to. Only the conversation travels — never the raw session file,
// which holds absolute paths, process ids, provider cache keys and account
// state. Token-shaped strings are redacted on the way out.
import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { readGalaxyJson, writeGalaxyJson } from './galaxy-repo.mjs';
import { planetSlug } from './planet.mjs';
import { redactJson } from './secrets.mjs';

// Every conversation is committed to a repository all stars clone: keep each small.
export const CONVERSATION_LIMIT_BYTES = 2 * 1024 * 1024;
const KEEP_PER_PLANET = 6;

export function conversationsDir(planetId) {
  return `conversations/${planetSlug(planetId)}`;
}

/** A session id that is safe as a file name: no separators, no leading dots, never 'latest'. */
export function safeConversationId(id) {
  const clean = String(id ?? '')
    .replace(/[^\w.-]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 120);
  if (clean === 'latest') return 'latest-';
  // An id with nothing path-safe in it (non-ASCII only) still needs a stable name.
  return clean || (id ? `c-${createHash('sha1').update(String(id)).digest('hex').slice(0, 12)}` : '');
}

/** `galaxy` is a Galaxy working-copy path (inside a transaction) or a galaxyReader() (outside one). */
function sourceOf(galaxy) {
  if (typeof galaxy !== 'string') return galaxy;
  return {
    json: (rel) => readGalaxyJson(galaxy, rel),
    names: async (relDir) => {
      try {
        return await readdir(join(galaxy, relDir));
      } catch {
        return [];
      }
    },
  };
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
    taskId: String(session?.cosmosTaskId || session?.inheritedFromSessionId || session?.id || ''),
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
  const id = safeConversationId(doc?.id);
  if (!id || !doc.planet) throw new Error('conversation export needs an id and a planet');
  const dir = conversationsDir(doc.planet);
  await writeGalaxyJson(galaxy, `${dir}/${id}.json`, { ...doc, id });
  await writeGalaxyJson(galaxy, `${dir}/latest.json`, {
    id,
    title: doc.title,
    star: doc.star,
    exportedAt: doc.exportedAt,
    messageCount: doc.messageCount,
  });
  // The document just written always stays: another machine's clock running
  // ahead must not make it look like the oldest one and prune it at once.
  const entries = (await listConversationsIn(galaxy, doc.planet)).filter((entry) => entry.file !== id);
  for (const stale of entries.slice(KEEP_PER_PLANET - 1)) {
    // `file` comes from the directory listing, never from the document's own id field.
    await rm(join(galaxy, dir, `${stale.file}.json`), { force: true });
  }
}

/** Newest first: [{ id, file, title, star, exportedAt, messageCount }]. */
export async function listConversationsIn(galaxy, planetId) {
  const dir = conversationsDir(planetId);
  const source = sourceOf(galaxy);
  const docs = [];
  for (const name of await source.names(dir)) {
    if (!name.endsWith('.json') || name === 'latest.json') continue;
    const doc = await source.json(`${dir}/${name}`);
    if (doc?.id) {
      docs.push({ id: doc.id, file: name.slice(0, -'.json'.length), title: doc.title, star: doc.star, exportedAt: doc.exportedAt, messageCount: doc.messageCount });
    }
  }
  // Ties (same millisecond, or no timestamp) break on the file name, so every
  // machine prunes the same documents.
  return docs.sort((a, b) => (b.exportedAt || 0) - (a.exportedAt || 0) || (a.file < b.file ? 1 : a.file > b.file ? -1 : 0));
}

export async function readConversationIn(galaxy, planetId, id = null) {
  const dir = conversationsDir(planetId);
  const source = sourceOf(galaxy);
  const target = safeConversationId(id || (await source.json(`${dir}/latest.json`))?.id);
  if (!target) return null;
  return source.json(`${dir}/${target}.json`);
}
