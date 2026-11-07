// Task pipelines. Solo: plan (skill Lv2+) → draft → review (Lv4+, rubric at
// Lv8, deeper at Lv10) → debrief. Team ("contemplating"): every member drafts
// from their own specialty in parallel, then the lead synthesises.
import { SKILLS, pipelineFor } from '../catalog/skills.mjs';
import { ACTION_BUDGET, TOOLS, actionBudget, addMastery, planEquipment, serverSpecs, toolsForStep } from '../catalog/tools.mjs';
import { AgentSession } from '../agent/session.mjs';
import { attachmentBlocks, attachmentDigest } from '../files.mjs';
import { newId } from '../util.mjs';
import { relatedWork } from './archive.mjs';
import { effortForLevel, topSkills } from './character.mjs';
import { computeQuality, rewardTask, rewardTeam } from './progression.mjs';
import {
  DEBRIEF_SCHEMA, debriefPrompt, draftPrompt, personaSystem, planPrompt, reviewPrompt, synthesisPrompt,
} from './prompts.mjs';

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const raiseEffort = (effort) => EFFORT_ORDER[Math.min(EFFORT_ORDER.length - 1, EFFORT_ORDER.indexOf(effort) + 1)];

export function effortFor(town, character) {
  return town.settings.effortByLevel ? effortForLevel(character.level) : 'medium';
}

