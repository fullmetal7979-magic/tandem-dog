import { ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Approval } from './desktop-types';
import { t } from './i18n';
import { ErrorNotice } from './ErrorNotice';
import { isApprovalDismissKey } from './renderer-logic.mjs';
import { asRecord, textOf } from './text-format';

function approvalText(value: unknown, preferredKey: string): string {
  const preferred = asRecord(value)?.[preferredKey];
  return (typeof preferred === 'string' ? preferred : textOf(value)).trim();
}

// The one argument that says what the call does, shown on its own the way a
// command approval shows the command; anything else falls back to the JSON.
const PRIMARY_ARG_KEYS = ['command', 'cmd', 'script', 'patch', 'file_path', 'path', 'url', 'query', 'pattern'];

function approvalDetail(args: unknown): string {
  const record = asRecord(args);
  const key = PRIMARY_ARG_KEYS.find((name) => typeof record?.[name] === 'string' && String(record[name]).trim());
  return key ? String(record?.[key]).trim() : textOf(args).trim();
}

export function ApprovalCard({
  approval,
  resolve,
}: {
  approval: Approval;
  resolve: (approved: boolean) => Promise<unknown>;
}) {
  const reason = approvalText(approval.reason, 'message') || t('Review this tool request before continuing.');
  const detail = approvalDetail(approval.args);
  const [resolving, setResolving] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const resolvingRef = useRef(false);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const decide = useCallback(async (approved: boolean) => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setApprovalError('');
    setResolving(true);
    try {
      const accepted = await resolveRef.current(approved);
      if (accepted === true) return;
      setApprovalError(t('Mixdog could not record this decision. Please try again.'));
      resolvingRef.current = false;
      setResolving(false);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason || '');
      setApprovalError(
        detail
          ? t('Mixdog could not record this decision: {{detail}}', { detail })
          : t('Mixdog could not record this decision. Please try again.')
      );
      resolvingRef.current = false;
      setResolving(false);
    }
  }, []);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
    (focusable()[0] || dialog.current)?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const shortcut = event.key.toLowerCase();
      if (shortcut === 'a' || shortcut === 'y' || shortcut === 'd' || shortcut === 'n') {
        event.preventDefault();
        event.stopPropagation();
        void decide(shortcut === 'a' || shortcut === 'y');
        return;
      }
      if (isApprovalDismissKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        void decide(false);
        return;
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previousFocus?.focus();
    };
  }, [decide]);
  // Inline approval: the request renders in the
  // transcript flow with a warning ring instead of a modal overlay, so the
  // user can keep reading and typing while deciding.
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <article> must keep its tag; role="group" names the approval region
    <article
      ref={dialog}
      className="approval-card approval-card--inline"
      role="group"
      aria-labelledby="approval-title"
      aria-describedby="approval-description"
    >
      {/* Icon column + title on one row; the reason and the call itself hang
          from the title's left edge, and the decision sits under them. */}
      <div className="approval-heading">
        <span>
          <ShieldAlert size={16} />
        </span>
        <div>
          <b id="approval-title">{t('Tool approval required')}</b>
          <small>{t('{{name}} wants to run', { name: String(approval.name || t('Tool')) })}</small>
        </div>
      </div>
      <div className="approval-body">
        <p id="approval-description">{reason}</p>
        {detail && <pre className="approval-detail">{detail}</pre>}
        {approvalError && <ErrorNotice error={approvalError} />}
      </div>
      <div className="approval-actions">
        <button type="button" disabled={resolving} className="deny" onClick={() => void decide(false)}>
          {t('Deny')}
        </button>
        <button type="button" disabled={resolving} className="allow" onClick={() => void decide(true)}>
          {t('Allow')}
        </button>
      </div>
    </article>
  );
}
