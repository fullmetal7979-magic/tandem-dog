// AgentVille browser client: state store, SSE wiring and panel renderers.
import { portrait } from './avatar.js';
import { esc, renderMarkdown } from './markdown.js';
import { TownView } from './town.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const store = {
  catalog: null,
  characters: new Map(),
  tasks: new Map(),
  taskOrder: [],
  chronicle: [],
  chats: {},
  clock: { minute: 0, speed: 1, paused: false },
  settings: {},
  brain: {},
  selected: null,
  tab: 'character',
  openTask: null,
  openSteps: new Set(),
  chatTarget: null,
  chatStream: '',
  chatBusy: false,
  memoryTab: 'recent',
  assignees: new Set(),
  draftRating: {},
};
let town = null;

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `요청 실패 (${response.status})`);
  return data;
}

// ---------- helpers ----------------------------------------------------------

function fmtClock(minute) {
  const total = Math.max(0, Math.floor(minute ?? 0));
  const day = Math.floor(total / 1440) + 1;
  const ofDay = total % 1440;
  return `${day}일차 ${String(Math.floor(ofDay / 60)).padStart(2, '0')}:${String(ofDay % 60).padStart(2, '0')}`;
}
const pct = (value, max) => `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100)).toFixed(1)}%`;
const moodOf = (c) => c.derived?.mood ?? { value: 60, emoji: '🙂', label: '좋음' };
const img = (c, size = 64, cls = '') => `<img class="${cls}" src="${portrait(c.appearance, moodOf(c).value, size)}" alt="">`;
const EFFORT = { low: '가볍게', medium: '보통', high: '깊게', xhigh: '아주 깊게', max: '최대' };

function activityLabel(c) {
  const id = c.state?.activity;
  const { activities, states } = store.catalog;
  if (c.state?.taskId) return id === 'meeting' ? '🧠 팀 숙고 중' : '💼 업무 중';
  if (activities[id]) return `${activities[id].emoji} ${activities[id].name}`;
  if (states[id]) return `${states[id].emoji} ${states[id].name}`;
  return '🙂 쉬는 중';
}

