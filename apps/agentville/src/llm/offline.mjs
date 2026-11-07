// Simulation brain: no network, no key. It reproduces the shape of every LLM
// step (plan, draft, review, synthesis, chat, small talk, debrief, reflection,
// character generation) from the character's own state, so the whole game loop
// runs offline and in tests. Outputs say plainly that they are simulated.
import { ASPIRATION_IDS, KOREAN_NAMES, ROLES } from '../catalog/roles.mjs';
import { SKILLS } from '../catalog/skills.mjs';
import { TRAITS } from '../catalog/traits.mjs';
import { looksLikePreference } from '../engine/memory.mjs';
import { clamp, eunNeun, hashString, makeRng, truncate } from '../util.mjs';

const NOTICE = '> 🧪 시뮬레이션 두뇌가 만든 결과물입니다. `ANTHROPIC_API_KEY`를 설정하면 이 캐릭터가 Claude로 실제 결과물을 만듭니다.';

function say(speech, variants) {
  return variants[speech] ?? variants.polite;
}

function flavour(character, rng) {
  const ids = character.traits.map((trait) => trait.id);
  const lines = [];
  if (ids.includes('witty')) lines.push(say(character.speech, { polite: '이번 건 제법 잘 풀렸어요, 커피 한 잔 각이에요 ☕', casual: '이번 건 꽤 잘 풀렸다, 커피 한 잔 각이야 ☕', formal: '이번 건은 순조로웠습니다. 커피 한 잔 하셔도 좋겠습니다.' }));
  if (ids.includes('perfectionist')) lines.push(say(character.speech, { polite: '아직 다듬을 곳이 보이지만, 우선 여기까지 정리했어요.', casual: '아직 다듬을 데가 보이긴 하는데, 일단 여기까지 했어.', formal: '보완할 부분이 남아 있으나 우선 여기까지 정리했습니다.' }));
  if (ids.includes('kind')) lines.push(say(character.speech, { polite: '도움이 됐으면 좋겠어요. 오늘도 수고 많으셨어요!', casual: '도움이 됐으면 좋겠다. 오늘도 고생 많았어!', formal: '도움이 되기를 바랍니다. 오늘도 수고 많으셨습니다.' }));
  if (ids.includes('curious')) lines.push(say(character.speech, { polite: '하다 보니 더 파 보고 싶은 질문이 생겼어요.', casual: '하다 보니 더 파 보고 싶은 게 생겼어.', formal: '진행하며 추가로 살펴볼 질문이 생겼습니다.' }));
  if (character.needs.energy < 25) lines.push(say(character.speech, { polite: '조금 지쳤지만 끝까지 해냈어요.', casual: '좀 지쳤지만 끝까지 했어.', formal: '다소 피로하지만 끝까지 마쳤습니다.' }));
  lines.push(say(character.speech, { polite: '피드백 주시면 다음엔 더 잘해 볼게요.', casual: '피드백 주면 다음엔 더 잘할게.', formal: '피드백을 주시면 다음에 반영하겠습니다.' }));
  return rng.pick(lines);
}

