import type { ComposerAttachment } from './composer-support';

export type SavedComposerDraft = { text: string; attachments: ComposerAttachment[] };
type StoredDraft = SavedComposerDraft & { scope: string; updatedAt: number; chars: number };
const DB_NAME = 'cosmos-composer-drafts-v1';
const STORE = 'drafts';
const MAX_DRAFTS = 20;
const MAX_CHARS = 128_000_000;
const MAX_TOTAL_CHARS = 256_000_000;
const MAX_AGE = 7 * 24 * 60 * 60_000;
const memory = new Map<string, SavedComposerDraft>();
let database: Promise<IDBDatabase> | undefined;
let writes: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Draft storage is unavailable.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'scope' });
      store.createIndex('updatedAt', 'updatedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Draft storage is blocked by another window.'));
  }).catch(error => { database = undefined; throw error; });
}

export function draftStorageChars(draft: SavedComposerDraft): number {
  return draft.text.length + draft.attachments.reduce((total, item) => total + item.data.length + item.name.length + item.token.length, 0);
}

/** IndexedDB stays in this device's app profile. Binary attachments never go
 * into localStorage, cloud sync, or a provider request as part of autosave. */
export function rememberComposerDraft(scope: string, draft: SavedComposerDraft): void {
  memory.delete(scope);
  memory.set(scope, { text: draft.text, attachments: [...draft.attachments] });
  while (memory.size > MAX_DRAFTS) memory.delete(memory.keys().next().value!);
  let total = 0;
  for (const [key, saved] of [...memory].reverse()) {
    total += draftStorageChars(saved);
    if (total > MAX_TOTAL_CHARS) memory.delete(key);
  }
}

export async function readComposerDraft(scope: string): Promise<SavedComposerDraft | undefined> {
  const cached = memory.get(scope);
  if (cached) return { text: cached.text, attachments: [...cached.attachments] };
  await writes;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(scope);
    request.onsuccess = () => {
      const row = request.result as StoredDraft | undefined;
      if (!row || Date.now() - row.updatedAt > MAX_AGE) return resolve(undefined);
      const draft = { text: row.text, attachments: row.attachments };
      rememberComposerDraft(scope, draft);
      resolve(draft);
    };
    request.onerror = () => reject(request.error);
  });
}

export function saveComposerDraft(scope: string, draft: SavedComposerDraft): Promise<void> {
  rememberComposerDraft(scope, draft);
  const captured = { text: draft.text, attachments: draft.attachments.map(item => ({ ...item })) };
  const chars = draftStorageChars(captured);
  const job = writes.catch(() => {}).then(async () => {
    if (chars > MAX_CHARS) throw new Error('Draft attachments exceed the local recovery storage limit.');
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      if (!captured.text.trim() && !captured.attachments.length) store.delete(scope);
      else store.put({ ...captured, scope, chars, updatedAt: Date.now() } satisfies StoredDraft);
      let kept = 0;
      let total = 0;
      const cursor = store.index('updatedAt').openCursor(null, 'prev');
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const row = entry.value as StoredDraft;
        kept += 1; total += row.chars || 0;
        if (kept > MAX_DRAFTS || total > MAX_TOTAL_CHARS || Date.now() - row.updatedAt > MAX_AGE) entry.delete();
        entry.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Draft save was interrupted.'));
    });
  });
  writes = job.catch(() => {});
  return job;
}

export type ComposerDraftSummary = { scope: string; updatedAt: number; chars: number; preview: string; attachmentCount: number };
export async function listComposerDrafts(): Promise<ComposerDraftSummary[]> {
  await writes; const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const request=db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess=()=>resolve((request.result as StoredDraft[]).filter(row=>Date.now()-row.updatedAt<=MAX_AGE)
      .sort((a,b)=>b.updatedAt-a.updatedAt).map(row=>({scope:row.scope,updatedAt:row.updatedAt,chars:row.chars,
        preview:row.text.slice(0,140),attachmentCount:row.attachments.length})));
    request.onerror=()=>reject(request.error);
  });
}
export function deleteComposerDraft(scope: string): Promise<void> {
  memory.delete(scope);
  const job=writes.catch(()=>{}).then(async()=>{const db=await openDatabase();await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(scope);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });});writes=job.catch(()=>{});return job;
}