function toast({ emoji = '✨', text }) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="emoji">${esc(emoji)}</span><span>${esc(text)}</span>`;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), 6000);
}

function fail(error) {
  toast({ emoji: '⚠️', text: error.message ?? String(error) });
}

function radar(attributes) {
  const ids = Object.keys(store.catalog.attributes);
  const size = 200;
  const center = size / 2;
  const radius = 72;
  const point = (index, value) => {
    const angle = (Math.PI * 2 * index) / ids.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius * value, center + Math.sin(angle) * radius * value];
  };
  const ring = (value) => ids.map((_, index) => point(index, value).join(',')).join(' ');
  const shape = ids.map((id, index) => point(index, Math.min(1, attributes[id] / 100)).join(',')).join(' ');
  const labels = ids.map((id, index) => {
    const [x, y] = point(index, 1.28);
    const attr = store.catalog.attributes[id];
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="currentColor">${attr.emoji}${attr.name} ${Math.round(attributes[id])}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="-46 -4 ${size + 92} ${size + 8}" role="img" aria-label="능력치">
    ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${ring(v)}" fill="none" stroke="currentColor" stroke-opacity="0.15"/>`).join('')}
    <polygon points="${shape}" fill="#5b6cff" fill-opacity="0.28" stroke="#5b6cff" stroke-width="2"/>
    ${labels}
  </svg>`;
}

// ---------- top bar ----------------------------------------------------------

function renderClock() {
  const night = (() => { const h = Math.floor((store.clock.minute % 1440) / 60); return h >= 22 || h < 7; })();
  $('#clock').textContent = `${night ? '🌙' : '☀️'} ${fmtClock(store.clock.minute)}`;
  for (const button of $$('.speed button')) {
    const speed = Number(button.dataset.speed);
    button.classList.toggle('active', store.clock.paused ? speed === 0 : speed === store.clock.speed);
  }
}

function renderBrain() {
  const el = $('#brain');
  const live = store.brain.live;
  el.className = `brain ${live ? 'live' : 'sim'}`;
  el.textContent = live ? `🧠 Claude · ${store.brain.model}` : '🧪 시뮬레이션 두뇌';
  el.title = live ? '실제 Claude 모델로 일합니다.' : 'ANTHROPIC_API_KEY를 설정하고 서버를 다시 시작하면 Claude로 일합니다.';
}

// ---------- roster -------------------------------------------------------------

function renderRoster() {
  const html = [...store.characters.values()].map((c) => `
    <button class="roster-card ${store.selected === c.id ? 'selected' : ''}" data-action="select" data-id="${c.id}">
      ${img(c, 40)}
      <span class="meta"><strong>${esc(c.name)} <small>Lv${c.level}</small></strong><small>${moodOf(c).emoji} ${esc(activityLabel(c))}</small></span>
    </button>`).join('');
  const next = `${html}<button class="roster-add" data-action="open-create">＋ 새 캐릭터</button>`;
  // Re-rendering on every timer tick would steal keyboard focus; only swap on change.
  if (next !== lastRoster) $('#roster').innerHTML = lastRoster = next;
}
let lastRoster = '';

// ---------- character sheet ---------------------------------------------------

function needRows(c) {
  return Object.entries(store.catalog.needs).map(([id, need]) => {
    const value = c.needs[id];
    const level = value < 25 ? 'low' : value < 50 ? 'mid' : '';
    return `<div class="need-row ${level}" data-need="${id}"><span>${need.emoji} ${need.name}</span><div class="bar"><i style="width:${pct(value, 100)}"></i></div><span class="num">${Math.round(value)}</span></div>`;
  }).join('');
}

function pipelineBadges(level) {
  const items = [[2, '🧭 계획'], [4, '🔍 자기 검토'], [6, '🧠 기억 확장'], [8, '📏 기준표'], [10, '🏆 장인']];
  return `<div class="pipeline">${items.map(([need, label]) => `<span class="pill ${level >= need ? 'accent' : 'off'}" title="Lv${need}에 해금">${label}</span>`).join('')}</div>`;
}

function renderCharacterPanel() {
  const panel = $('#panel-character');
  const c = store.characters.get(store.selected);
  const scroll = panel.scrollTop;
  if (!c) {
    panel.innerHTML = store.characters.size
      ? `<div class="empty"><div class="big">👆</div>마을이나 아래 목록에서 캐릭터를 눌러 보세요.</div>`
      : `<div class="empty"><div class="big">🏡</div>아직 주민이 없어요.<br><br><button class="primary" data-action="open-create">첫 캐릭터 만들기</button></div>`;
    return;
  }
  const { catalog } = store;
  const role = catalog.roles[c.role];
  const mood = moodOf(c);
  const skills = Object.entries(c.skills).sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp);
  const bestSkill = skills[0];
  const owned = new Set(c.traits.map((t) => t.id));
  const locked = Object.entries(catalog.traits).filter(([id, t]) => t.kind === 'earned' && !owned.has(id));
  const asp = catalog.aspirations[c.aspiration.id];
  const relations = Object.entries(c.relationships).filter(([id]) => store.characters.has(id)).sort((a, b) => b[1].friendship - a[1].friendship);
  const memories = store.memoryTab === 'recent' ? c.memory.recent : c.memory.reflections;
  const relLabel = (f) => (f >= 75 ? '💖 단짝' : f >= 40 ? '😊 친구' : f >= 10 ? '🙂 아는 사이' : f > -30 ? '😶 서먹함' : '😤 앙숙');

  panel.innerHTML = `
    <div class="sheet-head">
      ${img(c, 96)}
      <div style="min-width:0">
        <h2>${esc(c.name)} <span class="pill accent">Lv ${c.level}</span></h2>
        <div class="sub">${role.emoji} ${role.name} · ${esc(catalog.speech[c.speech]?.name ?? '')} · 마을 ${c.derived.age + 1}일차</div>
        <div class="pills">
          <span class="pill" title="기분">${mood.emoji} ${mood.label} ${mood.value}</span>
          <span class="pill gold" title="레벨이 오를수록 Claude가 더 깊게 생각합니다">🧠 사고 깊이 ${EFFORT[c.derived.effort]}</span>
          <span class="pill">${esc(activityLabel(c))}</span>
        </div>
      </div>
    </div>
    <div style="margin-top:12px"><div class="bar xp"><i style="width:${pct(c.xp, c.derived.xpToNext)}"></i></div>
      <div class="num" style="text-align:left;margin-top:3px">경험치 ${c.xp} / ${c.derived.xpToNext} · 누적 ${c.totalXp}</div></div>
    <p style="margin:10px 0 0;color:var(--muted);font-size:13px">${esc(c.bio)}${c.catchphrase ? ` <em>“${esc(c.catchphrase)}”</em>` : ''}</p>

    <div class="card"><h3>욕구 <span>${c.moodlets.length ? '' : '<small>무들렛 없음</small>'}</span></h3>
      <div id="need-rows">${needRows(c)}</div>
      ${c.moodlets.length ? `<div class="chips" style="margin-top:8px">${c.moodlets.map((m) => `<span class="chip" title="${m.value > 0 ? '+' : ''}${m.value}">${m.emoji} ${esc(m.label)} <small>${m.value > 0 ? '+' : ''}${m.value}</small></span>`).join('')}</div>` : ''}
    </div>

    <div class="card"><h3>능력치 <span><small>레벨업마다 +3</small></span></h3>${radar(c.attributes)}</div>
    <div class="card"><h3>성격 Big Five</h3>
      ${Object.entries(catalog.bigFive).map(([id, b]) => `<div class="b5-row" title="${esc(c.bigFive[id] >= 50 ? b.high : b.low)}"><span>${b.name}</span><div class="bar"><i style="width:${pct(c.bigFive[id], 100)}"></i></div><span class="num">${Math.round(c.bigFive[id])}</span></div>`).join('')}
      <small style="color:var(--muted)">일을 하고 대화할수록 조금씩 변해요.</small>
    </div>

    <div class="card"><h3>스킬 <span class="pill">최고: ${catalog.skills[bestSkill[0]].emoji} ${catalog.skills[bestSkill[0]].name}</span></h3>
      ${skills.map(([id, s]) => {
        const def = catalog.skills[id];
        const next = c.derived.skills[id].next;
        return `<div class="skill-row ${s.level === 0 ? 'zero' : ''}"><span>${def.emoji} ${def.name}</span><span class="lv">Lv${s.level}</span><div class="bar"><i style="width:${s.level >= 10 ? '100%' : pct(s.xp, c.derived.skills[id].xpToNext)}"></i></div>
          ${next && s.level > 0 ? `<div class="skill-next">다음 노하우(Lv${next.level}): ${esc(next.text)}</div>` : ''}</div>`;
      }).join('')}
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">${catalog.skills[bestSkill[0]].name} 업무에서 열린 작업 단계</div>
      ${pipelineBadges(bestSkill[1].level)}
    </div>

    <div class="card"><h3>특성 <span>${c.traits.length}개</span></h3>
      <div class="chips">${c.traits.map((t) => {
        const def = catalog.traits[t.id];
        return def ? `<span class="chip ${def.kind === 'earned' ? 'earned' : ''}" title="${esc(def.desc)} — ${esc(def.prompt)}">${def.emoji} ${esc(def.name)}</span>` : '';
      }).join('')}</div>
      ${c.flags?.traitHint && catalog.traits[c.flags.traitHint] ? `<p style="font-size:12.5px;color:var(--muted);margin:8px 0 0">🌱 성찰해 보니 <strong>${esc(catalog.traits[c.flags.traitHint].name)}</strong> 쪽으로 자라는 중 (${esc(catalog.traits[c.flags.traitHint].hint)})</p>` : ''}
      <details style="margin-top:8px"><summary style="cursor:pointer;font-size:12.5px;color:var(--muted)">얻을 수 있는 특성 ${locked.length}개</summary>
        <div class="chips" style="margin-top:8px">${locked.map(([, t]) => `<span class="chip locked" title="${esc(t.desc)}">${t.emoji} ${esc(t.name)} <small>· ${esc(t.hint)}</small></span>`).join('')}</div>
      </details>
    </div>

    <div class="card"><h3>꿈 <span>${asp.emoji} ${esc(asp.name)}</span></h3>
      <div class="bar xp"><i style="width:${pct(c.aspiration.stage, asp.stages.length)}"></i></div>
      <div style="font-size:13px;margin-top:6px">${c.aspiration.done ? '🏅 꿈을 이뤘어요!' : `다음 단계 (${c.aspiration.stage + 1}/${asp.stages.length}): ${esc(c.derived.aspiration.next ?? '')}`}</div>
    </div>

    <div class="card"><h3>성격 메모 <span><small>성찰로 생겨요</small></span></h3>
      ${c.quirks.length ? c.quirks.slice().reverse().map((q) => `<div class="quirk">🪞 ${esc(q.text)}</div>`).join('') : '<div style="color:var(--muted);font-size:13px">아직 없어요. 경험이 쌓이면 스스로 돌아보며 성격 메모를 남겨요.</div>'}
    </div>

    <div class="card"><h3>관계</h3>
      <div class="rel-row"><span>🧑</span><div><div style="font-size:12.5px">나(사용자)와의 호감도</div><div class="bar"><i style="width:${pct(c.userBond.affinity, 100)}"></i></div></div><span class="num">${Math.round(c.userBond.affinity)}</span></div>
      ${relations.map(([id, rel]) => {
        const other = store.characters.get(id);
        return `<div class="rel-row">${img(other, 28)}<div><div style="font-size:12.5px">${esc(other.name)} · ${relLabel(rel.friendship)}</div><div class="bar"><i style="width:${pct(rel.friendship + 100, 200)}"></i></div></div><span class="num">${Math.round(rel.friendship)}</span></div>`;
      }).join('') || '<div style="color:var(--muted);font-size:13px;margin-top:6px">아직 동료와 친해질 기회가 없었어요.</div>'}
    </div>

    <div class="card"><h3>기억 <span>${c.memory.count}개 · 성찰까지 ${Math.max(0, 60 - c.memory.sinceReflection)}</span></h3>
      <div class="subtabs"><button class="${store.memoryTab === 'recent' ? 'active' : ''}" data-action="memtab" data-tab="recent">최근 기억</button><button class="${store.memoryTab === 'deep' ? 'active' : ''}" data-action="memtab" data-tab="deep">성찰·선호</button></div>
      ${memories.length ? memories.slice(0, 25).map((m) => `<div class="memory"><span>${store.catalog.memoryKinds[m.kind]?.emoji ?? '•'}</span><span>${esc(m.text)}</span><span class="imp">${fmtClock(m.minute).split(' ')[1]} · ★${m.importance}</span></div>`).join('') : '<div style="color:var(--muted);font-size:13px">아직 없어요.</div>'}
    </div>

    <div class="actions">
      <button class="primary" data-action="chat-with" data-id="${c.id}">💬 대화하기</button>
      <button data-action="assign-to" data-id="${c.id}">📋 업무 맡기기</button>
      <button data-action="export" data-id="${c.id}">📦 카드 내보내기</button>
      <button class="danger" data-action="retire" data-id="${c.id}">👋 떠나보내기</button>
    </div>`;
  panel.scrollTop = scroll;
}

function refreshNeeds() {
  const c = store.characters.get(store.selected);
  const rows = $('#need-rows');
  if (c && rows && store.tab === 'character') rows.innerHTML = needRows(c);
}

// ---------- tasks ---------------------------------------------------------------

function initTaskForm() {
  const select = $('#task-category');
  for (const [id, skill] of Object.entries(store.catalog.skills)) select.insertAdjacentHTML('beforeend', `<option value="${id}">${skill.emoji} ${skill.name}</option>`);
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(updatePreview, 350); };
  for (const id of ['#task-prompt', '#task-category', '#task-difficulty', '#task-mode']) $(id).addEventListener('input', schedule);
  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#task-form button[type=submit]');
    button.disabled = true;
    try {
      const task = await api('POST', '/api/tasks', taskInput());
      upsertTask(task);
      store.openTask = task.id;
      $('#task-prompt').value = '';
      store.assignees.clear();
      renderAssigneePicker();
      renderTasks();
      updatePreview();
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  });
}

function taskInput() {
  return {
    prompt: $('#task-prompt').value,
    category: $('#task-category').value || undefined,
    difficulty: $('#task-difficulty').value || undefined,
    mode: $('#task-mode').value,
    assignees: [...store.assignees],
  };
}

async function updatePreview() {
  const box = $('#task-preview');
  const input = taskInput();
  if (!input.prompt.trim()) {
    box.textContent = '업무 내용을 쓰면 적임자를 추천해 드려요.';
    return;
  }
  try {
    const preview = await api('POST', '/api/tasks/preview', input);
    const skill = store.catalog.skills[preview.category];
    const names = preview.assignees.map((id) => store.characters.get(id)?.name).filter(Boolean);
    const top = preview.ranking.find((entry) => entry.id === preview.lead);
    box.innerHTML = names.length
      ? `${preview.mode === 'team' ? '🧠 팀 숙고' : '👤 혼자'} · ${skill.emoji} ${skill.name} · ${'★'.repeat(preview.difficulty)}<br>추천: <strong>${names.map(esc).join(', ')}</strong>${top ? ` — ${top.reasons.map(esc).join(' · ')}` : ''}`
      : '지금은 맡을 수 있는 캐릭터가 없어요.';
  } catch (error) {
    box.textContent = error.message;
  }
}

function renderAssigneePicker() {
  $('#assignee-picker').innerHTML = [...store.characters.values()].map((c) => `
    <button type="button" class="${store.assignees.has(c.id) ? 'on' : ''}" data-action="pick-assignee" data-id="${c.id}" title="직접 지정 (비워 두면 자동)">${img(c, 24)} ${esc(c.name)}${c.state?.taskId ? ' 💼' : ''}</button>`).join('');
}

function upsertTask(task) {
  if (!store.tasks.has(task.id)) store.taskOrder.unshift(task.id);
  store.tasks.set(task.id, task);
}

function stepIcon(step) {
  if (step.status === 'running') return '<span class="spinner"></span>';
  if (step.status === 'error') return '❌';
  return '✅';
}

function renderTaskCard(task) {
  const { catalog } = store;
  const skill = catalog.skills[task.category];
  const people = task.assignees.map((id) => store.characters.get(id)).filter(Boolean);
  const open = store.openTask === task.id;
  const statusText = { queued: '대기', working: '진행 중', done: '완료', error: '오류' }[task.status];
  const lead = store.characters.get(task.lead) ?? people[0];
  let body = '';
  if (open) {
    const steps = task.steps.map((step) => {
      const who = store.characters.get(step.charId);
      const expanded = step.status === 'running' || store.openSteps.has(step.id);
      return `<li><details class="step" data-step="${step.id}" ${expanded ? 'open' : ''}><summary>${stepIcon(step)} ${esc(step.label)} ${who && people.length > 1 ? `<small>· ${esc(who.name)}</small>` : ''}${step.effort ? `<span class="effort">🧠 ${EFFORT[step.effort] ?? step.effort}</span>` : ''}</summary><pre id="step-text-${step.id}">${esc(step.text)}</pre></details></li>`;
    }).join('');
    const rewards = Object.entries(task.rewards ?? {}).map(([id, reward]) => {
      const c = store.characters.get(id);
      return c ? `<span class="pill gold">${esc(c.name)} +${reward.xp}XP${reward.bonus ? ` (+${reward.bonus} 칭찬)` : ''}</span>` : '';
    }).join('');
    const draft = store.draftRating[task.id] ?? task.rating ?? 0;
    body = `<div class="task-body">
      <div class="pills" style="margin-top:10px"><span class="pill">${skill.emoji} ${skill.name}</span><span class="pill">${'★'.repeat(task.difficulty)}</span><span class="pill">${task.mode === 'team' ? '🧠 팀 숙고' : '👤 혼자'}</span>${task.quality != null ? `<span class="pill accent">품질 ${Math.round(task.quality * 100)}</span>` : ''}</div>
      <p style="font-size:13px;color:var(--muted);white-space:pre-wrap;margin:10px 0 0">${esc(task.prompt)}</p>
      <ol class="steps">${steps}</ol>
      ${task.status === 'done' ? `
        <div class="output">${renderMarkdown(task.output)}</div>
        ${task.comment && lead ? `<div class="comment">${img(lead, 28)}<span><strong>${esc(lead.name)}</strong> ${esc(task.comment)}</span></div>` : ''}
        <div class="rewards">${rewards}</div>
        <div class="rating">
          <div style="font-size:13px;font-weight:600">${task.rating ? `내 평가: ${'⭐'.repeat(task.rating)}${task.feedback ? ` “${esc(task.feedback)}”` : ''}` : '결과가 어땠나요? 평가는 캐릭터의 기분·성장·기억에 남아요.'}</div>
          <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= draft ? 'on' : ''}" data-action="star" data-id="${task.id}" data-value="${n}" aria-label="${n}점">★</button>`).join('')}</div>
          <div class="inline"><input id="fb-${task.id}" maxlength="400" placeholder="한마디 (예: 표로 정리해 줘서 좋았어, 앞으로도 표로!)"><button class="primary" data-action="rate" data-id="${task.id}">평가 보내기</button></div>
        </div>` : ''}
      ${task.status === 'error' ? `<div class="error-box">⚠️ ${esc(task.error)}</div><div class="actions"><button data-action="retry" data-id="${task.id}">🔁 다시 시도</button></div>` : ''}
    </div>`;
  }
  return `<article class="task" id="task-${task.id}">
    <button class="task-head" data-action="toggle-task" data-id="${task.id}">
      <span class="avatars">${people.map((c) => img(c, 24)).join('')}</span>
      <span class="title">${esc(task.title)}</span>
      <span class="status ${task.status}">${task.status === 'working' ? '<span class="spinner" style="width:9px;height:9px"></span> ' : ''}${statusText}</span>
    </button>${body}</article>`;
}

