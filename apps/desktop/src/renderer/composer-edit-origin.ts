// Where the composer's current text came from. A restored queued follow-up or
// a rewound earlier prompt looks exactly like fresh input, so the composer
// names the origin until the text is sent or cleared.
import { t } from './i18n';

export type ComposerEditOrigin = '' | 'queue' | 'rewind';

/** Did a queue restore actually hand text or files back to the composer? */
export function queueRestoreHandedBack(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as { count?: unknown; text?: unknown; ids?: unknown };
  const count = Number(record.count);
  if (Number.isFinite(count)) return count > 0;
  return Boolean(String(record.text ?? '').trim()) || (Array.isArray(record.ids) && record.ids.length > 0);
}

/** The next origin once the draft changes: an emptied draft is new input again. */
export function nextComposerEditOrigin(current: ComposerEditOrigin, draft: string): ComposerEditOrigin {
  return draft.trim() ? current : '';
}

export function composerEditOriginLabel(origin: ComposerEditOrigin, turnBusy: boolean): string {
  if (origin === 'queue') {
    return turnBusy
      ? t('Editing a queued follow-up. Sending puts it back at the end of the queue.')
      : t('Editing a queued follow-up. Sending sends it now.');
  }
  if (origin === 'rewind') return t('Editing an earlier message. Sending continues the conversation from that point.');
  return '';
}
