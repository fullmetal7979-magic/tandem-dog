// Task model, classification, difficulty estimate and explainable routing.
import { ASPIRATIONS } from '../catalog/roles.mjs';
import { SKILLS, SKILL_IDS } from '../catalog/skills.mjs';
import { clamp, newId, truncate } from '../util.mjs';
import { computeMood } from './needs.mjs';

export function classifyTask(text) {
  const value = ` ${String(text ?? '').toLowerCase()} `;
  const scores = Object.fromEntries(SKILL_IDS.map((id) => [id, 0]));
  for (const id of SKILL_IDS) {
    for (const keyword of SKILLS[id].keywords) if (value.includes(keyword)) scores[id] += keyword.length >= 3 ? 2 : 1;
  }
  const ranked = SKILL_IDS.slice().sort((a, b) => scores[b] - scores[a]);
  const category = scores[ranked[0]] > 0 ? ranked[0] : 'planning';
  return { category, scores, confident: scores[ranked[0]] > 0 && scores[ranked[0]] > scores[ranked[1]] };
}

const HARD_WORDS = /전략|아키텍처|설계|분석|비교|심층|자세히|상세|전체|모든|여러|보고서|계획서|논문|최적화|리팩터|architecture|in-depth|detailed|comprehensive|optimi[sz]e/i;
const EASY_WORDS = /간단|짧게|한 줄|한줄|빠르게|요약만|가볍게|quick|short|brief|simple/i;

export function estimateDifficulty(text) {
  const value = String(text ?? '');
  let level = 1 + Math.min(2, Math.floor(value.length / 160));
  if (HARD_WORDS.test(value)) level += 1;
  if ((value.match(/\n|[,·]|그리고|또한/g) ?? []).length >= 4) level += 1;
  if (EASY_WORDS.test(value)) level -= 1;
  return clamp(level, 1, 5);
}

export function makeTitle(text) {
  const firstLine = String(text ?? '').trim().split('\n')[0];
  return truncate(firstLine.replace(/\s+/g, ' '), 40) || '새 업무';
}

export function createTask(input, { minute }) {
  const prompt = truncate(String(input.prompt ?? '').trim(), 8000);
  const classification = classifyTask(prompt);
  const category = SKILLS[input.category] ? input.category : classification.category;
  const mode = ['solo', 'team'].includes(input.mode) ? input.mode : 'auto';
  return {
    id: newId('t'),
    title: truncate(String(input.title ?? '').trim(), 60) || makeTitle(prompt),
    prompt,
    category,
    difficulty: clamp(Math.round(Number(input.difficulty) || estimateDifficulty(prompt)), 1, 5),
    mode,
    requested: Array.isArray(input.assignees) ? input.assignees.slice(0, 4) : [],
    assignees: [],
    lead: null,
    status: 'queued',
    steps: [],
    output: '',
    comment: '',
    quality: null,
    rating: null,
    feedback: '',
    rewards: {},
    error: null,
    createdAt: minute,
    startedAt: null,
    finishedAt: null,
  };
}

export function rankCandidates(world, task) {
  const skillDef = SKILLS[task.category];
  return Object.values(world.characters)
    .map((character) => {
      const skill = character.skills[task.category];
      const mood = computeMood(character).value;
      const attrFit = Object.entries(skillDef.attrs).reduce((sum, [id, weight]) => sum + character.attributes[id] * weight, 0);
      const busy = Boolean(character.state.taskId);
      const wantsIt = ASPIRATIONS[character.aspiration.id]?.stages.some((stage) => stage.label.includes(skillDef.name));
      const parts = [
        ['skill', skill.level * 12],
        ['attr', attrFit * 0.35],
        ['mood', mood * 0.12],
        ['energy', character.needs.energy * 0.08],
        ['bond', character.userBond.affinity * 0.05],
        ['dream', wantsIt ? 6 : 0],
        ['busy', busy ? -500 : 0],
        ['exhausted', character.needs.energy < 12 ? -25 : 0],
      ];
      const score = parts.reduce((sum, [, value]) => sum + value, 0);
      const reasons = [`${skillDef.emoji} ${skillDef.name} Lv${skill.level}`];
      if (attrFit >= 28) reasons.push('적성이 잘 맞음');
      if (mood >= 70) reasons.push('기분 좋음');
      if (mood < 35) reasons.push('기분 저조');
      if (character.needs.energy < 25) reasons.push('지쳐 있음');
      if (wantsIt) reasons.push('꿈과 관련된 일');
      if (character.userBond.affinity >= 60) reasons.push('호흡이 잘 맞음');
      if (busy) reasons.push('다른 업무 중');
      return { id: character.id, name: character.name, score: Math.round(score), busy, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function bestSkillOf(character) {
  return SKILL_IDS.reduce((best, id) => (character.skills[id].level > character.skills[best].level ? id : best), SKILL_IDS[0]);
}

// Contemplation works best when perspectives differ: after the top candidate,
// prefer people whose strongest skill is not already on the team.
function pickDiverse(world, ranked, size) {
  const chosen = [];
  const covered = new Set();
  const pool = ranked.slice();
  while (chosen.length < size && pool.length) {
    pool.sort((a, b) => {
      const adjusted = (entry) => entry.score - (covered.has(bestSkillOf(world.characters[entry.id])) ? 20 : 0);
      return adjusted(b) - adjusted(a);
    });
    const next = pool.shift();
    chosen.push(next.id);
    covered.add(bestSkillOf(world.characters[next.id]));
  }
  return chosen;
}

// Picks who works on the task. Team mode takes the top free candidates and
// makes the best of them the lead, like a main agent delegating to specialists.
export function chooseAssignees(world, task) {
  const ranking = rankCandidates(world, task);
  const free = ranking.filter((entry) => !entry.busy);
  const requested = task.requested.filter((id) => world.characters[id] && !world.characters[id].state.taskId);
  let mode = task.mode;
  if (mode === 'auto') mode = requested.length > 1 || (task.difficulty >= 4 && free.length >= 2) ? 'team' : 'solo';
  let assignees = requested.length ? requested : [];
  if (!assignees.length) {
    const size = mode === 'team' ? Math.min(3, Math.max(2, task.difficulty - 1)) : 1;
    assignees = pickDiverse(world, free, size);
  }
  if (mode === 'team' && assignees.length < 2) mode = 'solo';
  if (mode === 'solo') assignees = assignees.slice(0, 1);
  const lead = assignees.slice().sort((a, b) => {
    const score = (id) => ranking.find((entry) => entry.id === id)?.score ?? 0;
    return score(b) - score(a);
  })[0] ?? null;
  return { mode, assignees, lead, ranking };
}

export function taskView(task) {
  return task;
}
