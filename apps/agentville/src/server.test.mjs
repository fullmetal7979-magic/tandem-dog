import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { Town, emptyState } from './engine/town.mjs';
import { createOfflineBrain } from './llm/offline.mjs';
import { STARTERS } from './seed.mjs';
import { createApp } from './server.mjs';

let server;
let base;
let town;

before(async () => {
  town = new Town({ state: emptyState(9), brain: createOfflineBrain({ delayMs: 0 }) });
  for (const starter of STARTERS) town.addCharacter(starter);
  server = await createApp({ town, log: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await town.idle();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test('state and catalog describe the town', async () => {
  const state = await call('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.body.characters.length, STARTERS.length);
  assert.equal(state.body.brain.live, false);
  const catalog = await call('GET', '/api/catalog');
  assert.ok(catalog.body.skills.research);
  assert.ok(catalog.body.map.rows.length > 10);
  assert.ok(Object.values(catalog.body.traits).every((trait) => !('when' in trait)));
});

test('task lifecycle over HTTP: preview, submit, finish, rate', async () => {
  const preview = await call('POST', '/api/tasks/preview', { prompt: '이메일 초안을 써줘' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.category, 'writing');
  const created = await call('POST', '/api/tasks', { prompt: '이메일 초안을 써줘' });
  assert.equal(created.status, 200);
  await town.idle();
  const state = await call('GET', '/api/state');
  const task = state.body.tasks.find((t) => t.id === created.body.id);
  assert.equal(task.status, 'done');
  const rated = await call('POST', `/api/tasks/${task.id}/feedback`, { rating: 4, comment: '좋아요' });
  assert.equal(rated.body.rating, 4);
  const empty = await call('POST', '/api/tasks', { prompt: '   ' });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /업무/);
});

test('characters: create, export card, import it back, retire', async () => {
  const created = await call('POST', '/api/characters', { name: '테오', role: 'analyst', traits: ['meticulous'] });
  assert.equal(created.status, 200);
  assert.equal(created.body.role, 'analyst');
  const card = await call('GET', `/api/characters/${created.body.id}/card`);
  assert.equal(card.body.spec, 'chara_card_v2');
  const imported = await call('POST', '/api/characters/import', card.body);
  assert.equal(imported.status, 200);
  assert.notEqual(imported.body.id, created.body.id);
  assert.equal(imported.body.name, '테오');
  const generated = await call('POST', '/api/characters/generate', { description: '반말 쓰는 디자이너' });
  assert.equal(generated.body.role, 'designer');
  assert.equal((await call('DELETE', `/api/characters/${imported.body.id}`)).status, 200);
  assert.equal((await call('DELETE', '/api/characters/nope')).status, 409);
});

test('chat replies and world settings validate input', async () => {
  const [first] = (await call('GET', '/api/state')).body.characters;
  const chat = await call('POST', `/api/chat/${first.id}`, { message: '안녕!' });
  assert.equal(chat.status, 200);
  assert.ok(chat.body.reply.length > 0);
  const world = await call('POST', '/api/world', { speed: 3, effortByLevel: false });
  assert.equal(world.body.clock.speed, 3);
  assert.equal(world.body.settings.effortByLevel, false);
  assert.equal((await call('POST', '/api/world', { speed: 7 })).status, 400);
  await call('POST', '/api/world', { speed: 1, effortByLevel: true });
});

test('static files are served and path traversal is refused', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AgentVille/);
  const status = await new Promise((resolve, reject) => {
    const req = request(`${base}/..%2f..%2fpackage.json`, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.ok([403, 404].includes(status), `got ${status}`);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});

test('the event stream sends live ticks', async () => {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/stream`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'text/event-stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('event: tick') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  controller.abort();
  assert.match(text, /event: tick/);
});
