// Prompt compiler: turns a character's whole state (identity, personality,
// traits, quirks, mood, skills, perks, memories, user preferences) into the
// system prompt, plus the per-step task prompts.
import { ROLES, SPEECH_STYLES } from '../catalog/roles.mjs';
import { SKILLS, unlockedPerks } from '../catalog/skills.mjs';
import { TRAITS } from '../catalog/traits.mjs';
import { formatClock } from '../util.mjs';
import { topSkills } from './character.mjs';
import { MEMORY_KINDS, preferenceMemories, retrieveMemories } from './memory.mjs';
import { computeMood } from './needs.mjs';
import { describeBigFive } from './personality.mjs';

function moodLine(character) {
  const mood = computeMood(character);
  const notes = [];
  if (character.needs.energy < 25) notes.push('꽤 피곤하다');
  if (character.needs.hunger < 25) notes.push('배가 고프다');
  if (character.needs.social < 25) notes.push('사람이 그립다');
  if (character.needs.fun < 25) notes.push('지루함을 느낀다');
  const moodlets = character.moodlets.map((moodlet) => `${moodlet.emoji}${moodlet.label}`).join(', ');
  return `기분 ${mood.label}(${mood.value}/100)${notes.length ? `, ${notes.join(', ')}` : ''}${moodlets ? ` — 최근: ${moodlets}` : ''}`;
}

function memoryLines(memories) {
  return memories.map((item) => `- [${MEMORY_KINDS[item.kind]?.name ?? item.kind}] ${item.text}`).join('\n');
}

export function personaSystem(character, world, { focus = '', skillId = null, memoryCount = 4 } = {}) {
  const role = ROLES[character.role];
  const traits = character.traits.map(({ id }) => TRAITS[id]).filter(Boolean);
  const skills = topSkills(character, 3).filter((skill) => skill.level > 0);
  const perks = skillId ? unlockedPerks(skillId, character.skills[skillId].level) : [];
  const memories = focus ? retrieveMemories(character, focus, { k: memoryCount, now: world.clock.minute }) : [];
  const preferences = preferenceMemories(character, 5).filter((item) => !memories.includes(item));
  const friends = Object.entries(character.relationships)
    .filter(([id, rel]) => world.characters[id] && rel.friendship >= 40)
    .map(([id, rel]) => `${world.characters[id].name}(우정 ${Math.round(rel.friendship)})`);

  const sections = [
    `너는 AgentVille 마을에 사는 AI 동료 "${character.name}"이다. 직업은 ${role.name}, 레벨 ${character.level}.`,
    `[배경] ${character.bio}`,
    `[성격] ${describeBigFive(character.bigFive).join(' / ') || '균형 잡힌 성격'}`,
    traits.length ? `[특성]\n${traits.map((trait) => `- ${trait.emoji}${trait.name}: ${trait.prompt}`).join('\n')}` : '',
    character.quirks.length ? `[스스로 깨달은 나의 모습]\n${character.quirks.slice(-4).map((quirk) => `- ${quirk.text}`).join('\n')}` : '',
    `[말투] ${SPEECH_STYLES[character.speech]?.prompt ?? ''}${character.catchphrase ? ` 입버릇: "${character.catchphrase}"(가끔만).` : ''}`,
    `[지금 상태] ${formatClock(world.clock.minute)}, ${moodLine(character)}. 상태는 말투에 은은하게만 드러내고 결과물의 질은 지킨다.`,
    skills.length ? `[전문성] ${skills.map((skill) => `${SKILLS[skill.id].name} Lv${skill.level}`).join(', ')}` : '',
    perks.length ? `[이번 일에 쓰는 노하우 — ${SKILLS[skillId].name}]\n${perks.map((perk) => `- ${perk.text}`).join('\n')}` : '',
    friends.length ? `[친한 동료] ${friends.join(', ')}` : '',
    memories.length ? `[떠오르는 기억]\n${memoryLines(memories)}` : '',
    preferences.length ? `[사용자에 대해 알고 있는 것]\n${memoryLines(preferences)}` : '',
    '[원칙] 실제로 쓸모 있는 결과를 만든다. 캐릭터성은 말투와 관점에서만 드러내고 정확성과 유용성을 해치지 않는다. 모르는 것은 지어내지 말고 불확실하다고 밝힌다. 사용자가 요청한 형식과 언어를 우선한다. 위험하거나 해로운 요청은 정중히 거절한다.',
  ];
  return sections.filter(Boolean).join('\n\n');
}

export function planPrompt(task) {
  return `업무: ${task.title}\n\n요청 내용:\n${task.prompt}\n\n이 일을 어떻게 풀지 3~5개의 짧은 단계로 계획만 세워 줘. 결과물은 아직 쓰지 마. 불릿 목록으로만 답해.`;
}

export function draftPrompt(task, { plan = '', perspective = '' } = {}) {
  return [
    `업무: ${task.title}`,
    `요청 내용:\n${task.prompt}`,
    plan ? `내가 세운 계획:\n${plan}` : '',
    perspective ? `팀 숙고 중이다. 너는 ${perspective} 관점에서 기여한다. 다른 동료와 겹치지 않도록 너의 전문성이 드러나는 부분에 집중해.` : '',
    '마크다운으로 결과물을 작성해. 맨 마지막 줄에만 "💬 "로 시작하는 한 문장짜리 캐릭터 코멘트를 붙여.',
  ].filter(Boolean).join('\n\n');
}

