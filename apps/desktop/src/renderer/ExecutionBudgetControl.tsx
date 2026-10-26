import { useEffect, useId, useRef, useState } from 'react';
import type { ExecutionBudget } from './execution-budget-settings';
import { t } from './i18n';

const sameBudget = (left: ExecutionBudget, right: ExecutionBudget) =>
  (left.maxTokens || 0) === (right.maxTokens || 0) &&
  (left.maxCostUsd || 0) === (right.maxCostUsd || 0) &&
  (left.maxRequests || 0) === (right.maxRequests || 0);

export function ExecutionBudgetControl({ value, disabled, onChange }: {
  value: ExecutionBudget; disabled: boolean; onChange(value: ExecutionBudget): void;
}) {
  const [open, setOpen] = useState(false);
  const [invalidOnClose, setInvalidOnClose] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const helpId = useId();
  const errorId = useId();
  const [tokens, setTokens] = useState(String(value.maxTokens || ''));
  const [cost, setCost] = useState(String(value.maxCostUsd || ''));
  const [requests, setRequests] = useState(String(value.maxRequests || ''));
  useEffect(() => {
    if (open) return;
    setTokens(String(value.maxTokens || ''));
    setCost(String(value.maxCostUsd || ''));
    setRequests(String(value.maxRequests || ''));
    setInvalidOnClose(false);
  }, [open, value.maxTokens, value.maxCostUsd, value.maxRequests]);
  const fieldValid = (raw: string, integer: boolean) =>
    !raw || (Number(raw) > 0 && Number.isFinite(Number(raw)) && (!integer || Number.isSafeInteger(Number(raw))));
  const tokensValid = fieldValid(tokens, true);
  const costValid = fieldValid(cost, false);
  const requestsValid = fieldValid(requests, true);
  const valid = tokensValid && costValid && requestsValid;
  const invalidProps = (fieldOk: boolean) => fieldOk ? {} : {
    'aria-invalid': true as const,
    ...(invalidOnClose ? { 'aria-errormessage': errorId } : {}),
  };
  const next: ExecutionBudget = {
    ...(tokens ? { maxTokens: Number(tokens) } : {}),
    ...(cost ? { maxCostUsd: Number(cost) } : {}),
    ...(requests ? { maxRequests: Number(requests) } : {}),
  };
  // A click outside keeps what was typed: a valid change applies, an invalid
  // one keeps the panel open with the reason instead of silently discarding.
  const closeFromOutside = useRef(() => {});
  closeFromOutside.current = () => {
    if (!valid) { setInvalidOnClose(true); return; }
    if (!sameBudget(next, value)) onChange(next);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    if (disabled) { setOpen(false); return; }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) closeFromOutside.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  const active = Boolean(value.maxTokens || value.maxCostUsd || value.maxRequests);
  const help = t('Applies to one response including tool loops. Stops before the next model request; an in-flight response may exceed the limit. Unknown model prices block a USD-limited request.');
  return <span ref={container} className="execution-budget-control" onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
      container.current?.querySelector('button')?.focus();
    }
  }}>
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-describedby={helpId} disabled={disabled} onClick={() => setOpen(!open)}>{active ? t('Limit set') : t('Request limit')}</button>
    <span id={helpId} hidden>{help}</span>
    {open && <span id={panelId} className="execution-budget-panel" role="group" aria-label={t('Request limit')} aria-describedby={helpId}>
      <label>{t('Total tokens')}<input type="number" autoFocus min="1" step="1" value={tokens} onChange={event => { setTokens(event.target.value); setInvalidOnClose(false); }} placeholder={t('Unlimited')} {...invalidProps(tokensValid)} /></label>
      <label>{t('Estimated USD')}<input type="number" min="0.000001" step="0.01" value={cost} onChange={event => { setCost(event.target.value); setInvalidOnClose(false); }} placeholder={t('Unlimited')} {...invalidProps(costValid)} /></label>
      <label>{t('Provider requests')}<input type="number" min="1" step="1" value={requests} onChange={event => { setRequests(event.target.value); setInvalidOnClose(false); }} placeholder={t('Unlimited')} {...invalidProps(requestsValid)} /></label>
      <small aria-hidden="true">{help}</small>
      {invalidOnClose && <small id={errorId} className="execution-budget-error" role="alert">{t('Fix the highlighted limit, or press Esc to discard it.')}</small>}
      <button type="button" disabled={!valid} onClick={() => {
        onChange(next); setOpen(false);
      }}>{t('Apply')}</button>
    </span>}
  </span>;
}
