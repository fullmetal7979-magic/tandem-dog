// Town map, zones, needs and activities. The map is authored as ASCII so it is
// easy to edit: '#' wall, uppercase = furniture (blocked), lowercase = a spot
// where an activity happens (walkable), '.' and ',' floor/grass, '~' water.

const COLS = 40;
const cafe = ['CCCCCCCC....', 'cccccccc....', '............', '.c.c..c.c...', '.K.K..K.K...', '.c.c..c.c...', '............', '.c.c..c.c...', '.K.K..K.K...', '.c.c..c.c...', '............', 'P..........P'];
const lounge = ['GGG...GGG...', 'ggg...ggg...', '............', 'SSSS....SSSS', 'ssss....ssss', '............', '............', '............', '............', '............', 'zzzzzzzzzzzz', 'ZZZZZZZZZZZZ'];
const right = ['BBBB....BBBB', 'bbbb....bbbb', '............', '..BBBB..BBBB', '..bbbb..bbbb', '#####.######', ',,T,,,,,T,,,', ',,,,~~~~,,,,', ',p,,~~~~,,p,', ',,,,,,,,,,,,', 'T,,p,,,,p,,T', ',,,,,,,,,,,,'];

function row(left, gate, middle, gate2 = null, rest = null) {
  return gate2 === null ? `#${left}${gate}${middle}#` : `#${left}${gate}${middle}${gate2}${rest}#`;
}

const top = [
  ['..................', '#', '.......WWWWW.......'],
  ['.DD..DD..DD..DD...', '#', '...................'],
  ['.dd..dd..dd..dd...', '#', '....mmmmmmmmmm.....'],
  ['..................', '#', '....MMMMMMMMMM.....'],
  ['.DD..DD..DD..DD...', '#', '....mmmmmmmmmm.....'],
  ['.dd..dd..dd..dd...', '#', '...................'],
  ['..................', '.', '...................'],
  ['P................P', '#', '...................'],
  ['..................', '#', 'P.................P'],
].map(([office, gate, meeting]) => row(office, gate, meeting));

const doors = new Set([10, 18, 24, 32]);
const divider = Array.from({ length: COLS }, (_, x) => (doors.has(x) ? '.' : '#')).join('');

const bottom = cafe.map((cafeRow, index) => {
  const y = 11 + index;
  const gateA = y === 17 ? '.' : '#';
  const gateB = y === 13 || y === 20 ? '.' : '#';
  return row(cafeRow, gateA, lounge[index], gateB, right[index]);
});

export const MAP_ROWS = ['#'.repeat(COLS), ...top, divider, ...bottom, '#'.repeat(COLS)];
export const MAP_WIDTH = COLS;
export const MAP_HEIGHT = MAP_ROWS.length;

export const ZONES = [
  { id: 'office', name: '사무실', rect: [1, 1, 18, 9], floor: '#e9e4d8' },
  { id: 'meeting', name: '회의실', rect: [20, 1, 38, 9], floor: '#dfe6ee' },
  { id: 'cafe', name: '카페', rect: [1, 11, 12, 22], floor: '#f1dfc6' },
  { id: 'lounge', name: '라운지', rect: [14, 11, 25, 22], floor: '#e6dcef' },
  { id: 'library', name: '도서관', rect: [27, 11, 38, 15], floor: '#e7dccb' },
  { id: 'garden', name: '정원', rect: [27, 17, 38, 22], floor: '#cfe6c0' },
];

export const TILE_ART = {
  D: '🖥️', W: '📋', M: '🟫', C: '☕', K: '🪑', G: '🕹️', S: '🛋️', Z: '🛏️', B: '📚', P: '🪴', T: '🌳', '~': '💧',
};

export const NEEDS = {
  energy: { name: '에너지', emoji: '⚡', decay: 0.09, weight: 1.3 },
  hunger: { name: '포만감', emoji: '🍙', decay: 0.14, weight: 1.1 },
  social: { name: '사교', emoji: '💬', decay: 0.1, weight: 0.9 },
  fun: { name: '재미', emoji: '🎈', decay: 0.1, weight: 0.9 },
  focus: { name: '집중', emoji: '🎯', decay: 0.07, weight: 1.0 },
};
export const NEED_IDS = Object.keys(NEEDS);

// gains: need points restored per game minute while doing the activity.
export const ACTIVITIES = {
  coffee: { name: '커피 타임', emoji: '☕', spot: 'c', minutes: [15, 25], cooldown: 120, gains: { energy: 0.5, hunger: 0.2, social: 0.2, fun: 0.15 } },
  lunch: { name: '식사', emoji: '🍱', spot: 'c', minutes: [30, 45], cooldown: 300, gains: { hunger: 1.6, energy: 0.15, social: 0.25, fun: 0.1 }, peak: [11, 14] },
  nap: { name: '소파에서 휴식', emoji: '💤', spot: 's', minutes: [30, 50], cooldown: 180, gains: { energy: 0.9, focus: 0.35 } },
  game: { name: '게임', emoji: '🎮', spot: 'g', minutes: [20, 35], cooldown: 90, gains: { fun: 1.0, social: 0.2, energy: -0.08 } },
  read: { name: '독서·자기계발', emoji: '📖', spot: 'b', minutes: [30, 50], cooldown: 90, gains: { focus: 0.6, fun: 0.3, energy: -0.04 }, xpPerMinute: 0.15 },
  walk: { name: '산책', emoji: '🌿', spot: 'p', minutes: [20, 35], cooldown: 90, gains: { fun: 0.5, focus: 0.4, energy: 0.15 } },
  daydream: { name: '멍때리기', emoji: '💭', spot: null, minutes: [10, 20], cooldown: 30, gains: { fun: 0.2, focus: 0.25 } },
  chat: { name: '수다', emoji: '💬', spot: null, minutes: [12, 20], gains: { social: 1.6, fun: 0.4, energy: -0.04 }, social: true },
  sleep: { name: '수면', emoji: '😴', spot: 'z', minutes: [60, 60], gains: { energy: 1.6, focus: 1.0, hunger: 0.05 }, night: true },
};
export const SELF_STUDY_DAILY_CAP = 30;
export const IDLE_ACTIVITY_IDS = ['coffee', 'lunch', 'nap', 'game', 'read', 'walk', 'daydream'];

export const STATE_LABELS = {
  idle: { name: '쉬는 중', emoji: '🙂' },
  walking: { name: '이동 중', emoji: '🚶' },
  working: { name: '업무 중', emoji: '💼' },
  meeting: { name: '팀 숙고 중', emoji: '🧠' },
  chatting: { name: '대화 중', emoji: '💬' },
};
