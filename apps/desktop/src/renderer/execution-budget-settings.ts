import type { DesktopSubmitOptions } from '../shared/contract';
import { normalizeExecutionBudget } from '../../../../src/runtime/shared/execution-budget.mjs';
export type ExecutionBudget = NonNullable<DesktopSubmitOptions['executionBudget']>;
const key = (scope: string) => `cosmos.execution-budget.v1:${scope}`;
export function readExecutionBudget(scope: string): ExecutionBudget {
  try { return normalizeExecutionBudget(JSON.parse(localStorage.getItem(key(scope)) || 'null')) || {}; } catch { return {}; }
}
export function saveExecutionBudget(scope: string, value: ExecutionBudget): void {
  try { localStorage.setItem(key(scope), JSON.stringify(normalizeExecutionBudget(value) || {})); } catch { /* current window still applies the limit */ }
}
export function carryExecutionBudget(source: string, target: string): void { saveExecutionBudget(target, readExecutionBudget(source)); }
