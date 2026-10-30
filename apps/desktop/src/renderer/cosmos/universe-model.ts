// 행성의 우주 (the planet's universe): one project is one planet, and every
// light in its sky was born on it. A commit is a light released into the
// galaxy; the newest sit close to the planet and the oldest drift out to the
// horizon along the spiral arms. Changes not yet committed are 성운 (nebula):
// matter still circling the planet, not yet a light. Commits not yet pushed
// stay tethered to the planet by a thin thread.
//
// Everything here is pure and seeded by names and hashes, so the same planet
// always draws the same sky on every device.
import { ago, josa } from './cosmos-format';

/** The slice of a git log entry the universe needs. */
export interface UniverseCommit {
  hash: string;
  shortHash?: string;
  subject: string;
  author: string;
  authoredAt: string;
  pushed: boolean;
  parents: string[];
  tags?: string[];
}

export type LightKind = 'commit' | 'merge' | 'tag' | 'origin';

export interface UniverseLight {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  at: number;
  kind: LightKind;
  pushed: boolean;
  tag: string;
  arm: number;
  /** 0 at the planet, 1 at the horizon. */
  r: number;
  theta: number;
  /** 0 newest … 1 oldest. */
  age: number;
  size: number;
  hue: number;
  twinkle: number;
}

export interface PlanetPalette {
  hue: number;
  light: string;
  mid: string;
  deep: string;
  ring: string;
  ringShade: string;
  atmosphere: string;
  nebula: [string, string];
}

export interface UniverseFacts {
  planetName: string;
  hasProject: boolean;
  repository: boolean;
  lights: number;
  /** More history exists beyond the horizon than was loaded. */
  beyond: boolean;
  /** Changed files not yet committed. */
  nebula: number;
  /** Commits not yet pushed; null when the branch has no upstream to push to. */
  tethered: number | null;
}

export const UNIVERSE_LIMIT = 240;
export const UNIVERSE_ARMS = 2;
/** Normalised radius where the newest light sits — just outside the planet. */
const INNER = 0.2;
const TWIST = 2.5;

/** FNV-1a: a stable 32-bit hash for seeding colours and positions. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny deterministic random source. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (hue: number, saturation: number, lightness: number, alpha = 1) =>
  alpha >= 1
    ? `hsl(${Math.round(hue) % 360} ${saturation}% ${lightness}%)`
    : `hsl(${Math.round(hue) % 360} ${saturation}% ${lightness}% / ${alpha})`;

/** The violet of the COSMOS mark, for the sky before any planet is chosen. */
export const GENESIS_HUE = 248;

/** Every planet has its own colours, taken from its name. */
export function planetPalette(seed: string, hue = hashString(seed || 'cosmos') % 360): PlanetPalette {
  return {
    hue,
    light: hsl(hue, 78, 80),
    mid: hsl(hue + 12, 52, 52),
    deep: hsl(hue + 28, 58, 16),
    ring: hsl(hue + 48, 88, 74),
    ringShade: hsl(hue + 36, 60, 46),
    atmosphere: hsl(hue, 92, 72),
    nebula: [hsl(hue + 200, 70, 58), hsl(hue + 268, 64, 56)],
  };
}

function lightKind(commit: UniverseCommit): LightKind {
  if (commit.tags?.length) return 'tag';
  if (commit.parents.length === 0) return 'origin';
  if (commit.parents.length > 1) return 'merge';
  return 'commit';
}

const KIND_SIZE: Record<LightKind, number> = { commit: 1, merge: 1.45, tag: 2.1, origin: 1.9 };

/**
 * Lay the commits (newest first, as git log gives them) on the spiral arms.
 * Positions are polar and normalised; the canvas scales and tilts them. A
 * light's arm and scatter come from its own hash, so a new commit never
 * reshuffles the sky: the older lights only drift a little further out.
 */
export function layoutUniverse(commits: readonly UniverseCommit[]): UniverseLight[] {
  const count = commits.length;
  return commits.map((commit, index) => {
    const seed = hashString(commit.hash);
    const random = seededRandom(seed);
    const age = count > 1 ? index / (count - 1) : 0;
    const arm = seed % UNIVERSE_ARMS;
    const base = INNER + (1 - INNER) * age;
    const r = Math.min(1, Math.max(INNER * 0.9, base + (random() - 0.5) * 0.09 * (0.5 + age)));
    const theta = (arm * 2 * Math.PI) / UNIVERSE_ARMS + TWIST * Math.log(r / INNER) + (random() - 0.5) * 0.5;
    const kind = lightKind(commit);
    const at = Date.parse(commit.authoredAt);
    return {
      hash: commit.hash,
      shortHash: commit.shortHash || commit.hash.slice(0, 7),
      subject: commit.subject,
      author: commit.author,
      at: Number.isFinite(at) ? at : 0,
      kind,
      pushed: commit.pushed,
      tag: commit.tags?.[0] ?? '',
      arm,
      r,
      theta,
      age,
      size: KIND_SIZE[kind] * (1.08 - age * 0.28),
      hue: hashString(commit.author || 'unknown') % 360,
      twinkle: random() * Math.PI * 2,
    };
  });
}

