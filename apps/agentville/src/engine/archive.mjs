// The archive: every finished deliverable stays searchable, for the user and
// for the characters themselves (similar past work, with how the user rated
// it, becomes a reference for the next draft).
import { similarity, textFeatures, truncate } from '../util.mjs';

const featureCache = new Map();

function featuresOf(task) {
  const key = `${task.finishedAt}:${task.output.length}`;
  const cached = featureCache.get(task.id);
  if (cached?.key === key) return cached.features;
  const features = textFeatures(`${task.title} ${task.title} ${task.prompt} ${task.output.slice(0, 4000)}`);
  featureCache.set(task.id, { key, features });
  return features;
}

// Output without the simulation notice, headings markup and table pipes.
function plain(output) {
  return String(output ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('> 🧪') && !/^\|?\s*-{3}/.test(line))
    .join(' ')
    .replace(/[#>*`|_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetOf(task, query) {
  const text = plain(task.output);
  const needle = String(query ?? '').trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at === -1) return truncate(text, 160);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, at + needle.length + 100)}${at + needle.length + 100 < text.length ? '…' : ''}`;
}

const finished = (town) => Object.values(town.tasks).filter((task) => task.status === 'done' && task.output);

export function archiveEntry(task, query = '') {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    mode: task.mode,
    assignees: task.assignees,
    lead: task.lead,
    rating: task.rating,
    feedback: task.feedback,
    quality: task.quality,
    finishedAt: task.finishedAt,
    attachments: task.attachments?.length ?? 0,
    snippet: snippetOf(task, query),
  };
}

export function searchArchive(town, { q = '', category = '', charId = '', minRating = 0, limit = 40 } = {}) {
  const query = String(q ?? '').trim().slice(0, 200);
  const lower = query.toLowerCase();
  const features = query ? textFeatures(query) : null;
  const results = [];
  for (const task of finished(town)) {
    if (category && task.category !== category) continue;
    if (charId && !task.assignees.includes(charId)) continue;
    if (minRating && (task.rating ?? 0) < minRating) continue;
    let score = 0;
    if (query) {
      const exact = `${task.title}\n${task.prompt}\n${task.output}`.toLowerCase().includes(lower);
      score = similarity(features, featuresOf(task)) + (exact ? 1 : 0);
      if (score < 0.08) continue;
    }
    results.push({ task, score });
  }
  results.sort((a, b) => (query ? b.score - a.score : 0) || (b.task.finishedAt ?? 0) - (a.task.finishedAt ?? 0));
  return { total: results.length, items: results.slice(0, Math.min(100, limit)).map(({ task }) => archiveEntry(task, query)) };
}

// The character's own earlier deliverables that resemble this task and were
// good (rated 4+ or, when unrated, high quality). Bad ones are left out so a
// weak result is not copied.
export function relatedWork(town, task, character, { k = 1, threshold = 0.12 } = {}) {
  if (k <= 0) return [];
  const query = textFeatures(`${task.title} ${task.prompt}`);
  return finished(town)
    .filter((past) => past.id !== task.id && past.assignees.includes(character.id))
    .filter((past) => (past.rating != null ? past.rating >= 4 : (past.quality ?? 0) >= 0.7))
    .map((past) => ({ past, score: similarity(query, featuresOf(past)) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ past }) => ({
      id: past.id,
      title: past.title,
      rating: past.rating,
      feedback: past.feedback,
      excerpt: truncate(past.output, 1500),
    }));
}
