// Drives the real @anthropic-ai/sdk against a local fake Messages endpoint, so
// the request shape and response handling are checked without network access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

const requests = [];
let mode = {};
let server;

const sse = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const start = (model) => ({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } });
const textBlock = (index, text) => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  ...text.map((piece) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } })),
  { type: 'content_block_stop', index },
];
const finish = (stopReason = 'end_turn') => [
  { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 7 } },
  { type: 'message_stop' },
];

before(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, beta: req.headers['anthropic-beta'] ?? '', body });
    if (mode.rejectFallbacks && body.fallbacks) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: Extra inputs are not permitted' } }));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const events = mode.midStreamFallback
        ? [start(body.model), ...textBlock(0, ['앞부분, ']),
          { type: 'content_block_start', index: 1, content_block: { type: 'fallback', from: { model: body.model }, to: { model: 'claude-opus-4-8' } } },
          { type: 'content_block_stop', index: 1 },
          ...textBlock(2, ['이어진 ', '뒷부분']), ...finish()]
        : mode.refuse
          ? [start(body.model), ...finish('refusal')]
          : [start(body.model), ...textBlock(0, ['안녕', '하세요']), ...finish()];
      res.end(sse(events));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_2', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ ok: true, effort: body.output_config?.effort }) }],
      usage: { input_tokens: 3, output_tokens: 5 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function brain() {
  const { createClaudeBrain } = await import('./anthropic.mjs');
  return createClaudeBrain({ model: 'claude-opus-5-5' });
}

test('streams text with effort, server-side fallbacks and the right beta', async () => {
  mode = {};
  requests.length = 0;
  const claude = await brain();
  const deltas = [];
  const text = await claude.text({ system: '너는 민지다.', messages: [{ role: 'user', content: '안녕' }], effort: 'high', onText: (d) => deltas.push(d) });
  assert.equal(text, '안녕하세요');
  assert.deepEqual(deltas, ['안녕', '하세요']);
  const [{ url, beta, body }] = requests;
  assert.match(url, /\/v1\/messages/);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 32000);
  assert.deepEqual(body.output_config, { effort: 'high' });
  assert.equal(body.fallbacks, 'default');
  assert.match(beta, /server-side-fallback-2026-07-01/);
  assert.equal(body.thinking, undefined, 'thinking is left to the model default');
});

test('a mid-stream fallback keeps the partial and its continuation', async () => {
  mode = { midStreamFallback: true };
  const claude = await brain();
  const deltas = [];
  const text = await claude.text({ system: 's', messages: [{ role: 'user', content: 'x' }], onText: (d) => deltas.push(d) });
  assert.equal(text, '앞부분, 이어진 뒷부분');
  assert.equal(deltas.join(''), text, 'what the user watched stream is the final text');
});

test('structured output sends a JSON schema format and parses the reply', async () => {
  mode = {};
  requests.length = 0;
  const claude = await brain();
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const result = await claude.json({ system: 's', messages: [{ role: 'user', content: 'x' }], schema });
  assert.deepEqual(result, { ok: true, effort: 'low' });
  const { body } = requests[0];
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema });
  assert.equal(body.stream, undefined);
});

test('an account that rejects fallbacks keeps working without them', async () => {
  mode = { rejectFallbacks: true };
  requests.length = 0;
  const claude = await brain();
  assert.equal(await claude.text({ system: 's', messages: [{ role: 'user', content: 'x' }] }), '안녕하세요');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.fallbacks, undefined);
  assert.doesNotMatch(requests[1].beta, /server-side-fallback/);
  await claude.text({ system: 's', messages: [{ role: 'user', content: 'y' }] });
  assert.equal(requests.length, 3, 'no second rejected attempt once disabled');
});

test('a refusal becomes a readable error', async () => {
  mode = { refuse: true };
  const claude = await brain();
  const error = await claude.text({ system: 's', messages: [{ role: 'user', content: 'x' }] }).catch((e) => e);
  assert.equal(error.name, 'RefusalError');
  assert.match(claude.describeError(error), /거절/);
});
