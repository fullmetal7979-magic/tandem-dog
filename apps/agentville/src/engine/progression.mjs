// Rewards after work and after user feedback. All growth rules live here so
// the simulation is deterministic code; the LLM only supplies the debrief text.
import { SKILLS } from '../catalog/skills.mjs';
import { clamp, clockParts, isNight, round1, truncate } from '../util.mjs';
import { addCharacterXp, addSkillXp, adjustFriendship, checkAspiration, growAttributes } from './character.mjs';
import { addMemory, looksLikePreference } from './memory.mjs';
import { addMoodlet, computeMood, moodXp, spendNeeds } from './needs.mjs';
import { checkEarnedTraits, compatibility, driftPersonality, qualityBonus, traitEffects, xpMultiplier } from './personality.mjs';

const CREATIVE = new Set(['writing', 'design', 'marketing']);

export function followUpChecks(character, minute) {
  const events = [];
  for (const trait of checkEarnedTraits(character, minute)) {
    addMoodlet(character, 'newTrait', minute);
    addMemory(character, { kind: 'milestone', text: `새로운 특성을 얻었다: ${trait.name}. ${trait.desc}`, importance: 8, minute });
    events.push({ type: 'trait', trait: trait.id, name: trait.name, emoji: trait.emoji });
  }
  for (const event of checkAspiration(character, minute)) events.push(event);
  // Finishing an aspiration can itself unlock the master trait.
  if (events.some((event) => event.type === 'aspiration' && event.done)) {
    for (const trait of checkEarnedTraits(character, minute)) events.push({ type: 'trait', trait: trait.id, name: trait.name, emoji: trait.emoji });
  }
  return events;
}

// Blends the character's own estimate with skill, mood and trait bonuses.
export function computeQuality(character, task, selfQuality, rng) {
  const skill = character.skills[task.category].level;
  const mood = computeMood(character).value;
  const skillFactor = clamp(0.45 + skill * 0.05 - (task.difficulty - 1) * 0.035, 0.1, 1);
  const self = selfQuality == null ? skillFactor : clamp(selfQuality / 10, 0.1, 1);
  const noise = (rng() - 0.5) * 0.12;
  const value = self * 0.45 + skillFactor * 0.35 + (mood / 100) * 0.12 + noise + qualityBonus(traitEffects(character), task.category);
  return round1(clamp(value, 0.05, 1) * 100) / 100;
}

export function rewardTask(world, character, task, { quality, role = 'solo', debrief = null }) {
  const minute = world.clock.minute;
  const effects = traitEffects(character);
  const mood = computeMood(character).value;
  const difficulty = task.difficulty;
  const roleMult = role === 'member' ? 0.75 : role === 'lead' ? 1.15 : 1;
  const teamMult = role === 'solo' ? 1 : 1 + effects.teamBonus;
  const xp = Math.round(40 * difficulty * (0.6 + 0.8 * quality) * moodXp(mood) * xpMultiplier(effects, task.category) * roleMult * teamMult);

  const events = [];
  events.push(...addSkillXp(character, task.category, xp, { minute }));
  events.push(...addCharacterXp(character, xp, { minute, rng: world.rng }));
  growAttributes(character, task.category, 0.25 * difficulty * (0.5 + quality));

  const lowEnergy = character.needs.energy < 20;
  spendNeeds(character, { energy: 4 * difficulty, focus: 6 * difficulty, hunger: 2 * difficulty, fun: 2 * difficulty });
  const stats = character.stats;
  stats.tasksDone += 1;
  stats.tasksByCat[task.category] = (stats.tasksByCat[task.category] ?? 0) + 1;
  if (role !== 'solo') stats.teamTasks += 1;
  if (role === 'lead') stats.ledTeams += 1;
  if (lowEnergy) stats.lowEnergyFinishes += 1;

  const { day } = clockParts(minute);
  driftPersonality(character, {
    O: CREATIVE.has(task.category) ? 0.3 : 0.1,
    C: difficulty >= 3 ? 0.3 : 0.1,
    A: role === 'solo' ? 0 : 0.4,
    E: role === 'solo' ? -0.05 : 0.2,
    N: quality < 0.4 ? 0.3 : -0.1,
  }, day);

  if (character.needs.energy < 15) addMoodlet(character, 'overworked', minute);
  if (isNight(minute) && !effects.nightWorker) addMoodlet(character, 'nightShift', minute);

  const skillName = SKILLS[task.category].name;
  const summary = debrief?.summary || `${skillName} 업무 "${task.title}"${role === 'member' ? '에 팀원으로 참여했다' : '를 마쳤다'}.`;
  addMemory(character, {
    kind: 'task',
    text: `${summary}${debrief?.lesson ? ` 교훈: ${debrief.lesson}` : ''}`,
    importance: debrief?.importance ?? 3 + difficulty,
    minute,
    meta: { taskId: task.id },
  });

  events.push(...followUpChecks(character, minute));
  return { xp, events };
}

