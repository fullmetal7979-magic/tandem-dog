// Growth reports. The town keeps one compact snapshot of every character at
// the start of each game day (plus one when a character arrives), so any
// period can be compared against where everyone started.
import { SKILLS } from '../catalog/skills.mjs';
import { TRAITS } from '../catalog/traits.mjs';
import { BIG_FIVE } from './personality.mjs';

export const HISTORY_LIMIT = 120;
const DAY = 1440;
const HIGHLIGHT_EMOJI = new Set(['🎉', '✨', '🏅', '🌠', '💖', '😊', '🌐', '🧪', '🪞', '🏡']);

export function snapshotOf(character, minute) {
  return {
    minute,
    level: character.level,
    totalXp: character.totalXp,
    skills: Object.fromEntries(Object.entries(character.skills).map(([id, skill]) => [id, skill.level])),
    bigFive: Object.fromEntries(Object.entries(character.bigFive).map(([id, value]) => [id, Math.round(value * 10) / 10])),
    traits: character.traits.map((trait) => trait.id),
    toolUses: character.stats.toolUses ?? 0,
    affinity: Math.round(character.userBond.affinity * 10) / 10,
    friends: Object.fromEntries(Object.entries(character.relationships).map(([id, rel]) => [id, Math.round(rel.friendship)])),
  };
}

// Called when the clock crosses into a new day.
export function recordDay(state, minute) {
  const day = Math.floor(minute / DAY);
  state.history ??= [];
  if (state.history.at(-1)?.day === day) return false;
  state.history.push({ day, minute, chars: Object.fromEntries(Object.values(state.characters).map((c) => [c.id, snapshotOf(c, minute)])) });
  if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
  return true;
}

// Where the character stood when the period began: the last day snapshot at
// or before it, else their arrival snapshot (they joined during the period).
function baselineFor(state, character, fromDay) {
  if (Number.isFinite(fromDay)) {
    const entry = (state.history ?? []).filter((item) => item.day <= fromDay && item.chars[character.id]).at(-1);
    if (entry) return entry.chars[character.id];
  }
  return character.origin ?? snapshotOf(character, character.createdAt ?? 0);
}

const average = (values) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);

function headline(entry) {
  if (entry.traits.length) return `새 특성 ${entry.traits.map((id) => TRAITS[id]?.name ?? id).join(', ')}을(를) 얻은 성장의 시간`;
  if (entry.level.to > entry.level.from) return `레벨 ${entry.level.from} → ${entry.level.to}, 눈에 띄게 자랐다`;
  if (entry.skills.length) return `${entry.skills.map((s) => `${SKILLS[s.id].name} Lv${s.to}`).join(', ')} 달성`;
  if (entry.tasks) return `업무 ${entry.tasks}건을 차곡차곡 해냈다`;
  if (entry.friends.length) return '동료들과 가까워진 시간';
  return '조용히 쉬며 재충전한 시간';
}

export function buildReport(town, { days = 7, fromDay: givenFrom } = {}) {
  const now = town.clock.minute;
  const today = Math.floor(now / DAY);
  const span = days === 'all' ? Infinity : Math.max(1, Math.min(365, Math.round(Number(days) || 7)));
  const fromDay = givenFrom ?? (span === Infinity ? -Infinity : today - (span - 1));
  const fromMinute = Number.isFinite(fromDay) ? fromDay * DAY : -Infinity;
  const tasks = Object.values(town.tasks).filter((task) => task.status === 'done' && (task.finishedAt ?? -1) >= fromMinute);

  const characters = Object.values(town.characters).map((c) => {
    const base = baselineFor(town.state, c, fromDay);
    const mine = tasks.filter((task) => task.assignees.includes(c.id));
    const ratings = mine.map((task) => task.rating).filter((value) => value != null);
    const drift = Object.keys(BIG_FIVE)
      .map((id) => ({ id, delta: Math.round(((c.bigFive[id] ?? 0) - (base.bigFive?.[id] ?? c.bigFive[id])) * 10) / 10 }))
      .filter(({ delta }) => Math.abs(delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const friends = Object.entries(c.relationships)
      .map(([id, rel]) => ({ id, from: base.friends?.[id] ?? 0, to: Math.round(rel.friendship) }))
      .filter(({ id, from, to }) => town.characters[id] && ((from < 40 && to >= 40) || (from < 75 && to >= 75)));
    const entry = {
      id: c.id,
      name: c.name,
      xp: Math.max(0, c.totalXp - (base.totalXp ?? 0)),
      level: { from: base.level ?? c.level, to: c.level },
      skills: Object.entries(c.skills)
        .map(([id, skill]) => ({ id, from: base.skills?.[id] ?? skill.level, to: skill.level }))
        .filter(({ from, to }) => to > from)
        .sort((a, b) => b.to - b.from - (a.to - a.from)),
      traits: c.traits.map((trait) => trait.id).filter((id) => !(base.traits ?? []).includes(id)),
      tasks: mine.length,
      teamTasks: mine.filter((task) => task.mode === 'team').length,
      rating: average(ratings),
      ratings: ratings.length,
      toolUses: Math.max(0, (c.stats.toolUses ?? 0) - (base.toolUses ?? 0)),
      affinity: Math.round((c.userBond.affinity - (base.affinity ?? c.userBond.affinity)) * 10) / 10,
      bigFive: drift.slice(0, 2),
      friends,
      since: base.minute,
      partial: Boolean(base.migrated),
    };
    entry.headline = headline(entry);
    return entry;
  }).sort((a, b) => b.xp - a.xp);

  const allRatings = tasks.map((task) => task.rating).filter((value) => value != null);
  const highlights = town.state.chronicle
    .filter((item) => item.minute >= fromMinute && HIGHLIGHT_EMOJI.has(item.emoji))
    .slice(-15)
    .reverse();
  return {
    days: span === Infinity ? 'all' : span,
    from: Number.isFinite(fromMinute) ? fromMinute : null,
    to: now,
    town: {
      tasks: tasks.length,
      teamTasks: tasks.filter((task) => task.mode === 'team').length,
      rating: average(allRatings),
      ratings: allRatings.length,
      xp: characters.reduce((sum, c) => sum + c.xp, 0),
      levelUps: characters.reduce((sum, c) => sum + (c.level.to - c.level.from), 0),
      newTraits: characters.reduce((sum, c) => sum + c.traits.length, 0),
      toolUses: characters.reduce((sum, c) => sum + c.toolUses, 0),
      star: characters.find((c) => c.xp > 0)?.id ?? null,
    },
    characters,
    highlights,
  };
}