function renderTasks() {
  const list = $('#task-list');
  const tasks = store.taskOrder.map((id) => store.tasks.get(id)).filter(Boolean);
  list.innerHTML = tasks.length ? tasks.map(renderTaskCard).join('') : '<div class="empty"><div class="big">📋</div>첫 업무를 맡겨 보세요. 일할수록 캐릭터가 자라요.</div>';
  const working = tasks.filter((task) => task.status === 'working').length;
  const badge = $('#tasks-badge');
  badge.hidden = !working;
  badge.textContent = working;
}

function rerenderTask(task) {
  const el = document.getElementById(`task-${task.id}`);
  if (!el) return renderTasks();
  el.outerHTML = renderTaskCard(task);
  const working = [...store.tasks.values()].filter((t) => t.status === 'working').length;
  $('#tasks-badge').hidden = !working;
  $('#tasks-badge').textContent = working;
}

// ---------- chat -------------------------------------------------------------------

function renderChat() {
  if (!store.chatTarget || !store.characters.has(store.chatTarget)) store.chatTarget = store.selected ?? store.characters.keys().next().value ?? null;
  $('#chat-targets').innerHTML = [...store.characters.values()].map((c) => `<button class="${store.chatTarget === c.id ? 'on' : ''}" data-action="chat-target" data-id="${c.id}">${img(c, 26)} ${esc(c.name)}</button>`).join('');
  const c = store.characters.get(store.chatTarget);
  const log = $('#chat-log');
  if (!c) {
    log.innerHTML = '<div class="empty">대화할 캐릭터가 없어요.</div>';
    return;
  }
  const history = store.chats[c.id] ?? [];
  const lines = history.map((line) => line.role === 'user'
    ? `<div class="msg user"><div class="text">${esc(line.text)}</div></div>`
    : `<div class="msg">${img(c, 30)}<div class="text">${esc(line.text)}</div></div>`);
  if (store.chatBusy && store.chatStreamTarget === c.id) lines.push(`<div class="msg">${img(c, 30)}<div class="text" id="chat-stream">${esc(store.chatStream) || '<span class="spinner"></span>'}</div></div>`);
  log.innerHTML = lines.join('') || `<div class="empty"><div class="big">💬</div>${esc(c.name)}에게 말을 걸어 보세요.<br><small>대화는 기억으로 남고, 좋아하는 것을 말해 주면 다음 업무에 반영해요.</small></div>`;
  log.scrollTop = log.scrollHeight;
  $('#chat-input').placeholder = `${c.name}에게 말 걸기…`;
}

