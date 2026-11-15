import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFencedPayload } from './session-dispatch.mjs';

test('webhook session prompts keep payload and headers inside a scrubbed fence', () => {
  const prompt = buildFencedPayload(
    { instruction: 'WEBHOOK_UNTRUSTED_DATA', text: 'inspect this' },
    { 'x-github-event': 'push', 'content-type': 'application/json', authorization: 'hidden' }
  );
  assert.match(prompt, /<<<WEBHOOK_UNTRUSTED_DATA_BEGIN>>>/);
  assert.match(prompt, /<<<WEBHOOK_UNTRUSTED_DATA_END>>>/);
  assert.match(prompt, /x-github-event: push/);
  assert.doesNotMatch(prompt, /authorization: hidden/);
  assert.match(prompt, /WEBHOOK_DATA/);
});

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('webhook session runs are capped per endpoint and in total; finished runs free a slot', async () => {
  const { createWebhookSessionDispatcher } = await import('./session-dispatch.mjs');
  const statuses = [];
  const pending = [];
  const dispatcher = createWebhookSessionDispatcher({
    getConfig: () => ({}),
    getBridgeDispatch: () => () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
    updateStatus: async (name, id, status, fields) => {
      statuses.push({ name, id, status, error: fields?.error || null });
    },
    maxRunsPerEndpoint: 2,
    maxRunsTotal: 3,
  });
  const fire = async (name, id) => {
    const res = fakeResponse();
    const handled = await dispatcher.dispatchEndpoint({ name, body: {}, headers: {}, res, deliveryId: id, endpoint: { instructions: 'go' } });
    assert.equal(handled, true);
    return res;
  };
  // Fired together, before any of them got past its first await.
  const burst = await Promise.all([fire('ci', 'a'), fire('ci', 'b'), fire('ci', 'c')]);
  assert.deepEqual(burst.map((res) => res.status), [202, 202, 429]);
  assert.equal(burst[2].headers['Retry-After'], '60');
  assert.deepEqual(statuses.find((row) => row.id === 'c'), {
    name: 'ci',
    id: 'c',
    status: 'failed',
    error: 'too many webhook runs in progress (max 2 per endpoint, 3 total)',
  });
  assert.equal((await fire('deploy', 'd')).status, 202, 'another endpoint still has room under the total');
  assert.equal((await fire('other', 'e')).status, 429, 'the total cap holds across endpoints');
  assert.equal(pending.length, 3);
  pending[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await fire('ci', 'f')).status, 202, 'a finished run frees its slot');
  // Settle the rest so their dispatch timeouts do not hold the process open.
  for (const resolve of pending) resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
