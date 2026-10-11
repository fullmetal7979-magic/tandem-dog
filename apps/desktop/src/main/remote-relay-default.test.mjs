import assert from 'node:assert/strict';
import { test } from 'node:test';

import { submitFeedback } from './feedback-client.ts';
import { resolveRelayUrl } from './remote-relay-device.ts';

test('the relay is disabled by default so the fork never dials upstream infrastructure', () => {
  assert.equal(resolveRelayUrl({}), null);
  for (const raw of ['', '   ']) {
    assert.equal(resolveRelayUrl({ MIXDOG_RELAY_URL: raw }), null);
  }
  for (const flag of ['0', 'false', 'off', 'OFF']) {
    assert.equal(resolveRelayUrl({ MIXDOG_RELAY_URL: flag }), null);
  }
});

test('an explicit relay URL still enables the relay and is validated', () => {
  assert.equal(resolveRelayUrl({ MIXDOG_RELAY_URL: 'wss://relay.example.com' }), 'wss://relay.example.com/');
  assert.equal(resolveRelayUrl({ MIXDOG_RELAY_URL: 'ws://127.0.0.1:8787' }), 'ws://127.0.0.1:8787/');
  assert.throws(() => resolveRelayUrl({ MIXDOG_RELAY_URL: 'ws://external.test' }), /wss/);
  assert.throws(() => resolveRelayUrl({ MIXDOG_RELAY_URL: 'not a url' }), /invalid/);
});

test('feedback fails closed without any request while the relay is disabled', async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    return new Response('', { status: 202 });
  };
  const feedback = {
    id: '457e173a-0ec2-4405-afb7-98b15ea9bf74',
    kind: 'bug',
    message: 'The pane flickers.',
    replyTo: 'dev@example.com',
  };
  await assert.rejects(submitFeedback(feedback, { env: {}, request }), /Feedback service is unavailable/);
  assert.equal(requests, 0);
});
