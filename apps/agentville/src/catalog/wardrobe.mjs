// The wardrobe (옷장): appearance items. Basics are free; the rest unlock as a
// character grows, so dressing someone up is also a record of what they did.
// Items are drawn by public/avatar.js from these ids.

import { ROLES } from './roles.mjs';

const free = null;

// Every role's colour is a free shirt colour, since new characters start in it.
const roleShirts = [...new Set(Object.values(ROLES).map((role) => role.color))].map((id) => ({ id, req: free }));

export const SLOTS = {
  skin: { name: '피부', kind: 'color' },
  hair: { name: '머리색', kind: 'color' },
  hairStyle: { name: '머리 모양', kind: 'item' },
  eyes: { name: '눈', kind: 'item' },
  outfit: { name: '옷', kind: 'item' },
  shirt: { name: '옷 색', kind: 'color' },
  accessory: { name: '소품', kind: 'item' },
  pet: { name: '반려동물', kind: 'item' },
};

export const WARDROBE = {
  skin: [
    { id: '#f6d7c3', req: free }, { id: '#eec4a4', req: free }, { id: '#d9a77f', req: free }, { id: '#b98058', req: free },
    { id: '#8d5a3b', req: free }, { id: '#6b4330', req: free }, { id: '#ffe3d6', req: free },
  ],
  hair: [
    { id: '#2b2118', req: free }, { id: '#4a3123', req: free }, { id: '#7a4b2a', req: free }, { id: '#c99a5b', req: free }, { id: '#e0c48a', req: free },
    { id: '#9a9aa5', req: free }, { id: '#6b3fa0', req: free }, { id: '#d0567a', req: free }, { id: '#2f6fd6', req: free },
    { id: '#3ec9a7', name: '민트', req: { level: 3 } }, { id: '#e8e9f0', name: '은발', req: { level: 6 } }, { id: '#ff8a3d', name: '노을빛', req: { praise: 5 } },
  ],
  hairStyle: [
    { id: 0, name: '짧은 머리', req: free }, { id: 1, name: '긴 머리', req: free }, { id: 2, name: '똥머리', req: free }, { id: 3, name: '삐죽 머리', req: free },
    { id: 6, name: '포니테일', req: free }, { id: 4, name: '양갈래', req: { level: 2 } }, { id: 5, name: '곱슬머리', req: { level: 4 } },
  ],
  eyes: [
    { id: 'dot', name: '동글', req: free }, { id: 'smile', name: '웃는 눈', req: free }, { id: 'sleepy', name: '졸린 눈', req: free },
    { id: 'sparkle', name: '반짝 눈', req: { level: 3 } }, { id: 'wink', name: '윙크', req: { trust: 50 } },
  ],
  outfit: [
    { id: 'tee', name: '티셔츠', req: free }, { id: 'hoodie', name: '후드티', req: free }, { id: 'shirt', name: '셔츠', req: free },
    { id: 'suit', name: '정장', req: { level: 4 } }, { id: 'labcoat', name: '연구복', req: { skill: ['research', 5], or: { skill: ['analysis', 5] } } },
    { id: 'apron', name: '앞치마', req: { tasks: 15 } }, { id: 'cape', name: '망토', req: { level: 8 } },
  ],
  shirt: [
    ...roleShirts,
    ...['#e0565b', '#14b8a6', '#475569', '#0ea5e9', '#f2b631'].filter((id) => !roleShirts.some((item) => item.id === id)).map((id) => ({ id, req: free })),
    { id: '#111827', name: '칠흑', req: { level: 5 } }, { id: '#fde68a', name: '금빛', req: { aspiration: 2 } },
  ],
  accessory: [
    { id: 'none', name: '없음', req: free }, { id: 'glasses', name: '안경', req: free }, { id: 'headphones', name: '헤드폰', req: free },
    { id: 'hat', name: '중절모', req: free }, { id: 'bow', name: '리본', req: free },
    { id: 'party', name: '고깔모자', req: { level: 2 } }, { id: 'catears', name: '고양이 귀', req: { level: 3 } },
    { id: 'beret', name: '베레모', req: { skill: ['design', 3], or: { skill: ['writing', 4] } } }, { id: 'flower', name: '꽃핀', req: { friend: 1 } },
    { id: 'sunglasses', name: '선글라스', req: { level: 5 } }, { id: 'halo', name: '천사 고리', req: { fiveStreak: 3 } }, { id: 'crown', name: '왕관', req: { level: 10 } },
  ],
  pet: [
    { id: 'none', name: '없음', req: free }, { id: 'chick', name: '병아리', req: { praise: 1 } }, { id: 'cat', name: '고양이', req: { level: 5 } },
    { id: 'dog', name: '강아지', req: { tasks: 10 } }, { id: 'owl', name: '부엉이', req: { reflections: 3 } }, { id: 'robot', name: '꼬마 로봇', req: { toolUses: 40 } },
    { id: 'slime', name: '슬라임', req: { level: 8 } },
  ],
};

