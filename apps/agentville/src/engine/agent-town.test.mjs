// Agent tasks through the whole town: equipment planning, the session, the
// approval inbox, live screens, artifacts, stopping, trust and the wardrobe.
// The offline brain drives the tools; the screen is a fake.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FakeScreen } from '../agent/screens.mjs';
import { sanitizeAppearance, unlockedItems } from '../catalog/wardrobe.mjs';
import { createOfflineBrain } from '../llm/offline.mjs';
import { STARTERS } from '../seed.mjs';
import { Town, emptyState } from './town.mjs';

const base = mkdtempSync(join(tmpdir(), 'agentville-agent-town-'));
after(() => rmSync(base, { recursive: true, force: true }));

function makeTown({ answer = () => ({ decision: 'allow' }) } = {}) {
  const screens = [];
  const town = new Town({
    state: emptyState(11), brain: createOfflineBrain({ delayMs: 0 }), workspaceDir: join(base, `town-${Math.random().toString(36).slice(2)}`),
    screens: (kind) => {
      const screen = new FakeScreen({ kind });
      screens.push(screen);
      return screen;
    },
  });
  const events = [];
  town.on('event', (type, payload) => {
    events.push({ type, payload });
    if (type === 'approval' && answer) {
      const decision = answer(payload);
      if (decision) setTimeout(() => town.resolveApproval(payload.id, decision), 0);
    }
  });
  for (const starter of STARTERS) town.addCharacter(starter);
  const byRole = (role) => Object.values(town.characters).find((c) => c.role === role);
  return { town, events, screens, byRole };
}

test('a browser task opens the page, reads it and reports back', async () => {
  const { town, screens, byRole, events } = makeTown();
  const researcher = byRole('researcher');
  const task = town.submitTask({ prompt: 'https://example.com/pricing 사이트에 들어가서 요금제를 정리해 줘', equipment: 'browser', assignees: [researcher.id] });
  assert.equal(task.mode, 'solo', 'agent equipment works alone');
  await town.idle();
  assert.equal(task.status, 'done', task.error);
  const step = task.steps.find((entry) => entry.kind === 'agent');
  assert.ok(step, 'the character worked hands-on');
  assert.match(step.label, /직접 해 보기/);
  assert.equal(screens.length, 1);
  assert.deepEqual(screens[0].log.filter((entry) => entry.op === 'open').map((entry) => entry.url), ['https://example.com/pricing']);
  assert.match(task.output, /직접 한 일/);
  assert.match(task.output, /테스트 제목/, 'what it read is in the result');
  assert.ok(researcher.stats.browserActions >= 1);
  assert.ok((researcher.toolMastery.browser ?? 0) >= 1, 'using the browser builds mastery');
  assert.ok(step.screen?.final, 'the last screen is kept for the task card');
  assert.ok(task.finalScreen && town.files.read(task.finalScreen.id), 'the final screenshot is stored');
  assert.equal(town.liveScreens.has(task.id), false, 'the live screen is released');
  assert.ok(events.some((event) => event.type === 'task' && event.payload.steps?.some((entry) => entry.screen)));
});

test('saving a file asks a new hire first, then lists it as a result', async () => {
  const { town, byRole, events } = makeTown();
  const writer = byRole('writer');
  const task = town.submitTask({ prompt: '회의록 양식을 파일로 만들어 줘', equipment: 'files', assignees: [writer.id] });
  await town.idle();
  assert.equal(task.status, 'done', task.error);
  const asks = events.filter((event) => event.type === 'approval');
  assert.ok(asks.length >= 1, 'tier 1 asks before writing');
  assert.equal(asks[0].payload.tool, 'files');
  assert.match(asks[0].payload.summary, /저장/);
  assert.ok(asks[0].payload.detail, 'the user sees what will be written');
  assert.ok(events.some((event) => event.type === 'approvalDone' && event.payload.id === asks[0].payload.id));
  assert.equal(task.artifacts.length, 1);
  assert.match(task.artifacts[0].path, /^결과\/.+\.md$/);
  assert.equal(task.artifacts[0].created, true);
  assert.equal(task.workspace.own, true);
  assert.match(readFileSync(join(task.workspace.root, task.artifacts[0].path), 'utf8'), /회의록/);
  assert.ok(writer.userBond.trust > 10, 'a granted approval adds a little trust');
  assert.equal(town.pendingApprovals().length, 0);
});

test('a refused save leaves no file and the task still finishes', async () => {
  const { town, byRole } = makeTown({ answer: () => ({ decision: 'deny', note: '파일은 만들지 마' }) });
  const writer = byRole('writer');
  const task = town.submitTask({ prompt: '주간 보고서 초안을 파일로 남겨 줘', equipment: 'files', assignees: [writer.id] });
  await town.idle();
  assert.equal(task.status, 'done', task.error);
  assert.equal(task.artifacts.length, 0);
  assert.ok(writer.userBond.trust < 10);
});

