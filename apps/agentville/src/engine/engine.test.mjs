import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_HEIGHT, MAP_ROWS, MAP_WIDTH, ACTIVITIES } from '../catalog/world.mjs';
import { pipelineFor, skillXpToNext } from '../catalog/skills.mjs';
import { TRAITS } from '../catalog/traits.mjs';
import { makeRng, similarity, textFeatures } from '../util.mjs';
import { addCharacterXp, addSkillXp, adjustFriendship, characterView, createCharacter, effortForLevel, xpToNextLevel } from './character.mjs';
import { findPath, isWalkable, spotsOf, walkableTiles } from './map.mjs';
import { addMemory, pruneMemories, retrieveMemories, shouldReflect, MEMORY_LIMIT, REFLECTION_THRESHOLD } from './memory.mjs';
import { addMoodlet, computeMood, decayNeeds, expireMoodlets } from './needs.mjs';
import { checkEarnedTraits, compatibility, driftPersonality, grantTrait, hasTrait } from './personality.mjs';
import { chooseAssignees, classifyTask, createTask, estimateDifficulty } from './tasks.mjs';

const make = (input = {}) => createCharacter({ name: '테스트', role: 'researcher', ...input }, { minute: 0, rng: makeRng(1) });
const world = (characters) => ({ characters: Object.fromEntries(characters.map((c) => [c.id, c])), clock: { minute: 600 } });

test('map: every walkable tile is reachable and every activity has a spot', () => {
  assert.equal(MAP_ROWS.length, MAP_HEIGHT);
  for (const row of MAP_ROWS) assert.equal(row.length, MAP_WIDTH);
  const origin = spotsOf('d')[0];
  const targets = [...walkableTiles(), ...'dmcgszbp'.split('').flatMap((letter) => spotsOf(letter))];
  for (const target of targets) {
    assert.ok(isWalkable(target.x, target.y));
    assert.ok(findPath(origin, target), `unreachable ${target.x},${target.y}`);
  }
  for (const [id, activity] of Object.entries(ACTIVITIES)) {
    if (activity.spot) assert.ok(spotsOf(activity.spot).length > 0, `${id} has no spot`);
  }
  assert.ok(spotsOf('d').length >= 12, 'enough desks for a busy town');
});

test('text similarity understands Korean without spaces', () => {
  const query = textFeatures('가격 정책 비교');
  assert.ok(similarity(query, textFeatures('경쟁사 가격정책을 비교했다')) > similarity(query, textFeatures('점심으로 비빔밥을 먹었다')));
});

test('memory retrieval mixes relevance, importance and recency', () => {
  const c = make();
  addMemory(c, { kind: 'task', text: '점심 메뉴를 골랐다', importance: 2, minute: 10 });
  addMemory(c, { kind: 'task', text: '경쟁사 가격 정책을 조사해서 표로 정리했다', importance: 6, minute: 20 });
  addMemory(c, { kind: 'preference', text: '사용자는 결론을 먼저 듣는 걸 좋아한다', importance: 8, minute: 30 });
  const [top] = retrieveMemories(c, '가격 정책 다시 조사', { k: 1, now: 40 });
  assert.match(top.text, /가격 정책/);
  const prefs = retrieveMemories(c, '아무거나', { k: 3, now: 40, kinds: ['preference'] });
  assert.equal(prefs.length, 1);
});

test('memory pruning keeps reflections and preferences', () => {
  const c = make();
  addMemory(c, { kind: 'reflection', text: '나는 근거를 중요하게 여긴다', importance: 9, minute: 1 });
  for (let i = 0; i < MEMORY_LIMIT + 50; i++) addMemory(c, { kind: 'observation', text: `잡담 ${i}`, importance: 1, minute: 2 + i });
  pruneMemories(c, 10_000);
  assert.ok(c.memory.items.length <= MEMORY_LIMIT);
  assert.ok(c.memory.items.some((item) => item.kind === 'reflection'));
});

test('reflection triggers after enough important experience', () => {
  const c = make();
  c.memory.sinceReflection = 0;
  let minute = 0;
  while (!shouldReflect(c)) addMemory(c, { kind: 'task', text: `중요한 일 ${minute}`, importance: 8, minute: minute++ });
  assert.ok(c.memory.sinceReflection >= REFLECTION_THRESHOLD);
});

test('levels raise the thinking effort and the pipeline grows with skill', () => {
  assert.equal(effortForLevel(1), 'low');
  assert.equal(effortForLevel(5), 'medium');
  assert.equal(effortForLevel(8), 'high');
  assert.equal(effortForLevel(12), 'xhigh');
  assert.deepEqual(pipelineFor(1), { plan: false, review: false, widerMemory: false, rubric: false, mastery: false });
  assert.equal(pipelineFor(4).review, true);
  assert.equal(pipelineFor(10).mastery, true);

  const c = make();
  const events = addCharacterXp(c, xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3), { minute: 5, rng: makeRng(2) });
  assert.equal(c.level, 4);
  assert.equal(events.filter((e) => e.type === 'levelUp').length, 3);
  assert.equal(events.at(-1).effortUp, 'medium');

  const skillEvents = addSkillXp(c, 'research', skillXpToNext(c.skills.research.level), { minute: 6 });
  assert.equal(skillEvents[0].type, 'skillUp');
  assert.ok(characterView(c, 100).derived.skills.research.xpToNext > 0);
});

test('needs decay, moodlets change mood and expire', () => {
  const c = make();
  const before = { ...c.needs };
  decayNeeds(c, 120, { working: true });
  assert.ok(c.needs.energy < before.energy);
  const base = computeMood(c).value;
  addMoodlet(c, 'praised', 0);
  assert.ok(computeMood(c).value > base);
  expireMoodlets(c, 100_000);
  assert.equal(computeMood(c).value, base);
});