export function meets(character, req) {
  if (!req) return true;
  const checks = [];
  if (req.level) checks.push(character.level >= req.level);
  if (req.tasks) checks.push((character.stats?.tasksDone ?? 0) >= req.tasks);
  if (req.praise) checks.push((character.stats?.praise ?? 0) >= req.praise);
  if (req.fiveStreak) checks.push((character.stats?.bestFiveStreak ?? 0) >= req.fiveStreak);
  if (req.reflections) checks.push((character.stats?.reflections ?? 0) >= req.reflections);
  if (req.toolUses) checks.push((character.stats?.toolUses ?? 0) >= req.toolUses);
  if (req.trust) checks.push((character.userBond?.trust ?? 0) >= req.trust);
  if (req.aspiration) checks.push((character.aspiration?.stage ?? 0) >= req.aspiration || character.aspiration?.done === true);
  if (req.friend) checks.push(Object.values(character.relationships ?? {}).filter((rel) => rel.friendship >= 40).length >= req.friend);
  if (req.skill) checks.push((character.skills?.[req.skill[0]]?.level ?? 0) >= req.skill[1]);
  const ok = checks.every(Boolean);
  return ok || (req.or ? meets(character, req.or) : false);
}

export function reqText(req, skills = {}) {
  if (!req) return '';
  const parts = [];
  if (req.level) parts.push(`Lv${req.level}`);
  if (req.tasks) parts.push(`업무 ${req.tasks}건`);
  if (req.praise) parts.push(req.praise === 1 ? '첫 칭찬(별 4개 이상)' : `칭찬 ${req.praise}번`);
  if (req.fiveStreak) parts.push(`별 5개 ${req.fiveStreak}연속`);
  if (req.reflections) parts.push(`성찰 ${req.reflections}번`);
  if (req.toolUses) parts.push(`도구 ${req.toolUses}번 사용`);
  if (req.trust) parts.push(`신뢰도 ${req.trust}`);
  if (req.aspiration) parts.push(`꿈 ${req.aspiration}단계`);
  if (req.friend) parts.push('친구 사귀기');
  if (req.skill) parts.push(`${skills[req.skill[0]]?.name ?? req.skill[0]} Lv${req.skill[1]}`);
  const text = parts.join(' · ');
  return req.or ? `${text} 또는 ${reqText(req.or, skills)}` : text;
}

const itemOf = (slot, value) => WARDROBE[slot]?.find((item) => item.id === value) ?? null;

// Keeps only items the character may wear; anything else stays as it was.
export function sanitizeAppearance(character, patch = {}, current = character.appearance ?? {}) {
  const next = { ...current };
  const rejected = [];
  for (const slot of Object.keys(SLOTS)) {
    if (patch[slot] === undefined) continue;
    const value = slot === 'hairStyle' ? Number(patch[slot]) : patch[slot];
    const item = itemOf(slot, value);
    if (!item) {
      rejected.push(slot);
      continue;
    }
    if (!meets(character, item.req)) {
      rejected.push(slot);
      continue;
    }
    next[slot] = value;
  }
  return { appearance: next, rejected };
}

// Items unlocked (beyond the free ones) for this character right now.
export function unlockedItems(character) {
  const out = [];
  for (const [slot, items] of Object.entries(WARDROBE)) {
    for (const item of items) if (item.req && meets(character, item.req)) out.push(`${slot}:${item.id}`);
  }
  return out;
}

export function itemName(key) {
  const [slot, raw] = key.split(':');
  const value = slot === 'hairStyle' ? Number(raw) : raw;
  const item = itemOf(slot, value);
  return item ? `${SLOTS[slot].name} ${item.name ?? ''}`.trim() : key;
}

export function wardrobePublic(skills) {
  return {
    slots: SLOTS,
    items: Object.fromEntries(Object.entries(WARDROBE).map(([slot, items]) => [slot, items.map((item) => ({ id: item.id, name: item.name ?? null, req: item.req, reqText: reqText(item.req, skills) }))])),
  };
}
