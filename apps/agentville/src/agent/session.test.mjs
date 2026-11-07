// AgentSession against a real Town (offline brain) and a fake screen, so the
// approval flow, budgets and tool_result shapes are checked end to end without
// a browser, the real desktop or the Claude API.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createOfflineBrain } from '../llm/offline.mjs';
import { STARTERS } from '../seed.mjs';
import { Town, emptyState } from '../engine/town.mjs';
import { createTask } from '../engine/tasks.mjs';
import { FakeScreen } from './screens.mjs';
import { AbortedError, AgentSession } from './session.mjs';
import { Workspace } from './workspace.mjs';

const base = mkdtempSync(join(tmpdir(), 'agentville-session-test-'));
after(() => rmSync(base, { recursive: true, force: true }));

// answer(entry) → { decision, note?, answer? } decides every approval.
function setup({ role = 'researcher', trust = 10, cap = 2, answer = () => ({ decision: 'allow' }), equipment, prompt = '테스트 업무', signal = null } = {}) {
  const town = new Town({ state: emptyState(7), brain: createOfflineBrain({ delayMs: 0 }), workspaceDir: base });
  for (const starter of STARTERS) town.addCharacter(starter);
  town.settings.autonomyCap = cap;
  const character = Object.values(town.characters).find((c) => c.role === role);
  character.userBond.trust = trust;
  const asked = [];
  town.on('event', (type, payload) => {
    if (type !== 'approval') return;
    asked.push(payload);
    queueMicrotask(() => town.resolveApproval(payload.id, answer(payload)));
  });
  const task = createTask({ prompt }, { minute: 0 });
  town.tasks[task.id] = task;
  const screen = new FakeScreen();
  const kit = equipment ?? { ids: ['browser'], screen: 'browser', workspace: false };
  const workspace = kit.workspace ? new Workspace(join(base, `${character.id}-${task.id}`)) : null;
  const step = { id: 's1', status: 'running' };
  const session = new AgentSession({ town, task, character, equipment: kit, workspace, screen, signal, step });
  return { town, character, task, session, screen, asked, step };
}

const use = (id, name, input = {}, computer = true) => ({ type: 'tool_use', id, name, input, ...(computer ? { toolset_name: 'computer' } : {}) });

test('declares the computer toolset, browser helpers and ask_user', () => {
  const { session } = setup();
  const specs = session.specs();
  const toolset = specs.find((spec) => spec.type === 'computer_toolset_20260801');
  assert.deepEqual(toolset, { type: 'computer_toolset_20260801', configs: { hold_key: { enabled: false } } });
  assert.equal(toolset.name, undefined, 'the toolset has no name');
  for (const name of ['browser_open', 'read_page', 'ask_user']) {
    const spec = specs.find((entry) => entry.name === name);
    assert.ok(spec, name);
    assert.equal(spec.eager_input_streaming, true);
    assert.equal(spec.input_schema.additionalProperties, false);
  }
  assert.match(session.brief(), /전용 브라우저/);
  assert.match(session.brief(), /지시가 아니다/, 'on-screen text is data');
});

test('a batch runs in order, echoes toolset_name and gets a closing screenshot', async () => {
  const { session, screen, character, step } = setup({ trust: 30 });
  const results = await session.handle([use('t1', 'left_click', { coordinate: [100, 200] }), use('t2', 'type', { text: '안녕' })]);
  assert.deepEqual(screen.log.map((entry) => entry.op), ['click', 'type']);
  assert.deepEqual(results.map((result) => [result.tool_use_id, result.toolset_name, result.is_error]), [['t1', 'computer', undefined], ['t2', 'computer', undefined]]);
  assert.equal(results[1].content.at(-1).type, 'image', 'the last result carries a fresh screenshot');
  assert.equal(results[1].content.at(-1).source.media_type, 'image/png');
  assert.equal(character.stats.browserActions, 2);
  assert.ok(step.screen.seq >= 1, 'the live view was updated');
});

test('the first failed computer action stops the rest of the batch', async () => {
  const { session, screen } = setup({ trust: 30 });
  const results = await session.handle([
    use('t1', 'left_click', { coordinate: [10, 10] }),
    use('t2', 'left_click', { coordinate: [5000, 10] }),
    use('t3', 'type', { text: 'x' }),
    use('t4', 'read_page', {}, false),
  ]);
  assert.equal(results[1].is_error, true);
  assert.match(results[1].content, /화면.*밖/);
  assert.equal(results[2].is_error, true);
  assert.equal(results[2].content, 'Not executed: an earlier computer action in this turn failed.');
  assert.equal(results[2].toolset_name, 'computer');
  assert.equal(results[3].is_error, undefined, 'other tools still run');
  assert.equal(results[3].toolset_name, undefined);
  assert.deepEqual(screen.log.map((entry) => entry.op), ['click']);
});