/** Where a light sits on the arm at a given normalised radius (for drawing the arms). */
export function armAngle(arm: number, r: number): number {
  return (arm * 2 * Math.PI) / UNIVERSE_ARMS + TWIST * Math.log(Math.max(r, INNER * 0.5) / INNER);
}

/**
 * The galaxy turns slowly and, like a real one, its inner lights turn faster
 * than the ones at the horizon. Radians per second at normalised radius r.
 */
export function orbitSpeed(r: number): number {
  return 0.01 + 0.024 * (INNER / Math.max(r, INNER));
}

/** How many unpushed commits to thread back to the planet. */
export function tetheredCount(lights: readonly Pick<UniverseLight, 'pushed'>[], upstream: boolean): number | null {
  if (!upstream) return null;
  return lights.filter((light) => !light.pushed).length;
}

/** The one sentence under the sky, then the plain facts behind it. */
export function universeVerse(facts: UniverseFacts): { line: string; detail: string } {
  if (!facts.hasProject) {
    return { line: '행성을 고르면, 그 행성이 지은 우주가 펼쳐져요.', detail: '모든 빛은 하나의 행성에서 시작돼요.' };
  }
  if (!facts.repository) {
    return { line: '아직 기억이 없는 행성이에요.', detail: 'git을 시작하면 첫 커밋이 이 우주의 첫 빛이 돼요.' };
  }
  if (facts.lights === 0) {
    return { line: '아직 아무 빛도 태어나지 않았어요.', detail: '첫 커밋이 이 우주의 첫 빛이 돼요.' };
  }
  const count = `${facts.lights}${facts.beyond ? '+' : ''}`;
  const parts: string[] = [];
  if (facts.nebula > 0) parts.push(`성운 ${facts.nebula}개가 빛이 되기를 기다려요`);
  if (facts.tethered) parts.push(`빛 ${facts.tethered}개가 아직 행성에 매여 있어요`);
  return {
    line: `이 우주의 빛 ${count}개는 모두 ${facts.planetName}에서 태어났어요.`,
    detail: parts.length ? `${parts.join(' · ')}.` : '모든 빛이 제자리에 있어요.',
  };
}

/** Plain-language chips: the poetic name first, then what it really is. */
export function universeChips(facts: UniverseFacts): { name: string; value: string; plain: string }[] {
  if (!facts.hasProject || !facts.repository) return [];
  const chips = [{ name: '빛', value: `${facts.lights}${facts.beyond ? '+' : ''}`, plain: '커밋' }];
  if (facts.nebula > 0) chips.push({ name: '성운', value: String(facts.nebula), plain: '커밋 전 변경' });
  if (facts.tethered) chips.push({ name: '매인 빛', value: String(facts.tethered), plain: '푸시 전' });
  return chips;
}

/** Screen-reader sentence for the whole picture. */
export function universeSummary(facts: UniverseFacts): string {
  if (!facts.hasProject) return '아직 고른 행성이 없어요.';
  if (!facts.repository) return `${josa(facts.planetName, '은는')} 아직 git 기록이 없어요.`;
  const parts = [`커밋 ${facts.lights}${facts.beyond ? '개 이상' : '개'}가 빛으로 그려져 있어요`];
  if (facts.nebula > 0) parts.push(`커밋 전 변경 ${facts.nebula}개가 행성 곁을 돌아요`);
  if (facts.tethered) parts.push(`푸시 전 커밋 ${facts.tethered}개가 행성에 이어져 있어요`);
  return `${facts.planetName}의 우주: ${parts.join(', ')}.`;
}

/** What a light says when you point at it. */
export function lightCaption(light: UniverseLight, now = Date.now()): { title: string; meta: string; note: string } {
  const notes: string[] = [];
  if (light.kind === 'origin') notes.push('이 우주의 첫 빛');
  if (light.kind === 'merge') notes.push('두 길이 만난 빛 · 병합');
  if (light.tag) notes.push(`이름 붙은 빛 · ${light.tag}`);
  if (!light.pushed) notes.push('아직 행성에 매여 있어요 · 푸시 전');
  return {
    title: light.subject || '(제목 없는 커밋)',
    meta: [light.shortHash, light.author, light.at ? ago(light.at, now) : ''].filter(Boolean).join(' · '),
    note: notes.join(' · '),
  };
}

/**
 * Sentences for the sky. One is chosen per planet per day, so the home does
 * not flicker between them but the words still change with the days.
 */
export const COSMOS_VERSES = [
  '하나의 행성이 자신의 우주를 짓는다.',
  '가장 먼 빛이 가장 오래된 시작이다.',
  '커밋 하나가 빛 하나. 빛이 모여 길이 된다.',
  '아직 이름 없는 빛도 이미 이 우주의 일부다.',
  '지운 줄도 사라지지 않는다. 궤적으로 남을 뿐.',
  '우주는 바깥에 있지 않다. 만드는 손끝에서 시작된다.',
  '모든 빛은 한때 누군가의 첫 줄이었다.',
] as const;

export function verseOfTheDay(seed: string, now = Date.now()): string {
  const day = Math.floor(now / 86_400_000);
  return COSMOS_VERSES[(hashString(seed) + day) % COSMOS_VERSES.length];
}
