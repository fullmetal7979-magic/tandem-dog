import { normalizeExecutionBudget, measuredBudgetTokens } from '../../../../shared/execution-budget.mjs';
import { isInclusiveProvider, priceUsage } from '../../../../shared/llm/cost.mjs';

export class ExecutionBudgetReached extends Error {
  constructor(reason) { super(`Execution budget: ${reason}. Increase the request limit to continue.`); this.name = 'ExecutionBudgetReached'; }
}

export function assertBudgetRequestAllowed(state, price = priceUsage) {
  const limits = normalizeExecutionBudget(state.opts?.executionBudget);
  if (!limits) return;
  const tracker = state.executionBudgetTracker ??= { requests: 0 };
  const usage = state.lastUsage;
  if ((limits.maxTokens || limits.maxCostUsd) && tracker.unmeasured)
    throw new ExecutionBudgetReached('the provider did not report enough usage to enforce the limit');
  const tokens = measuredBudgetTokens(usage, isInclusiveProvider(state.sessionRef?.provider || state.provider?.name));
  if (limits.maxRequests && tracker.requests >= limits.maxRequests) throw new ExecutionBudgetReached('provider request limit reached');
  if (limits.maxTokens && tokens != null && tokens >= limits.maxTokens) throw new ExecutionBudgetReached('token limit reached');
  if (limits.maxTokens && tracker.requests > 0 && (!usage || !(Number(usage.inputTokens) > 0 || Number(usage.promptTokens) > 0 || Number(usage.cachedTokens) > 0 || Number(usage.cacheWriteTokens) > 0)))
    throw new ExecutionBudgetReached('the provider did not report enough usage to enforce the token limit');
  if (limits.maxCostUsd) {
    const priced = price({
      provider: state.sessionRef?.provider || state.provider?.name, model: state.model,
      inputTokens: usage?.inputTokens ?? 1, outputTokens: usage?.outputTokens ?? 1,
      cacheWrite1hTokens: usage?.cacheWrite1hTokens || 0,
      cacheReadTokens: usage?.cachedTokens || 0, cacheWriteTokens: usage?.cacheWriteTokens || 0,
      requestServiceTier: state.opts?.fast ? (state.sessionRef?.provider || state.provider?.name || '').startsWith('anthropic') ? 'fast' : state.opts?.modelParameters?.serviceTier || 'priority' : '',
    });
    if (priced.costUsd == null) throw new ExecutionBudgetReached('this model has no reliable price for the configured USD limit');
    const cost = Math.max(Number(usage?.costUsd) || 0, priced.costUsd);
    if (tracker.requests > 0 && (!usage || !(Number(usage.inputTokens) > 0 || Number(usage.promptTokens) > 0 || Number(usage.cachedTokens) > 0 || Number(usage.cacheWriteTokens) > 0) || cost >= limits.maxCostUsd)) throw new ExecutionBudgetReached('estimated USD limit reached');
  }
  return tracker;
}

export function admitBudgetRequest(state, price = priceUsage) {
  const tracker = assertBudgetRequestAllowed(state, price);
  if (tracker) tracker.requests += 1;
}