async function sendChat(event) {
  event.preventDefault();
  const input = $('#chat-input');
  const message = input.value.trim();
  if (!message || store.chatBusy || !store.chatTarget) return;
  store.chatBusy = true;
  store.chatStream = '';
  store.chatStreamTarget = store.chatTarget;
  input.value = '';
  renderChat();
  const target = store.chatTarget;
  try {
    await api('POST', `/api/chat/${target}`, { message });
  } catch (error) {
    // The server drops the user's line when the reply fails; mirror that.
    const history = store.chats[target] ?? [];
    if (history.at(-1)?.role === 'user' && history.at(-1).text === message) history.pop();
    input.value = message;
    fail(error);
  } finally {
    store.chatBusy = false;
    store.chatStream = '';
    renderChat();
  }
}

// ---------- chronicle ---------------------------------------------------------------

function renderChronicle() {
  const onlySelected = $('#chronicle-filter').checked && store.selected;
  const entries = store.chronicle.slice().reverse().filter((entry) => !onlySelected || entry.charId === store.selected);
  $('#chronicle').innerHTML = entries.map((entry) => `<li><span>${esc(entry.emoji)}</span><span>${esc(entry.text)}<time>${fmtClock(entry.minute)}</time></span></li>`).join('') || '<div class="empty">아직 기록이 없어요.</div>';
}