export function rewardTeam(world, members, quality) {
  const events = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      const delta = 2 + compatibility(a, b) * 3 + (quality > 0.6 ? 1.5 : -0.5);
      const crossed = adjustFriendship(a, b, delta, world.clock.minute);
      if (crossed) events.push(crossed);
    }
  }
  if (quality > 0.6) for (const member of members) addMoodlet(member, 'teamwork', world.clock.minute);
  for (const member of members) events.push(...followUpChecks(member, world.clock.minute).map((event) => ({ ...event, charId: member.id })));
  return events;
}

export function applyFeedback(world, task, rating, comment = '') {
  const minute = world.clock.minute;
  const value = clamp(Math.round(Number(rating)), 1, 5);
  const note = truncate(String(comment ?? '').trim(), 400);
  const previous = task.rating;
  task.rating = value;
  task.feedback = note;
  task.quality = round1(((task.selfQuality ?? task.quality ?? 0.6) * 0.4 + (value / 5) * 0.6) * 100) / 100;
  const result = [];
  for (const id of task.assignees) {
    const character = world.characters[id];
    if (!character) continue;
    const events = [];
    const effects = traitEffects(character);
    const bond = character.userBond;
    const stats = character.stats;
    // Re-rating the same task only updates the score, not the rewards.
    if (previous == null) {
      bond.ratings = [...bond.ratings, value].slice(-10);
      if (value >= 4) {
        stats.praise += 1;
        if (stats.criticism > 0) stats.praiseAfterCriticism += 1;
        addMoodlet(character, value === 5 ? 'loved' : 'praised', minute);
        bond.affinity = clamp(bond.affinity + (value === 5 ? 6 : 4), 0, 100);
        const bonus = Math.round((task.rewards[id]?.xp ?? 40) * 0.25);
        events.push(...addCharacterXp(character, bonus, { minute, rng: world.rng }));
        events.push(...addSkillXp(character, task.category, bonus, { minute }));
        task.rewards[id] = { ...(task.rewards[id] ?? {}), bonus };
      } else if (value <= 2) {
        stats.criticism += 1;
        addMoodlet(character, 'criticized', minute);
        const moodlet = character.moodlets.find((item) => item.id === 'criticized');
        if (moodlet) moodlet.value = Math.round(moodlet.value * effects.criticismSting);
        bond.affinity = clamp(bond.affinity - 2, 0, 100);
        driftPersonality(character, { N: 0.5 * effects.criticismSting }, clockParts(minute).day);
      } else {
        bond.affinity = clamp(bond.affinity + 1, 0, 100);
      }
      stats.fiveStarStreak = value === 5 ? stats.fiveStarStreak + 1 : 0;
      stats.bestFiveStreak = Math.max(stats.bestFiveStreak, stats.fiveStarStreak);
      const others = Object.values(world.tasks).filter((other) => other.id !== task.id && other.category === task.category && other.rating != null && !other.assignees.includes(id));
      if (value <= 3 && others.some((other) => other.rating >= value + 1)) stats.outshined += 1;
    }
    const verdict = value >= 4 ? '좋아했다' : value <= 2 ? '아쉬워했다' : '무난하게 받아들였다';
    addMemory(character, {
      kind: 'feedback',
      text: `사용자가 "${task.title}" 결과를 ${verdict}(별 ${value}개).${note ? ` 한마디: "${note}"` : ''}`,
      importance: value <= 2 ? 9 : value === 5 ? 8 : 5,
      minute,
      meta: { taskId: task.id },
    });
    if (note && (looksLikePreference(note) || value <= 2)) {
      addMemory(character, { kind: 'preference', text: `사용자 선호(${SKILLS[task.category].name}): ${note}`, importance: 8, minute });
    }
    events.push(...followUpChecks(character, minute));
    result.push(...events.map((event) => ({ ...event, charId: id })));
  }
  return result;
}
