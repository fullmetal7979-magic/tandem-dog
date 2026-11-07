// Character Card V2 import/export. AgentVille's own state rides along in
// data.extensions.agentville so a card round-trips without loss, while plain
// V2 cards from other tools still import as a fresh character.
import { ROLES, SPEECH_STYLES } from './catalog/roles.mjs';
import { TRAITS } from './catalog/traits.mjs';
import { describeBigFive } from './engine/personality.mjs';
import { truncate } from './util.mjs';

export function exportCard(character) {
  const role = ROLES[character.role];
  const traits = character.traits.map(({ id }) => TRAITS[id]).filter(Boolean);
  const { memory, state, ...portable } = character;
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.bio,
      personality: [...traits.map((trait) => `${trait.name}: ${trait.prompt}`), ...describeBigFive(character.bigFive)].join('\n'),
      scenario: `AgentVille 마을의 ${role.name}. 사용자와 함께 일하며 성장한다.`,
      first_mes: SPEECH_STYLES[character.speech]?.name === '반말' ? `안녕! 나 ${character.name}. 뭐 도와줄까?` : `안녕하세요, ${character.name}예요. 무엇을 도와드릴까요?`,
      mes_example: '',
      creator_notes: `AgentVille Lv${character.level} ${role.name}`,
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['agentville', role.name, ...traits.map((trait) => trait.name)],
      creator: 'AgentVille',
      character_version: `lv${character.level}`,
      extensions: {
        agentville: {
          version: 1,
          character: {
            ...portable,
            memory: { items: memory.items.filter((item) => ['reflection', 'preference', 'milestone'].includes(item.kind)), sinceReflection: 0, nextId: memory.nextId },
          },
        },
      },
    },
  };
}

const ROLE_HINTS = [
  ['engineer', /개발|코드|엔지니어|프로그래머|engineer|developer|programmer|hacker/i],
  ['writer', /작가|글|writer|author|poet|novel/i],
  ['researcher', /연구|과학|research|scientist|scholar/i],
  ['designer', /디자인|디자이너|예술|artist|designer|painter/i],
  ['analyst', /분석|데이터|analyst|data/i],
  ['marketer', /마케팅|홍보|marketer|marketing|influencer/i],
  ['counselor', /상담|치유|coach|counsel|therap|healer|nurse/i],
  ['strategist', /기획|리더|manager|leader|strategist|captain/i],
];

// Returns either a full AgentVille character (round-trip) or creation input.
export function importCard(card) {
  const data = card?.spec === 'chara_card_v2' ? card.data : card?.data ?? card;
  if (!data || typeof data !== 'object' || !data.name) throw new Error('Character Card V2 형식이 아닙니다.');
  const own = data.extensions?.agentville?.character;
  if (own && own.skills && own.attributes) return { full: own };
  const text = `${data.description ?? ''} ${data.personality ?? ''} ${(data.tags ?? []).join(' ')}`;
  const role = ROLE_HINTS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'writer';
  const traits = Object.values(TRAITS)
    .filter((trait) => trait.kind === 'start' && text.includes(trait.name.replace(/한$|인$|는$/, '')))
    .map((trait) => trait.id)
    .slice(0, 3);
  return {
    input: {
      name: truncate(data.name, 16),
      role,
      bio: truncate(data.description || data.personality || '', 500),
      traits,
      speech: /반말|casual/i.test(text) ? 'casual' : 'polite',
      catchphrase: '',
    },
  };
}