// ---------- create dialog -------------------------------------------------------------

const draft = { role: 'researcher', traits: new Set(), bigFive: {} };

function initCreateDialog() {
  const { catalog } = store;
  $('#c-speech').innerHTML = Object.entries(catalog.speech).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join('');
  $('#c-aspiration').innerHTML = Object.entries(catalog.aspirations).map(([id, a]) => `<option value="${id}">${a.emoji} ${a.name} — ${a.desc}</option>`).join('');
  $('#c-roles').innerHTML = Object.entries(catalog.roles).map(([id, r]) => `<button type="button" data-role="${id}"><span class="e">${r.emoji}</span>${r.name}</button>`).join('');
  $('#c-traits').innerHTML = Object.entries(catalog.traits).filter(([, t]) => t.kind === 'start').map(([id, t]) => `<button type="button" data-trait="${id}" title="${esc(t.desc)}">${t.emoji} ${t.name}</button>`).join('');
  $('#c-bigfive').innerHTML = Object.entries(catalog.bigFive).map(([id, b]) => `<label>${b.name}<input type="range" min="0" max="100" data-b5="${id}"><span class="num" data-b5v="${id}"></span></label>`).join('');

  $('#c-roles').addEventListener('click', (event) => {
    const button = event.target.closest('[data-role]');
    if (button) applyRole(button.dataset.role);
  });
  $('#c-traits').addEventListener('click', (event) => {
    const button = event.target.closest('[data-trait]');
    if (!button) return;
    const id = button.dataset.trait;
    if (draft.traits.has(id)) draft.traits.delete(id);
    else {
      const opposite = catalog.traits[id].opposite ?? [];
      const clash = opposite.find((other) => draft.traits.has(other));
      if (clash) return toast({ emoji: '🙅', text: `${catalog.traits[id].name}과(와) ${catalog.traits[clash].name}은(는) 함께 가질 수 없어요.` });
      if (draft.traits.size >= 3) return toast({ emoji: '✋', text: '시작 특성은 3개까지예요.' });
      draft.traits.add(id);
    }
    paintDraft();
  });
  $('#c-bigfive').addEventListener('input', (event) => {
    const id = event.target.dataset.b5;
    if (id) { draft.bigFive[id] = Number(event.target.value); paintDraft(); }
  });
  $('#c-random').addEventListener('click', () => { $('#c-name').value = randomName(); });
  $('#gen-button').addEventListener('click', generateDraft);
  $('#c-import').addEventListener('change', importCardFile);
  $('#create-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'create') return;
    event.preventDefault();
    try {
      const created = await api('POST', '/api/characters', {
        name: $('#c-name').value, role: draft.role, speech: $('#c-speech').value, traits: [...draft.traits],
        aspiration: $('#c-aspiration').value, bigFive: draft.bigFive, bio: $('#c-bio').value, catchphrase: $('#c-catch').value,
      });
      store.characters.set(created.id, created);
      town.setCharacter(created);
      $('#create-dialog').close();
      select(created.id);
    } catch (error) {
      fail(error);
    }
  });
}

