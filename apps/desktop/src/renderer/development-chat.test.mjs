import test from 'node:test';
import assert from 'node:assert/strict';
import { draftTokenBudget } from './draft-token-budget.ts';
import { estimateTokens } from '../../../../src/runtime/agent/orchestrator/session/token-estimate.mjs';

const attachment = (patch = {}) => ({ id: 1, kind: 'text', name: 'notes.txt',
  mimeType: 'text/plain', token: '[Pasted text #1]', data: '가나다라마바 사아자차카타파하', ...patch });

test('draft meter includes Korean and referenced text, omits placeholder and unused attachments', () => {
  const file = attachment();
  assert.equal(draftTokenBudget('hello ' + file.token, [file]).tokens,
    estimateTokens('hello ') + estimateTokens(file.data));
  assert.equal(draftTokenBudget('hello', [file]).tokens, estimateTokens('hello'));
  assert.ok(draftTokenBudget(file.data, []).tokens > file.data.length / 4);
  assert.deepEqual(draftTokenBudget('', []), { tokens: 0, unmeasuredFiles: 0 });
});

test('chip-only text is counted, binary payloads are explicitly unknown, cached edits refresh', () => {
  const file = attachment({ chipOnly: true });
  const binary = attachment({ id: 2, token: '[Image #2]', kind: 'image', chipOnly: true, data: 'A'.repeat(1_000_000) });
  assert.deepEqual(draftTokenBudget('', [file, binary]), { tokens: estimateTokens(file.data), unmeasuredFiles: 1 });
  const before = draftTokenBudget('', [file]).tokens;
  file.data += ' additional words '.repeat(100);
  assert.ok(draftTokenBudget('', [file]).tokens > before);
});
