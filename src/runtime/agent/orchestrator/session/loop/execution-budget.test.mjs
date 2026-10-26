import './test-isolation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExecutionBudget, measuredBudgetTokens } from '../../../../shared/execution-budget.mjs';
import { admitBudgetRequest, ExecutionBudgetReached } from './execution-budget.mjs';
import { sendProviderRequest, settleSendResult } from './send-phase.mjs';

const state = limits => ({ opts: { executionBudget: limits }, model: 'test', sessionRef: { provider: 'openai' } });
test('only finite positive numeric limits are admitted', () => {
  assert.equal(normalizeExecutionBudget({}), null);
  assert.deepEqual(normalizeExecutionBudget({ maxTokens: 100, maxCostUsd: .1 }), { maxTokens: 100, maxCostUsd: .1 });
  for (const limits of [{ maxTokens: NaN }, { maxRequests: 1.5 }, { maxCostUsd: -1 }, { extra: 1 }])
    assert.throws(() => normalizeExecutionBudget(limits), TypeError);
});
test('cache tokens count once for inclusive providers and add for Anthropic', () => {
  const usage = { inputTokens: 100, cachedTokens: 60, cacheWriteTokens: 10, outputTokens: 20 };
  assert.equal(measuredBudgetTokens(usage, true), 120);
  assert.equal(measuredBudgetTokens(usage, false), 190);
  assert.equal(measuredBudgetTokens({ ...usage, promptTokens: 170 }, false), 190);
});
test('request and token limits stop the next request after tool-loop usage', () => {
  const s = state({ maxRequests: 2, maxTokens: 100 });
  admitBudgetRequest(s); s.lastUsage = { inputTokens: 50, outputTokens: 10 };
  admitBudgetRequest(s); s.lastUsage = { inputTokens: 90, outputTokens: 20 };
  assert.throws(() => admitBudgetRequest(s), ExecutionBudgetReached);
  const t = state({ maxTokens: 10 }); admitBudgetRequest(t);
  t.lastUsage = { inputTokens: 8, outputTokens: 2 };
  assert.throws(() => admitBudgetRequest(t), /token limit/);
});
test('USD caps use the larger of catalog estimates and reported cost; unknown prices block upfront', () => {
  const s = state({ maxCostUsd: .1 });
  assert.throws(() => admitBudgetRequest(s, () => ({ costUsd: null })), /no reliable price/);
  admitBudgetRequest(s, () => ({ costUsd: .001 }));
  s.lastUsage = { inputTokens: 100, costUsd: 0 };
  assert.throws(() => admitBudgetRequest(s, () => ({ costUsd: .11 })), /USD limit/);
  s.lastUsage.costUsd = .2;
  assert.throws(() => admitBudgetRequest(s, () => ({ costUsd: .01 })), /USD limit/);
});
test('missing usage cannot silently bypass token or USD limits after an earlier measured response', () => {
  const s = { ...state({ maxTokens: 1000 }), messages: [], opts: { executionBudget: { maxTokens: 1000 } }, throwIfAborted() {} };
  admitBudgetRequest(s); s.lastUsage = { inputTokens: 10, outputTokens: 1 };
  settleSendResult(s, { nextIteration: 2, sendTools: [] }, {
    result: { response: {} }, providerMessages: [], sendStartedAt: Date.now(), preSendMs: 0,
  });
  assert.throws(() => admitBudgetRequest(s), /did not report enough usage/);
  const usd = state({ maxCostUsd: 1 }); admitBudgetRequest(usd, () => ({ costUsd: .01 }));
  usd.lastUsage = { inputTokens: 0, outputTokens: 0 };
  assert.throws(() => admitBudgetRequest(usd, () => ({ costUsd: .01 })), /USD limit/);
});
test('send-phase enforces the limit before reaching any provider transport', async () => {
  let sent = 0;
  const s = { ...state({ maxRequests: 1 }), executionBudgetTracker: { requests: 1 }, provider: { send: async () => { sent++; } } };
  await assert.rejects(sendProviderRequest(s, { iterT0: Date.now() }), ExecutionBudgetReached);
  assert.equal(sent, 0);
});
