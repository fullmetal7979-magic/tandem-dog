import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOfflineBrain } from '../llm/offline.mjs';
import { STARTERS } from '../seed.mjs';
import { Town, emptyState } from './town.mjs';

function makeTown(brain = createOfflineBrain({ delayMs: 0 })) {
  const town = new Town({ state: emptyState(42), brain });
  const events = [];
  town.on('event', (type, payload) => events.push({ type, payload }));
  for (const starter of STARTERS) town.addCharacter(starter);
  return { town, events };
}

test('a solo task streams steps, produces output and grows the character', async () => {
  const { town, events } = makeTown();
  const task = town.submitTask({ prompt: '경쟁사 3곳의 가격 정책을 비교 조사해서 정리해줘' });
  const worker = town.characters[task.assignees[0]];
  assert.equal(worker.role, 'researcher', 'research goes to the researcher');
  const before = { totalXp: worker.totalXp, skill: worker.skills.research.xp + worker.skills.research.level * 1000, memories: worker.memory.items.length };
  await town.idle();

  assert.equal(task.status, 'done');
  assert.ok(task.output.length > 100);
  assert.ok(task.steps.every((step) => step.status === 'done'));
  assert.ok(task.steps.some((step) => step.kind === 'draft'));
  assert.ok(events.some((e) => e.type === 'delta' && e.payload.taskId === task.id), 'deltas streamed');
  assert.ok(task.quality > 0 && task.quality <= 1);
  assert.ok(task.rewards[worker.id].xp > 0);
  assert.ok(worker.totalXp > before.totalXp);
  assert.ok(worker.skills.research.xp + worker.skills.research.level * 1000 > before.skill);
  assert.ok(worker.memory.items.length > before.memories, 'the task becomes a memory');
  assert.equal(worker.state.taskId, null, 'released after work');
});

test('a team task runs parallel perspectives and a lead synthesis', async () => {
  const { town } = makeTown();
  const task = town.submitTask({ prompt: '신제품 출시 마케팅 전략과 로드맵을 자세히 기획해줘, 채널별 계획, 예산, 위험요소 포함', mode: 'team' });
  assert.equal(task.mode, 'team');
  assert.ok(task.assignees.length >= 2);
  await town.idle();
  assert.equal(task.status, 'done');
  const drafts = task.steps.filter((step) => step.kind === 'draft');
  assert.equal(new Set(drafts.map((step) => step.charId)).size, drafts.length, 'one draft per member');
  assert.ok(task.steps.some((step) => step.kind === 'synthesis' && step.charId === task.lead));
  for (const id of task.assignees) assert.ok(task.rewards[id]?.xp > 0);
  const [a, b] = task.assignees.map((id) => town.characters[id]);
  assert.ok(a.relationships[b.id], 'teammates know each other afterwards');
});

test('feedback changes mood, affinity and memory once', async () => {
  const { town } = makeTown();
  const task = town.submitTask({ prompt: '회의록을 간단히 요약해줘' });
  await town.idle();
  const c = town.characters[task.lead ?? task.assignees[0]];
  const affinity = c.userBond.affinity;
  const xp = c.totalXp;
  town.feedback(task.id, 5, '표로 정리해줘서 좋았어. 앞으로도 표로 부탁해');
  assert.ok(c.userBond.affinity > affinity);
  assert.ok(c.totalXp > xp, 'praise gives bonus XP');
  assert.ok(c.moodlets.some((m) => m.id === 'loved'), '5 stars feel loved');
  assert.ok(c.memory.items.some((m) => m.kind === 'preference'), 'the preference is remembered');
  const afterFirst = c.totalXp;
  town.feedback(task.id, 5, '한 번 더');
  assert.equal(c.totalXp, afterFirst, 're-rating does not re-reward');
});

test('chatting with the user is remembered and streamed', async () => {
  const { town, events } = makeTown();
  const c = Object.values(town.characters)[0];
  const reply = await town.chat(c.id, '나는 결론부터 말해 주는 게 좋아');
  assert.ok(reply.length > 0);
  assert.equal(town.state.chats[c.id].length, 2);
  assert.ok(events.some((e) => e.type === 'chatDelta' && e.payload.charId === c.id));
  assert.ok(c.memory.items.some((m) => m.kind === 'preference'));
  await assert.rejects(() => town.chat(c.id, '   '), /메시지/);
});

test('a failing brain marks the task as error and frees the worker', async () => {
  const brain = createOfflineBrain({ delayMs: 0 });
  brain.text = async () => { throw new Error('boom'); };
  brain.describeError = (error) => `실패: ${error.message}`;
  const { town } = makeTown(brain);
  const task = town.submitTask({ prompt: '짧은 시를 써줘' });
  await town.idle();
  assert.equal(task.status, 'error');
  assert.match(task.error, /boom/);
  assert.ok(task.steps.every((step) => step.status !== 'running'));
  assert.ok(task.assignees.every((id) => town.characters[id].state.taskId === null));
  brain.text = createOfflineBrain({ delayMs: 0 }).text;
  town.retryTask(task.id);
  await town.idle();
  assert.equal(task.status, 'done');
});

test('a simulated day: people eat, rest, chat and make friends', () => {
  const { town } = makeTown();
  const seen = new Set();
  for (let i = 0; i < 60 * 24; i++) {
    town.tick(1000);
    for (const c of Object.values(town.characters)) seen.add(c.state.activity);
  }
  for (const activity of ['lunch', 'chat', 'sleep']) assert.ok(seen.has(activity), `${activity} happened (${[...seen]})`);
  const people = Object.values(town.characters);
  for (const c of people) {
    for (const value of Object.values(c.needs)) assert.ok(value >= 0 && value <= 100);
  }
  const friendships = people.flatMap((c) => Object.values(c.relationships).map((rel) => rel.friendship));
  assert.ok(friendships.some((value) => value > 0), 'small talk built relationships');
  assert.ok(town.state.chronicle.length > 0);
});

test('characters can be created, imported back and removed', () => {
  const { town } = makeTown();
  const c = town.addCharacter({ name: '새봄', role: 'designer', traits: ['curious', 'witty'] });
  assert.equal(c.role, 'designer');
  assert.ok(c.traits.some((t) => t.id === 'curious'));
  assert.equal(town.removeCharacter('nope'), false);
  town.removeCharacter(c.id);
  assert.equal(town.characters[c.id], undefined);
  for (const other of Object.values(town.characters)) assert.equal(other.relationships[c.id], undefined);
});

test('interrupted work from a previous run becomes retryable', () => {
  const { town } = makeTown();
  const task = town.submitTask({ prompt: '보고서 써줘' });
  const revived = new Town({ state: JSON.parse(JSON.stringify(town.state)), brain: createOfflineBrain({ delayMs: 0 }) });
  assert.equal(revived.tasks[task.id].status, 'error');
  assert.ok(Object.values(revived.characters).every((c) => c.state.taskId === null));
  return town.idle();
});

test('generated characters never reuse a resident name', async () => {
  const { town } = makeTown();
  const names = new Set(Object.values(town.characters).map((c) => c.name));
  for (let i = 0; i < 12; i++) {
    town.clock.minute += 1;
    const draft = await town.draftCharacter('반말 쓰는 냉소적인 데이터 분석가');
    assert.ok(!names.has(draft.name), `${draft.name} is already taken`);
    assert.equal(draft.role, 'analyst');
  }
});
