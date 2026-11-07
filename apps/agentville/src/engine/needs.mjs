// Needs decay, activity gains, moodlets and the resulting mood.
import { NEEDS, NEED_IDS } from '../catalog/world.mjs';
import { clamp } from '../util.mjs';
import { traitEffects } from './personality.mjs';

export const MOODLETS = {
  praised: { label: '칭찬받음', emoji: '🥰', value: 15, hours: 8 },
  loved: { label: '최고의 평가', emoji: '🤩', value: 22, hours: 12 },
  criticized: { label: '아쉬운 피드백', emoji: '😣', value: -12, hours: 6 },
  levelUp: { label: '레벨 업!', emoji: '🎉', value: 25, hours: 12 },
  skillUp: { label: '실력이 늘었다', emoji: '💪', value: 10, hours: 6 },
  newTrait: { label: '새로운 나', emoji: '✨', value: 12, hours: 10 },
  aspiration: { label: '꿈에 한 걸음', emoji: '🌠', value: 18, hours: 16 },
  overworked: { label: '과로', emoji: '🥵', value: -15, hours: 6 },
  nightShift: { label: '야근', emoji: '🌃', value: -8, hours: 6 },
  goodChat: { label: '즐거운 수다', emoji: '😊', value: 7, hours: 4 },
  awkwardChat: { label: '어색한 대화', emoji: '😅', value: -5, hours: 3 },
  teamwork: { label: '멋진 팀워크', emoji: '🙌', value: 10, hours: 6 },
  userChat: { label: '사용자와 대화', emoji: '💌', value: 5, hours: 3 },
  insight: { label: '깨달음', emoji: '💡', value: 8, hours: 8 },
  burnout: { label: '번아웃', emoji: '🪫', value: -25, hours: 10 },
  wellRested: { label: '푹 잤다', emoji: '🌅', value: 10, hours: 6 },
};

export function addMoodlet(character, id, now) {
  const def = MOODLETS[id];
  if (!def) return;
  character.moodlets = character.moodlets.filter((moodlet) => moodlet.id !== id);
  character.moodlets.push({ id, label: def.label, emoji: def.emoji, value: def.value, until: now + def.hours * 60 });
}

export function expireMoodlets(character, now) {
  character.moodlets = character.moodlets.filter((moodlet) => moodlet.until > now);
}

// Extraverts get lonely faster; very open characters get bored faster.
function personalityDecay(character, needId) {
  const { E, O, N } = character.bigFive;
  if (needId === 'social') return 0.5 + E / 100;
  if (needId === 'fun') return 0.75 + O / 250;
  if (needId === 'energy') return 0.9 + N / 500;
  return 1;
}

export function decayNeeds(character, minutes, { working = false, night = false } = {}) {
  const effects = traitEffects(character);
  for (const id of NEED_IDS) {
    let rate = NEEDS[id].decay * personalityDecay(character, id) * (effects.needDecay[id] ?? 1);
    if (working) {
      if (id === 'energy') rate += 0.12;
      if (id === 'focus') rate += 0.2;
      if (id === 'fun') rate += 0.03;
      if (night && !effects.nightWorker && id === 'energy') rate += 0.08;
    }
    character.needs[id] = clamp(character.needs[id] - rate * minutes, 0, 100);
  }
  if (character.needs.energy <= 0 && !character.flags.burnedOut) {
    character.flags.burnedOut = true;
    character.stats.burnouts += 1;
    return 'burnout';
  }
  if (character.needs.energy > 40) character.flags.burnedOut = false;
  return null;
}

export function applyGains(character, gains, minutes, multiplier = 1) {
  for (const [id, perMinute] of Object.entries(gains)) {
    if (id in character.needs) character.needs[id] = clamp(character.needs[id] + perMinute * minutes * multiplier, 0, 100);
  }
}

export function spendNeeds(character, costs) {
  for (const [id, amount] of Object.entries(costs)) {
    if (id in character.needs) character.needs[id] = clamp(character.needs[id] - amount, 0, 100);
  }
}

const NEED_MOOD_WEIGHTS = { energy: 0.28, hunger: 0.18, social: 0.16, fun: 0.18, focus: 0.2 };

export function computeMood(character) {
  const effects = traitEffects(character);
  const base = NEED_IDS.reduce((sum, id) => sum + character.needs[id] * NEED_MOOD_WEIGHTS[id], 0);
  const moodlets = character.moodlets.reduce((sum, moodlet) => sum + moodlet.value, 0);
  const value = clamp(Math.round(base * 0.85 + 10 + moodlets + effects.moodBase), 0, 100);
  return { value, ...moodLabel(value) };
}

export function moodLabel(value) {
  if (value >= 80) return { label: '신남', emoji: '😄' };
  if (value >= 60) return { label: '좋음', emoji: '🙂' };
  if (value >= 40) return { label: '보통', emoji: '😐' };
  if (value >= 20) return { label: '지침', emoji: '😟' };
  return { label: '한계', emoji: '😫' };
}

// Mood nudges work quality between 0.85x and 1.1x and XP between 0.8x and 1.2x.
export const moodQuality = (mood) => 0.85 + (mood / 100) * 0.25;
export const moodXp = (mood) => 0.8 + (mood / 100) * 0.4;

// Urgency rises sharply as a need empties (squared curve, as in life sims).
export function urgency(character, needId) {
  const level = character.needs[needId] ?? 100;
  return ((100 - level) / 100) ** 2 * (NEEDS[needId]?.weight ?? 1);
}
