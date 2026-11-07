// Roles (직업 프리셋) and aspirations (열망: long-term goals with staged rewards).

export const ROLES = {
  researcher: {
    name: '연구원', emoji: '🔬', color: '#4f7cff',
    attrs: { int: 34, cre: 18, cha: 14, foc: 30, emp: 16, tec: 20 },
    skills: { research: 2, analysis: 1 },
    traits: ['curious', 'meticulous'], aspiration: 'scholar',
    bigFive: { O: 78, C: 66, E: 38, A: 56, N: 40 },
  },
  writer: {
    name: '작가', emoji: '✍️', color: '#e0679a',
    attrs: { int: 20, cre: 34, cha: 28, foc: 20, emp: 24, tec: 10 },
    skills: { writing: 2, translation: 1 },
    traits: ['witty', 'passionate'], aspiration: 'author',
    bigFive: { O: 82, C: 48, E: 55, A: 60, N: 52 },
  },
  engineer: {
    name: '개발자', emoji: '💻', color: '#2fb380',
    attrs: { int: 28, cre: 18, cha: 12, foc: 28, emp: 12, tec: 36 },
    skills: { coding: 2, analysis: 1 },
    traits: ['meticulous', 'introvert'], aspiration: 'artisan',
    bigFive: { O: 64, C: 72, E: 30, A: 50, N: 38 },
  },
  strategist: {
    name: '기획자', emoji: '🗺️', color: '#f0a020',
    attrs: { int: 28, cre: 24, cha: 26, foc: 24, emp: 22, tec: 12 },
    skills: { planning: 2, marketing: 1 },
    traits: ['optimist', 'social'], aspiration: 'leader',
    bigFive: { O: 70, C: 64, E: 68, A: 58, N: 36 },
  },
  designer: {
    name: '디자이너', emoji: '🎨', color: '#a065e8',
    attrs: { int: 18, cre: 36, cha: 20, foc: 22, emp: 26, tec: 22 },
    skills: { design: 2, marketing: 1 },
    traits: ['perfectionist', 'curious'], aspiration: 'renaissance',
    bigFive: { O: 86, C: 58, E: 46, A: 62, N: 50 },
  },
  analyst: {
    name: '분석가', emoji: '📊', color: '#18a3c4',
    attrs: { int: 36, cre: 14, cha: 16, foc: 32, emp: 14, tec: 26 },
    skills: { analysis: 2, research: 1 },
    traits: ['blunt', 'calm'], aspiration: 'scholar',
    bigFive: { O: 60, C: 76, E: 34, A: 44, N: 32 },
  },
  marketer: {
    name: '마케터', emoji: '📣', color: '#ff7a45',
    attrs: { int: 20, cre: 28, cha: 36, foc: 18, emp: 26, tec: 12 },
    skills: { marketing: 2, writing: 1 },
    traits: ['social', 'passionate'], aspiration: 'friend_of_all',
    bigFive: { O: 74, C: 52, E: 80, A: 60, N: 44 },
  },
  counselor: {
    name: '상담가', emoji: '🫶', color: '#e2557a',
    attrs: { int: 22, cre: 20, cha: 28, foc: 20, emp: 38, tec: 8 },
    skills: { counseling: 2, teaching: 1 },
    traits: ['kind', 'calm'], aspiration: 'best_assistant',
    bigFive: { O: 68, C: 60, E: 56, A: 84, N: 34 },
  },
};
export const ROLE_IDS = Object.keys(ROLES);

const friendsAtLeast = (c, value) => Object.values(c.relationships).filter((rel) => rel.friendship >= value).length;
const skillsAtLeast = (c, value) => Object.values(c.skills).filter((skill) => skill.level >= value).length;

