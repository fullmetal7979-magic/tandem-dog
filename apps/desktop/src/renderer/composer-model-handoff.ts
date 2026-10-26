import type { ComposerAttachment } from './composer-support';

type Draft = { text: string; attachments: ComposerAttachment[] };
const pending = new Map<string, Draft>();
const ready = new Map<string, Draft>();

/** Only a user-requested model continuation carries the unsent composer.
 * Keep binary attachments in memory, never in localStorage or an API call. */
export async function withComposerModelHandoff(
  sourceId: string, draft: Draft, run: () => Promise<boolean>
): Promise<boolean> {
  if (pending.has(sourceId)) return false;
  const captured = { text: draft.text, attachments: draft.attachments.map(entry => ({ ...entry })) };
  pending.set(sourceId, captured);
  try { return await run(); }
  finally { if (pending.get(sourceId) === captured) pending.delete(sourceId); }
}

export function transferComposerModelHandoff(sourceId: string, targetId: string): void {
  const draft = pending.get(sourceId);
  if (!draft || !targetId || sourceId === targetId) return;
  pending.delete(sourceId);
  ready.set(targetId, draft);
  // A tab closed between handoff and first paint must not retain file data forever.
  while (ready.size > 4) ready.delete(ready.keys().next().value!);
}

export function takeComposerModelHandoff(sessionId: string): Draft | undefined {
  const draft = ready.get(sessionId);
  ready.delete(sessionId);
  return draft;
}