function applyRole(roleId, { keepTraits = false } = {}) {
  const role = store.catalog.roles[roleId];
  draft.role = roleId;
  if (!keepTraits) draft.traits = new Set(role.traits);
  draft.bigFive = { ...role.bigFive };
  $('#c-aspiration').value = role.aspiration;
  paintDraft();
}

function paintDraft() {
  for (const button of $$('#c-roles [data-role]')) button.classList.toggle('on', button.dataset.role === draft.role);
  for (const button of $$('#c-traits [data-trait]')) button.classList.toggle('on', draft.traits.has(button.dataset.trait));
  for (const input of $$('#c-bigfive [data-b5]')) {
    input.value = draft.bigFive[input.dataset.b5] ?? 50;
    $(`[data-b5v="${input.dataset.b5}"]`).textContent = input.value;
  }
}

// A name nobody in town has yet, so two residents are never confused.
function randomName() {
  const taken = new Set([...store.characters.values()].map((c) => c.name));
  const free = store.catalog.names.filter((name) => !taken.has(name));
  const pool = free.length ? free : store.catalog.names;
  return pool[Math.floor(Math.random() * pool.length)];
}

function openCreate() {
  $('#create-form').reset();
  applyRole('researcher');
  $('#c-name').value = randomName();
  $('#create-dialog').showModal();
}

async function generateDraft() {
  const button = $('#gen-button');
  button.disabled = true;
  button.textContent = '만드는 중…';
  try {
    const result = await api('POST', '/api/characters/generate', { description: $('#gen-description').value });
    draft.role = result.role;
    draft.traits = new Set(result.traits);
    draft.bigFive = { ...store.catalog.roles[result.role].bigFive, ...Object.fromEntries(Object.entries(result.bigFive ?? {}).filter(([, v]) => Number.isFinite(v))) };
    $('#c-name').value = result.name;
    $('#c-speech').value = result.speech;
    $('#c-aspiration').value = result.aspiration;
    $('#c-bio').value = result.bio;
    $('#c-catch').value = result.catchphrase;
    paintDraft();
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
    button.textContent = '설명대로 만들기';
  }
}

async function importCardFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const card = JSON.parse(await file.text());
    const created = await api('POST', '/api/characters/import', card);
    store.characters.set(created.id, created);
    town.setCharacter(created);
    $('#create-dialog').close();
    select(created.id);
  } catch (error) {
    fail(error);
  } finally {
    event.target.value = '';
  }
}

