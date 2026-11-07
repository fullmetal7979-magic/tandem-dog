// The HTTP API on a throwaway town: offline brain, in-memory files, a fake
// screen and a temporary work folder. Nothing leaves the machine.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { FakeScreen } from './agent/screens.mjs';
import { Town, emptyState } from './engine/town.mjs';
import { FileStore, attachmentBlocks, attachmentDigest, resolveType } from './files.mjs';
import { createOfflineBrain } from './llm/offline.mjs';
import { STARTERS } from './seed.mjs';
import { createApp } from './server.mjs';

const base = mkdtempSync(join(tmpdir(), 'agentville-server-test-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let town;
let server;
let root;
let autoAllow = true;

before(async () => {
  town = new Town({ state: emptyState(5), brain: createOfflineBrain({ delayMs: 0 }), files: new FileStore(), workspaceDir: base, screens: (kind) => new FakeScreen({ kind }) });
  for (const starter of STARTERS) town.addCharacter(starter);
  town.on('event', (type, payload) => {
    if (type === 'approval' && autoAllow) setTimeout(() => town.resolveApproval(payload.id, { decision: 'allow' }), 0);
  });
  server = await createApp({ town, log: { error() {}, info() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  root = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(base, { recursive: true, force: true });
});

async function call(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) init.body = body;
    else {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
  }
  const response = await fetch(root + path, init);
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}

const byRole = (role) => Object.values(town.characters).find((c) => c.role === role);

test('the catalog describes equipment, trust tiers and the wardrobe', async () => {
  const { status, data } = await call('GET', '/api/catalog');
  assert.equal(status, 200);
  for (const id of ['web_fetch', 'web_search', 'browser', 'files', 'shell', 'desktop', 'code_execution']) assert.ok(data.tools[id]?.unlock, id);
  assert.deepEqual(data.trust.map((tier) => tier.tier), [1, 2, 3, 4]);
  assert.ok(data.equipment.browser && data.equipment.desktop);
  assert.ok(data.wardrobe.slots.pet);
  assert.ok(data.wardrobe.items.accessory.some((item) => item.id === 'crown' && /Lv10/.test(item.reqText)));
});

test('settings: desktop control needs consent, the autonomy cap is 1 to 4', async () => {
  assert.equal(town.settings.desktop, false, 'off by default');
  const refused = await call('POST', '/api/world', { desktop: true });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /동의/);
  assert.equal(town.settings.desktop, false);
  const agreed = await call('POST', '/api/world', { desktop: true, consent: true });
  assert.equal(agreed.data.settings.desktop, true);
  assert.equal((await call('POST', '/api/world', { desktop: false })).data.settings.desktop, false, 'turning it off needs no consent');
  assert.equal((await call('POST', '/api/world', { autonomyCap: 7 })).status, 400);
  assert.equal((await call('POST', '/api/world', { autonomyCap: '3' })).status, 400);
  assert.equal((await call('POST', '/api/world', { autonomyCap: 3 })).data.settings.autonomyCap, 3);
  assert.equal((await call('POST', '/api/world', { browser: false, shell: false })).data.settings.browser, false);
  await call('POST', '/api/world', { autonomyCap: 2, browser: true, shell: true });
});

test('approvals, stopping and screens fail cleanly when there is nothing to act on', async () => {
  assert.deepEqual((await call('GET', '/api/approvals')).data, []);
  const missing = await call('POST', '/api/approvals/a_nothing', { decision: 'allow' });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /이미 처리/);
  assert.deepEqual((await call('POST', '/api/stop')).data, { cancelled: 0 });
  assert.equal((await call('POST', '/api/tasks/t_none/cancel')).status, 400);
  assert.equal((await call('GET', '/api/tasks/t_none/screen')).status, 404);
  assert.equal((await call('GET', '/api/tasks/t_none/artifact?path=a.md')).status, 404);
  const status = await call('GET', '/api/agent/status');
  assert.equal(status.status, 200);
  assert.equal(typeof status.data.browser.ok, 'boolean');
  assert.equal(status.data.workspaceDir, base);
});

test('uploads are checked by type, content and size', async () => {
  const image = await call('POST', '/api/files', PNG, { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('화면.png') });
  assert.equal(image.status, 200);
  assert.equal(image.data.kind, 'image');
  assert.equal(image.data.name, '화면.png');
  const fake = await call('POST', '/api/files', Buffer.from('not a png'), { 'content-type': 'image/png', 'x-file-name': 'x.png' });
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /맞지 않아요/);
  assert.equal((await call('POST', '/api/files', Buffer.from('<svg onload=alert(1)>'), { 'content-type': 'image/svg+xml', 'x-file-name': 'x.svg' })).status, 400, 'SVG is refused');
  assert.equal((await call('POST', '/api/files', Buffer.alloc(0), { 'content-type': 'text/plain', 'x-file-name': 'empty.txt' })).status, 400);
  const served = await call('GET', `/api/files/${image.data.id}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('GET', '/api/files/f_0000000000')).status, 404);

  assert.equal(resolveType('application/octet-stream', '메모.md'), 'text/markdown', 'the extension decides for unknown types');
  assert.equal(resolveType('', 'virus.exe'), null);
  const store = new FileStore();
  const text = store.put(Buffer.from('회의 메모: 다음 주 월요일 출시'), { name: 'memo.txt', type: 'text/plain' });
  assert.throws(() => store.put(Buffer.alloc(2 * 1024 * 1024, 65), { name: 'big.txt', type: 'text/plain' }), /1MB/);
  assert.deepEqual(attachmentBlocks(store, [text]), [{ type: 'document', title: 'memo.txt', source: { type: 'text', media_type: 'text/plain', data: '회의 메모: 다음 주 월요일 출시' } }]);
  assert.match(attachmentDigest(store, [text])[0].text, /출시/);
  assert.equal(store.meta('../../etc/passwd'), null);
});

test('a task with an attachment is done, archived, searchable and in the report', async () => {
  const memo = (await call('POST', '/api/files', Buffer.from('올해 매출 목표: 120억, 핵심 고객: 중소기업'), { 'content-type': 'text/plain', 'x-file-name': 'goal.txt' })).data;
  const submitted = await call('POST', '/api/tasks', { prompt: '첨부한 목표 메모를 바탕으로 분기별 영업 계획을 세워 줘', attachments: [memo.id], equipment: 'none' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.attachments[0].name, 'goal.txt');
  assert.equal((await call('POST', '/api/tasks', { prompt: 'x', attachments: ['f_ffffffffff'] })).status, 400);
  await town.idle();
  const task = (await call('GET', `/api/tasks/${submitted.data.id}`)).data;
  assert.equal(task.status, 'done', task.error);
  assert.match(task.output, /goal\.txt|120억/, 'the simulated brain read the attachment');

  const found = (await call('GET', `/api/archive?q=${encodeURIComponent('영업 계획')}`)).data;
  assert.ok(found.items.some((item) => item.id === task.id));
  assert.equal(found.items.find((item) => item.id === task.id).attachments, 1);
  assert.equal((await call('GET', `/api/archive?q=${encodeURIComponent('전혀상관없는우주선')}`)).data.total, 0);
  assert.equal((await call('GET', '/api/archive?minRating=5')).data.total, 0, 'unrated work is filtered out by rating');

  await call('POST', `/api/tasks/${task.id}/feedback`, { rating: 5, comment: '좋아요' });
  assert.ok((await call('GET', '/api/archive?minRating=5')).data.items.some((item) => item.id === task.id));
  const report = (await call('GET', '/api/report?days=all')).data;
  assert.ok(report.town.tasks >= 1);
  const lead = report.characters.find((entry) => entry.id === task.lead);
  assert.ok(lead.tasks >= 1 && lead.xp > 0);
  assert.equal((await call('GET', '/api/report?days=7')).status, 200);
});

test('a file task: the result file is served, nothing else in the folder is', async () => {
  const writer = byRole('writer');
  const submitted = (await call('POST', '/api/tasks', { prompt: '팀 소개 글을 파일로 만들어 줘', equipment: 'files', assignees: [writer.id] })).data;
  await town.idle();
  const task = town.tasks[submitted.id];
  assert.equal(task.status, 'done', task.error);
  const [file] = task.artifacts;
  assert.ok(file, 'the file was left as a result');
  const served = await call('GET', `/api/tasks/${task.id}/artifact?path=${encodeURIComponent(file.path)}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /^text\/plain/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
  assert.match(served.data.toString('utf8'), /팀 소개/);
  for (const path of ['../../../etc/passwd', '.agentville-backup', 'other.md', '']) {
    assert.equal((await call('GET', `/api/tasks/${task.id}/artifact?path=${encodeURIComponent(path)}`)).status, 404, path);
  }
  assert.equal((await call('GET', `/api/tasks/${task.id}/screen`)).status, 404, 'a file task has no screen');
});

test('a browser task keeps its final screen; waiting approvals are listed and answered over HTTP', async () => {
  autoAllow = false;
  const researcher = byRole('researcher');
  const submitted = (await call('POST', '/api/tasks', { prompt: 'https://example.com 을 읽고 요약해 줘. 시작 전에 물어봐', equipment: 'browser', assignees: [researcher.id] })).data;
  let pending = [];
  for (let i = 0; i < 100 && !pending.length; i++) {
    pending = (await call('GET', '/api/approvals')).data;
    if (!pending.length) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  autoAllow = true;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'question');
  assert.equal(pending[0].taskId, submitted.id);
  assert.equal(pending[0].finish, undefined, 'internals are not exposed');
  assert.equal((await call('POST', `/api/approvals/${pending[0].id}`, { decision: 'maybe' })).status, 200, 'a question treats an unknown decision as an answer');
  await town.idle();
  const task = town.tasks[submitted.id];
  assert.equal(task.status, 'done', task.error);
  const screen = await call('GET', `/api/tasks/${task.id}/screen`);
  assert.equal(screen.status, 200);
  assert.equal(screen.headers.get('content-type'), 'image/png');
  assert.equal(screen.data.subarray(1, 4).toString('latin1'), 'PNG');
});

test('wardrobe changes go through PATCH and locked items are refused', async () => {
  const researcher = byRole('researcher');
  const locked = await call('PATCH', `/api/characters/${researcher.id}`, { appearance: { accessory: 'crown' } });
  assert.equal(locked.status, 400);
  const dressed = await call('PATCH', `/api/characters/${researcher.id}`, { appearance: { accessory: 'headphones', eyes: 'smile', outfit: 'hoodie' } });
  assert.equal(dressed.status, 200);
  assert.equal(dressed.data.appearance.accessory, 'headphones');
  assert.ok(Array.isArray(dressed.data.derived.wardrobe));
  const created = await call('POST', '/api/characters', { name: '새봄', role: 'designer', appearance: { pet: 'slime', hairStyle: 4, accessory: 'bow' } });
  assert.equal(created.status, 200);
  assert.equal(created.data.appearance.accessory, 'bow');
  assert.equal(created.data.appearance.pet, 'none', 'a newcomer cannot start with a locked pet');
  assert.notEqual(created.data.appearance.hairStyle, 4);
});
