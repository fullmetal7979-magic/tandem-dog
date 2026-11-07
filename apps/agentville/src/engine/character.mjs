// Character creation, experience, levels, attributes, aspirations, relationships.
import { ASPIRATIONS, ROLES, SPEECH_STYLES } from '../catalog/roles.mjs';
import { ATTRIBUTE_IDS, SKILLS, SKILL_IDS, SKILL_MAX_LEVEL, nextPerk, skillXpToNext } from '../catalog/skills.mjs';
import { START_TRAIT_IDS, TRAITS } from '../catalog/traits.mjs';
import { clamp, newId, round1, truncate } from '../util.mjs';
import { walkableTiles, zoneAt } from './map.mjs';
import { addMemory } from './memory.mjs';
import { addMoodlet, computeMood } from './needs.mjs';
import { BIG_FIVE_IDS } from './personality.mjs';

export const xpToNextLevel = (level) => Math.round(80 * level ** 1.45);

export function effortForLevel(level) {
  if (level <= 3) return 'low';
  if (level <= 6) return 'medium';
  if (level <= 9) return 'high';
  return 'xhigh';
}
export const EFFORT_LABELS = { low: '가볍게', medium: '보통', high: '깊게', xhigh: '아주 깊게', max: '최대' };

const SKIN = ['#f6d7c3', '#eec4a4', '#d9a77f', '#b98058', '#8d5a3b'];
const HAIR = ['#2b2118', '#4a3123', '#7a4b2a', '#c99a5b', '#e0c48a', '#9a9aa5', '#6b3fa0', '#d0567a', '#2f6fd6'];
const ACCESSORIES = ['none', 'none', 'glasses', 'headphones', 'hat', 'bow', 'none'];

function freshStats() {
  return {
    tasksDone: 0, tasksByCat: {}, teamTasks: 0, ledTeams: 0, chats: 0, smallTalks: 0,
    praise: 0, criticism: 0, praiseAfterCriticism: 0, fiveStarStreak: 0, bestFiveStreak: 0,
    reflections: 0, lowEnergyFinishes: 0, burnouts: 0, outshined: 0, readMinutes: 0,
  };
}

function cleanBigFive(input, fallback) {
  return Object.fromEntries(BIG_FIVE_IDS.map((id) => [id, clamp(Math.round(Number(input?.[id] ?? fallback[id])), 0, 100)]));
}

export function createCharacter(input, { minute = 0, rng = Math.random } = {}) {
  const roleId = ROLES[input.role] ? input.role : 'researcher';
  const role = ROLES[roleId];
  const pick = (items) => items[Math.floor(rng() * items.length)];
  const jitter = () => Math.round((rng() - 0.5) * 6);

  const traitIds = (Array.isArray(input.traits) && input.traits.length ? input.traits : role.traits)
    .filter((id) => START_TRAIT_IDS.includes(id))
    .slice(0, 3);
  const traits = [];
  for (const id of traitIds) {
    const clash = (TRAITS[id].opposite ?? []).some((other) => traits.some((trait) => trait.id === other));
    if (!clash && !traits.some((trait) => trait.id === id)) traits.push({ id, acquiredAt: minute, source: 'start' });
  }

  const skills = Object.fromEntries(SKILL_IDS.map((id) => [id, { level: role.skills[id] ?? 0, xp: 0 }]));
  const start = pick(walkableTiles().filter(({ x, y }) => zoneAt(x, y) === 'office'));
  const character = {
    id: newId('c'),
    name: truncate(String(input.name ?? '').trim() || '이름 없음', 16),
    role: roleId,
    bio: truncate(String(input.bio ?? '').trim() || `${role.name}로 일하는 AgentVille의 새 주민.`, 500),
    speech: SPEECH_STYLES[input.speech] ? input.speech : 'polite',
    catchphrase: truncate(String(input.catchphrase ?? '').trim(), 40),
    appearance: {
      skin: input.appearance?.skin ?? pick(SKIN),
      hair: input.appearance?.hair ?? pick(HAIR),
      hairStyle: input.appearance?.hairStyle ?? Math.floor(rng() * 4),
      accessory: input.appearance?.accessory ?? pick(ACCESSORIES),
      shirt: role.color,
    },
    createdAt: minute,
    level: 1,
    xp: 0,
    totalXp: 0,
    attributes: Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, clamp(role.attrs[id] + jitter(), 1, 100)])),
    skills,
    bigFive: cleanBigFive(input.bigFive, role.bigFive),
    traits,
    quirks: [],
    needs: { energy: 85 + Math.round(rng() * 10), hunger: 75 + Math.round(rng() * 15), social: 70 + Math.round(rng() * 20), fun: 75 + Math.round(rng() * 15), focus: 85 + Math.round(rng() * 10) },
    moodlets: [],
    aspiration: { id: ASPIRATIONS[input.aspiration] ? input.aspiration : role.aspiration, stage: 0, done: false },
    relationships: {},
    userBond: { affinity: 20, ratings: [] },
    stats: freshStats(),
    flags: { burnedOut: false },
    drift: null,
    memory: { items: [], sinceReflection: 0, nextId: 1 },
    state: { activity: 'idle', pos: { ...start }, path: [], until: minute, taskId: null, with: null, bubble: null, lastActivity: null },
  };
  addMemory(character, { kind: 'milestone', text: `AgentVille에 처음 왔다. ${character.bio}`, importance: 6, minute });
  return character;
}

