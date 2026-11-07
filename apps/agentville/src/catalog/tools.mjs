// Equipment (업무 장비): what a character can actually do while working.
// Server tools (web search, web fetch, cloud code) run inside the Claude call;
// client tools (work folder, terminal, private browser, the user's desktop)
// run here, through src/agent/, behind the approval policy. Growth unlocks
// them, and each one has its own mastery level that raises how much a
// character may do with it in one task.

export const TOOLS = {
  web_fetch: {
    name: '웹 페이지 읽기',
    emoji: '📄',
    kind: 'server',
    family: 'web',
    charLevel: 1,
    skills: [],
    desc: '주소를 알려 주면 페이지 본문을 직접 읽고 요약·비교한다.',
    prompt: '웹 페이지 읽기 도구(web_fetch)로 주소의 본문을 직접 읽을 수 있다. 사용자가 준 주소나 검색 결과의 주소를 열어 근거를 확인한다.',
    spec: (character) => ({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 + masteryLevel(character, 'web_fetch') * 2 }),
  },
  web_search: {
    name: '웹 검색',
    emoji: '🌐',
    kind: 'server',
    family: 'web',
    skills: ['research'],
    level: 3,
    desc: '최신 정보를 검색하고 결과물에 출처 링크를 남긴다.',
    prompt: '웹 검색 도구를 쓸 수 있다. 최신 사실이나 수치가 필요하면 검색해서 확인하고, 확인하지 못한 내용은 추정이라고 밝힌다.',
    // Searches per step grow with research skill and search mastery.
    spec: (character) => ({
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: Math.min(10, 1 + Math.ceil(character.skills.research.level / 2) + Math.floor(masteryLevel(character, 'web_search') / 2)),
    }),
  },
  files: {
    name: '작업 폴더',
    emoji: '🗂️',
    kind: 'client',
    family: 'files',
    charLevel: 1,
    skills: [],
    desc: '자기 작업 폴더(또는 맡겨 준 폴더)에서 파일을 읽고 만들고 고친다. 결과 파일을 남긴다.',
    prompt: '파일 편집 도구(str_replace_based_edit_tool)로 작업 폴더의 파일을 보고, 만들고, 고칠 수 있다. 결과물이 문서·데이터·코드라면 파일로도 저장한다.',
  },
  shell: {
    name: '터미널',
    emoji: '⌨️',
    kind: 'client',
    family: 'files',
    skills: ['coding', 'analysis'],
    level: 3,
    desc: '작업 폴더에서 명령을 실행해 파일 정리·데이터 처리·스크립트 실행을 한다.',
    prompt: 'bash 도구로 작업 폴더에서 명령을 실행할 수 있다. 파괴적인 명령(지우기·덮어쓰기)은 꼭 필요할 때만, 범위를 좁혀서 쓴다.',
  },
  browser: {
    name: '전용 브라우저',
    emoji: '🧭',
    kind: 'client',
    family: 'screen',
    charLevel: 2,
    skills: ['research', 'planning'],
    level: 2,
    desc: '내 브라우저와 분리된 전용 브라우저로 사이트를 열고, 보고, 클릭하고, 입력한다.',
    prompt: '전용 브라우저(1280×800 화면)를 쓸 수 있다. browser_open으로 주소를 열고, read_page로 본문을 읽고, 화면 조작 도구(screenshot, left_click, type, key, scroll 등)로 사이트를 다룬다.',
  },
  desktop: {
    name: '내 컴퓨터 조작',
    emoji: '🖥️',
    kind: 'client',
    family: 'screen',
    charLevel: 3,
    skills: [],
    desc: '사용자의 실제 화면을 보고 마우스·키보드로 앱을 다룬다. 설정에서 직접 켜야 쓸 수 있다.',
    prompt: '사용자의 실제 컴퓨터 화면을 조작할 수 있다(screenshot, left_click, type, key, scroll 등). 실제 사용자의 컴퓨터이므로 한 단계씩 확인하며 신중하게 움직인다.',
  },
  code_execution: {
    name: '클라우드 코드 실행',
    emoji: '🧪',
    kind: 'server',
    family: 'code',
    skills: ['coding', 'analysis'],
    level: 5,
    desc: '격리된 클라우드 환경에서 코드를 돌려 계산·검증·데이터 분석을 한다.',
    prompt: '코드 실행 도구(격리된 파이썬 환경, 인터넷 없음)를 쓸 수 있다. 계산·데이터 처리·코드 동작은 직접 실행해 확인하고 결과를 근거로 쓴다.',
    spec: () => ({ type: 'code_execution_20260120', name: 'code_execution' }),
  },
};
export const TOOL_IDS = Object.keys(TOOLS);

