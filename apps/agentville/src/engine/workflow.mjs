// Task pipelines. Solo: plan (skill Lv2+) → draft → review (Lv4+, rubric at
// Lv8, deeper at Lv10) → debrief. Team ("contemplating"): every member drafts
// from their own specialty in parallel, then the lead synthesises.
import { SKILLS, pipelineFor } from '../catalog/skills.mjs';
import { newId } from '../util.mjs';
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
  const call = (content, options) => town.brain.text({ system, messages: [{ role: 'user', content }], ...options });

  let plan = '';
  if (pipe.plan) {
    const step = startStep(town, task, { kind: 'plan', label: '🧭 계획 세우기', character, effort: 'low' });
    plan = await call(planPrompt(task), { effort: 'low', maxTokens: 6000, meta: { kind: 'plan', character, task }, onText: streamInto(town, task, step) });
    finishStep(town, task, step, plan);
  }

  const draftStep = startStep(town, task, { kind: 'draft', label: '✍️ 작업', character, effort });
  let final = await call(draftPrompt(task, { plan }), { effort, maxTokens: 32000, meta: { kind: 'draft', character, task, plan }, onText: streamInto(town, task, draftStep) });
  finishStep(town, task, draftStep, final);

  if (pipe.review) {
    const reviewEffort = pipe.mastery ? raiseEffort(effort) : effort;
    const label = pipe.rubric ? '📏 기준표로 검토·개선' : '🔍 스스로 검토·개선';
    const step = startStep(town, task, { kind: 'review', label, character, effort: reviewEffort });
    final = await call(reviewPrompt(task, final, { rubric: pipe.rubric ? SKILLS[task.category].rubric : null }), {
      effort: reviewEffort, maxTokens: 32000, meta: { kind: 'review', character, task, plan }, onText: streamInto(town, task, step),
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
  const drafts = await Promise.all(members.map(async (member) => {
    const perspective = perspectiveOf(member, task);
    const effort = effortFor(town, member);
    const system = personaSystem(member, town, { focus: `${task.title} ${task.prompt}`, skillId: perspective.skillId, memoryCount: 4 });
    const step = startStep(town, task, { kind: 'draft', label: `🧩 ${member.name}의 관점 (${perspective.label})`, character: member, effort });
    const text = await town.brain.text({
      system,
      messages: [{ role: 'user', content: draftPrompt(task, { perspective: `${SKILLS[perspective.skillId].name} 전문가` }) }],
      effort, maxTokens: 24000,
      meta: { kind: 'draft', character: member, task, salt: member.id },
      onText: streamInto(town, task, step),
    });
    finishStep(town, task, step, text);
    return { name: member.name, skill: SKILLS[perspective.skillId].name, text: splitComment(text).output };
  }));

  const effort = effortFor(town, lead);
  const system = personaSystem(lead, town, { focus: `${task.title} ${task.prompt}`, skillId: task.category, memoryCount: 6 });
  const step = startStep(town, task, { kind: 'synthesis', label: `🧠 ${lead.name}의 종합 (리더)`, character: lead, effort });
  const final = await town.brain.text({
    system, messages: [{ role: 'user', content: synthesisPrompt(task, drafts) }], effort, maxTokens: 32000,
    meta: { kind: 'synthesis', character: lead, task, drafts }, onText: streamInto(town, task, step),
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
    task.error = town.brain.describeError(error);
    for (const step of task.steps) if (step.status === 'running') step.status = 'error';
    town.chronicle({ emoji: '⚠️', text: `"${task.title}" 진행 중 오류: ${task.error}`, charId: lead?.id });
  } finally {
    for (const member of members) {
      town.endWork(member, task);
      town.maybeReflect(member);
    }
    town.emitTask(task);
    town.saveSoon();
  }
}
