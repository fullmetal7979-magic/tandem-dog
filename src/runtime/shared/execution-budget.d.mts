export interface ExecutionBudget { maxTokens?: number; maxCostUsd?: number; maxRequests?: number; }
export function normalizeExecutionBudget(value: unknown): ExecutionBudget | null;
export function measuredBudgetTokens(usage: unknown, inclusive?: boolean): number | null;
