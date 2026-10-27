// Screen readers hear a finished reply once, politely, through a status line
// of its own. The transcript itself is not a live region: paging in older
// history (or a virtualized row remounting) would otherwise be read aloud.
import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

const CLEAR_AFTER_MS = 4_000;

/** The text for a `role="status"` line: set when a turn of this session ends. */
export function useTurnAnnouncement(busy: boolean, sessionKey: string): string {
  const [notice, setNotice] = useState('');
  const previous = useRef<{ key: string; busy: boolean }>({ key: '', busy: false });
  useEffect(() => {
    const before = previous.current;
    previous.current = { key: sessionKey, busy };
    // Another session's reply is not this one's news.
    if (before.key !== sessionKey) {
      setNotice('');
      return;
    }
    // Only busy → idle within the same session.
    if (before.busy && !busy) setNotice(t('A new reply arrived.'));
  }, [busy, sessionKey]);
  // Cleared on its own clock, so a new turn starting cannot strand the text.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), CLEAR_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return notice;
}