// ---- unlocks ------------------------------------------------------------------

export function hasTool(character, id) {
  const tool = TOOLS[id];
  if (!tool) return false;
  if (tool.charLevel && character.level >= tool.charLevel) return true;
  return tool.skills.some((skill) => (character.skills[skill]?.level ?? 0) >= (tool.level ?? Infinity));
}

export const unlockedTools = (character) => TOOL_IDS.filter((id) => hasTool(character, id));

// The tool a skill-up just unlocked, if any (a level or another skill may have
// unlocked it earlier, in which case nothing new happens).
export function toolUnlockedBy(character, skillId, level) {
  return TOOL_IDS.find((id) => {
    const tool = TOOLS[id];
    if (!tool.skills.includes(skillId) || level !== tool.level) return false;
    if (tool.charLevel && character.level >= tool.charLevel) return false;
    return !tool.skills.some((other) => other !== skillId && (character.skills[other]?.level ?? 0) >= tool.level);
  }) ?? null;
}

// Tools a character level-up just unlocked.
export function toolsUnlockedByLevel(character, level) {
  return TOOL_IDS.filter((id) => {
    const tool = TOOLS[id];
    if (tool.charLevel !== level || level <= 1) return false;
    return !tool.skills.some((skill) => (character.skills[skill]?.level ?? 0) >= (tool.level ?? Infinity));
  });
}

export function unlockText(tool, skills) {
  const parts = [];
  if (tool.charLevel) parts.push(tool.charLevel <= 1 ? '처음부터' : `캐릭터 Lv${tool.charLevel}`);
  if (tool.skills.length && tool.level) parts.push(`${tool.skills.map((id) => skills[id]?.name ?? id).join('·')} Lv${tool.level}`);
  return parts.join(' 또는 ');
}

// ---- mastery ------------------------------------------------------------------

// Uses needed to reach each mastery level (index = level). Lv1 on unlock.
export const MASTERY_STEPS = [0, 0, 8, 25, 60, 130];
export const MASTERY_MAX = 5;
// How many screen actions / commands one task may use, by mastery level.
export const ACTION_BUDGET = { browser: [0, 25, 35, 50, 70, 100], desktop: [0, 15, 25, 35, 50, 70], shell: [0, 12, 18, 28, 40, 60], files: [0, 20, 30, 40, 60, 80] };
export const MASTERY_PERKS = {
  2: '한 업무에 더 많이 조작할 수 있다',
  3: '익숙해져 실수가 줄었다',
  4: '손에 완전히 익었다',
  5: '이 도구의 달인',
};

export function masteryLevel(character, id) {
  const uses = character.toolMastery?.[id] ?? 0;
  if (!hasTool(character, id)) return 0;
  let level = 1;
  while (level < MASTERY_MAX && uses >= MASTERY_STEPS[level + 1]) level += 1;
  return level;
}

export function actionBudget(character, id) {
  const table = ACTION_BUDGET[id];
  return table ? table[Math.max(1, masteryLevel(character, id))] : Infinity;
}

// Adds uses; returns the new level when it went up.
export function addMastery(character, id, uses = 1) {
  const before = masteryLevel(character, id);
  character.toolMastery ??= {};
  character.toolMastery[id] = (character.toolMastery[id] ?? 0) + uses;
  const after = masteryLevel(character, id);
  return after > before ? after : null;
}

// ---- choosing equipment for a task -----------------------------------------------

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;
export const urlsIn = (text) => [...new Set(String(text ?? '').match(URL_PATTERN) ?? [])].map((url) => url.replace(/[.,;:!?]+$/, ''));

