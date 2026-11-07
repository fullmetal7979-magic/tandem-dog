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
    if (body.stream && mode.agent) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const last = body.messages.at(-1);
      const answered = Array.isArray(last.content) && last.content.some((block) => block.type === 'tool_result');
      const callTools = !answered || mode.agent === 'forever';
      const n = requests.length;
      const events = callTools
        ? [start(body.model), ...textBlock(0, ['화면을 볼게요.']),
          { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `toolu_${n}a`, name: 'screenshot', input: {}, toolset_name: 'computer' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: `toolu_${n}b`, name: 'ask_user', input: {} } },
          { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"question":"계속할까요?"}' } },
          { type: 'content_block_stop', index: 2 },
          ...finish('tool_use')]
        : [start(body.model), ...textBlock(0, ['다 했어요.']), ...finish()];
      res.end(sse(events));
      return;
    }
    if (body.stream && mode.tools) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const resumed = body.messages.at(-1)?.role === 'assistant';
      const search = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} };
      const events = !resumed
        ? [start(body.model), ...textBlock(0, ['찾아볼게요.']),
          { type: 'content_block_start', index: 1, content_block: search },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"고양이 사료 가격"}' } },
          { type: 'content_block_stop', index: 1 },
          ...finish('pause_turn')]
        : [start(body.model),
          { type: 'content_block_start', index: 0, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: '사료 가격 A', encrypted_content: 'x', page_age: null }] } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: [] } },
          { type: 'content_block_delta', index: 1, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://example.com/a', title: '사료 가격 A', cited_text: '...', encrypted_index: 'e' } } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '평균 3만 원입니다.' } },
          { type: 'content_block_stop', index: 1 },
          ...finish()];
      res.end(sse(events));
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

test('server tools: declared on the request, paused turns resume, citations become sources', async () => {
  mode = { tools: true };
  requests.length = 0;
  const claude = await brain();
  const activity = [];
  let streamed = '';
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  const text = await claude.text({ system: 's', messages: [{ role: 'user', content: '가격 알아봐' }], tools, onText: (d) => { streamed += d; }, onActivity: (a) => activity.push(a) });
  assert.equal(requests.length, 2, 'pause_turn was resumed once');
  assert.deepEqual(requests[0].body.tools, tools);
  assert.equal(requests[1].body.messages.at(-1).role, 'assistant');
  assert.ok(requests[1].body.messages.at(-1).content.some((block) => block.type === 'server_tool_use'), 'the paused turn is sent back as-is');
  assert.equal(requests[1].body.messages.length, 2, 'no extra "continue" message');
  assert.match(text, /^찾아볼게요\.\n\n평균 3만 원입니다\./, 'a tool call starts a new paragraph');
  assert.match(text, /### 출처\n- \[사료 가격 A\]\(https:\/\/example\.com\/a\)/);
  assert.equal(streamed, text, 'the live view matches the final text');
  assert.deepEqual(activity.map((a) => a.text), ['검색: 고양이 사료 가격', '결과 1건']);
  assert.equal(activity[0].use, true);
});

test('client tools: tool_use goes to runTools, results come back and the history only grows', async () => {
  mode = { agent: true };
  requests.length = 0;
  const claude = await brain();
  const calls = [];
  const tools = [{ type: 'computer_toolset_20260801', configs: { hold_key: { enabled: false } } }, { name: 'ask_user', description: 'q', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, eager_input_streaming: true }];
  const text = await claude.text({
    system: 's', messages: [{ role: 'user', content: '해 줘' }], tools,
    runTools: async (uses) => {
      calls.push(uses);
      return uses.map((block) => ({ type: 'tool_result', tool_use_id: block.id, ...(block.toolset_name ? { toolset_name: block.toolset_name } : {}), content: [{ type: 'text', text: 'OK' }] }));
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map((block) => [block.name, block.toolset_name, block.input]), [['screenshot', 'computer', {}], ['ask_user', undefined, { question: '계속할까요?' }]]);
  const [first, second] = requests.map((entry) => entry.body);
  assert.deepEqual(first.tools, tools);
  assert.deepEqual(first.cache_control, { type: 'ephemeral' }, 'agent loops cache the growing conversation');
  assert.equal(second.messages.length, 3);
  assert.deepEqual(second.messages[0], first.messages[0], 'earlier turns are sent unchanged');
  assert.equal(second.messages[1].role, 'assistant');
  assert.equal(second.messages[1].content.find((block) => block.type === 'tool_use').toolset_name, 'computer');
  const results = second.messages[2].content;
  assert.deepEqual(results.map((block) => [block.type, block.tool_use_id, block.toolset_name]), [['tool_result', 'toolu_1a', 'computer'], ['tool_result', 'toolu_1b', undefined]]);
  assert.match(text, /화면을 볼게요\./);
  assert.match(text, /다 했어요\.$/);
});

test('client tools: past the turn limit every call is told to wrap up', async () => {
  mode = { agent: 'forever' };
  requests.length = 0;
  const claude = await brain();
  let runs = 0;
  await claude.text({
    system: 's', messages: [{ role: 'user', content: '해 줘' }], tools: [{ type: 'computer_toolset_20260801' }], maxTurns: 1,
    runTools: async (uses) => {
      runs += 1;
      return uses.map((block) => ({ type: 'tool_result', tool_use_id: block.id, content: 'OK' }));
    },
  });
  assert.equal(runs, 1, 'tools ran only within the limit');
  assert.equal(requests.length, 3, 'two more turns to wrap up, then the loop ends');
  const wrapUp = requests[2].body.messages.at(-1).content;
  assert.ok(wrapUp.every((block) => block.is_error && /작업 한도/.test(block.content)));
  assert.equal(wrapUp.find((block) => block.tool_use_id.endsWith('a')).toolset_name, 'computer', 'wrap-up results still echo the toolset');
});

test('stopping a task aborts the request', async () => {
  mode = { agent: true };
  const claude = await brain();
  const controller = new AbortController();
  controller.abort();
  const error = await claude.text({ system: 's', messages: [{ role: 'user', content: 'x' }], signal: controller.signal, runTools: async () => [] }).catch((e) => e);
  assert.ok(error instanceof Error);
  assert.equal(claude.describeError(error), '사용자가 업무를 멈췄어요.');
});
