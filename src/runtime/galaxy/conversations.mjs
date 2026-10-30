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
  // `latest` and `index` name the planet's own pointer files.
  if (clean === 'latest' || clean === 'index') return `${clean}-`;
  // An id with nothing path-safe in it (non-ASCII only) still needs a stable name.
  return clean || (id ? `c-${createHash('sha1').update(String(id)).digest('hex').slice(0, 12)}` : '');
}

/** `galaxy` is a Galaxy working-copy path (inside a transaction) or a galaxyReader() (outside one). */
function sourceOf(galaxy) {
  if (typeof galaxy !== 'string') return galaxy;
  return {
    json: (rel) => readGalaxyJson(galaxy, rel),
    jsonMany: (rels) => Promise.all(rels.map((rel) => readGalaxyJson(galaxy, rel))),
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

const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value));
const CLIP_FLOOR = 2_000;

/**
 * The longest string anywhere in `value`, as [holder, key, length] — a pasted
 * log or a tool result is usually what makes one message too big to carry.
 */
function longestString(value, best = null) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === 'string') {
        if (!best || item.length > best[2]) best = [value, index, item.length];
      } else best = longestString(item, best);
    });
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (!best || item.length > best[2]) best = [value, key, item.length];
      } else best = longestString(item, best);
    }
  }
  return best;
}

/**
 * Trim from the oldest end until the document fits, keeping a user turn
 * first. When a few messages are still too big on their own, their longest
 * texts are cut in the middle (head and tail kept) until the whole fits.
 * Returns { messages, clipped } (clipped: how many texts were cut).
 */
function fitMessages(messages, limit) {
  let carried = messages;
  while (carried.length > 2 && bytesOf(carried) > limit) {
    carried = carried.slice(Math.ceil(carried.length / 8));
    const firstUser = carried.findIndex((message) => message?.role === 'user');
    carried = firstUser > 0 ? carried.slice(firstUser) : carried;
  }
  let clipped = 0;
  if (bytesOf(carried) > limit) {
    carried = structuredClone(carried);
    for (let guard = 0; guard < 200 && bytesOf(carried) > limit; guard += 1) {
      const target = longestString(carried);
      if (!target || target[2] <= CLIP_FLOOR) break;
      const [holder, key, length] = target;
      const keep = Math.max(CLIP_FLOOR, Math.floor(length / 2));
      const text = holder[key];
      const head = text.slice(0, Math.ceil(keep / 2));
      const tail = text.slice(text.length - Math.floor(keep / 2));
      holder[key] = `${head}\n…[은하수로 옮기며 ${length - keep}자를 줄였어요]…\n${tail}`;
      clipped += 1;
    }
  }
  return { messages: carried, clipped };
}

/** Pure: the portable document for `session` (a runtime session object). */
export function buildConversationExport(session, { planetId, planetRoot, star, now = Date.now(), limit = CONVERSATION_LIMIT_BYTES } = {}) {
  const messages = conversational(session?.messages);
  const { value: redacted, count } = redactJson(messages);
  const { messages: fitted, clipped } = fitMessages(redacted, limit);
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
    trimmed: fitted.length < redacted.length || clipped > 0,
    ...(clipped ? { clipped } : {}),
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
  const all = await listConversationsIn(galaxy, doc.planet, { useIndex: false });
  const others = all.filter((entry) => entry.file !== id);
  const pruned = new Set();
  for (const stale of others.slice(KEEP_PER_PLANET - 1)) {
    // `file` comes from the directory listing, never from the document's own id field.
    await rm(join(galaxy, dir, `${stale.file}.json`), { force: true });
    pruned.add(stale.file);
  }
  // The listing every screen polls: metadata only, so nobody parses
  // megabytes of messages to draw a list.
  await writeGalaxyJson(galaxy, `${dir}/${INDEX_FILE}`, { v: 1, conversations: all.filter((entry) => !pruned.has(entry.file)) });
}

const INDEX_FILE = 'index.json';
const POINTER_FILES = new Set(['latest.json', INDEX_FILE]);
const metaOf = (doc, file) => ({ id: doc.id, file, title: doc.title, star: doc.star, exportedAt: doc.exportedAt, messageCount: doc.messageCount });
// Ties (same millisecond, or no timestamp) break on the file name, so every
// machine prunes the same documents.
const newestFirst = (a, b) => (b.exportedAt || 0) - (a.exportedAt || 0) || (a.file < b.file ? 1 : a.file > b.file ? -1 : 0);

/**
 * Newest first: [{ id, file, title, star, exportedAt, messageCount }].
 * Answers from index.json when it names exactly the documents present (an
 * older COSMOS that wrote a document without it is noticed and read in full).
 */
export async function listConversationsIn(galaxy, planetId, { useIndex = true } = {}) {
  const dir = conversationsDir(planetId);
  const source = sourceOf(galaxy);
  const files = (await source.names(dir)).filter((name) => name.endsWith('.json') && !POINTER_FILES.has(name)).map((name) => name.slice(0, -'.json'.length));
  if (useIndex) {
    const index = await source.json(`${dir}/${INDEX_FILE}`);
    const listed = Array.isArray(index?.conversations) ? index.conversations.filter((entry) => entry?.id && typeof entry.file === 'string') : null;
    if (listed && listed.length === files.length && listed.every((entry) => files.includes(entry.file))) {
      return listed.map((entry) => metaOf(entry, entry.file)).sort(newestFirst);
    }
  }
  const docs = await source.jsonMany(files.map((file) => `${dir}/${file}.json`));
  return docs
    .map((doc, at) => (doc?.id ? metaOf(doc, files[at]) : null))
    .filter(Boolean)
    .sort(newestFirst);
}

export async function readConversationIn(galaxy, planetId, id = null) {
  const dir = conversationsDir(planetId);
  const source = sourceOf(galaxy);
  const target = safeConversationId(id || (await source.json(`${dir}/latest.json`))?.id);
  if (!target) return null;
  return source.json(`${dir}/${target}.json`);
}