const WANTS = {
  browser: /브라우저|사이트|홈페이지|웹페이지|페이지에\s*(들어|접속)|접속해|클릭|로그인 화면|양식|폼(을|에)|장바구니|예약 (페이지|사이트)|스크린샷|화면(을|에서) (보고|캡처)|browser|website/i,
  desktop: /내 컴퓨터|내 맥|데스크톱|바탕\s*화면|파인더|finder|시스템 설정|앱을? (열|실행|켜)|프로그램을? (열|실행|켜)|내 화면|메일 앱|캘린더 앱|키노트|넘버스|엑셀을? 열|desktop/i,
  files: /파일|폴더|이름을? 바꿔|변환|스크립트|csv|xlsx|json|엑셀|저장해|내보내|코드(를)? (짜|작성|실행)|프로그램(을)? (짜|만들)|자동화|일괄/i,
};

export const EQUIPMENT = {
  auto: { name: '자동', emoji: '✨' },
  web: { name: '웹 조사', emoji: '🌐' },
  browser: { name: '전용 브라우저', emoji: '🧭' },
  files: { name: '파일·터미널', emoji: '🗂️' },
  desktop: { name: '내 컴퓨터', emoji: '🖥️' },
  none: { name: '도구 없이', emoji: '✍️' },
};

// Settings switch whole families: tools (all), browser, shell, desktop.
function allowed(character, id, settings) {
  if (settings.tools === false || !hasTool(character, id)) return false;
  if (id === 'browser') return settings.browser !== false;
  if (id === 'shell') return settings.shell !== false;
  if (id === 'desktop') return settings.desktop === true;
  return true;
}

// What this character brings to this task. `screen` is the one computer
// toolset target (they cannot share a request); `workspace` means the files
// tools are on. Cloud code is only used when nothing else executes code,
// because a second execution environment beside the 2026 web tools (which
// filter results with their own sandbox) confuses the model.
export function planEquipment(character, task, settings = {}, { agentic = true } = {}) {
  const want = task.equipment && EQUIPMENT[task.equipment] ? task.equipment : 'auto';
  const ids = new Set();
  const has = (id) => allowed(character, id, settings);
  if (want === 'none' || settings.tools === false) return finish([], null);
  const text = `${task.title} ${task.prompt}`;
  const urls = urlsIn(text);
  const research = ['research', 'planning', 'marketing'].includes(task.category);
  let screen = null;
  if (agentic) {
    if (want === 'desktop' || (want === 'auto' && WANTS.desktop.test(text))) screen = has('desktop') ? 'desktop' : null;
    if (!screen && (want === 'browser' || (want === 'auto' && (WANTS.browser.test(text) || (urls.length && !research))))) screen = has('browser') ? 'browser' : null;
    if (screen) ids.add(screen);
    const fileWork = want === 'files' || Boolean(task.folder) || (want === 'auto' && WANTS.files.test(text)) || (want === 'auto' && ['coding', 'analysis'].includes(task.category) && has('shell'));
    if (fileWork && has('files')) {
      ids.add('files');
      if (has('shell')) ids.add('shell');
    }
  }
  // Coding and analysis run code first (in the cloud sandbox) when nothing
  // local does and no page needs reading.
  const codeFirst = ['coding', 'analysis'].includes(task.category) && has('code_execution') && !ids.has('shell') && !urls.length && want !== 'web' && !screen;
  if (codeFirst) ids.add('code_execution');
  else {
    if ((urls.length || want === 'web' || research || screen === 'browser') && has('web_fetch')) ids.add('web_fetch');
    if ((want === 'web' || research || screen === 'browser' || (want === 'auto' && !ids.size)) && has('web_search')) ids.add('web_search');
  }
  return finish([...ids], screen);

  function finish(list, target) {
    return { ids: list, screen: target, workspace: list.includes('files'), want };
  }
}

// Server-tool definitions for the request.
export function serverSpecs(character, ids) {
  return ids.filter((id) => TOOLS[id]?.kind === 'server').map((id) => TOOLS[id].spec(character));
}

// Kept for the team pipeline: members work in parallel, so they bring only
// server tools (no shared screens or folders).
export function toolsForStep(character, category, { enabled = true, settings = {} } = {}) {
  if (!enabled) return [];
  return planEquipment(character, { title: '', prompt: '', category }, { ...settings, tools: true }, { agentic: false }).ids;
}

export function toolPublic(tool) {
  const { spec, ...rest } = tool;
  return rest;
}
