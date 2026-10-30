import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildConversationExport, conversationsDir, listConversationsIn, safeConversationId, writeConversationIn } from './conversations.mjs';

const planetId = 'github.com/me/app';

test('one message too big to carry is cut in the middle, not dropped', () => {
  const log = `HEAD-${'x'.repeat(400_000)}-TAIL`;
  const session = { id: 's1', messages: [{ role: 'user', content: '로그 봐 줘' }, { role: 'assistant', content: log }] };
  const doc = buildConversationExport(session, { planetId, limit: 100_000 });
  assert.ok(Buffer.byteLength(JSON.stringify(doc.messages)) <= 100_000);
  assert.equal(doc.messageCount, 2, 'both turns are still there');
  assert.equal(doc.trimmed, true);
  assert.ok(doc.clipped >= 1);
  const text = doc.messages[1].content;
  assert.ok(text.startsWith('HEAD-') && text.endsWith('-TAIL'), 'head and tail are kept');
  assert.match(text, /은하수로 옮기며 \d+자를 줄였어요/);
  assert.equal(session.messages[1].content, log, 'the session itself is untouched');
});

test('a small conversation is carried as it is', () => {
  const doc = buildConversationExport({ id: 's2', messages: [{ role: 'user', content: 'hi' }] }, { planetId });
  assert.equal(doc.trimmed, false);
  assert.equal(doc.clipped, undefined);
});

test('the listing answers from index.json and notices documents written without it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cosmos-conv-'));
  try {
    for (let i = 1; i <= 8; i += 1) {
      await writeConversationIn(dir, { id: `s${i}`, planet: planetId, title: `세션 ${i}`, exportedAt: i * 1000, messageCount: i, messages: [] });
    }
    const index = JSON.parse(readFileSync(join(dir, conversationsDir(planetId), 'index.json'), 'utf8'));
    assert.deepEqual(index.conversations.map((entry) => entry.file), ['s8', 's7', 's6', 's5', 's4', 's3'], 'pruned documents leave the index');
    const listed = await listConversationsIn(dir, planetId);
    assert.deepEqual(listed.map((entry) => entry.title), ['세션 8', '세션 7', '세션 6', '세션 5', '세션 4', '세션 3']);
    // An older COSMOS adds a document and leaves the index alone.
    writeFileSync(join(dir, conversationsDir(planetId), 'old.json'), JSON.stringify({ id: 'old', title: '예전 판', exportedAt: 99_000 }));
    const fresh = await listConversationsIn(dir, planetId);
    assert.equal(fresh[0].title, '예전 판');
    assert.equal(fresh.length, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session ids never take the pointer files’ names', () => {
  assert.equal(safeConversationId('latest'), 'latest-');
  assert.equal(safeConversationId('index'), 'index-');
  assert.equal(safeConversationId('index2'), 'index2');
});