// Splits the trailing "💬 ..." in-character comment from the deliverable.
export function splitComment(text) {
  const lines = String(text ?? '').trimEnd().split('\n');
  const index = lines.findLastIndex((line) => line.trim().startsWith('💬'));
  if (index === -1) return { output: lines.join('\n').trim(), comment: '' };
  const comment = lines[index].trim().replace(/^💬\s*/, '');
  return { output: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n').trim(), comment };
}

function startStep(town, task, { kind, label, character, effort = null }) {
  const step = { id: newId('s'), kind, label, charId: character.id, effort, status: 'running', text: '', startedAt: town.clock.minute };
  task.steps.push(step);
  town.emitTask(task);
  return step;
}

function streamInto(town, task, step) {
  return (delta) => {
    step.text += delta;
    town.emit('delta', { taskId: task.id, stepId: step.id, text: delta });
  };
}

function finishStep(town, task, step, text = step.text) {
  step.text = text;
  step.status = 'done';
  step.endedAt = town.clock.minute;
  town.emitTask(task);
}

// Attachments ride along on every step's message as image/document blocks;
// the offline brain gets a digest (names, and the text of text files).
function taskInputs(town, task) {
  const blocks = attachmentBlocks(town.files, task.attachments);
  return {
    content: (text) => (blocks.length ? [...blocks, { type: 'text', text }] : text),
    digest: attachmentDigest(town.files, task.attachments),
  };
}

const toolLabel = (ids) => ids.map((id) => ` · ${TOOLS[id].emoji} ${TOOLS[id].name}`).join('');

// Server tools for a team member's step (setting-gated).
function stepTools(town, character, category) {
  const ids = toolsForStep(character, category, { enabled: town.settings.tools !== false, settings: town.settings });
  return { ids, specs: serverSpecs(character, ids), label: toolLabel(ids) };
}

// Keeps a short live trace of tool use on the step, counts real uses and
// grows server-tool mastery (client tools grow theirs in the session).
function recordActivity(town, task, step, character, ups = []) {
  return (activity) => {
    const tools = (step.tools ??= []);
    tools.push({ tool: activity.tool, text: activity.text, error: Boolean(activity.error), use: Boolean(activity.use) });
    if (tools.length > 60) tools.shift();
    if (activity.use) {
      character.stats.toolUses = (character.stats.toolUses ?? 0) + 1;
      step.uses = (step.uses ?? 0) + 1;
      if (TOOLS[activity.tool]?.kind === 'server') {
        const level = addMastery(character, activity.tool);
        if (level) ups.push({ tool: activity.tool, level });
      }
    }
    town.emitTask(task);
  };
}

function recordMastery(town, character, ups) {
  if (ups.length) town.recordEvents(ups.map((up) => ({ type: 'mastery', charId: character.id, ...up })), character.id);
}

// Turn budget for an agent step: enough for every action it may take.
function turnBudget(character, ids) {
  const actions = ids.filter((id) => ACTION_BUDGET[id]).reduce((sum, id) => sum + actionBudget(character, id), 0);
  return Math.min(150, Math.max(12, Math.ceil(actions * 0.8) + 6));
}

// Files left behind and the last screen become part of the result.
async function finishSession(town, task, character, session, step) {
  try {
    task.artifacts = session.artifacts().map((file) => ({ ...file, charId: character.id }));
    const live = town.liveScreens.get(task.id);
    if (live?.png && session.shots) {
      const meta = town.files.put(live.png, { name: `${character.name}의 마지막 화면.png`, type: 'image/png' });
      task.finalScreen = meta;
      if (step.screen) step.screen.final = meta.id;
    }
  } catch (error) {
    task.artifacts ??= [];
    step.tools?.push({ tool: 'files', text: `결과 정리 실패: ${error.message}`, error: true });
  } finally {
    await session.close();
    town.liveScreens.delete(task.id);
  }
}

async function debrief(town, task, character, system, output) {
  const step = startStep(town, task, { kind: 'debrief', label: '🔮 회고', character, effort: 'low' });
  try {
    const result = await town.brain.json({
      system,
      messages: [{ role: 'user', content: debriefPrompt(task, output) }],
      schema: DEBRIEF_SCHEMA,
      effort: 'low',
      meta: { kind: 'debrief', character, task },
    });
    finishStep(town, task, step, `${result.summary}\n교훈: ${result.lesson}\n자기 평가: ${result.self_quality}/10`);
    return result;
  } catch (error) {
    // A failed debrief should not lose finished work.
    finishStep(town, task, step, `회고를 건너뜀: ${town.brain.describeError(error)}`);
    return null;
  }
}

async function runSolo(town, task, character) {
  const level = character.skills[task.category].level;
  const pipe = pipelineFor(level);
  const effort = effortFor(town, character);
  const memoryCount = (pipe.widerMemory ? 8 : 4) + Math.floor(character.level / 4);
  const system = personaSystem(character, town, { focus: `${task.title} ${task.prompt}`, skillId: task.category, memoryCount });
  const inputs = taskInputs(town, task);
  const signal = town.controllers.get(task.id)?.signal ?? null;
  const call = (text, { meta, ...options }) => town.brain.text({
    system, messages: [{ role: 'user', content: inputs.content(text) }], signal, ...options, meta: { ...meta, attachments: inputs.digest },
  });

  let plan = '';
  if (pipe.plan) {
    const step = startStep(town, task, { kind: 'plan', label: '🧭 계획 세우기', character, effort: 'low' });
    plan = await call(planPrompt(task), { effort: 'low', maxTokens: 6000, meta: { kind: 'plan', character, task }, onText: streamInto(town, task, step) });
    finishStep(town, task, step, plan);
  }

  const equipment = planEquipment(character, task, town.settings);
  // Skill Lv6 (wider memory) also widens how much past work is recalled.
  const refs = relatedWork(town, task, character, { k: pipe.widerMemory ? 3 : 1 });
  const agentic = Boolean(equipment.screen || equipment.workspace);
  const draftStep = startStep(town, task, { kind: agentic ? 'agent' : 'draft', label: `${agentic ? '🤖 직접 해 보기' : '✍️ 작업'}${toolLabel(equipment.ids)}`, character, effort });
  if (refs.length) draftStep.refs = refs.map(({ id, title, rating }) => ({ id, title, rating }));
  const ups = [];
  const onActivity = recordActivity(town, task, draftStep, character, ups);
  const session = agentic
    ? new AgentSession({
      town, task, character, equipment, signal, onActivity, step: draftStep,
      workspace: equipment.workspace ? town.workspaceFor(character, task) : null,
      screen: town.makeScreen(equipment.screen),
    })
    : null;
  if (session?.workspace) task.workspace = { root: session.workspace.root, own: session.workspace.own, charId: character.id, sandboxed: session.workspace.sandboxed };
  let final;
  try {
    final = await call(draftPrompt(task, { plan, tools: equipment.ids, refs, environment: session?.brief() ?? '' }), {
      effort, maxTokens: agentic ? 16000 : 32000, tools: session ? session.specs() : serverSpecs(character, equipment.ids),
      runTools: session ? (blocks) => session.handle(blocks) : null, maxTurns: session ? turnBudget(character, equipment.ids) : undefined,
      meta: { kind: 'draft', character, task, plan, refs, agent: session },
      onText: streamInto(town, task, draftStep), onActivity,
    });
  } finally {
    if (session) await finishSession(town, task, character, session, draftStep);
    recordMastery(town, character, [...ups, ...(session?.masteryUps ?? [])]);
  }
  finishStep(town, task, draftStep, final);

  if (pipe.review) {
    const reviewEffort = pipe.mastery ? raiseEffort(effort) : effort;
    const label = pipe.rubric ? '📏 기준표로 검토·개선' : '🔍 스스로 검토·개선';
    const step = startStep(town, task, { kind: 'review', label, character, effort: reviewEffort });
    final = await call(reviewPrompt(task, final, { rubric: pipe.rubric ? SKILLS[task.category].rubric : null }), {
      effort: reviewEffort, maxTokens: 32000, meta: { kind: 'review', character, task, plan, refs }, onText: streamInto(town, task, step),
    });
    finishStep(town, task, step, final);
  }

  const { output, comment } = splitComment(final);
  task.output = output;
  task.comment = comment;
  const result = await debrief(town, task, character, system, output);
  const quality = computeQuality(character, task, result?.self_quality, town.rng);
  task.quality = quality;
  task.selfQuality = quality;
  const { xp, events } = rewardTask(town, character, task, { quality, role: 'solo', debrief: result });
  task.rewards[character.id] = { xp };
  town.recordEvents(events, character.id);
}

function perspectiveOf(character, task) {
  const own = character.skills[task.category].level;
  const best = topSkills(character, 1)[0];
  const skillId = best && best.level > own ? best.id : task.category;
  return { skillId, label: `${SKILLS[skillId].emoji} ${SKILLS[skillId].name}` };
}

async function runTeam(town, task, members, lead) {
  const inputs = taskInputs(town, task);
  const drafts = await Promise.all(members.map(async (member) => {
    const perspective = perspectiveOf(member, task);
    const effort = effortFor(town, member);
    const system = personaSystem(member, town, { focus: `${task.title} ${task.prompt}`, skillId: perspective.skillId, memoryCount: 4 });
    const tools = stepTools(town, member, perspective.skillId);
    const refs = relatedWork(town, task, member, { k: 1 });
    const ups = [];
    const step = startStep(town, task, { kind: 'draft', label: `🧩 ${member.name}의 관점 (${perspective.label})${tools.label}`, character: member, effort });
    if (refs.length) step.refs = refs.map(({ id, title, rating }) => ({ id, title, rating }));
    const text = await town.brain.text({
      system,
      messages: [{ role: 'user', content: inputs.content(draftPrompt(task, { perspective: `${SKILLS[perspective.skillId].name} 전문가`, tools: tools.ids, refs })) }],
      effort, maxTokens: 24000, tools: tools.specs, signal: town.controllers.get(task.id)?.signal ?? null,
      meta: { kind: 'draft', character: member, task, salt: member.id, refs, attachments: inputs.digest },
      onText: streamInto(town, task, step), onActivity: recordActivity(town, task, step, member, ups),
    });
    recordMastery(town, member, ups);
    finishStep(town, task, step, text);
    return { name: member.name, skill: SKILLS[perspective.skillId].name, text: splitComment(text).output };
  }));

  const effort = effortFor(town, lead);
  const system = personaSystem(lead, town, { focus: `${task.title} ${task.prompt}`, skillId: task.category, memoryCount: 6 });
  const step = startStep(town, task, { kind: 'synthesis', label: `🧠 ${lead.name}의 종합 (리더)`, character: lead, effort });
  const final = await town.brain.text({
    system, messages: [{ role: 'user', content: inputs.content(synthesisPrompt(task, drafts)) }], effort, maxTokens: 32000, signal: town.controllers.get(task.id)?.signal ?? null,
    meta: { kind: 'synthesis', character: lead, task, drafts, attachments: inputs.digest }, onText: streamInto(town, task, step),
  });
  finishStep(town, task, step, final);

  const { output, comment } = splitComment(final);
  task.output = output;
  task.comment = comment;
  const result = await debrief(town, task, lead, system, output);
  const quality = Math.min(1, computeQuality(lead, task, result?.self_quality, town.rng) + 0.03 * (members.length - 1));
  task.quality = quality;
  task.selfQuality = quality;
  for (const member of members) {
    const role = member.id === lead.id ? 'lead' : 'member';
    const { xp, events } = rewardTask(town, member, task, { quality, role, debrief: member.id === lead.id ? result : null });
    task.rewards[member.id] = { xp };
    town.recordEvents(events, member.id);
  }
  town.recordEvents(rewardTeam(town, members, quality));
}

export async function runTask(town, task) {
  const members = task.assignees.map((id) => town.characters[id]).filter(Boolean);
  const lead = town.characters[task.lead] ?? members[0];
  task.status = 'working';
  task.error = null;
  task.startedAt = town.clock.minute;
  const controller = new AbortController();
  town.controllers.set(task.id, controller);
  for (const member of members) town.beginWork(member, task);
  town.emitTask(task);
  try {
    if (task.mode === 'team' && members.length > 1) await runTeam(town, task, members, lead);
    else await runSolo(town, task, lead);
    task.status = 'done';
    task.finishedAt = town.clock.minute;
    town.chronicle({ emoji: '✅', text: `${members.map((m) => m.name).join(', ')} — "${task.title}" 완료 (품질 ${Math.round((task.quality ?? 0) * 100)}점)`, charId: lead?.id });
  } catch (error) {
    task.status = 'error';
    task.error = controller.signal.aborted ? '사용자가 업무를 멈췄어요. 다시 시도할 수 있어요.' : town.brain.describeError(error);
    task.cancelled = controller.signal.aborted;
    for (const step of task.steps) if (step.status === 'running') step.status = 'error';
    if (task.cancelled) town.chronicle({ emoji: '⏹️', text: `"${task.title}" 업무를 멈췄다`, charId: lead?.id });
    else town.chronicle({ emoji: '⚠️', text: `"${task.title}" 진행 중 오류: ${task.error}`, charId: lead?.id });
  } finally {
    town.controllers.delete(task.id);
    for (const pending of town.pendingApprovals().filter((entry) => entry.taskId === task.id)) town.resolveApproval(pending.id, { decision: 'deny' });
    for (const member of members) {
      town.endWork(member, task);
      town.maybeReflect(member);
    }
    town.emitTask(task);
    town.saveSoon();
  }
}