test('traits respect opposites, earned traits unlock from records', () => {
  const c = make({ traits: ['introvert'] });
  assert.equal(grantTrait(c, 'social', 0), null, 'introvert blocks social');
  assert.ok(hasTrait(c, 'introvert'));
  const earned = Object.values(TRAITS).find((trait) => trait.id === 'tenacious');
  assert.ok(earned?.when, 'tenacious is an earned trait');
  assert.deepEqual(checkEarnedTraits(c, 5), [], 'a fresh character earns nothing');
  c.stats.lowEnergyFinishes = 3;
  c.stats.praise = 5;
  const gained = checkEarnedTraits(c, 10).map((trait) => trait.id);
  assert.ok(gained.includes('tenacious'));
  assert.ok(gained.includes('confident'));
  assert.deepEqual(checkEarnedTraits(c, 11), [], 'traits are only granted once');
});

test('personality drift is capped per day', () => {
  const c = make();
  const start = c.bigFive.O;
  for (let i = 0; i < 20; i++) driftPersonality(c, { O: 2 }, 1);
  assert.ok(c.bigFive.O - start <= 3.01, `drifted ${c.bigFive.O - start}`);
  driftPersonality(c, { O: 2 }, 2);
  assert.ok(c.bigFive.O - start > 3);
});

test('friendship is symmetric and compatibility is bounded', () => {
  const a = make({ name: '가' });
  const b = make({ name: '나', role: 'engineer' });
  const value = compatibility(a, b);
  assert.ok(value >= -1 && value <= 1);
  const event = adjustFriendship(a, b, 45, 0);
  assert.equal(a.relationships[b.id].friendship, b.relationships[a.id].friendship);
  assert.equal(event?.type, 'friendship');
});

test('tasks are classified, sized and routed to the right specialist', () => {
  assert.equal(classifyTask('파이썬 코드 버그를 고쳐줘').category, 'coding');
  assert.equal(classifyTask('이 문장을 영어로 번역해줘').category, 'translation');
  assert.ok(estimateDifficulty('간단히 한 줄로') <= 1);
  assert.ok(estimateDifficulty('신규 서비스 전체 아키텍처를 상세히 설계하고, 비용, 일정, 위험, 대안을 모두 비교해줘') >= 3);

  const researcher = make({ name: '민지', role: 'researcher' });
  const engineer = make({ name: '하준', role: 'engineer' });
  const writer = make({ name: '서연', role: 'writer' });
  const town = world([researcher, engineer, writer]);
  const solo = chooseAssignees(town, createTask({ prompt: '자바스크립트 함수 리팩터링 코드 작성' }, { minute: 0 }));
  assert.equal(solo.mode, 'solo');
  assert.equal(solo.assignees[0], engineer.id);

  const team = chooseAssignees(town, createTask({ prompt: '시장 조사', mode: 'team', difficulty: 5 }, { minute: 0 }));
  assert.equal(team.mode, 'team');
  assert.ok(team.assignees.length >= 2);
  assert.equal(new Set(team.assignees).size, team.assignees.length);
  assert.ok(team.assignees.includes(team.lead));

  engineer.state.taskId = 'busy';
  const busy = chooseAssignees(town, createTask({ prompt: '코드 작성' }, { minute: 0 }));
  assert.notEqual(busy.assignees[0], engineer.id, 'busy characters are skipped');
});

test('growth unlocks tools, one tool family per step', async () => {
  const { hasTool, toolsForStep, toolUnlockedBy, unlockedTools, TOOLS } = await import('../catalog/tools.mjs');
  const c = make();
  assert.deepEqual(unlockedTools(c), ['web_fetch', 'files', 'browser'], 'pages, a work folder and (research Lv2) the private browser from the start');
  assert.deepEqual(unlockedTools(make({ role: 'writer' })), ['web_fetch', 'files'], 'others open the browser at Lv2');
  assert.deepEqual(toolsForStep(c, 'research'), ['web_fetch'], 'research reads pages before search is earned');
  c.skills.research.level = 3;
  assert.ok(hasTool(c, 'web_search'));
  assert.ok(hasTool(c, 'browser'), 'research Lv2+ also opens the private browser');
  assert.deepEqual(toolsForStep(c, 'writing'), ['web_search']);
  assert.deepEqual(toolsForStep(c, 'writing', { enabled: false }), []);
  assert.equal(TOOLS.web_search.spec(c).max_uses, 3);
  assert.equal(toolUnlockedBy(c, 'research', 3), 'web_search');

  c.skills.analysis.level = 5;
  assert.equal(toolUnlockedBy(c, 'analysis', 5), 'code_execution');
  assert.deepEqual(toolsForStep(c, 'analysis'), ['code_execution'], 'code first for analysis');
  assert.deepEqual(toolsForStep(c, 'research'), ['web_fetch', 'web_search'], 'web tools elsewhere');
  c.skills.coding.level = 5;
  assert.equal(toolUnlockedBy(c, 'coding', 5), null, 'already unlocked through analysis');
  assert.deepEqual(TOOLS.code_execution.spec(c), { type: 'code_execution_20260120', name: 'code_execution' });
});

test('domain words beat generic planning words', () => {
  assert.equal(classifyTask('신규 앱 출시 마케팅 전략을 자세히 기획해줘. 채널별 계획 포함').category, 'marketing');
  assert.equal(classifyTask('제주도 2박 3일 가족 여행 일정을 짜 줘').category, 'planning');
  assert.equal(classifyTask('프로젝트 우선순위를 정해줘').category, 'planning');
  assert.equal(classifyTask('서비스 아키텍처를 설계해줘').category, 'coding');
});