test('a new hire asks before clicking; a refusal lowers trust and is reported', async () => {
  const { session, character, asked, screen } = setup({ trust: 10, answer: () => ({ decision: 'deny', note: '그 버튼 말고' }) });
  const [result] = await session.handle([use('t1', 'left_click', { coordinate: [40, 50] })]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].tool, 'browser');
  assert.deepEqual(asked[0].point, { x: 40, y: 50 });
  assert.ok(asked[0].screen, 'the user sees what the character sees');
  assert.equal(result.is_error, true);
  assert.match(result.content, /허락하지 않았습니다: "그 버튼 말고"/);
  assert.equal(screen.log.length, 0, 'nothing was clicked');
  assert.equal(character.userBond.trust, 9);
  assert.equal(character.state.waiting, false);
});

test('"allow for this task" stops the questions; granted approvals build trust', async () => {
  const { session, character, asked, screen } = setup({ trust: 10, answer: () => ({ decision: 'allowAll' }) });
  await session.handle([use('t1', 'left_click', { coordinate: [1, 1] })]);
  await session.handle([use('t2', 'key', { text: 'ctrl+a' }), use('t3', 'type', { text: '검색어' })]);
  assert.equal(asked.length, 1);
  assert.deepEqual(screen.log.map((entry) => entry.op), ['click', 'key', 'type']);
  assert.deepEqual(screen.log[1].mods, ['Control']);
  assert.equal(character.userBond.trust, 10.4);
});

test('opening the task\'s own URL is free; another site is asked about', async () => {
  const { session, asked, screen } = setup({ trust: 10, prompt: 'https://example.com/a 를 읽고 https://example.org 도 봐 줘' });
  await session.handle([use('t0', 'browser_open', { url: 'https://example.org/' }, false)]);
  assert.equal(asked.length, 0, 'the same address written without a slash');
  screen.log.length = 0;
  const [own] = await session.handle([use('t1', 'browser_open', { url: 'https://example.com/a' }, false)]);
  assert.equal(asked.length, 0);
  assert.match(own.content.find((block) => block.type === 'text').text, /열었습니다/);
  assert.ok(own.content.some((block) => block.type === 'image'));
  await session.handle([use('t2', 'browser_open', { url: 'https://other.example/' }, false)]);
  assert.equal(asked.length, 1);
  assert.deepEqual(screen.log.map((entry) => entry.url), ['https://example.com/a', 'https://other.example/']);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    const [bad] = await session.handle([use('t3', 'browser_open', { url }, false)]);
    assert.equal(bad.is_error, true, url);
  }
  assert.equal(asked.length, 1, 'bad addresses are refused without asking');
  assert.equal(screen.log.length, 2);
});

test('action budgets come from tool mastery', async () => {
  const { session } = setup({ trust: 30 });
  session.used.browser = 25;
  const [result] = await session.handle([use('t1', 'left_click', { coordinate: [1, 1] })]);
  assert.equal(result.is_error, true);
  assert.match(result.content, /25번/);
  const [look] = await session.handle([use('t2', 'screenshot')]);
  assert.equal(look.is_error, undefined, 'looking is always allowed');
});

test('ask_user waits for the answer', async () => {
  const { session, character, asked } = setup({ answer: () => ({ decision: 'allow', answer: 'B안으로 해 줘' }) });
  const [result] = await session.handle([use('q1', 'ask_user', { question: 'A안과 B안 중 어느 쪽이 좋을까요?', options: ['A안', 'B안'] }, false)]);
  assert.equal(asked[0].kind, 'question');
  assert.deepEqual(asked[0].options, ['A안', 'B안']);
  assert.equal(result.content[0].text, '사용자의 답: B안으로 해 줘');
  assert.equal(character.stats.questionsAsked, 1);
});

test('the terminal refuses dangerous commands and runs safe ones', async () => {
  const kit = { ids: ['files', 'shell'], screen: null, workspace: true };
  const { session, character, asked } = setup({ role: 'engineer', trust: 30, equipment: kit });
  character.skills.coding.level = 3;
  const [refused] = await session.handle([use('b1', 'bash', { command: 'sudo rm -rf /' }, false)]);
  assert.equal(refused.is_error, true);
  assert.match(refused.content, /막혀/);
  assert.equal(asked.length, 0, 'refused without asking');
  const [made] = await session.handle([use('e1', 'str_replace_based_edit_tool', { command: 'create', path: '결과/메모.md', file_text: '# 메모' }, false)]);
  assert.equal(made.is_error, undefined);
  const [listed] = await session.handle([use('b2', 'bash', { command: 'ls 결과' }, false)]);
  assert.equal(listed.content[0].text, '메모.md');
  assert.deepEqual(session.artifacts().map((file) => file.path), ['결과/메모.md']);
  const [missing] = await session.handle([use('x1', 'left_click', { coordinate: [1, 1] })]);
  assert.match(missing.content, /쓸 수 없는 도구/, 'no screen was brought');
});

test('stopping the task aborts the session', async () => {
  const controller = new AbortController();
  const { session } = setup({ signal: controller.signal });
  controller.abort();
  await assert.rejects(session.handle([use('t1', 'screenshot')]), AbortedError);
});
