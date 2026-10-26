import test from 'node:test';
import assert from 'node:assert/strict';
import { withComposerModelHandoff, transferComposerModelHandoff, takeComposerModelHandoff } from './composer-model-handoff.ts';
import { inheritSessionInPlace } from './app-session-inheritance.ts';
const draft = { text: 'unsent [Image #4]', attachments: [{ id: 4, kind: 'image', data: 'not-sent-to-model', token: '[Image #4]' }] };

test('model continuation prepares the transcript and carries draft plus attachments before replacing the tab', async () => {
  let restored;
  await withComposerModelHandoff('source-handoff', draft, async () => {
    await inheritSessionInPlace('source-handoff', { provider: 'other', model: 'new' }, {
      inherit: async () => ({ sessionId: 'target-handoff', snapshot: { sessionId: 'target-handoff', items: [] } }),
      leaves: () => [{ id: 'leaf', tabs: [{ kind: 'session', id: 'source-handoff' }], activeKey: 'session:source-handoff' }],
      focusedLeafId: () => 'leaf', sourceTitle: () => 'Task', refreshSessions: async () => [],
      prepare() {}, readSession: async () => false, snapshot: () => null,
      replace() { restored = takeComposerModelHandoff('target-handoff'); },
    });
    return true;
  });
  assert.deepEqual(restored, draft);
  assert.notEqual(restored.attachments[0], draft.attachments[0]);
  assert.equal(takeComposerModelHandoff('target-handoff'), undefined);
});

test('failed handoffs clean up; unrelated inheritance never acquires a stale draft', async () => {
  await assert.rejects(withComposerModelHandoff('failed', draft, async () => { throw new Error('network'); }), /network/);
  transferComposerModelHandoff('failed', 'unrelated');
  assert.equal(takeComposerModelHandoff('unrelated'), undefined);
  assert.equal(await withComposerModelHandoff('failed', draft, async () => false), false);
  transferComposerModelHandoff('failed', 'unrelated');
  assert.equal(takeComposerModelHandoff('unrelated'), undefined);
});

test('two requests cannot inherit one composer concurrently', async () => {
  let release;
  const first = withComposerModelHandoff('busy', draft, () => new Promise(resolve => { release = resolve; }));
  assert.equal(await withComposerModelHandoff('busy', draft, async () => true), false);
  release(true);
  await first;
});

test('a draft request limit moves to the session its first send creates', async () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  try {
    const { saveExecutionBudget, readExecutionBudget, promoteDraftExecutionBudget } = await import('./execution-budget-settings.ts');
    saveExecutionBudget('draft:a', { maxRequests: 3, maxTokens: 5000 });
    promoteDraftExecutionBudget('draft:a', 'session-a');
    assert.deepEqual(readExecutionBudget('session-a'), { maxRequests: 3, maxTokens: 5000 });
    assert.deepEqual(readExecutionBudget('draft:a'), {});
    assert.equal([...store.keys()].some(key => key.endsWith(':draft:a')), false, 'the draft key is deleted');
    saveExecutionBudget('session-b', { maxRequests: 9 });
    promoteDraftExecutionBudget('draft:b', 'session-b');
    assert.deepEqual(readExecutionBudget('session-b'), { maxRequests: 9 }, 'an empty draft never clears a limit');
  } finally {
    globalThis.localStorage = previous;
  }
});
