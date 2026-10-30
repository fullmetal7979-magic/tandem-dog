// `cosmos 우주`: the planet's universe in the terminal. The desktop home draws
// commits as lights on a spiral around the project; here the same facts are
// said in a few lines — how many lights (commits), the first light (the root
// commit), the nebula (uncommitted changes), the tethered lights (commits not
// pushed yet) and the named ones (tags) — under the verse of the day.
// The verses and the day's pick match apps/desktop/src/renderer/cosmos/universe-model.ts.
import { basename } from 'node:path';
import { runGit } from '../shared/git-process.mjs';
import { branchState } from './project-sync.mjs';
import { ago, josa } from './words.mjs';

export const COSMOS_VERSES = Object.freeze([
  '하나의 행성이 자신의 우주를 짓는다.',
  '가장 먼 빛이 가장 오래된 시작이다.',
  '커밋 하나가 빛 하나. 빛이 모여 길이 된다.',
  '아직 이름 없는 빛도 이미 이 우주의 일부다.',
  '지운 줄도 사라지지 않는다. 궤적으로 남을 뿐.',
  '우주는 바깥에 있지 않다. 만드는 손끝에서 시작된다.',
  '모든 빛은 한때 누군가의 첫 줄이었다.',
]);

/** FNV-1a, the same hash the home uses to seed a planet's sky. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function verseOfTheDay(seed, now = Date.now()) {
  const day = Math.floor(now / 86_400_000);
  return COSMOS_VERSES[(hashString(String(seed)) + day) % COSMOS_VERSES.length];
}

async function out(root, args) {
  const r = await runGit(root, args);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** What the universe of the repository at `root` is made of; `repository: false` outside git. */
export async function universeFacts(root) {
  const top = await out(root, ['rev-parse', '--show-toplevel']);
  if (top === null) return { repository: false, planetName: basename(root) };
  const planetName = basename(top);
  const head = await out(top, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const state = await branchState(top).catch(() => null);
  if (!head) return { repository: true, planetName, lights: 0, nebula: state?.dirty || 0 };
  const [count, roots, latest, tags, authors] = await Promise.all([
    out(top, ['rev-list', '--count', 'HEAD']),
    out(top, ['log', '--max-parents=0', '--format=%ct', 'HEAD']),
    out(top, ['log', '-1', '--format=%ct%x00%s']),
    out(top, ['tag', '--merged', 'HEAD']),
    out(top, ['shortlog', '-sne', 'HEAD']),
  ]);
  const firstAt = Math.min(...(roots || '').split('\n').filter(Boolean).map((value) => Number(value) * 1000));
  const [latestAt, latestSubject] = (latest || '').split('\0');
  return {
    repository: true,
    planetName,
    branch: state?.branch || null,
    lights: Number(count) || 0,
    firstAt: Number.isFinite(firstAt) ? firstAt : null,
    latestAt: Number(latestAt) * 1000 || null,
    latestSubject: latestSubject || '',
    nebula: state?.dirty || 0,
    // Without an upstream nothing can be said about what is pushed.
    tethered: state?.upstream ? state.ahead : null,
    named: (tags || '').split('\n').filter(Boolean).length,
    hands: (authors || '').split('\n').filter(Boolean).length,
  };
}

/** The lines `cosmos 우주` prints. */
export function universeLines(facts, { now = Date.now() } = {}) {
  if (!facts.repository) return [`🪐 ${josa(facts.planetName, '은는')} 아직 git 기록이 없어요.`, '   git을 시작하면 첫 커밋이 이 우주의 첫 빛이 돼요.'];
  const verse = verseOfTheDay(facts.planetName, now);
  if (!facts.lights) {
    return [`🪐 ${facts.planetName}`, '   아직 아무 빛도 태어나지 않았어요. 첫 커밋이 이 우주의 첫 빛이 돼요.', ...(facts.nebula ? [`   🌫️ 성운 ${facts.nebula}개 (커밋 전 변경)가 기다리고 있어요.`] : []), '', `   “${verse}”`];
  }
  const lines = [`🪐 ${facts.planetName}${facts.branch ? ` · ${facts.branch}` : ''}`, ''];
  lines.push(`   ✦ 빛 ${facts.lights}개 (커밋)${facts.hands > 1 ? ` · ${facts.hands}명의 손길` : ''}`);
  if (facts.firstAt) lines.push(`   ✧ 첫 빛 ${ago(facts.firstAt, now)} (첫 커밋)`);
  if (facts.latestAt) lines.push(`   ☄️ 가장 새 빛 ${ago(facts.latestAt, now)}${facts.latestSubject ? ` — ${facts.latestSubject}` : ''}`);
  if (facts.named) lines.push(`   ✶ 이름 붙은 빛 ${facts.named}개 (태그)`);
  if (facts.nebula) lines.push(`   🌫️ 성운 ${facts.nebula}개 (커밋 전 변경)`);
  if (facts.tethered) lines.push(`   🔗 매인 빛 ${facts.tethered}개 (푸시 전 커밋)`);
  if (facts.tethered === 0 && !facts.nebula) lines.push('   모든 빛이 제자리에 있어요.');
  lines.push('', `   “${verse}”`);
  return lines;
}
