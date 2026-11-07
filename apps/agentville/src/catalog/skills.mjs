// Attributes (능력치) and skills (전문 기술). Perks are the bridge between a
// number going up and the agent actually working differently: each unlocked
// perk adds a craft rule to the prompt, and levels 2/4/8/10 unlock pipeline steps.

export const ATTRIBUTES = {
  int: { name: '지능', emoji: '🧠', desc: '분석과 논리' },
  cre: { name: '창의', emoji: '🎨', desc: '아이디어와 표현' },
  cha: { name: '소통', emoji: '🗣️', desc: '설득과 전달' },
  foc: { name: '집중', emoji: '🎯', desc: '꼼꼼함과 지구력' },
  emp: { name: '공감', emoji: '💗', desc: '의도 파악과 배려' },
  tec: { name: '기술', emoji: '🛠️', desc: '도구와 구현' },
};
export const ATTRIBUTE_IDS = Object.keys(ATTRIBUTES);

export const SKILL_MAX_LEVEL = 10;

export const SKILLS = {
  research: {
    name: '리서치', emoji: '🔬', attrs: { int: 0.6, foc: 0.4 },
    keywords: ['조사', '리서치', '찾아', '비교', '알아봐', '정리해', '동향', '트렌드', '논문', '자료', '사례', 'research', 'compare', 'find', 'survey', 'market'],
    approach: ['질문을 하위 질문으로 쪼갠다', '근거가 강한 순서로 정리한다', '모르는 부분을 따로 표시한다'],
    perks: {
      1: '핵심 질문 세 가지를 먼저 적는다.',
      3: '비교가 필요하면 표로 정리한다.',
      4: '사실, 추정, 의견을 구분해서 표시한다.',
      6: '반대 근거와 한계를 꼭 한 단락 넣는다.',
      8: '결론마다 확신 정도(높음·중간·낮음)를 단다.',
      10: '검증 방법과 다음에 확인할 자료를 제안한다.',
    },
    rubric: ['질문에 직접 답했는가', '근거와 추정을 구분했는가', '빠진 관점이 없는가', '결론이 실행 가능한가'],
  },
  writing: {
    name: '글쓰기', emoji: '✍️', attrs: { cre: 0.5, cha: 0.3, foc: 0.2 },
    keywords: ['글', '작성', '써줘', '에세이', '블로그', '이메일', '메일', '편지', '소설', '시 ', '문장', '요약', '보고서', '초안', 'write', 'essay', 'email', 'draft', 'story', 'summary'],
    approach: ['독자와 목적을 먼저 정한다', '첫 문장에 핵심을 둔다', '군더더기를 걷어낸다'],
    perks: {
      1: '독자가 누구인지 정하고 그에 맞는 어휘를 쓴다.',
      3: '첫 문단에서 핵심을 말한다.',
      4: '퇴고: 중복 표현과 수동태를 줄인다.',
      6: '사용자가 좋아했던 문체를 기억해 맞춘다.',
      8: '리듬을 위해 문장 길이에 변화를 준다.',
      10: '같은 내용을 더 짧게 말할 수 있는지 마지막으로 점검한다.',
    },
    rubric: ['목적이 분명한가', '구조가 자연스러운가', '문장이 간결한가', '독자에게 맞는 어조인가'],
  },
  coding: {
    name: '코딩', emoji: '💻', attrs: { tec: 0.6, int: 0.3, foc: 0.1 },
    keywords: ['코드', '코딩', '함수', '버그', '에러', '오류', '프로그램', '스크립트', '구현', '파이썬', '자바스크립트', 'sql', 'api', 'code', 'python', 'javascript', 'typescript', 'bug', 'function', 'regex', 'html', 'css'],
    approach: ['입력과 출력을 먼저 정의한다', '작게 나눠 구현한다', '경계 조건을 확인한다'],
    perks: {
      1: '코드는 실행 가능한 완전한 형태로 준다.',
      3: '사용 예시와 실행 방법을 함께 적는다.',
      4: '경계 조건과 오류 처리를 점검한다.',
      6: '테스트 코드 또는 검증 방법을 제안한다.',
      8: '복잡도와 성능 특성을 한 줄로 설명한다.',
      10: '더 단순한 설계가 있는지 마지막으로 비교한다.',
    },
    rubric: ['요구 사항을 만족하는가', '실행 가능한가', '경계 조건을 다루는가', '읽기 쉬운가'],
  },
  planning: {
    name: '기획', emoji: '🗺️', attrs: { int: 0.4, foc: 0.3, emp: 0.3 },
    keywords: ['기획', '계획', '전략', '로드맵', '일정', '스케줄', '목표', '아이디어', '브레인스토밍', '여행', '프로젝트', '우선순위', 'plan', 'strategy', 'roadmap', 'schedule', 'itinerary', 'idea'],
    approach: ['목표와 제약을 먼저 확인한다', '단계와 순서를 정한다', '위험과 대안을 적는다'],
    perks: {
      1: '목표와 성공 기준을 한 문장으로 적는다.',
      3: '단계별 일정이나 순서를 제시한다.',
      4: '위험 요소와 대안을 함께 낸다.',
      6: '우선순위를 근거와 함께 매긴다.',
      8: '첫 주에 할 일처럼 바로 시작할 행동을 뽑아 준다.',
      10: '계획이 틀렸을 때 알아챌 신호를 정의한다.',
    },
    rubric: ['목표가 분명한가', '현실적인가', '순서가 논리적인가', '바로 실행할 수 있는가'],
  },
  design: {
    name: '디자인', emoji: '🎨', attrs: { cre: 0.6, emp: 0.3, tec: 0.1 },
    keywords: ['디자인', 'ui', 'ux', '로고', '색상', '컬러', '레이아웃', '화면', '와이어프레임', '브랜딩', '폰트', '배너', 'design', 'logo', 'layout', 'color', 'wireframe', 'brand'],
    approach: ['사용자의 맥락을 먼저 본다', '위계와 대비를 정한다', '일관성을 지킨다'],
    perks: {
      1: '누가 어떤 상황에서 쓰는지부터 정한다.',
      3: '색상은 구체적인 값(HEX)으로 제안한다.',
      4: '접근성(대비, 글자 크기)을 점검한다.',
      6: '대안 시안을 두 가지 이상 비교한다.',
      8: '디자인 결정마다 이유를 한 줄로 단다.',
      10: '디자인 시스템으로 확장할 규칙을 제안한다.',
    },
    rubric: ['목적에 맞는가', '위계가 분명한가', '접근성을 지켰는가', '일관적인가'],
  },
  analysis: {
    name: '분석', emoji: '📊', attrs: { int: 0.6, foc: 0.3, tec: 0.1 },
    keywords: ['분석', '데이터', '통계', '수치', '지표', '엑셀', '표', '차트', '계산', '예측', '매출', '비용', 'analyze', 'analysis', 'data', 'metric', 'statistics', 'forecast', 'excel'],
    approach: ['질문을 지표로 바꾼다', '가정을 명시한다', '숫자와 해석을 분리한다'],
    perks: {
      1: '계산 과정을 단계별로 보여 준다.',
      3: '결과를 표로 요약한다.',
      4: '가정과 데이터의 한계를 밝힌다.',
      6: '이상값이나 다른 해석 가능성을 짚는다.',
      8: '결론을 뒤집을 수 있는 조건을 적는다.',
      10: '의사결정에 필요한 다음 데이터를 제안한다.',
    },
    rubric: ['계산이 정확한가', '가정을 밝혔는가', '해석이 타당한가', '의사결정에 쓸모 있는가'],
  },
  marketing: {
    name: '마케팅', emoji: '📣', attrs: { cha: 0.5, cre: 0.3, emp: 0.2 },
    keywords: ['마케팅', '광고', '카피', '홍보', 'sns', '인스타', '캠페인', '슬로건', '브랜드', '고객', '타깃', '이벤트', 'marketing', 'campaign', 'copy', 'slogan', 'promotion', 'audience'],
    approach: ['고객의 고민에서 출발한다', '하나의 메시지에 집중한다', '행동을 유도한다'],
    perks: {
      1: '타깃 고객을 구체적인 한 사람으로 그린다.',
      3: '카피는 여러 버전을 낸다.',
      4: '채널별로 길이와 어조를 맞춘다.',
      6: '측정할 지표와 목표 수치를 제안한다.',
      8: '경쟁 메시지와 차별점을 대비한다.',
      10: '실험(A/B) 설계까지 붙인다.',
    },
    rubric: ['타깃이 분명한가', '메시지가 하나로 모이는가', '행동을 유도하는가', '측정 가능한가'],
  },
  translation: {
    name: '번역', emoji: '🌐', attrs: { cha: 0.4, foc: 0.3, emp: 0.3 },
    keywords: ['번역', '영어로', '한국어로', '일본어로', '중국어로', '통역', '현지화', 'translate', 'translation', 'localize', 'in english', 'in korean'],
    approach: ['원문의 의도를 먼저 잡는다', '자연스러운 표현으로 옮긴다', '용어를 일관되게 쓴다'],
    perks: {
      1: '직역보다 자연스러운 표현을 우선한다.',
      3: '고유명사와 전문 용어를 일관되게 옮긴다.',
      4: '애매한 표현은 번역 메모로 따로 단다.',
      6: '문화적 맥락이 다른 표현은 현지화한다.',
      8: '격식 수준을 원문과 맞춘다.',
      10: '대안 번역을 함께 제시한다.',
    },
    rubric: ['의미가 정확한가', '자연스러운가', '용어가 일관적인가', '어조가 맞는가'],
  },
  teaching: {
    name: '교육', emoji: '🎓', attrs: { cha: 0.4, emp: 0.3, int: 0.3 },
    keywords: ['설명', '가르쳐', '알려줘', '이해', '개념', '강의', '튜토리얼', '공부', '학습', '퀴즈', '쉽게', 'explain', 'teach', 'tutorial', 'learn', 'concept', 'quiz'],
    approach: ['상대의 수준을 가늠한다', '쉬운 비유로 시작한다', '확인 질문으로 끝낸다'],
    perks: {
      1: '쉬운 비유로 시작한다.',
      3: '단계별 예시를 든다.',
      4: '흔한 오해를 짚어 준다.',
      6: '이해를 확인할 질문이나 연습 문제를 낸다.',
      8: '수준별(입문·중급) 설명을 나눠 준다.',
      10: '다음에 배울 것을 학습 경로로 제안한다.',
    },
    rubric: ['정확한가', '쉬운가', '예시가 적절한가', '스스로 해 볼 수 있게 하는가'],
  },
  counseling: {
    name: '상담', emoji: '🫶', attrs: { emp: 0.6, cha: 0.3, int: 0.1 },
    keywords: ['고민', '상담', '조언', '위로', '힘들', '스트레스', '불안', '관계', '코칭', '동기', '진로', '마음', 'advice', 'coach', 'stress', 'feel', 'motivation', 'career'],
    approach: ['감정을 먼저 알아준다', '상황을 함께 정리한다', '작은 다음 걸음을 제안한다'],
    perks: {
      1: '판단하기 전에 감정을 먼저 알아준다.',
      3: '상황을 상대의 말로 다시 정리해 준다.',
      4: '선택지를 장단점과 함께 펼쳐 보인다.',
      6: '상대가 이미 가진 강점을 짚어 준다.',
      8: '오늘 할 수 있는 작은 행동 하나를 제안한다.',
      10: '전문가 도움이 필요한 신호를 부드럽게 안내한다.',
    },
    rubric: ['공감했는가', '판단을 강요하지 않았는가', '현실적인 도움이 되는가', '안전을 고려했는가'],
  },
};
export const SKILL_IDS = Object.keys(SKILLS);

// XP needed to go from `level` to `level + 1` in a skill.
export const skillXpToNext = (level) => Math.round(60 * (level + 1) ** 1.35);

export function unlockedPerks(skillId, level) {
  const perks = SKILLS[skillId]?.perks ?? {};
  return Object.entries(perks)
    .filter(([required]) => Number(required) <= level)
    .map(([required, text]) => ({ level: Number(required), text }));
}

export function nextPerk(skillId, level) {
  const perks = SKILLS[skillId]?.perks ?? {};
  const entry = Object.entries(perks).find(([required]) => Number(required) > level);
  return entry ? { level: Number(entry[0]), text: entry[1] } : null;
}

// Pipeline steps unlocked by the skill level of the task's category.
export function pipelineFor(level) {
  return {
    plan: level >= 2,
    review: level >= 4,
    widerMemory: level >= 6,
    rubric: level >= 8,
    mastery: level >= 10,
  };
}
