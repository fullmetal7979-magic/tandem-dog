// Memory stream in the style of Generative Agents: every event becomes a
// memory with an importance score; retrieval blends recency, relevance and
// importance (weights 0.5 / 3 / 2); accumulated importance triggers reflection.
import { clamp, similarity, textFeatures, truncate } from '../util.mjs';

export const MEMORY_LIMIT = 400;
export const REFLECTION_THRESHOLD = 60;
const RECENCY_DECAY_PER_HOUR = 0.995;
const WEIGHTS = { recency: 0.5, relevance: 3, importance: 2 };
const KEEP_KINDS = new Set(['reflection', 'preference', 'milestone']);

export const MEMORY_KINDS = {
  task: { name: '업무', emoji: '💼' },
  chat: { name: '대화', emoji: '💬' },
  social: { name: '수다', emoji: '☕' },
  feedback: { name: '피드백', emoji: '⭐' },
  preference: { name: '사용자 선호', emoji: '💡' },
  reflection: { name: '성찰', emoji: '🔮' },
  milestone: { name: '이정표', emoji: '🏁' },
  observation: { name: '관찰', emoji: '👀' },
};

export function addMemory(character, { kind = 'observation', text, importance = 3, minute, meta = undefined }) {
  const memory = character.memory;
  const item = {
    id: memory.nextId++,
    kind,
    text: truncate(String(text).trim(), 400),
    importance: clamp(Math.round(importance), 1, 10),
    minute,
    lastAccess: minute,
    ...(meta ? { meta } : {}),
  };
  memory.items.push(item);
  memory.sinceReflection += item.importance;
  if (memory.items.length > MEMORY_LIMIT) pruneMemories(character, minute);
  return item;
}

function recency(item, now) {
  const hours = Math.max(0, now - item.lastAccess) / 60;
  return RECENCY_DECAY_PER_HOUR ** hours;
}

function normalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((value) => (span < 1e-9 ? 0.5 : (value - min) / span));
}

// Returns the k best memories for `query`. Touching a memory refreshes its
// recency, so things a character keeps recalling stay easy to recall.
export function retrieveMemories(character, query, { k = 5, now, kinds = null, touch = true } = {}) {
  const pool = character.memory.items.filter((item) => !kinds || kinds.includes(item.kind));
  if (!pool.length) return [];
  const queryFeatures = textFeatures(query);
  const rel = normalize(pool.map((item) => similarity(queryFeatures, textFeatures(item.text))));
  const rec = normalize(pool.map((item) => recency(item, now)));
  const imp = normalize(pool.map((item) => item.importance));
  const scored = pool.map((item, index) => ({
    item,
    score: WEIGHTS.recency * rec[index] + WEIGHTS.relevance * rel[index] + WEIGHTS.importance * imp[index],
  }));
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored.slice(0, k).map(({ item }) => item);
  if (touch) for (const item of chosen) item.lastAccess = now;
  return chosen;
}

export function recentMemories(character, count = 20) {
  return character.memory.items.slice(-count);
}

export function preferenceMemories(character, count = 6) {
  return character.memory.items.filter((item) => item.kind === 'preference').slice(-count);
}

export const shouldReflect = (character) => character.memory.sinceReflection >= REFLECTION_THRESHOLD;

export function markReflected(character) {
  character.memory.sinceReflection = 0;
}

// Drops the least valuable event memories; reflections and preferences stay.
export function pruneMemories(character, now) {
  const items = character.memory.items;
  const overflow = items.length - MEMORY_LIMIT;
  if (overflow <= 0) return;
  const candidates = items
    .filter((item) => !KEEP_KINDS.has(item.kind))
    .map((item) => ({ item, value: item.importance * 2 + recency(item, now) * 4 }))
    .sort((a, b) => a.value - b.value)
    .slice(0, overflow)
    .map(({ item }) => item.id);
  const drop = new Set(candidates);
  character.memory.items = items.filter((item) => !drop.has(item.id));
}

const EMOTION_WORDS = /고마|사랑|싫|짜증|최고|감동|슬프|기뻐|힘들|중요|꼭|절대|항상|앞으로|기억해|부탁|좋아해|싫어해|thank|love|hate|important|always|never|remember/i;
const PREFERENCE_WORDS = /좋아해|싫어해|게 좋아|게 싫어|면 좋겠|선호|원해|앞으로는|다음부터|항상|절대|스타일|형식|말투|짧게|길게|표로|prefer|always|never|from now on/i;

// Cheap importance estimate for chat lines so chatting needs no extra LLM call.
export function estimateImportance(text) {
  const value = String(text ?? '');
  let score = 2 + Math.min(3, value.length / 120);
  if (EMOTION_WORDS.test(value)) score += 2;
  if (PREFERENCE_WORDS.test(value)) score += 2;
  return clamp(Math.round(score), 1, 9);
}

export const looksLikePreference = (text) => PREFERENCE_WORDS.test(String(text ?? ''));
