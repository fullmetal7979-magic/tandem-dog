// Big Five description, slow personality drift, trait effects and trait acquisition.
import { MAX_TRAITS, TRAITS } from '../catalog/traits.mjs';
import { clamp, round1 } from '../util.mjs';

export const BIG_FIVE = {
  O: { name: '개방성', high: '새로운 아이디어와 실험을 즐긴다', low: '검증된 방식을 선호한다' },
  C: { name: '성실성', high: '체계적이고 끝까지 책임진다', low: '즉흥적이고 유연하다' },
  E: { name: '외향성', high: '사람들과 어울릴 때 활력을 얻는다', low: '조용히 혼자 집중할 때 힘이 난다' },
  A: { name: '친화성', high: '협조적이고 상대를 배려한다', low: '비판적이고 자기 주장이 분명하다' },
  N: { name: '신경성', high: '감정 기복이 있고 걱정이 많다', low: '정서가 안정적이고 침착하다' },
};
export const BIG_FIVE_IDS = Object.keys(BIG_FIVE);

export function describeBigFive(bigFive) {
  return BIG_FIVE_IDS.map((id) => {
    const value = bigFive[id];
    if (value >= 65) return `${BIG_FIVE[id].name} 높음(${Math.round(value)}): ${BIG_FIVE[id].high}`;
    if (value <= 35) return `${BIG_FIVE[id].name} 낮음(${Math.round(value)}): ${BIG_FIVE[id].low}`;
    return null;
  }).filter(Boolean);
}

const DAILY_DRIFT_CAP = 3;

// Personality moves a little with experience, capped per game day per trait so
// one busy afternoon cannot rewrite who someone is.
export function driftPersonality(character, changes, day) {
  const ledger = character.drift?.day === day ? character.drift : { day, used: {} };
  for (const [id, delta] of Object.entries(changes)) {
    if (!delta || !(id in character.bigFive)) continue;
    const used = ledger.used[id] ?? 0;
    const room = DAILY_DRIFT_CAP - Math.abs(used);
    if (room <= 0) continue;
    const applied = clamp(delta, -room, room);
    character.bigFive[id] = round1(clamp(character.bigFive[id] + applied, 0, 100));
    ledger.used[id] = used + applied;
  }
  character.drift = ledger;
}

export function traitEffects(character) {
  const effects = {
    xp: {}, quality: {}, needDecay: {}, activity: {},
    socialDelta: 0, moodBase: 0, criticismSting: 1, teamBonus: 0, nightWorker: false,
  };
  for (const { id } of character.traits) {
    const trait = TRAITS[id];
    if (!trait) continue;
    const e = trait.effects ?? {};
    for (const [k, v] of Object.entries(e.xp ?? {})) effects.xp[k] = (effects.xp[k] ?? 1) * v;
    for (const [k, v] of Object.entries(e.quality ?? {})) effects.quality[k] = (effects.quality[k] ?? 0) + v;
    for (const [k, v] of Object.entries(e.needDecay ?? {})) effects.needDecay[k] = (effects.needDecay[k] ?? 1) * v;
    for (const [k, v] of Object.entries(e.activity ?? {})) effects.activity[k] = (effects.activity[k] ?? 1) * v;
    effects.socialDelta += e.socialDelta ?? 0;
    effects.moodBase += e.moodBase ?? 0;
    effects.criticismSting *= e.criticismSting ?? 1;
    effects.teamBonus += e.teamBonus ?? 0;
    effects.nightWorker ||= Boolean(e.nightWorker);
  }
  return effects;
}

export const xpMultiplier = (effects, skillId) => (effects.xp.all ?? 1) * (effects.xp[skillId] ?? 1);
export const qualityBonus = (effects, skillId) => (effects.quality.all ?? 0) + (effects.quality[skillId] ?? 0);

export function hasTrait(character, id) {
  return character.traits.some((trait) => trait.id === id);
}

export function grantTrait(character, id, minute, source = 'earned') {
  if (!TRAITS[id] || hasTrait(character, id) || character.traits.length >= MAX_TRAITS) return null;
  const opposite = TRAITS[id].opposite ?? [];
  if (opposite.some((other) => hasTrait(character, other))) return null;
  character.traits.push({ id, acquiredAt: minute, source });
  return TRAITS[id];
}

// Checks every earned trait's condition against the character's own record.
export function checkEarnedTraits(character, minute) {
  const gained = [];
  for (const trait of Object.values(TRAITS)) {
    if (trait.kind !== 'earned' || hasTrait(character, trait.id)) continue;
    if (trait.when?.(character)) {
      const granted = grantTrait(character, trait.id, minute);
      if (granted) gained.push(granted);
    }
  }
  return gained;
}

// Compatibility -1..1 from Big Five closeness plus agreeableness of both.
export function compatibility(a, b) {
  const gap = BIG_FIVE_IDS.reduce((sum, id) => sum + Math.abs(a.bigFive[id] - b.bigFive[id]), 0) / (BIG_FIVE_IDS.length * 100);
  const warmth = (a.bigFive.A + b.bigFive.A) / 200;
  return clamp(0.9 - gap * 1.6 + (warmth - 0.5) * 0.8, -1, 1);
}