export const ASPIRATIONS = {
  scholar: {
    name: '지식의 탐구자', emoji: '📚', desc: '리서치를 끝까지 파고든다.',
    stages: [
      { label: '리서치 Lv3', check: (c) => c.skills.research.level >= 3 },
      { label: '리서치 Lv5 + 성찰 2회', check: (c) => c.skills.research.level >= 5 && c.stats.reflections >= 2 },
      { label: '리서치 Lv8', check: (c) => c.skills.research.level >= 8 },
    ],
  },
  author: {
    name: '베스트셀러 작가', emoji: '📖', desc: '마음을 움직이는 글을 쓴다.',
    stages: [
      { label: '글쓰기 Lv3', check: (c) => c.skills.writing.level >= 3 },
      { label: '글쓰기 Lv5 + 높은 평가 3회', check: (c) => c.skills.writing.level >= 5 && c.stats.praise >= 3 },
      { label: '글쓰기 Lv8', check: (c) => c.skills.writing.level >= 8 },
    ],
  },
  artisan: {
    name: '코드 장인', emoji: '⚙️', desc: '아름답게 동작하는 코드를 만든다.',
    stages: [
      { label: '코딩 Lv3', check: (c) => c.skills.coding.level >= 3 },
      { label: '코딩 Lv5', check: (c) => c.skills.coding.level >= 5 },
      { label: '코딩 Lv8 + 업무 20회', check: (c) => c.skills.coding.level >= 8 && c.stats.tasksDone >= 20 },
    ],
  },
  leader: {
    name: '팀의 리더', emoji: '👑', desc: '팀을 이끌어 큰일을 해낸다.',
    stages: [
      { label: '팀 업무 3회', check: (c) => c.stats.teamTasks >= 3 },
      { label: '팀 리더 3회', check: (c) => c.stats.ledTeams >= 3 },
      { label: '팀 리더 10회 + 기획 Lv6', check: (c) => c.stats.ledTeams >= 10 && c.skills.planning.level >= 6 },
    ],
  },
  renaissance: {
    name: '만능 크리에이터', emoji: '🌈', desc: '모든 분야를 넘나든다.',
    stages: [
      { label: '스킬 2개 Lv4', check: (c) => skillsAtLeast(c, 4) >= 2 },
      { label: '스킬 3개 Lv4', check: (c) => skillsAtLeast(c, 4) >= 3 },
      { label: '스킬 5개 Lv4', check: (c) => skillsAtLeast(c, 4) >= 5 },
    ],
  },
  friend_of_all: {
    name: '모두의 친구', emoji: '💐', desc: '마을 모두와 친해진다.',
    stages: [
      { label: '우정 60 이상 친구 1명', check: (c) => friendsAtLeast(c, 60) >= 1 },
      { label: '우정 60 이상 친구 2명', check: (c) => friendsAtLeast(c, 60) >= 2 },
      { label: '우정 60 이상 친구 3명 + 수다 40회', check: (c) => friendsAtLeast(c, 60) >= 3 && c.stats.smallTalks >= 40 },
    ],
  },
  best_assistant: {
    name: '최고의 파트너', emoji: '🏆', desc: '사용자에게 없어서는 안 될 존재가 된다.',
    stages: [
      { label: '업무 10회 + 호감도 50', check: (c) => c.stats.tasksDone >= 10 && c.userBond.affinity >= 50 },
      { label: '업무 20회 + 호감도 70', check: (c) => c.stats.tasksDone >= 20 && c.userBond.affinity >= 70 },
      { label: '업무 30회 + 호감도 90', check: (c) => c.stats.tasksDone >= 30 && c.userBond.affinity >= 90 },
    ],
  },
};
export const ASPIRATION_IDS = Object.keys(ASPIRATIONS);

export function aspirationPublic(aspiration) {
  return { ...aspiration, stages: aspiration.stages.map(({ label }) => ({ label })) };
}

export const KOREAN_NAMES = [
  '민지', '서연', '하준', '도윤', '지우', '예린', '시우', '유나', '주원', '하린', '태오', '나연', '은호',
  '소윤', '준서', '채아', '지안', '로아', '이안', '다온', '세아', '루이', '건우', '하람', '윤슬', '라온',
];

export const SPEECH_STYLES = {
  polite: { name: '존댓말', prompt: '부드러운 존댓말(해요체)로 말한다.' },
  casual: { name: '반말', prompt: '친구처럼 편한 반말로 말한다. 단, 무례하지 않게.' },
  formal: { name: '격식체', prompt: '격식 있는 합니다체로 정중하게 말한다.' },
};
