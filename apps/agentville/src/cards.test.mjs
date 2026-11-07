import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportCard, importCard } from './cards.mjs';
import { createCharacter } from './engine/character.mjs';
import { addMemory } from './engine/memory.mjs';
import { createTask } from './engine/tasks.mjs';
import { readText, RefusalError } from './llm/anthropic.mjs';
import { createOfflineBrain } from './llm/offline.mjs';
import { selectBrain } from './llm/index.mjs';
import { loadState, reviveState, saveState } from './store.mjs';
import { emptyState } from './engine/town.mjs';
import { makeRng } from './util.mjs';

test('character cards round-trip growth but not private chatter', () => {
  const c = createCharacter({ name: '민지', role: 'researcher', traits: ['curious'] }, { minute: 0, rng: makeRng(3) });
  c.level = 7;
  c.skills.research.level = 6;
  addMemory(c, { kind: 'reflection', text: '나는 출처를 꼭 확인한다', importance: 9, minute: 5 });
  addMemory(c, { kind: 'chat', text: '사적인 잡담', importance: 2, minute: 6 });
  const card = exportCard(c);
  assert.equal(card.spec, 'chara_card_v2');
  assert.equal(card.data.name, '민지');
  const json = JSON.parse(JSON.stringify(card));
  const { full } = importCard(json);
  assert.equal(full.level, 7);
  assert.equal(full.skills.research.level, 6);
  assert.ok(full.memory.items.some((m) => m.kind === 'reflection'));
  assert.ok(!full.memory.items.some((m) => m.kind === 'chat'));
});

test('plain V2 cards from other tools import as a new character', () => {
  const { input, full } = importCard({ spec: 'chara_card_v2', data: { name: 'Aria', description: '데이터와 통계를 좋아하는 분석가', personality: '호기심 많고 꼼꼼함' } });
  assert.equal(full, undefined);
  assert.equal(input.name, 'Aria');
  assert.equal(input.role, 'analyst');
  assert.throws(() => importCard({ hello: 'world' }));
});

test('world state saves atomically and revives Infinity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-'));
  try {
    const file = join(dir, 'world.json');
    const state = emptyState(1);
    state.characters.x = { state: { until: Infinity } };
    saveState(state, file);
    const loaded = reviveState(loadState(file));
    assert.equal(loaded.characters.x.state.until, Infinity);
    assert.equal(loadState(join(dir, 'missing.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude replies: fallback markers are skipped, a kept partial and its continuation join, refusals throw', () => {
  assert.equal(readText({ stop_reason: 'end_turn', content: [{ type: 'text', text: '안녕' }] }), '안녕');
  const midStream = { stop_reason: 'end_turn', content: [{ type: 'text', text: '앞부분, ' }, { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }, { type: 'text', text: '이어진 뒷부분' }] };
  assert.equal(readText(midStream), '앞부분, 이어진 뒷부분');
  const preOutput = { stop_reason: 'end_turn', content: [{ type: 'fallback' }, { type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }] };
  assert.equal(readText(preOutput), '{"ok":true}');
  assert.throws(() => readText({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), RefusalError);
});

test('brain selection falls back to the offline simulation', async () => {
  const quiet = { info() {}, warn() {}, log() {} };
  const brain = await selectBrain({ AGENTVILLE_PROVIDER: 'offline' }, { log: quiet });
  assert.equal(brain.live, false);
  const auto = await selectBrain({}, { log: quiet });
  assert.equal(auto.live, false, 'no key → simulation');
});

test('offline brain answers every structured kind it is asked for', async () => {
  const brain = createOfflineBrain({ delayMs: 0 });
  const character = createCharacter({ name: '하준', role: 'engineer' }, { minute: 0, rng: makeRng(4) });
  const debrief = await brain.json({ system: '', messages: [], schema: {}, meta: { kind: 'debrief', character, task: createTask({ prompt: '정렬 함수 코드 작성' }, { minute: 0 }) } });
  assert.ok(debrief.self_quality >= 1 && debrief.self_quality <= 10);
  assert.match(debrief.summary, /정렬/);
  const draft = await brain.json({ system: '', messages: [], schema: {}, meta: { kind: 'character', description: '반말을 쓰는 냉소적인 데이터 분석가' } });
  assert.equal(draft.role, 'analyst');
  assert.equal(draft.speech, 'casual');
});
