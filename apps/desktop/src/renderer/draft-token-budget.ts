import type { ComposerAttachment } from './composer-support';
// @ts-expect-error Shared estimator is plain ESM, also used by runtime compaction.
import { estimateTokens } from '../../../../src/runtime/agent/orchestrator/session/token-estimate.mjs';

// Weak keys avoid retaining old attachments; streaming snapshots and typing
// only re-count the small editor text, not the same large attached log.
const estimates = new WeakMap<ComposerAttachment, { data: string; tokens: number }>();
export function draftTokenBudget(draft: string, attachments: ComposerAttachment[]) {
  let text = draft;
  let attachmentTokens = 0;
  let unmeasuredFiles = 0;
  for (const attachment of attachments) {
    if (!attachment.token || (!attachment.chipOnly && !draft.includes(attachment.token))) continue;
    text = text.split(attachment.token).join('');
    if (attachment.kind !== 'text') {
      unmeasuredFiles += 1;
      continue;
    }
    let cached = estimates.get(attachment);
    if (!cached || cached.data !== attachment.data) {
      cached = { data: attachment.data, tokens: estimateTokens(attachment.data) };
      estimates.set(attachment, cached);
    }
    attachmentTokens += cached.tokens;
  }
  return { tokens: estimateTokens(text) + attachmentTokens, unmeasuredFiles };
}