function keyPhrases(text) {
  return String(text ?? '')
    .split(/[\n.,!?]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .slice(0, 4);
}

function deliverable({ character, task, plan, stage, rng }) {
  const skill = SKILLS[task.category];
  const level = character.skills[task.category].level;
  const phrases = keyPhrases(task.prompt);
  const points = phrases.length ? phrases : [truncate(task.prompt, 60)];
  const perks = Object.entries(skill.perks).filter(([required]) => Number(required) <= level).map(([, text]) => text);
  const body = [
    `## ${task.title}`,
    NOTICE,
    `### ${skill.emoji} 접근 방식 (${skill.name} Lv${level})`,
    ...skill.approach.map((line) => `- ${line}`),
    plan ? `### 세운 계획\n${plan}` : '',
    '### 핵심 정리',
    ...points.map((point, index) => `${index + 1}. **${point}** — ${rng.pick(['요청의 핵심 조건으로 보고 우선 반영했습니다.', '구체적인 기준을 세워 판단할 부분입니다.', '실제 자료로 확인이 필요한 지점입니다.', '바로 실행할 수 있는 형태로 나눴습니다.'])}`),
    perks.length ? `### 적용한 노하우\n${perks.map((text) => `- ${text}`).join('\n')}` : '',
    stage === 'review' ? '### 검토 후 보완\n- 빠진 조건과 중복 표현을 점검해 다듬었습니다.' : '',
    '### 다음 단계',
    `- ${rng.pick(['필요한 자료나 조건을 알려 주시면 구체화하겠습니다.', '우선순위를 정해 주시면 그 순서로 깊게 파겠습니다.', '실제 데이터로 검증하는 단계를 제안합니다.'])}`,
    '',
    `💬 ${flavour(character, rng)}`,
  ];
  return body.filter((line) => line !== '').join('\n');
}

function synthesis({ character, task, drafts, rng }) {
  return [
    `## ${task.title} — 팀 숙고 종합`,
    NOTICE,
    '### 관점별 기여',
    ...drafts.map((draft) => `- **${draft.name}** (${draft.skill}): 자신의 전문성으로 ${rng.pick(['핵심 근거를 보강했습니다', '실행 계획을 구체화했습니다', '위험 요소를 짚었습니다', '표현을 다듬었습니다'])}.`),
    '### 종합 결과',
    ...keyPhrases(task.prompt).map((point, index) => `${index + 1}. ${point}: 팀의 관점을 합쳐 균형 있게 정리했습니다.`),
    '### 리더 메모',
    `- ${eunNeun(character.name)} 서로 다른 의견 중 근거가 더 분명한 쪽을 택했습니다.`,
    '',
    `💬 ${flavour(character, rng)}`,
  ].join('\n');
}

const GREETING = /안녕|하이|hello|hi\b|반가/i;
const THANKS = /고마|감사|thank/i;
const HOW_ARE_YOU = /기분|어때|잘 지내|피곤|컨디션|how are/i;

function chatReply({ character, message, memories, rng }) {
  const s = character.speech;
  const name = character.name;
  // A stated preference is acknowledged, since the town stores it as a memory.
  const noted = looksLikePreference(message)
    ? say(s, { polite: ' 그리고 말씀하신 취향은 기억해 둘게요. 다음 업무부터 그렇게 할게요!', casual: ' 그리고 말한 취향은 기억해 둘게. 다음 일부터 그렇게 할게!', formal: ' 말씀하신 선호는 기억해 두었다가 다음 업무부터 반영하겠습니다.' })
    : '';
  return reply({ character, message, memories, rng, s, name }) + noted;
}

function reply({ character, message, memories, rng, s, name }) {
  if (looksLikePreference(message) && !GREETING.test(message) && !THANKS.test(message)) {
    return say(s, { polite: '좋아요, 알려 주셔서 고마워요.', casual: '오케이, 알려 줘서 고마워.', formal: '알려 주셔서 감사합니다.' });
  }
  if (GREETING.test(message)) return say(s, { polite: `안녕하세요! ${name}예요. 오늘은 뭘 같이 해 볼까요?`, casual: `안녕! 나 ${name}. 오늘은 뭐 같이 할까?`, formal: `안녕하십니까, ${name}입니다. 무엇을 도와드릴까요?` });
  if (THANKS.test(message)) return say(s, { polite: '천만에요! 그렇게 말해 주시니 힘이 나요 😊', casual: '에이 뭘! 그렇게 말해 주니까 힘난다 😊', formal: '별말씀을요. 말씀만으로도 큰 힘이 됩니다.' });
  if (HOW_ARE_YOU.test(message)) {
    const tired = character.needs.energy < 35;
    return say(s, {
      polite: tired ? '솔직히 좀 피곤해요. 잠깐 쉬고 오면 금방 괜찮아질 거예요.' : '컨디션 좋아요! 뭐든 맡겨 주세요.',
      casual: tired ? '솔직히 좀 피곤해. 잠깐 쉬면 괜찮아질 거야.' : '컨디션 좋아! 뭐든 맡겨 줘.',
      formal: tired ? '다소 피곤합니다. 잠시 휴식하면 회복될 것 같습니다.' : '컨디션이 좋습니다. 무엇이든 맡겨 주십시오.',
    });
  }
  const memory = memories.find((item) => item.kind !== 'milestone');
  const recall = memory ? say(s, { polite: ` 그러고 보니 "${truncate(memory.text, 40)}" 일이 떠오르네요.`, casual: ` 그러고 보니 "${truncate(memory.text, 40)}" 생각난다.`, formal: ` "${truncate(memory.text, 40)}" 일이 떠오릅니다.` }) : '';
  return say(s, {
    polite: `"${truncate(message, 30)}" 말씀이군요. 제 생각엔 하나씩 정리해 보면 좋을 것 같아요.${recall} 업무로 맡겨 주시면 제대로 해 볼게요!`,
    casual: `"${truncate(message, 30)}" 말이지? 하나씩 정리해 보면 좋겠어.${recall} 업무로 맡겨 주면 제대로 해 볼게!`,
    formal: `"${truncate(message, 30)}"에 대해 말씀하셨군요. 하나씩 정리해 보는 것이 좋겠습니다.${recall} 업무로 맡겨 주시면 성실히 수행하겠습니다.`,
  }) + (rng.chance(0.3) && character.catchphrase ? ` ${character.catchphrase}` : '');
}

const TOPICS = [
  { topic: '점심 메뉴', lines: ['오늘 점심 뭐 먹을까?', '카페 샌드위치 어때?', '좋아, 대신 디저트도!', '역시 말이 통한다니까.'] },
  { topic: '요즘 맡은 일', lines: ['요즘 맡은 일 어때?', '생각보다 재밌는데 손이 많이 가.', '필요하면 도와줄게.', '고마워, 든든하다.'] },
  { topic: '주말 계획', lines: ['주말에 뭐 해?', '정원 산책이나 할까 해.', '나도 끼워 줘!', '그래, 같이 가자.'] },
  { topic: '새로 읽은 책', lines: ['도서관에서 재밌는 책 찾았어.', '무슨 책인데?', '일 잘하는 법에 관한 거.', '다 읽으면 빌려줘!'] },
  { topic: '게임 대결', lines: ['아까 게임 한 판 어땠어?', '아깝게 졌어...', '다음엔 내가 봐줄게.', '그 말 꼭 기억한다?'] },
  { topic: '사용자 이야기', lines: ['요즘 사용자 부탁이 재밌지 않아?', '응, 배울 게 많아.', '피드백 받으면 확실히 늘더라.', '맞아, 우리 같이 성장하자.'] },
];

export function createOfflineBrain({ delayMs = 18, seed = 7 } = {}) {
  const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
  const rngFor = (meta) => makeRng(hashString(`${meta?.character?.id ?? ''}:${meta?.task?.id ?? ''}:${meta?.kind ?? ''}:${seed}:${meta?.salt ?? ''}`));

  async function stream(text, onText) {
    if (!onText) return text;
    const chunks = text.match(/[\s\S]{1,14}/g) ?? [];
    for (const chunk of chunks) {
      onText(chunk);
      await sleep(delayMs);
    }
    return text;
  }

  return {
    name: 'simulation',
    live: false,
    model: 'simulation',
    async text({ meta = {}, onText }) {
      const rng = rngFor(meta);
      const { character, task } = meta;
      let text;
      switch (meta.kind) {
        case 'plan':
          text = SKILLS[task.category].approach.map((line, index) => `${index + 1}. ${line}`).concat(`${SKILLS[task.category].approach.length + 1}. "${truncate(task.title, 24)}"의 결과를 바로 쓸 수 있게 정리한다`).join('\n');
          break;
        case 'draft':
        case 'review':
          text = deliverable({ character, task, plan: meta.plan, stage: meta.kind, rng });
          break;
        case 'synthesis':
          text = synthesis({ character, task, drafts: meta.drafts ?? [], rng });
          break;
        case 'chat':
          text = chatReply({ character, message: meta.message ?? '', memories: meta.memories ?? [], rng });
          break;
        default:
          text = '...';
      }
      return stream(text, onText);
    },
    async json({ meta = {} }) {
      const rng = rngFor(meta);
      const { character, task } = meta;
      switch (meta.kind) {
        case 'debrief': {
          const level = character.skills[task.category].level;
          const quality = clamp(Math.round(4 + level * 0.5 + rng.range(-1.5, 1.5) - (task.difficulty - 2) * 0.4), 1, 10);
          return {
            self_quality: quality,
            summary: `"${task.title}" 업무를 ${SKILLS[task.category].name} 실력으로 마쳤다.`,
            lesson: `"${rng.pick(SKILLS[task.category].approach)}" 방식이 효과적이었다.`,
            importance: clamp(3 + task.difficulty, 1, 10),
            feeling: quality >= 8 ? 'proud' : quality >= 6 ? 'satisfied' : character.needs.energy < 25 ? 'tired' : 'neutral',
          };
        }
        case 'reflection': {
          const counts = Object.entries(character.stats.tasksByCat).sort((a, b) => b[1] - a[1]);
          const top = counts[0]?.[0];
          const insights = [];
          if (top) insights.push(`요즘 ${SKILLS[top].name} 일을 가장 많이 했다. 이 분야에서 내 방식이 생기고 있다.`);
          if (character.stats.praise > character.stats.criticism) insights.push('사용자는 내가 핵심을 먼저 말할 때 만족하는 것 같다.');
          else if (character.stats.criticism > 0) insights.push('아쉬운 피드백에서 배운 점을 다음 업무에 꼭 반영해야겠다.');
          const friend = Object.entries(character.relationships).sort((a, b) => b[1].friendship - a[1].friendship)[0];
          if (friend && friend[1].friendship > 20) insights.push('동료와 함께 이야기하면 아이디어가 더 잘 떠오른다.');
          if (!insights.length) insights.push('마을 생활에 조금씩 익숙해지고 있다.');
          return {
            insights: insights.slice(0, 3),
            personality_note: top ? `${SKILLS[top].name} 일을 할 때면 "${SKILLS[top].approach[0]}"는 원칙을 자연스럽게 따르게 됐다.` : '',
            trait_hint: 'none',
          };
        }
        case 'smalltalk': {
          const pick = rng.pick(TOPICS);
          return { topic: pick.topic, lines: pick.lines, tone: rng.chance(0.15) ? 'awkward' : 'warm' };
        }
        case 'character':
          return generateCharacter(meta.description ?? '', rng);
        default:
          return {};
      }
    },
    describeError(error) {
      return error?.message ?? String(error);
    },
  };
}

const ROLE_HINTS = [
  ['researcher', /연구|리서치|조사|과학|박사|research/i],
  ['writer', /작가|글|소설|시인|에디터|기자|writer/i],
  ['engineer', /개발|코딩|프로그래머|엔지니어|해커|engineer|developer/i],
  ['strategist', /기획|전략|\bpm\b|매니저|리더|창업|planner/i],
  ['designer', /디자인|디자이너|예술|화가|그림|아티스트|일러스트|designer/i],
  ['analyst', /분석|데이터|숫자|통계|회계|analyst/i],
  ['marketer', /마케팅|홍보|광고|인플루언서|marketer/i],
  ['counselor', /상담|코치|심리|위로|선생|counsel|coach/i],
];
const TRAIT_HINTS = [
  ['curious', /호기심|궁금|탐구/], ['meticulous', /꼼꼼|정확|디테일/], ['optimist', /낙천|긍정|밝/], ['introvert', /내성|조용|수줍|내향/],
  ['social', /사교|활발|외향|수다/], ['perfectionist', /완벽/], ['witty', /재치|유머|농담|장난/], ['calm', /차분|침착|평온/],
  ['passionate', /열정|에너지|뜨거/], ['blunt', /직설|냉소|시니컬|솔직/], ['kind', /다정|친절|따뜻|상냥/], ['night_owl', /밤|올빼미|새벽/],
];

function generateCharacter(description, rng) {
  const role = ROLE_HINTS.find(([, pattern]) => pattern.test(description))?.[0] ?? rng.pick(Object.keys(ROLES));
  const traits = TRAIT_HINTS.filter(([, pattern]) => pattern.test(description)).map(([id]) => id).slice(0, 3);
  const base = ROLES[role];
  const finalTraits = traits.length ? traits : base.traits;
  const speech = /반말|친구|편하게/.test(description) ? 'casual' : /격식|정중|딱딱/.test(description) ? 'formal' : 'polite';
  return {
    name: rng.pick(KOREAN_NAMES),
    role,
    bio: truncate(`${description.trim() || `${base.name}로 일하는 주민`}. AgentVille에서 새로운 동료들과 함께 성장하고 싶어 한다.`, 300),
    speech,
    traits: finalTraits.filter((id) => TRAITS[id]),
    aspiration: base.aspiration ?? rng.pick(ASPIRATION_IDS),
    catchphrase: rng.pick(['좋아, 해 보자!', '음, 흥미로운데?', '차근차근 가 봅시다.', '이건 제 전문이죠.', '']),
    openness: base.bigFive.O, conscientiousness: base.bigFive.C, extraversion: base.bigFive.E,
    agreeableness: base.bigFive.A, neuroticism: base.bigFive.N,
  };
}
