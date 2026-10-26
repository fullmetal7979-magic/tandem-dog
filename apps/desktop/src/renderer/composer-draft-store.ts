import type { ComposerAttachment } from './composer-support';

export type SavedComposerDraft = { text: string; attachments: ComposerAttachment[] };

/** Small per-draft row: pruning and the recovery list read only these. */
type DraftMeta = {
  scope: string;
  updatedAt: number;
  chars: number;
  attachmentCount: number;
  preview: string;
  /** 1 for a `replaced:` safety copy. Those keep their own cap so restoring
   *  old drafts can never evict the live drafts of open tabs. */
  replaced: 0 | 1;
};
type TextRow = { scope: string; text: string };
type AttachmentRow = { scope: string; attachments: ComposerAttachment[] };
/** Version 1 kept text, attachments and metadata in one row. */
type LegacyDraft = SavedComposerDraft & { scope: string; updatedAt: number; chars: number };

const DB_NAME = 'cosmos-composer-drafts-v1';
const DB_VERSION = 2;
const LEGACY_STORE = 'drafts';
const META = 'meta';
const TEXTS = 'texts';
const ATTACHMENTS = 'attachments';
const MAX_DRAFTS = 20;
const MAX_REPLACED = 5;
const MAX_CHARS = 128_000_000;
const MAX_TOTAL_CHARS = 256_000_000;
const MAX_AGE = 7 * 24 * 60 * 60_000;
const PRUNE_INTERVAL = 60_000;
/** The in-memory copy only speeds up tab switches; IndexedDB stays the
 *  recovery source, so a few MB (UTF-16) is plenty. */
const MAX_MEMORY_DRAFTS = 20;
const MAX_MEMORY_CHARS = 2_000_000;
const REPLACED_PREFIX = 'replaced:';

const memory = new Map<string, SavedComposerDraft>();
let database: Promise<IDBDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();
let lastPruneAt = 0;

// Attachments are immutable objects (an edit creates a new one), so object
// identity tells whether a draft's attachments changed since they were last
// written. Typing then rewrites only the text row, never the binary data.
const attachmentIdentity = new WeakMap<ComposerAttachment, number>();
let attachmentSequence = 0;
const writtenAttachments = new Map<string, string>();
function attachmentSignature(attachments: readonly ComposerAttachment[]): string {
  return attachments
    .map((item) => {
      let id = attachmentIdentity.get(item);
      if (id === undefined) attachmentIdentity.set(item, (id = ++attachmentSequence));
      return id;
    })
    .join(',');
}

function isReplacedScope(scope: string): boolean {
  return scope.startsWith(REPLACED_PREFIX);
}

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Draft storage is unavailable.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const meta = db.objectStoreNames.contains(META)
        ? request.transaction!.objectStore(META)
        : db.createObjectStore(META, { keyPath: 'scope' });
      if (!meta.indexNames.contains('updatedAt')) meta.createIndex('updatedAt', 'updatedAt');
      const texts = db.objectStoreNames.contains(TEXTS)
        ? request.transaction!.objectStore(TEXTS)
        : db.createObjectStore(TEXTS, { keyPath: 'scope' });
      const attachments = db.objectStoreNames.contains(ATTACHMENTS)
        ? request.transaction!.objectStore(ATTACHMENTS)
        : db.createObjectStore(ATTACHMENTS, { keyPath: 'scope' });
      if (!db.objectStoreNames.contains(LEGACY_STORE)) return;
      // Split every version-1 row into metadata, text and attachments.
      const cursor = request.transaction!.objectStore(LEGACY_STORE).openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) {
          db.deleteObjectStore(LEGACY_STORE);
          return;
        }
        const row = entry.value as LegacyDraft;
        const saved = { text: String(row.text || ''), attachments: Array.isArray(row.attachments) ? row.attachments : [] };
        meta.put(metaRow(row.scope, saved, row.chars || draftStorageChars(saved), row.updatedAt || Date.now()));
        texts.put({ scope: row.scope, text: saved.text } satisfies TextRow);
        if (saved.attachments.length) attachments.put({ scope: row.scope, attachments: saved.attachments } satisfies AttachmentRow);
        entry.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another window upgrading the schema must not wait on this handle.
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Draft storage is blocked by another window.'));
  }).catch(error => { database = undefined; throw error; });
}

function metaRow(scope: string, draft: SavedComposerDraft, chars: number, updatedAt: number): DraftMeta {
  return {
    scope,
    updatedAt,
    chars,
    attachmentCount: draft.attachments.length,
    preview: draft.text.slice(0, 140),
    replaced: isReplacedScope(scope) ? 1 : 0,
  };
}

export function draftStorageChars(draft: SavedComposerDraft): number {
  return draft.text.length + draft.attachments.reduce((total, item) => total + item.data.length + item.name.length + item.token.length, 0);
}

/** IndexedDB stays in this device's app profile. Binary attachments never go
 * into localStorage, cloud sync, or a provider request as part of autosave. */
export function rememberComposerDraft(scope: string, draft: SavedComposerDraft): void {
  memory.delete(scope);
  // `replaced:` copies are recovery-only and never read back on a tab switch.
  if (isReplacedScope(scope)) return;
  memory.set(scope, { text: draft.text, attachments: [...draft.attachments] });
  while (memory.size > MAX_MEMORY_DRAFTS) memory.delete(memory.keys().next().value!);
  let total = 0;
  for (const [key, saved] of [...memory].reverse()) {
    total += draftStorageChars(saved);
    if (total > MAX_MEMORY_CHARS) memory.delete(key);
  }
}