async function exportCard(id) {
  const card = await api('GET', `/api/characters/${id}/card`);
  const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${card.data.name}-agentville-card.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- settings --------------------------------------------------------------------

function renderSettings() {
  const live = store.brain.live;
  $('#settings-body').innerHTML = `
    <label class="setting"><input type="checkbox" data-setting="effortByLevel" ${store.settings.effortByLevel ? 'checked' : ''}>
      <span><strong>레벨에 따라 사고 깊이 올리기</strong><small>Lv1~3 가볍게 · Lv4~6 보통 · Lv7~9 깊게 · Lv10+ 아주 깊게. 끄면 모두 '보통'.</small></span></label>
    <label class="setting"><input type="checkbox" data-setting="llmSmallTalk" ${store.settings.llmSmallTalk ? 'checked' : ''} ${live ? '' : 'disabled'}>
      <span><strong>Claude로 잡담 대사 만들기</strong><small>쉬는 시간 수다를 Claude가 씁니다. 토큰을 계속 쓰므로 기본은 꺼짐.${live ? '' : ' (시뮬레이션 두뇌에서는 사용할 수 없음)'}</small></span></label>
    <dl class="kv">
      <dt>두뇌</dt><dd>${live ? 'Claude (실제 모델)' : '시뮬레이션 (오프라인)'}</dd>
      <dt>모델</dt><dd>${esc(store.brain.model)}</dd>
      <dt>Claude 켜기</dt><dd><code>ANTHROPIC_API_KEY=… npm start</code> (apps/agentville)</dd>
      <dt>모델 바꾸기</dt><dd><code>AGENTVILLE_MODEL</code> 환경 변수</dd>
    </dl>`;
}

// ---------- selection & tabs ---------------------------------------------------------------

function select(id) {
  store.selected = id;
  town.selected = id;
  store.chatTarget = id;
  renderRoster();
  document.querySelector(`.roster-card[data-id="${CSS.escape(id ?? '')}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderCharacterPanel();
  if (store.tab === 'chat') renderChat();
  if (store.tab === 'chronicle') renderChronicle();
}

function showTab(tab) {
  store.tab = tab;
  for (const button of $$('.tabs button')) button.classList.toggle('active', button.dataset.tab === tab);
  for (const panel of $$('.panel')) panel.hidden = panel.id !== `panel-${tab}`;
  if (tab === 'character') renderCharacterPanel();
  if (tab === 'tasks') { renderAssigneePicker(); renderTasks(); }
  if (tab === 'chat') renderChat();
  if (tab === 'chronicle') renderChronicle();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  try {
    switch (action) {
      case 'select': select(id); if (store.tab !== 'character') showTab('character'); break;
      case 'open-create': openCreate(); break;
      case 'chat-with': store.chatTarget = id; showTab('chat'); $('#chat-input').focus(); break;
      case 'chat-target': store.chatTarget = id; renderChat(); break;
      case 'assign-to': store.assignees = new Set([id]); showTab('tasks'); $('#task-prompt').focus(); updatePreview(); break;
      case 'pick-assignee':
        if (store.assignees.has(id)) store.assignees.delete(id); else store.assignees.add(id);
        renderAssigneePicker();
        updatePreview();
        break;
      case 'export': await exportCard(id); break;
      case 'retire': {
        const c = store.characters.get(id);
        if (c && confirm(`${c.name}을(를) 마을에서 떠나보낼까요? 성장 기록이 사라집니다. (카드로 먼저 내보내 둘 수 있어요)`)) {
          await api('DELETE', `/api/characters/${id}`);
        }
        break;
      }
      case 'memtab': store.memoryTab = target.dataset.tab; renderCharacterPanel(); break;
      case 'toggle-task': store.openTask = store.openTask === id ? null : id; renderTasks(); break;
      case 'star': store.draftRating[id] = Number(target.dataset.value); rerenderTask(store.tasks.get(id)); break;
      case 'rate': {
        const rating = store.draftRating[id] ?? store.tasks.get(id)?.rating;
        if (!rating) return toast({ emoji: '⭐', text: '별점을 먼저 골라 주세요.' });
        const task = await api('POST', `/api/tasks/${id}/feedback`, { rating, comment: $(`#fb-${id}`)?.value ?? '' });
        delete store.draftRating[id];
        upsertTask(task);
        rerenderTask(task);
        break;
      }
      case 'retry': upsertTask(await api('POST', `/api/tasks/${id}/retry`)); break;
      default: break;
    }
  } catch (error) {
    fail(error);
  }
});

// Remember which step panels the user opened so live re-renders keep them.
document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.dataset.step) return;
  if (details.open) store.openSteps.add(details.dataset.step);
  else store.openSteps.delete(details.dataset.step);
}, true);

// ---------- live events ------------------------------------------------------------------

