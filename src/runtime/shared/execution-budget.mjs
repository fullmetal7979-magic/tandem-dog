/** Per-user-request limits. Checked between provider requests; an in-flight
 * response can exceed a limit before its final usage becomes available. */
export function normalizeExecutionBudget(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('execution budget must be an object');
  const allowed = new Set(['maxTokens', 'maxCostUsd', 'maxRequests']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown execution budget field: ${key}`);
  const result = {};
  for (const key of allowed) {
    if (value[key] == null || value[key] === '') continue;
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0 ||
      (key !== 'maxCostUsd' && !Number.isSafeInteger(number))) throw new TypeError(`invalid execution budget ${key}`);
    result[key] = number;
  }
  return Object.keys(result).length ? result : null;
}

export function measuredBudgetTokens(usage, inclusive = true) {
  if (!usage) return null;
  const n = value => Math.max(0, Number(value) || 0);
  const input = n(usage.inputTokens);
  const cached = n(usage.cachedTokens) + n(usage.cacheWriteTokens);
  const prompt = Number(usage.promptTokens) > 0 ? Number(usage.promptTokens)
    : inclusive ? Math.max(input, cached) : input + cached;
  return prompt + n(usage.outputTokens);
}