test('a question waits in the inbox and stopping the task clears it', async () => {
  const { town, byRole, events } = makeTown({ answer: () => null });
  const researcher = byRole('researcher');
  const task = town.submitTask({ prompt: 'https://example.com 을 보기 전에 확인해 줘, 물어보고 시작해', equipment: 'browser', assignees: [researcher.id] });
  for (let i = 0; i < 50 && !town.pendingApprovals().length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const [pending] = town.pendingApprovals();
  assert.ok(pending, 'the question is waiting');
  assert.equal(pending.kind, 'question');
  assert.equal(researcher.state.waiting, true);
  assert.equal(town.snapshot().approvals.length, 1, 'the inbox is part of the state');
  assert.ok(town.tickView().characters.find((c) => c.id === researcher.id).waiting, 'the town shows who is waiting');
  assert.deepEqual(town.cancelAll(), { cancelled: 1 });
  await town.idle();
  assert.equal(task.status, 'error');
  assert.equal(task.cancelled, true);
  assert.match(task.error, /멈췄어요/);
  assert.equal(town.pendingApprovals().length, 0);
  assert.equal(researcher.state.waiting, false);
  assert.ok(events.some((event) => event.type === 'approvalDone'));
  assert.throws(() => town.cancelTask(task.id), /진행 중인 업무만/);
  assert.throws(() => town.resolveApproval(pending.id, { decision: 'allow' }), /이미 처리/);
});

test('answering a question lets the work go on', async () => {
  const { town, byRole } = makeTown({ answer: (entry) => (entry.kind === 'question' ? { decision: 'allow', answer: '표로 정리해 줘' } : { decision: 'allow' }) });
  const researcher = byRole('researcher');
  const task = town.submitTask({ prompt: 'https://example.com 내용 정리, 시작 전에 물어봐', equipment: 'browser', assignees: [researcher.id] });
  await town.idle();
  assert.equal(task.status, 'done', task.error);
  assert.match(task.output, /표로 정리해 줘/);
  assert.equal(researcher.stats.questionsAsked, 1);
});

test('lent folders are checked', async () => {
  const { town } = makeTown();
  assert.throws(() => town.submitTask({ prompt: 'x', folder: '/' }), /맡길 수 없어요/);
  assert.throws(() => town.submitTask({ prompt: 'x', folder: '~' }), /맡길 수 없어요/);
  assert.throws(() => town.submitTask({ prompt: 'x', folder: join(base, 'nope') }), /찾을 수 없어요/);
  const task = town.submitTask({ prompt: '이 폴더의 파일 목록을 정리해 줘', folder: base });
  assert.equal(task.equipment, 'files');
  assert.equal(task.mode, 'solo');
  await town.idle();
  assert.equal(task.workspace.own, false, 'the lent folder is not the character\'s own');
  assert.equal(task.workspace.root, task.folder);
});

test('trust tiers are announced; the wardrobe opens as characters grow', () => {
  const { town, byRole } = makeTown();
  const researcher = byRole('researcher');
  const change = town.changeTrust(researcher, 16);
  assert.equal(change.to.tier, 2);
  assert.ok(town.state.chronicle.some((entry) => /더 믿게/.test(entry.text)), 'the chronicle remembers');

  assert.deepEqual(sanitizeAppearance(researcher, { accessory: 'crown' }).rejected, ['accessory'], 'locked at Lv1');
  assert.equal(sanitizeAppearance(researcher, { accessory: 'glasses', hairStyle: '6' }).appearance.hairStyle, 6);
  assert.deepEqual(sanitizeAppearance(researcher, { pet: 'dragon' }).rejected, ['pet'], 'unknown items are rejected');
  assert.throws(() => town.updateCharacter(researcher.id, { appearance: { accessory: 'crown' } }));
  town.updateCharacter(researcher.id, { appearance: { accessory: 'glasses', shirt: '#e0679a' } });
  assert.equal(researcher.appearance.accessory, 'glasses');
  assert.equal(researcher.appearance.shirt, '#e0679a', 'role colours are free');

  researcher.level = 5;
  town.checkWardrobe(researcher);
  assert.ok(unlockedItems(researcher).includes('pet:cat'));
  assert.ok(town.state.chronicle.some((entry) => entry.emoji === '👗' && /고양이/.test(entry.text)));
  const before = town.state.chronicle.length;
  town.checkWardrobe(researcher);
  assert.equal(town.state.chronicle.length, before, 'each item is announced once');
  town.updateCharacter(researcher.id, { appearance: { pet: 'cat' } });
  assert.equal(researcher.appearance.pet, 'cat');
});