function allocateAttributePoints(character, points, rng) {
  const weights = { ...Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, 0.4])) };
  for (const [id, value] of Object.entries(ROLES[character.role].attrs)) weights[id] += value / 20;
  const topSkill = SKILL_IDS.reduce((best, id) => (character.skills[id].level > character.skills[best].level ? id : best), SKILL_IDS[0]);
  for (const [id, weight] of Object.entries(SKILLS[topSkill].attrs)) weights[id] += weight * 2;
  const gained = {};
  for (let index = 0; index < points; index++) {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    let roll = rng() * total;
    const chosen = ATTRIBUTE_IDS.find((id) => (roll -= weights[id]) <= 0) ?? ATTRIBUTE_IDS[0];
    character.attributes[chosen] = clamp(character.attributes[chosen] + 1, 1, 100);
    gained[chosen] = (gained[chosen] ?? 0) + 1;
  }
  return gained;
}

export function addCharacterXp(character, amount, { minute, rng = Math.random }) {
  const events = [];
  const gain = Math.max(0, Math.round(amount));
  character.xp += gain;
  character.totalXp += gain;
  while (character.xp >= xpToNextLevel(character.level)) {
    character.xp -= xpToNextLevel(character.level);
    character.level += 1;
    const gained = allocateAttributePoints(character, 3, rng);
    addMoodlet(character, 'levelUp', minute);
    addMemory(character, { kind: 'milestone', text: `레벨 ${character.level}이 되었다.`, importance: 7, minute });
    const before = effortForLevel(character.level - 1);
    const after = effortForLevel(character.level);
    events.push({ type: 'levelUp', level: character.level, gained, effortUp: before !== after ? after : null });
  }
  return events;
}

export function addSkillXp(character, skillId, amount, { minute }) {
  const skill = character.skills[skillId];
  if (!skill) return [];
  const events = [];
  skill.xp += Math.max(0, amount);
  while (skill.level < SKILL_MAX_LEVEL && skill.xp >= skillXpToNext(skill.level)) {
    skill.xp -= skillXpToNext(skill.level);
    skill.level += 1;
    addMoodlet(character, 'skillUp', minute);
    const perk = SKILLS[skillId].perks[skill.level] ?? null;
    events.push({ type: 'skillUp', skill: skillId, level: skill.level, perk });
  }
  if (skill.level >= SKILL_MAX_LEVEL) skill.xp = 0;
  skill.xp = round1(skill.xp);
  return events;
}

export function growAttributes(character, skillId, amount) {
  for (const [id, weight] of Object.entries(SKILLS[skillId]?.attrs ?? {})) {
    character.attributes[id] = round1(clamp(character.attributes[id] + amount * weight, 1, 100));
  }
}

export function checkAspiration(character, minute) {
  const events = [];
  const def = ASPIRATIONS[character.aspiration.id];
  if (!def || character.aspiration.done) return events;
  while (character.aspiration.stage < def.stages.length && def.stages[character.aspiration.stage].check(character)) {
    const stage = def.stages[character.aspiration.stage];
    character.aspiration.stage += 1;
    addMoodlet(character, 'aspiration', minute);
    addMemory(character, { kind: 'milestone', text: `꿈 "${def.name}"의 단계를 달성했다: ${stage.label}`, importance: 8, minute });
    const done = character.aspiration.stage >= def.stages.length;
    if (done) character.aspiration.done = true;
    events.push({ type: 'aspiration', aspiration: character.aspiration.id, stage: character.aspiration.stage, label: stage.label, done });
  }
  return events;
}

export function relationship(character, otherId) {
  character.relationships[otherId] ??= { friendship: 0, interactions: 0, last: null };
  return character.relationships[otherId];
}

export function adjustFriendship(a, b, delta, minute) {
  const before = relationship(a, b.id).friendship;
  for (const [self, other] of [[a, b], [b, a]]) {
    const rel = relationship(self, other.id);
    rel.friendship = round1(clamp(rel.friendship + delta, -100, 100));
    rel.interactions += 1;
    rel.last = minute;
  }
  const after = relationship(a, b.id).friendship;
  const crossed = [40, 75].find((line) => before < line && after >= line);
  return crossed ? { type: 'friendship', a: a.id, b: b.id, level: crossed } : null;
}

export function relationshipLabel(friendship) {
  if (friendship >= 75) return { label: '단짝', emoji: '💖' };
  if (friendship >= 40) return { label: '친구', emoji: '😊' };
  if (friendship >= 10) return { label: '아는 사이', emoji: '🙂' };
  if (friendship > -30) return { label: '서먹함', emoji: '😶' };
  return { label: '앙숙', emoji: '😤' };
}

export function topSkills(character, count = 3) {
  return SKILL_IDS.map((id) => ({ id, ...character.skills[id] }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, count);
}

// Client-facing view with derived numbers so the UI stays a thin renderer.
export function characterView(character, now) {
  const mood = computeMood(character);
  return {
    ...character,
    memory: {
      count: character.memory.items.length,
      sinceReflection: character.memory.sinceReflection,
      recent: character.memory.items.slice(-40).reverse(),
      reflections: character.memory.items.filter((item) => item.kind === 'reflection' || item.kind === 'preference').slice(-12).reverse(),
    },
    derived: {
      mood,
      xpToNext: xpToNextLevel(character.level),
      effort: effortForLevel(character.level),
      skills: Object.fromEntries(SKILL_IDS.map((id) => [id, {
        xpToNext: skillXpToNext(character.skills[id].level),
        next: nextPerk(id, character.skills[id].level),
      }])),
      aspiration: {
        stages: ASPIRATIONS[character.aspiration.id]?.stages.length ?? 0,
        next: ASPIRATIONS[character.aspiration.id]?.stages[character.aspiration.stage]?.label ?? null,
      },
      age: Math.max(0, Math.floor((now - character.createdAt) / 1440)),
    },
  };
}