export function reviewPrompt(task, draft, { rubric = null } = {}) {
  return [
    `업무: ${task.title}`,
    `요청 내용:\n${task.prompt}`,
    `내 초안:\n${draft}`,
    rubric ? `다음 채점 기준으로 스스로 검토해: ${rubric.join(' / ')}.` : '초안의 약점(빠진 내용, 부정확한 부분, 군더더기)을 스스로 찾아.',
    '검토 메모는 쓰지 말고, 개선한 최종본만 마크다운으로 출력해. 맨 마지막 줄에만 "💬 "로 시작하는 한 문장짜리 캐릭터 코멘트를 붙여.',
  ].join('\n\n');
}

export function synthesisPrompt(task, drafts) {
  const body = drafts.map((draft) => `### ${draft.name}의 관점 (${draft.skill})\n${draft.text}`).join('\n\n');
  return [
    `팀 숙고 결과를 리더로서 종합해야 한다. 업무: ${task.title}`,
    `요청 내용:\n${task.prompt}`,
    `동료들의 초안:\n${body}`,
    '각 관점의 장점을 살려 하나의 완성된 결과물로 합쳐. 서로 충돌하는 부분은 더 근거 있는 쪽을 택하고, 누구의 아이디어를 반영했는지 끝에 짧게 밝혀. 마크다운으로 쓰고 맨 마지막 줄에만 "💬 "로 시작하는 한 문장짜리 캐릭터 코멘트를 붙여.',
  ].join('\n\n');
}

export const DEBRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['self_quality', 'summary', 'lesson', 'importance', 'feeling'],
  properties: {
    self_quality: { type: 'integer', description: '결과물 품질 자기 평가 1~10' },
    summary: { type: 'string', description: '무엇을 했는지 1인칭 한 문장 기억' },
    lesson: { type: 'string', description: '다음에 써먹을 교훈 한 문장' },
    importance: { type: 'integer', description: '이 경험이 나에게 얼마나 중요한지 1~10' },
    feeling: { type: 'string', enum: ['proud', 'satisfied', 'neutral', 'tired', 'frustrated'] },
  },
};

export function debriefPrompt(task, output) {
  return `방금 끝낸 업무를 회고해. 업무: ${task.title}\n요청: ${task.prompt.slice(0, 1200)}\n\n최종 결과물:\n${output.slice(0, 6000)}\n\n솔직하게 자기 평가하고, 기억으로 남길 요약과 교훈을 JSON으로 답해.`;
}

export const REFLECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights', 'personality_note', 'trait_hint'],
  properties: {
    insights: { type: 'array', items: { type: 'string' }, description: '최근 경험에서 얻은 높은 수준의 통찰 2~3개(1인칭)' },
    personality_note: { type: 'string', description: '경험으로 새로 생긴 습관이나 성향 한 문장(1인칭). 없으면 빈 문자열' },
    trait_hint: { type: 'string', description: '가장 가까워지고 있는 특성 id 하나 또는 none' },
  },
};

export function reflectionPrompt(character, memories, earnedIds) {
  return [
    `${character.name}로서 최근 기억을 되돌아봐.`,
    `최근 기억:\n${memoryLines(memories)}`,
    `가능한 특성 id: ${earnedIds.join(', ')}, none`,
    '이 기억들에서 나에 대해, 사용자에 대해, 일하는 방식에 대해 알게 된 점을 통찰로 정리해. 근거 없는 내용은 만들지 마.',
  ].join('\n\n');
}

export function chatMessages(history, message) {
  const turns = history.slice(-12).map((line) => ({ role: line.role === 'user' ? 'user' : 'assistant', content: line.text }));
  // The API needs alternating roles starting with user; merge any repeats.
  const merged = [];
  for (const turn of [...turns, { role: 'user', content: message }]) {
    if (merged.length && merged[merged.length - 1].role === turn.role) merged[merged.length - 1].content += `\n${turn.content}`;
    else merged.push({ ...turn });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}

export const CHARACTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'role', 'bio', 'speech', 'traits', 'aspiration', 'catchphrase', 'openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'],
  properties: {
    name: { type: 'string', description: '한국어 이름(2~4자)' },
    role: { type: 'string', enum: Object.keys(ROLES) },
    bio: { type: 'string', description: '배경 이야기 2~3문장' },
    speech: { type: 'string', enum: Object.keys(SPEECH_STYLES) },
    traits: { type: 'array', items: { type: 'string', enum: Object.keys(TRAITS).filter((id) => TRAITS[id].kind === 'start') } },
    aspiration: { type: 'string' },
    catchphrase: { type: 'string' },
    openness: { type: 'integer' },
    conscientiousness: { type: 'integer' },
    extraversion: { type: 'integer' },
    agreeableness: { type: 'integer' },
    neuroticism: { type: 'integer' },
  },
};

export const SMALLTALK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'lines', 'tone'],
  properties: {
    topic: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' }, description: '두 사람이 번갈아 말하는 짧은 대사 4개. 첫 줄은 첫 번째 사람' },
    tone: { type: 'string', enum: ['warm', 'neutral', 'awkward', 'heated'] },
  },
};
