import { memo, useDeferredValue, useMemo, useEffect, useState } from 'react';
import type { ComposerAttachment } from './composer-support';
import { draftTokenBudget } from './draft-token-budget';
import { t } from './i18n';

// The "Large input" warning starts at this many draft tokens.
const DRAFT_TOKEN_WARNING = 8000;

export const DraftTokenBudget = memo(function DraftTokenBudget({ draft, attachments, turnBusy, sessionId = '' }: {
  draft: string; attachments: ComposerAttachment[]; turnBusy: boolean; sessionId?: string;
}) {
  const deferredDraft = useDeferredValue(draft);
  const budget = useMemo(() => draftTokenBudget(deferredDraft, attachments), [deferredDraft, attachments]);
  const [context, setContext] = useState<{ sessionId: string; tokens: number; usd: number | null } | null>(null);
  useEffect(() => {
    if (!sessionId || turnBusy || !window.mixdogDesktop?.invokeCapability) return;
    let live = true;
    void window.mixdogDesktop.invokeCapability({ capability: 'contextStatus', args: [], sessionId }).then(result => {
      const row = result.value as Record<string, unknown> | null;
      if (live && row && Number(row.currentEstimatedTokens) > 0) setContext({
        sessionId, tokens: Number(row.currentEstimatedTokens),
        usd: typeof row.inputEstimateUsd === 'number' ? row.inputEstimateUsd : null,
      });
    }).catch(() => {});
    return () => { live = false; };
  }, [sessionId, turnBusy]);
  if (!draft.trim() && !attachments.length && !turnBusy) return null;
  const baseline = context?.sessionId === sessionId ? context : null;
  const estimatedInput = baseline ? baseline.tokens + budget.tokens : budget.tokens;
  const inputUsd = baseline?.usd != null && baseline.tokens > 0 ? baseline.usd * estimatedInput / baseline.tokens : null;
  return <div className="draft-token-budget" data-large={budget.tokens >= DRAFT_TOKEN_WARNING || undefined}>
    <span title={t('Estimate includes saved conversation, instructions and tools when available, plus this draft. Input value excludes output and cache discounts; binary file tokens remain unknown until processed.')}>
      {baseline ? t('Next input ≈{{tokens}} tokens', { tokens: estimatedInput.toLocaleString() }) : t('Draft text ≈{{tokens}} tokens', { tokens: budget.tokens.toLocaleString() })}
      {inputUsd != null && <span> · {t('Input value ≈${{usd}}', { usd: new Intl.NumberFormat('ko-KR',{maximumSignificantDigits:3}).format(inputUsd) })}</span>}
      {budget.unmeasuredFiles > 0 && <span> · {t('File tokens calculated on send')}</span>}
    </span>
    <span className="draft-token-guidance">{budget.tokens >= DRAFT_TOKEN_WARNING ? t('Large input · attach only relevant excerpts')
      : turnBusy ? t('Switch models between turns · reasoning changes apply next turn') : t('⌘/Ctrl + Shift + M · models')}</span>
  </div>;
});