function connect() {
  const source = new EventSource('/api/stream');
  let dropped = false;
  source.addEventListener('open', () => {
    if (dropped) loadState().catch(fail);
    dropped = false;
  });
  source.addEventListener('error', () => { dropped = true; });
  source.addEventListener('tick', (event) => {
    const tick = JSON.parse(event.data);
    store.clock = tick.clock;
    for (const entry of tick.characters) {
      const c = store.characters.get(entry.id);
      if (!c) continue;
      c.state = { ...c.state, pos: entry.pos, activity: entry.activity, taskId: entry.taskId, bubble: entry.bubble };
      c.needs = entry.needs;
      c.derived = { ...c.derived, mood: entry.mood };
    }
    town.applyTick(tick);
    renderClock();
  });
  source.addEventListener('character', (event) => {
    const view = JSON.parse(event.data);
    store.characters.set(view.id, view);
    town.setCharacter(view);
    if (view.id === store.selected && store.tab === 'character') renderCharacterPanel();
  });
  source.addEventListener('removed', (event) => {
    const { id } = JSON.parse(event.data);
    store.characters.delete(id);
    town.removeCharacter(id);
    if (store.selected === id) store.selected = null;
    renderRoster();
    renderCharacterPanel();
  });
  source.addEventListener('task', (event) => {
    const task = JSON.parse(event.data);
    const isNew = !store.tasks.has(task.id);
    upsertTask(task);
    if (store.tab === 'tasks') (isNew ? renderTasks() : rerenderTask(task));
    else {
      const working = [...store.tasks.values()].filter((t) => t.status === 'working').length;
      $('#tasks-badge').hidden = !working;
      $('#tasks-badge').textContent = working;
    }
  });
  source.addEventListener('delta', (event) => {
    const { taskId, stepId, text } = JSON.parse(event.data);
    const step = store.tasks.get(taskId)?.steps.find((s) => s.id === stepId);
    if (step) step.text += text;
    const el = document.getElementById(`step-text-${stepId}`);
    if (el) {
      el.textContent += text;
      el.scrollTop = el.scrollHeight;
    }
  });
  source.addEventListener('chat', (event) => {
    const line = JSON.parse(event.data);
    (store.chats[line.charId] ??= []).push({ role: line.role, text: line.text, minute: line.minute });
    if (line.role === 'char' && store.chatStreamTarget === line.charId) store.chatStream = '';
    if (store.tab === 'chat') renderChat();
  });
  source.addEventListener('chatDelta', (event) => {
    const { charId, delta } = JSON.parse(event.data);
    if (store.chatStreamTarget !== charId) return;
    store.chatStream += delta;
    const el = $('#chat-stream');
    if (el) { el.textContent = store.chatStream; $('#chat-log').scrollTop = $('#chat-log').scrollHeight; }
  });
  source.addEventListener('chronicle', (event) => {
    store.chronicle.push(JSON.parse(event.data));
    if (store.chronicle.length > 300) store.chronicle.shift();
    if (store.tab === 'chronicle') renderChronicle();
  });
  source.addEventListener('toast', (event) => toast(JSON.parse(event.data)));
  source.addEventListener('world', (event) => {
    const { clock, settings } = JSON.parse(event.data);
    store.clock = clock;
    store.settings = settings;
    renderClock();
  });
}

async function loadState() {
  const state = await api('GET', '/api/state');
  store.clock = state.clock;
  store.settings = state.settings;
  store.brain = state.brain;
  store.characters = new Map(state.characters.map((c) => [c.id, c]));
  store.tasks = new Map(state.tasks.map((t) => [t.id, t]));
  store.taskOrder = state.tasks.map((t) => t.id);
  store.chronicle = state.chronicle;
  store.chats = state.chats;
  town.minute = state.clock.minute; // avoid a midnight tint before the first tick
  for (const c of state.characters) town.setCharacter(c);
  if (!store.selected || !store.characters.has(store.selected)) store.selected = state.characters[0]?.id ?? null;
  town.selected = store.selected;
  renderClock();
  renderBrain();
  renderRoster();
  showTab(store.tab);
}

async function boot() {
  store.catalog = await api('GET', '/api/catalog');
  town = new TownView($('#town'), store.catalog, { onSelect: (id) => { select(id); if (store.tab !== 'character') showTab('character'); } });
  town.start();
  initTaskForm();
  initCreateDialog();
  await loadState();
  connect();

  for (const button of $$('.tabs button')) button.addEventListener('click', () => showTab(button.dataset.tab));
  for (const button of $$('.speed button')) {
    button.addEventListener('click', async () => {
      const speed = Number(button.dataset.speed);
      try {
        const result = await api('POST', '/api/world', speed === 0 ? { paused: !store.clock.paused } : { speed, paused: false });
        store.clock = result.clock;
        renderClock();
      } catch (error) {
        fail(error);
      }
    });
  }
  $('#chat-form').addEventListener('submit', sendChat);
  $('#chronicle-filter').addEventListener('change', renderChronicle);
  $('#open-settings').addEventListener('click', () => { renderSettings(); $('#settings-dialog').showModal(); });
  $('#settings-body').addEventListener('change', async (event) => {
    const key = event.target.dataset.setting;
    if (!key) return;
    try {
      const result = await api('POST', '/api/world', { [key]: event.target.checked });
      store.settings = result.settings;
    } catch (error) {
      fail(error);
    }
  });
  setInterval(() => { renderRoster(); refreshNeeds(); }, 1500);
}

boot().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="error-box" style="margin:16px">AgentVille을 시작하지 못했어요: ${esc(error.message)}</div>`);
});
