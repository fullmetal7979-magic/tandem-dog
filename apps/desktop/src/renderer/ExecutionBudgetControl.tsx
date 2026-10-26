import { useEffect, useId, useRef, useState } from 'react';
import type { ExecutionBudget } from './execution-budget-settings';
import { t } from './i18n';

export function ExecutionBudgetControl({ value, disabled, onChange }: {
  value: ExecutionBudget; disabled: boolean; onChange(value: ExecutionBudget): void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); return; }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  const [tokens, setTokens] = useState(String(value.maxTokens || ''));
  const [cost, setCost] = useState(String(value.maxCostUsd || ''));
  const [requests, setRequests] = useState(String(value.maxRequests || ''));
  useEffect(() => {
    if (open) return;
    setTokens(String(value.maxTokens || ''));
    setCost(String(value.maxCostUsd || ''));
    setRequests(String(value.maxRequests || ''));
  }, [open, value.maxTokens, value.maxCostUsd, value.maxRequests]);
  const valid = [[tokens, true], [cost, false], [requests, true]].every(([raw, integer]) =>
    !raw || (Number(raw) > 0 && Number.isFinite(Number(raw)) && (!integer || Number.isSafeInteger(Number(raw)))));
  const active = Boolean(value.maxTokens || value.maxCostUsd || value.maxRequests);
  return <span ref={container} className="execution-budget-control" onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
      container.current?.querySelector('button')?.focus();
    }
  }}>
    <button type="button" aria-expanded={open} aria-controls={panelId} disabled={disabled} onClick={() => setOpen(!open)}>{active ? t('Limit set') : t('Request limit')}</button>
    {open && <span id={panelId} className="execution-budget-panel" role="group" aria-label={t('Request limit')}>
      <label>{t('Total tokens')}<input type="number" autoFocus min="1" step="1" value={tokens} onChange={event => setTokens(event.target.value)} placeholder={t('Unlimited')} /></label>
      <label>{t('Estimated USD')}<input type="number" min="0.000001" step="0.01" value={cost} onChange={event => setCost(event.target.value)} placeholder={t('Unlimited')} /></label>
      <label>{t('Provider requests')}<input type="number" min="1" step="1" value={requests} onChange={event => setRequests(event.target.value)} placeholder={t('Unlimited')} /></label>
      <small>{t('Applies to one response including tool loops. Stops before the next model request; an in-flight response may exceed the limit. Unknown model prices block a USD-limited request.')}</small>
      <button type="button" disabled={!valid} onClick={() => {
        onChange({ ...(tokens ? { maxTokens: Number(tokens) } : {}), ...(cost ? { maxCostUsd: Number(cost) } : {}), ...(requests ? { maxRequests: Number(requests) } : {}) }); setOpen(false);
      }}>{t('Apply')}</button>
    </span>}
  </span>;
}