function requestValue<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export async function readComposerDraft(scope: string): Promise<SavedComposerDraft | undefined> {
  const cached = memory.get(scope);
  if (cached) return { text: cached.text, attachments: [...cached.attachments] };
  await writes;
  const db = await openDatabase();
  const transaction = db.transaction([META, TEXTS, ATTACHMENTS]);
  const [meta, text, attachments] = await Promise.all([
    requestValue<DraftMeta | undefined>(transaction.objectStore(META).get(scope)),
    requestValue<TextRow | undefined>(transaction.objectStore(TEXTS).get(scope)),
    requestValue<AttachmentRow | undefined>(transaction.objectStore(ATTACHMENTS).get(scope)),
  ]);
  if (!meta || Date.now() - meta.updatedAt > MAX_AGE) return undefined;
  const draft = { text: text?.text ?? '', attachments: attachments?.attachments ?? [] };
  // These objects ARE what is stored, so an unchanged chip is not rewritten.
  writtenAttachments.set(scope, attachmentSignature(draft.attachments));
  rememberComposerDraft(scope, draft);
  return { text: draft.text, attachments: [...draft.attachments] };
}

/** Drop the oldest rows beyond the live/`replaced:` caps, the total size cap,
 *  or the age limit. Only the small metadata rows are walked. */
function pruneDrafts(transaction: IDBTransaction): void {
  const meta = transaction.objectStore(META);
  const counts = [0, 0];
  let total = 0;
  const cursor = meta.index('updatedAt').openCursor(null, 'prev');
  cursor.onsuccess = () => {
    const entry = cursor.result;
    if (!entry) return;
    const row = entry.value as DraftMeta;
    const kind = row.replaced ? 1 : 0;
    counts[kind] += 1;
    total += row.chars || 0;
    if (counts[kind] > (kind ? MAX_REPLACED : MAX_DRAFTS) || total > MAX_TOTAL_CHARS || Date.now() - row.updatedAt > MAX_AGE) {
      entry.delete();
      transaction.objectStore(TEXTS).delete(row.scope);
      transaction.objectStore(ATTACHMENTS).delete(row.scope);
      writtenAttachments.delete(row.scope);
      memory.delete(row.scope);
    }
    entry.continue();
  };
}

export function saveComposerDraft(scope: string, draft: SavedComposerDraft): Promise<void> {
  rememberComposerDraft(scope, draft);
  const text = draft.text;
  const attachments = [...draft.attachments];
  const signature = attachmentSignature(attachments);
  const chars = draftStorageChars({ text, attachments });
  const job = writes.catch(() => {}).then(async () => {
    if (chars > MAX_CHARS) throw new Error('Draft attachments exceed the local recovery storage limit.');
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([META, TEXTS, ATTACHMENTS], 'readwrite');
      const meta = transaction.objectStore(META);
      const empty = !text.trim() && !attachments.length;
      const attachmentsChanged = writtenAttachments.get(scope) !== signature;
      if (empty) {
        meta.delete(scope);
        transaction.objectStore(TEXTS).delete(scope);
        transaction.objectStore(ATTACHMENTS).delete(scope);
      } else {
        const existing = meta.getKey(scope);
        existing.onsuccess = () => {
          meta.put(metaRow(scope, { text, attachments }, chars, Date.now()));
          transaction.objectStore(TEXTS).put({ scope, text } satisfies TextRow);
          // Binary data is written only when the chip set actually changed.
          if (attachmentsChanged || existing.result === undefined) {
            if (attachments.length) {
              transaction.objectStore(ATTACHMENTS).put({ scope, attachments: attachments.map(item => ({ ...item })) } satisfies AttachmentRow);
            } else transaction.objectStore(ATTACHMENTS).delete(scope);
          }
          const now = Date.now();
          if (existing.result === undefined || now - lastPruneAt > PRUNE_INTERVAL) {
            lastPruneAt = now;
            pruneDrafts(transaction);
          }
        };
      }
      transaction.oncomplete = () => {
        if (empty) writtenAttachments.delete(scope);
        else writtenAttachments.set(scope, signature);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Draft save was interrupted.'));
    });
  });
  writes = job.catch(() => {});
  return job;
}

/** Keeps a copy of a draft that a restore is about to overwrite. These rows
 *  are capped separately from live drafts and never enter the memory cache. */
export function saveReplacedComposerDraft(scope: string, draft: SavedComposerDraft): Promise<void> {
  return saveComposerDraft(`${REPLACED_PREFIX}${scope}:${Date.now()}`, draft);
}

export type ComposerDraftSummary = { scope: string; updatedAt: number; chars: number; preview: string; attachmentCount: number };
export async function listComposerDrafts(): Promise<ComposerDraftSummary[]> {
  await writes; const db=await openDatabase();
  const rows = await requestValue<DraftMeta[]>(db.transaction(META).objectStore(META).getAll());
  return rows.filter(row=>Date.now()-row.updatedAt<=MAX_AGE)
    .sort((a,b)=>b.updatedAt-a.updatedAt).map(row=>({scope:row.scope,updatedAt:row.updatedAt,chars:row.chars,
      preview:row.preview,attachmentCount:row.attachmentCount}));
}
export function deleteComposerDraft(scope: string): Promise<void> {
  memory.delete(scope);
  const job=writes.catch(()=>{}).then(async()=>{const db=await openDatabase();await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction([META,TEXTS,ATTACHMENTS],'readwrite');
    for(const name of [META,TEXTS,ATTACHMENTS])tx.objectStore(name).delete(scope);
    tx.oncomplete=()=>{writtenAttachments.delete(scope);resolve();};tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Draft delete was interrupted.'));
  });});writes=job.catch(()=>{});return job;
}
