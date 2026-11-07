// Small shared helpers: math, ids, seeded randomness, Korean-friendly text similarity.
import { randomBytes } from 'node:crypto';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const round1 = (value) => Math.round(value * 10) / 10;

export function newId(prefix = 'id') {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

// Mulberry32: tiny deterministic PRNG so tests and replays are stable.
export function makeRng(seed = Date.now()) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.pick = (items) => items[Math.floor(next() * items.length)];
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(min + next() * (max - min + 1));
  next.chance = (p) => next() < p;
  next.weighted = (entries) => {
    const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    if (total <= 0) return entries[0]?.[0];
    let roll = next() * total;
    for (const [value, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  };
  return next;
}

export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const STOP_WORDS = new Set([
  '그리고', '그런데', '하지만', '그래서', '이것', '저것', '그것', '있는', '없는', '하는', '해줘', '해주세요',
  '좀', '더', '를', '을', '이', '가', '은', '는', '에', '의', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in',
  'for', 'is', 'are', 'please', 'with', 'on', 'it', 'this', 'that',
]);

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

// Korean is agglutinative ("리서치를", "리서치는"), so word overlap alone misses
// matches. Character bigrams inside each word recover them without embeddings.
export function textFeatures(text) {
  const words = tokenize(text);
  const features = new Set(words);
  for (const word of words) {
    if (/[\p{Script=Hangul}]/u.test(word) && word.length >= 2) {
      for (let index = 0; index < word.length - 1; index++) features.add(`#${word.slice(index, index + 2)}`);
    }
  }
  return features;
}

export function similarity(featuresA, featuresB) {
  if (!featuresA.size || !featuresB.size) return 0;
  let shared = 0;
  for (const feature of featuresA) if (featuresB.has(feature)) shared++;
  return shared / Math.sqrt(featuresA.size * featuresB.size);
}

export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export const MINUTES_PER_DAY = 1440;

export function clockParts(minute) {
  const total = Math.max(0, Math.floor(minute));
  const day = Math.floor(total / MINUTES_PER_DAY) + 1;
  const ofDay = total % MINUTES_PER_DAY;
  return { day, hour: Math.floor(ofDay / 60), minute: ofDay % 60, ofDay };
}

export function formatClock(minute) {
  const { day, hour, minute: mm } = clockParts(minute);
  return `${day}일차 ${String(hour).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function isNight(minute) {
  const { hour } = clockParts(minute);
  return hour >= 22 || hour < 7;
}

// Korean particle helpers: 은/는, 이/가, 을/를, 과/와 chosen by the final syllable.
function hasFinalConsonant(word) {
  const last = String(word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return /[bcdfgjklmnpqrstvxz]$/i.test(last);
}
export const josa = (word, withFinal, withoutFinal) =>
  `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
export const eunNeun = (word) => josa(word, '은', '는');
export const iGa = (word) => josa(word, '이', '가');
export const eulReul = (word) => josa(word, '을', '를');
export const gwaWa = (word) => josa(word, '과', '와');
