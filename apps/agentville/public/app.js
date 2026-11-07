// AgentVille browser client: state store, SSE wiring and panel renderers.
import { paintPreview, portrait } from './avatar.js';
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
  approvals: new Map(),
  dockOpen: true,
  tasksView: 'live',
  chronicleView: 'log',
  reportDays: 7,
  attachments: [],
  agentStatus: null,
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

async function upload(file) {
  const response = await fetch('/api/files', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `업로드 실패 (${response.status})`);
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

    ${trustCard(c)}
    <div class="card"><h3>업무 장비 <span><small>사용 ${c.stats.toolUses ?? 0}회</small></span></h3>
      ${(c.derived.tools ?? []).map((entry) => toolRow(entry)).join('')}
      <div class="agent-stats">🧭 브라우저 조작 ${c.stats.browserActions ?? 0} · ⌨️ 명령 ${c.stats.shellCommands ?? 0} · 🖥️ 내 컴퓨터 ${c.stats.desktopActions ?? 0} · 🙋 질문 ${c.stats.questionsAsked ?? 0}</div>
      ${store.settings.tools === false ? '<small style="color:var(--muted)">설정에서 도구 사용이 꺼져 있어요.</small>' : ''}
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
      <button data-action="wardrobe" data-id="${c.id}">👗 꾸미기</button>
      <button data-action="export" data-id="${c.id}">📦 카드 내보내기</button>
      <button class="danger" data-action="retire" data-id="${c.id}">👋 떠나보내기</button>
    </div>`;
  panel.scrollTop = scroll;
}

function trustCard(c) {
  const trust = c.derived.trust ?? { value: 10, tier: 1, name: '신입', emoji: '🐣', desc: '' };
  const tiers = store.catalog.trust;
  const cap = store.settings.autonomyCap ?? 2;
  const next = tiers.find((tier) => tier.min > trust.value);
  const capped = trust.tier > cap;
  return `<div class="card"><h3>신뢰와 자율성 <span class="pill accent">${trust.emoji} ${esc(trust.name)}</span></h3>
    <div class="trust-bar"><div class="bar"><i style="width:${pct(trust.value, 100)}"></i></div>${tiers.slice(1).map((tier) => `<span class="tick" style="left:${tier.min}%" title="${esc(tier.name)}"></span>`).join('')}</div>
    <div class="num" style="text-align:left;margin-top:3px">신뢰도 ${Math.round(trust.value)} / 100${next ? ` · ${next.emoji} ${esc(next.name)}까지 ${Math.ceil(next.min - trust.value)}` : ' · 최고 단계'}</div>
    <p class="muted-line">${esc(trust.desc)}</p>
    ${capped ? `<p class="muted-line">⚙️ 설정의 자율성 상한(${esc(tiers[cap - 1].name)}) 때문에 지금은 ${esc(tiers[cap - 1].name)}처럼 일해요.</p>` : ''}
    <p class="muted-line">좋은 평가와 허락이 쌓이면 믿음이 커져, 묻지 않고 혼자 할 수 있는 일이 늘어요.</p>
  </div>`;
}

function toolRow({ id, unlocked, mastery, uses, next, budget }) {
  const tool = store.catalog.tools[id];
  if (!tool) return '';
  const off = (id === 'desktop' && !store.settings.desktop) || (id === 'browser' && store.settings.browser === false) || (id === 'shell' && store.settings.shell === false);
  const stars = unlocked ? `<span class="mastery" title="숙련도 Lv${mastery}">${'●'.repeat(mastery)}${'○'.repeat(5 - mastery)}</span>` : '';
  const progress = unlocked && next ? `<div class="bar thin"><i style="width:${pct(uses - (store.catalog.mastery.steps[mastery] ?? 0), next - (store.catalog.mastery.steps[mastery] ?? 0))}"></i></div>` : '';
  return `<div class="tool-row ${unlocked ? 'on' : ''} ${off ? 'off' : ''}"><span class="e">${unlocked ? tool.emoji : '🔒'}</span><span class="grow"><strong>${esc(tool.name)}</strong> ${stars}
    <small>${unlocked ? (off ? '설정에서 꺼짐' : `숙련 Lv${mastery}${budget ? ` · 한 업무 ${budget}번` : ''}${next ? ` · 다음까지 ${next - uses}번` : ''}`) : `${esc(tool.unlock)}에 해금`}</small><br><small>${esc(tool.desc)}</small>${progress}</span></div>`;
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
  $('#task-equipment').innerHTML = Object.entries(store.catalog.equipment).map(([id, item]) => `<option value="${id}">${item.emoji} ${item.name}</option>`).join('');
  $('#task-files').accept = store.catalog.attachments.accept;
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(updatePreview, 350); };
  for (const id of ['#task-prompt', '#task-category', '#task-difficulty', '#task-mode', '#task-equipment', '#task-folder']) $(id).addEventListener('input', schedule);
  $('#task-equipment').addEventListener('change', () => { $('#folder-row').hidden = $('#task-equipment').value !== 'files'; });
  $('#task-files').addEventListener('change', async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    for (const file of files) {
      if (store.attachments.length >= store.catalog.attachments.max) {
        toast({ emoji: '📎', text: `첨부는 ${store.catalog.attachments.max}개까지예요.` });
        break;
      }
      const chip = { name: file.name, uploading: true };
      store.attachments.push(chip);
      renderAttachChips();
      try {
        Object.assign(chip, await upload(file), { uploading: false });
      } catch (error) {
        store.attachments.splice(store.attachments.indexOf(chip), 1);
        fail(error);
      }
      renderAttachChips();
    }
  });
  $('#task-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#task-form button[type=submit]');
    button.disabled = true;
    if (store.attachments.some((file) => file.uploading)) {
      button.disabled = false;
      return toast({ emoji: '📎', text: '첨부 파일을 올리는 중이에요. 잠시만요.' });
    }
    try {
      const task = await api('POST', '/api/tasks', taskInput());
      upsertTask(task);
      store.openTask = task.id;
      $('#task-prompt').value = '';
      $('#task-folder').value = '';
      store.attachments = [];
      renderAttachChips();
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
    equipment: $('#task-equipment').value,
    folder: $('#task-equipment').value === 'files' ? $('#task-folder').value.trim() || undefined : undefined,
    attachments: store.attachments.filter((file) => file.id).map((file) => file.id),
    assignees: [...store.assignees],
  };
}

const KIND_EMOJI = { image: '🖼️', pdf: '📕', text: '📄' };
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`);

function renderAttachChips() {
  $('#attach-chips').innerHTML = store.attachments.map((file, index) => `<span class="attach-chip ${file.uploading ? 'busy' : ''}">
    ${file.kind === 'image' && file.id ? `<img src="/api/files/${file.id}" alt="">` : `<span>${KIND_EMOJI[file.kind] ?? '📎'}</span>`}
    <span class="name">${esc(file.name)}</span>${file.size ? `<small>${fmtSize(file.size)}</small>` : ''}${file.uploading ? '<span class="spinner"></span>' : `<button type="button" class="x" data-action="unattach" data-index="${index}" aria-label="첨부 빼기">✕</button>`}
  </span>`).join('');
}

function attachmentList(files = []) {
  if (!files.length) return '';
  return `<div class="attach-list">${files.map((file) => `<a class="attach-chip" href="/api/files/${file.id}" target="_blank" rel="noopener">${file.kind === 'image' ? `<img src="/api/files/${file.id}" alt="">` : `<span>${KIND_EMOJI[file.kind] ?? '📎'}</span>`}<span class="name">${esc(file.name)}</span><small>${fmtSize(file.size)}</small></a>`).join('')}</div>`;
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
      const trace = step.tools?.length
        ? `<ul class="tool-trace" id="trace-${step.id}">${step.tools.map((entry) => `<li class="${entry.error ? 'error' : ''}">${entry.tool === 'ask' ? '' : `${store.catalog.tools[entry.tool]?.emoji ?? '🔧'} `}${esc(entry.text)}</li>`).join('')}</ul>`
        : '';
      const uses = step.uses ?? step.tools?.filter((entry) => entry.use ?? /^(검색|실행|파일)/.test(entry.text)).length ?? 0;
      const refs = step.refs?.length ? `<div class="refs">📚 참고: ${step.refs.map((ref) => `<button type="button" class="link" data-action="open-archived" data-id="${ref.id}">${esc(ref.title)}${ref.rating ? ` ★${ref.rating}` : ''}</button>`).join(', ')}</div>` : '';
      return `<li><details class="step" data-step="${step.id}" ${expanded ? 'open' : ''}><summary>${stepIcon(step)} ${esc(step.label)} ${who && people.length > 1 ? `<small>· ${esc(who.name)}</small>` : ''}${uses ? `<span class="effort">🔧 ${uses}</span>` : ''}${step.effort ? `<span class="effort">🧠 ${EFFORT[step.effort] ?? step.effort}</span>` : ''}</summary>${refs}${liveScreen(task, step)}${trace}<pre id="step-text-${step.id}">${esc(step.text)}</pre></details></li>`;
    }).join('');
    const rewards = Object.entries(task.rewards ?? {}).map(([id, reward]) => {
      const c = store.characters.get(id);
      return c ? `<span class="pill gold">${esc(c.name)} +${reward.xp}XP${reward.bonus ? ` (+${reward.bonus} 칭찬)` : ''}</span>` : '';
    }).join('');
    const draft = store.draftRating[task.id] ?? task.rating ?? 0;
    body = `<div class="task-body">
      <div class="pills" style="margin-top:10px">${task.equipment && task.equipment !== 'auto' ? `<span class="pill">${catalog.equipment[task.equipment]?.emoji ?? ''} ${esc(catalog.equipment[task.equipment]?.name ?? '')}</span>` : ''}<span class="pill">${skill.emoji} ${skill.name}</span><span class="pill">${'★'.repeat(task.difficulty)}</span><span class="pill">${task.mode === 'team' ? '🧠 팀 숙고' : '👤 혼자'}</span>${task.quality != null ? `<span class="pill accent">품질 ${Math.round(task.quality * 100)}</span>` : ''}</div>
      <p style="font-size:13px;color:var(--muted);white-space:pre-wrap;margin:10px 0 0">${esc(task.prompt)}</p>
      ${task.folder ? `<div class="muted-line">🗂️ 맡긴 폴더: <code>${esc(task.folder)}</code></div>` : ''}
      ${attachmentList(task.attachments)}
      ${pendingFor(task)}
      <ol class="steps">${steps}</ol>
      ${task.status === 'working' ? `<div class="actions"><button class="danger" data-action="cancel-task" data-id="${task.id}">⏹ 멈추기</button></div>` : ''}
      ${task.status === 'done' ? `
        <div class="output">${renderMarkdown(task.output)}</div>
        ${artifactList(task)}
        ${task.comment && lead ? `<div class="comment">${img(lead, 28)}<span><strong>${esc(lead.name)}</strong> ${esc(task.comment)}</span></div>` : ''}
        <div class="rewards">${rewards}</div>
        <div class="rating">
          <div style="font-size:13px;font-weight:600">${task.rating ? `내 평가: ${'⭐'.repeat(task.rating)}${task.feedback ? ` “${esc(task.feedback)}”` : ''}` : '결과가 어땠나요? 평가는 캐릭터의 기분·성장·기억에 남아요.'}</div>
          <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= draft ? 'on' : ''}" data-action="star" data-id="${task.id}" data-value="${n}" aria-label="${n}점">★</button>`).join('')}</div>
          <div class="inline"><input id="fb-${task.id}" maxlength="400" placeholder="한마디 (예: 표로 정리해 줘서 좋았어, 앞으로도 표로!)"><button class="primary" data-action="rate" data-id="${task.id}">평가 보내기</button></div>
        </div>` : ''}
      ${task.status === 'error' ? `<div class="error-box">${task.cancelled ? '⏹️' : '⚠️'} ${esc(task.error)}</div>${artifactList(task)}<div class="actions"><button data-action="retry" data-id="${task.id}">🔁 다시 시도</button></div>` : ''}
    </div>`;
  }
  return `<article class="task" id="task-${task.id}">
    <button class="task-head" data-action="toggle-task" data-id="${task.id}">
      <span class="avatars">${people.map((c) => img(c, 24)).join('')}</span>
      <span class="title">${esc(task.title)}</span>
      ${[...store.approvals.values()].some((entry) => entry.taskId === task.id) ? '<span class="status waiting">🙋 확인 대기</span>' : ''}<span class="status ${task.status}">${task.status === 'working' ? '<span class="spinner" style="width:9px;height:9px"></span> ' : ''}${statusText}</span>
    </button>${body}</article>`;
}

// What the character is looking at, refreshed as screenshots come in.
function liveScreen(task, step) {
  const screen = step.screen;
  if (!screen) return '';
  const live = step.status === 'running';
  const src = live ? `/api/tasks/${task.id}/screen?seq=${screen.seq}` : screen.final ? `/api/files/${screen.final}` : null;
  if (!src) return '';
  const dot = live && screen.action && Number.isFinite(screen.action.x) ? `<i class="dot" style="left:${(screen.action.x / screen.width) * 100}%;top:${(screen.action.y / screen.height) * 100}%"></i>` : '';
  return `<figure class="live-screen ${live ? 'live' : ''}"><div class="frame"><img src="${src}" alt="캐릭터가 보고 있는 화면" loading="lazy">${dot}</div>
    <figcaption>${live ? '<span class="rec">● 실시간</span>' : '마지막 화면'}${screen.url ? ` · <span class="url">${esc(screen.url)}</span>` : ''}</figcaption></figure>`;
}

function artifactList(task) {
  if (!task.artifacts?.length) return '';
  return `<div class="artifacts"><div class="label">📁 남긴 파일${task.workspace?.own === false ? ' (맡긴 폴더)' : ''}</div>${task.artifacts.map((file) => `<a href="/api/tasks/${task.id}/artifact?path=${encodeURIComponent(file.path)}" target="_blank" rel="noopener">${file.created ? '🆕' : '✏️'} ${esc(file.path)} <small>${fmtSize(file.size)}</small></a>`).join('')}
    ${task.workspace?.root ? `<div class="muted-line">위치: <code>${esc(task.workspace.root)}</code></div>` : ''}</div>`;
}

function pendingFor(task) {
  const items = [...store.approvals.values()].filter((entry) => entry.taskId === task.id);
  return items.map((entry) => approvalCard(entry, { inline: true })).join('');
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

// ---------- approvals ------------------------------------------------------------

const TOOL_VERB = { browser: '전용 브라우저에서', desktop: '내 컴퓨터에서', files: '작업 폴더에서', shell: '터미널에서' };

function approvalCard(entry, { inline = false } = {}) {
  const c = store.characters.get(entry.charId);
  const task = store.tasks.get(entry.taskId);
  const question = entry.kind === 'question';
  const shot = entry.screen ? `<div class="frame small"><img src="/api/tasks/${entry.taskId}/screen?seq=${entry.screen.seq}" alt="">${entry.point ? `<i class="dot" style="left:${(entry.point.x / entry.screen.width) * 100}%;top:${(entry.point.y / entry.screen.height) * 100}%"></i>` : ''}</div>` : '';
  const ask = question
    ? `<div class="q-options">${(entry.options ?? []).map((option) => `<button type="button" data-action="approve" data-id="${entry.id}" data-decision="allow" data-answer="${esc(option)}">${esc(option)}</button>`).join('')}</div>
       <div class="inline"><input id="ans-${entry.id}${inline ? '-i' : ''}" maxlength="2000" placeholder="답하기…"><button class="primary" data-action="approve" data-id="${entry.id}" data-decision="allow" data-input="ans-${entry.id}${inline ? '-i' : ''}">보내기</button><button data-action="approve" data-id="${entry.id}" data-decision="deny">넘어가기</button></div>`
    : `<div class="approve-buttons"><button class="primary" data-action="approve" data-id="${entry.id}" data-decision="allow">허용</button><button data-action="approve" data-id="${entry.id}" data-decision="allowAll" title="이 업무가 끝날 때까지 같은 종류의 조작은 묻지 않아요">이 업무 동안 모두 허용</button><button class="danger" data-action="approve" data-id="${entry.id}" data-decision="deny" data-input="note-${entry.id}${inline ? '-i' : ''}">거절</button></div>
       <input class="note" id="note-${entry.id}${inline ? '-i' : ''}" maxlength="400" placeholder="거절 이유나 다른 방법 (선택)">`;
  return `<div class="approval ${question ? 'question' : ''}" data-approval="${entry.id}">
    <div class="who">${c ? img(c, 34) : ''}<div><strong>${esc(c?.name ?? '')}</strong> <small>${question ? '🙋 질문' : `🙋 ${TOOL_VERB[entry.tool] ?? ''} 해도 될까요?`}</small>${task && !inline ? `<div class="task-name">📋 ${esc(task.title)}</div>` : ''}</div></div>
    <div class="what">${esc(entry.summary)}</div>
    ${entry.detail ? `<pre class="detail">${esc(entry.detail)}</pre>` : ''}
    ${shot}
    ${ask}
  </div>`;
}

function renderApprovals() {
  const items = [...store.approvals.values()].sort((a, b) => a.at - b.at);
  const badge = $('#inbox-badge');
  badge.hidden = !items.length;
  badge.textContent = items.length;
  document.title = items.length ? `(${items.length}) 🙋 AgentVille` : 'AgentVille';
  const dock = $('#approval-dock');
  const focused = document.activeElement?.closest?.('#approval-dock') ? document.activeElement.id : null;
  if (!items.length) {
    dock.innerHTML = '';
    dock.hidden = true;
    return;
  }
  dock.hidden = false;
  dock.innerHTML = `<div class="dock-head"><strong>🙋 확인 요청 ${items.length}</strong><button class="icon-btn" data-action="toggle-dock" aria-label="${store.dockOpen ? '접기' : '펼치기'}">${store.dockOpen ? '▾' : '▴'}</button></div>
    ${store.dockOpen ? items.slice(0, 3).map((entry) => approvalCard(entry)).join('') + (items.length > 3 ? `<div class="muted-line">외 ${items.length - 3}건 대기 중</div>` : '') : ''}`;
  if (focused) document.getElementById(focused)?.focus();
}

function renderStopAll() {
  const running = [...store.tasks.values()].some((task) => task.status === 'working' && task.steps.some((step) => step.kind === 'agent' && step.status === 'running'));
  $('#stop-all').hidden = !running;
}

async function answerApproval(target) {
  const { id, decision } = target.dataset;
  const input = target.dataset.input ? document.getElementById(target.dataset.input) : null;
  const entry = store.approvals.get(id);
  const body = { decision };
  if (entry?.kind === 'question') body.answer = target.dataset.answer ?? input?.value ?? '';
  else if (input) body.note = input.value;
  if (entry?.kind === 'question' && decision === 'allow' && !body.answer.trim()) return toast({ emoji: '💬', text: '답을 적거나 골라 주세요.' });
  await api('POST', `/api/approvals/${id}`, body);
  store.approvals.delete(id);
  renderApprovals();
  const task = entry && store.tasks.get(entry.taskId);
  if (task && store.tab === 'tasks') rerenderTask(task);
}

// ---------- archive ----------------------------------------------------------------

let archiveTimer = null;
async function renderArchive() {
  const list = $('#archive-list');
  const params = new URLSearchParams({ q: $('#archive-q').value, category: $('#archive-category').value, charId: $('#archive-person').value, minRating: $('#archive-rating').value });
  try {
    const result = await api('GET', `/api/archive?${params}`);
    const q = $('#archive-q').value.trim();
    const mark = (text) => {
      const safe = esc(text);
      if (!q) return safe;
      const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return safe.replace(new RegExp(needle, 'gi'), (match) => `<mark>${match}</mark>`);
    };
    list.innerHTML = result.items.length
      ? `<div class="muted-line">${result.total}건${result.total > result.items.length ? ` 중 ${result.items.length}건` : ''}</div>${result.items.map((item) => {
        const people = item.assignees.map((id) => store.characters.get(id)).filter(Boolean);
        const skill = store.catalog.skills[item.category];
        return `<button class="archive-item" data-action="open-archived" data-id="${item.id}">
          <span class="avatars">${people.map((c) => img(c, 22)).join('')}</span>
          <span class="body"><strong>${mark(item.title)}</strong><small>${skill?.emoji ?? ''} ${esc(skill?.name ?? '')} · ${fmtClock(item.finishedAt)}${item.rating ? ` · ${'★'.repeat(item.rating)}` : ''}${item.attachments ? ` · 📎${item.attachments}` : ''}</small><span class="snippet">${mark(item.snippet)}</span></span>
        </button>`;
      }).join('')}`
      : `<div class="empty"><div class="big">📚</div>${q ? '찾는 결과물이 없어요.' : '끝낸 업무가 여기에 쌓여요. 캐릭터들도 비슷한 일을 할 때 예전 결과를 참고해요.'}</div>`;
  } catch (error) {
    list.innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
  }
}

function initArchive() {
  $('#archive-category').insertAdjacentHTML('beforeend', Object.entries(store.catalog.skills).map(([id, skill]) => `<option value="${id}">${skill.emoji} ${skill.name}</option>`).join(''));
  $('#archive-form').addEventListener('input', () => { clearTimeout(archiveTimer); archiveTimer = setTimeout(renderArchive, 250); });
  $('#archive-form').addEventListener('submit', (event) => { event.preventDefault(); renderArchive(); });
}

function fillArchivePeople() {
  const select = $('#archive-person');
  const value = select.value;
  select.innerHTML = `<option value="">모든 사람</option>${[...store.characters.values()].map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
  select.value = store.characters.has(value) ? value : '';
}

async function openArchived(id) {
  const task = store.tasks.get(id) ?? await api('GET', `/api/tasks/${id}`);
  store.tasks.set(task.id, task);
  if (!store.taskOrder.includes(task.id)) store.taskOrder.push(task.id);
  store.openTask = task.id;
  setTasksView('live');
  showTab('tasks');
  document.getElementById(`task-${task.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function setTasksView(view) {
  store.tasksView = view;
  for (const button of $$('[data-action="tasks-view"]')) button.classList.toggle('active', button.dataset.view === view);
  $('#tasks-live').hidden = view !== 'live';
  $('#tasks-archive').hidden = view !== 'archive';
  if (view === 'archive') { fillArchivePeople(); renderArchive(); }
}

// ---------- growth report ----------------------------------------------------------

async function renderReport() {
  const box = $('#chronicle-report');
  const ranges = [[1, '오늘'], [7, '7일'], [30, '30일'], ['all', '전체']];
  try {
    const report = await api('GET', `/api/report?days=${store.reportDays}`);
    const { town: t } = report;
    const tiles = [['📋', '끝낸 업무', t.tasks, t.teamTasks ? `팀 ${t.teamTasks}` : ''], ['⭐', '평균 별점', t.rating ?? '—', t.ratings ? `${t.ratings}건 평가` : '평가 없음'], ['✨', '경험치', `+${t.xp}`, ''], ['🎉', '레벨업', t.levelUps, ''], ['🌱', '새 특성', t.newTraits, ''], ['🔧', '도구 사용', t.toolUses, '']];
    const star = t.star ? store.characters.get(t.star) : null;
    box.innerHTML = `<div class="subtabs">${ranges.map(([days, label]) => `<button class="${String(store.reportDays) === String(days) ? 'active' : ''}" data-action="report-days" data-days="${days}">${label}</button>`).join('')}</div>
      <div class="report-range muted-line">${report.from != null ? `${fmtClock(report.from)} ~ ` : '처음부터 ~ '}${fmtClock(report.to)}</div>
      <div class="tiles">${tiles.map(([emoji, label, value, sub]) => `<div class="tile"><span class="e">${emoji}</span><strong>${esc(String(value))}</strong><small>${label}${sub ? ` · ${esc(sub)}` : ''}</small></div>`).join('')}</div>
      ${star ? `<div class="star-card">${img(star, 40)}<div><small>이 기간의 주인공</small><strong>${esc(star.name)}</strong></div></div>` : ''}
      ${report.characters.map((entry) => reportCard(entry)).join('') || '<div class="empty">아직 주민이 없어요.</div>'}
      ${report.highlights.length ? `<div class="card"><h3>하이라이트</h3><ol class="chronicle">${report.highlights.map((item) => `<li><span>${esc(item.emoji)}</span><span>${esc(item.text)}<time>${fmtClock(item.minute)}</time></span></li>`).join('')}</ol></div>` : ''}`;
  } catch (error) {
    box.innerHTML = `<div class="error-box">${esc(error.message)}</div>`;
  }
}

function reportCard(entry) {
  const c = store.characters.get(entry.id);
  if (!c) return '';
  const { catalog } = store;
  const chips = [
    ...entry.skills.map((skill) => `<span class="chip">${catalog.skills[skill.id].emoji} ${catalog.skills[skill.id].name} Lv${skill.from}→${skill.to}</span>`),
    ...entry.traits.map((id) => (catalog.traits[id] ? `<span class="chip earned">${catalog.traits[id].emoji} ${esc(catalog.traits[id].name)}</span>` : '')),
    ...entry.friends.map((friend) => (store.characters.get(friend.id) ? `<span class="chip">${friend.to >= 75 ? '💖' : '😊'} ${esc(store.characters.get(friend.id).name)}</span>` : '')),
    ...entry.bigFive.map((drift) => `<span class="chip">${esc(catalog.bigFive[drift.id]?.name ?? drift.id)} ${drift.delta > 0 ? '▲' : '▼'}${Math.abs(drift.delta)}</span>`),
  ].join('');
  return `<div class="card report-card"><div class="head">${img(c, 44)}<div><strong>${esc(c.name)}</strong> <span class="pill accent">Lv${entry.level.from}${entry.level.to > entry.level.from ? ` → ${entry.level.to}` : ''}</span><div class="headline">${esc(entry.headline)}</div></div><span class="xp">+${entry.xp} XP</span></div>
    <div class="stats">📋 ${entry.tasks}건${entry.teamTasks ? ` (팀 ${entry.teamTasks})` : ''} · ⭐ ${entry.rating ?? '—'} · 🔧 ${entry.toolUses} · 💗 ${entry.affinity >= 0 ? '+' : ''}${entry.affinity}</div>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${entry.partial ? '<div class="muted-line">이 마을에 성장 기록이 생기기 전부터 있던 캐릭터라, 기록이 생긴 뒤부터 셌어요.</div>' : ''}</div>`;
}

function setChronicleView(view) {
  store.chronicleView = view;
  for (const button of $$('[data-action="chronicle-view"]')) button.classList.toggle('active', button.dataset.view === view);
  $('#chronicle-log').hidden = view !== 'log';
  $('#chronicle-report').hidden = view !== 'report';
  if (view === 'report') renderReport();
}

// ---------- wardrobe ----------------------------------------------------------------

const wardrobe = { tab: 'hairStyle', look: null, owner: null, timer: null };

function itemLocked(owner, slot, item) {
  if (!item.req) return false;
  if (!owner) return true;
  return !(owner.derived?.wardrobe ?? []).includes(`${slot}:${item.id}`);
}

// One editor for both the create dialog (owner null: basics only) and the
// wardrobe of an existing character.
function renderWardrobe(container, owner, look, onChange) {
  const { slots, items } = store.catalog.wardrobe;
  const tabs = Object.entries(slots);
  const tab = slots[wardrobe.tab] ? wardrobe.tab : 'hairStyle';
  const list = items[tab].map((item) => {
    const locked = itemLocked(owner, tab, item);
    const on = String(look[tab]) === String(item.id);
    const title = locked ? `🔒 ${item.reqText}` : item.name ?? '';
    if (slots[tab].kind === 'color') return `<button type="button" class="swatch ${on ? 'on' : ''} ${locked ? 'locked' : ''}" style="--c:${item.id}" data-slot="${tab}" data-value="${item.id}" title="${esc(title)}" aria-label="${esc(item.name ?? item.id)}${locked ? ' (잠김)' : ''}" ${locked ? 'aria-disabled="true"' : ''}>${locked ? '🔒' : ''}</button>`;
    const preview = portrait({ ...look, [tab]: item.id, pet: 'none' }, 70, 44);
    return `<button type="button" class="item ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-slot="${tab}" data-value="${item.id}" title="${esc(title)}" ${locked ? 'aria-disabled="true"' : ''}>
      ${tab === 'pet' ? `<span class="pet-e">${{ none: '🚫', chick: '🐥', cat: '🐱', dog: '🐶', owl: '🦉', robot: '🤖', slime: '💧' }[item.id] ?? '🐾'}</span>` : `<img src="${preview}" alt="">`}
      <span>${esc(item.name ?? '')}</span>${locked ? `<small>🔒 ${esc(item.reqText)}</small>` : ''}</button>`;
  }).join('');
  container.innerHTML = `<div class="wardrobe-grid"><canvas class="wardrobe-preview" width="220" height="220"></canvas>
    <div class="wardrobe-side"><div class="subtabs wrap">${tabs.map(([id, slot]) => `<button type="button" class="${id === tab ? 'active' : ''}" data-wtab="${id}">${esc(slot.name)}</button>`).join('')}</div>
    <div class="wardrobe-items ${slots[tab].kind}">${list}</div></div></div>`;
  const canvas = $('.wardrobe-preview', container);
  clearInterval(wardrobe.timer);
  const paint = () => { if (canvas.isConnected) paintPreview(canvas, look, { t: performance.now() }); else clearInterval(wardrobe.timer); };
  paint();
  if (look.pet && look.pet !== 'none') wardrobe.timer = setInterval(paint, 60);
  container.onclick = (event) => {
    const tabButton = event.target.closest('[data-wtab]');
    if (tabButton) {
      wardrobe.tab = tabButton.dataset.wtab;
      return renderWardrobe(container, owner, look, onChange);
    }
    const button = event.target.closest('[data-slot]');
    if (!button) return;
    if (button.classList.contains('locked')) return toast({ emoji: '🔒', text: `잠긴 아이템이에요: ${button.title.replace('🔒 ', '')}` });
    const slot = button.dataset.slot;
    look[slot] = slot === 'hairStyle' ? Number(button.dataset.value) : button.dataset.value;
    onChange?.(look);
    renderWardrobe(container, owner, look, onChange);
  };
}

function randomLook(owner, base) {
  const { items } = store.catalog.wardrobe;
  const look = { ...base };
  for (const [slot, list] of Object.entries(items)) {
    const open = list.filter((item) => !itemLocked(owner, slot, item));
    if (slot === 'pet' && Math.random() < 0.5) continue;
    if (open.length) look[slot] = open[Math.floor(Math.random() * open.length)].id;
  }
  return look;
}

function openWardrobe(id) {
  const c = store.characters.get(id);
  if (!c) return;
  wardrobe.owner = c;
  wardrobe.look = { ...c.appearance };
  $('#wardrobe-title').textContent = `👗 ${c.name}의 옷장`;
  renderWardrobe($('#wardrobe-body'), c, wardrobe.look);
  $('#wardrobe-dialog').showModal();
}

function initWardrobe() {
  $('#wardrobe-random').addEventListener('click', () => {
    wardrobe.look = randomLook(wardrobe.owner, wardrobe.look);
    renderWardrobe($('#wardrobe-body'), wardrobe.owner, wardrobe.look);
  });
  $('#wardrobe-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    try {
      const view = await api('PATCH', `/api/characters/${wardrobe.owner.id}`, { appearance: wardrobe.look });
      store.characters.set(view.id, view);
      town.setCharacter(view);
      lastRoster = '';
      renderRoster();
      renderCharacterPanel();
      $('#wardrobe-dialog').close();
      toast({ emoji: '✨', text: `${view.name}: 어때요? 마음에 들어요!` });
    } catch (error) {
      fail(error);
    }
  });
  $('#wardrobe-dialog').addEventListener('close', () => clearInterval(wardrobe.timer));
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

const draft = { role: 'researcher', traits: new Set(), bigFive: {}, look: null };

function freshLook(roleId) {
  const base = { skin: '#f6d7c3', hair: '#2b2118', hairStyle: 0, eyes: 'dot', outfit: 'tee', accessory: 'none', pet: 'none', shirt: store.catalog.roles[roleId]?.color ?? '#4f7cff' };
  return randomLook(null, base);
}

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
  $('#c-look-random').addEventListener('click', () => {
    draft.look = randomLook(null, draft.look);
    renderWardrobe($('#c-wardrobe'), null, draft.look);
  });
  $('#create-dialog').addEventListener('close', () => clearInterval(wardrobe.timer));
  $('#gen-button').addEventListener('click', generateDraft);
  $('#c-import').addEventListener('change', importCardFile);
  $('#create-form').addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'create') return;
    event.preventDefault();
    try {
      const created = await api('POST', '/api/characters', {
        name: $('#c-name').value, role: draft.role, speech: $('#c-speech').value, traits: [...draft.traits],
        aspiration: $('#c-aspiration').value, bigFive: draft.bigFive, bio: $('#c-bio').value, catchphrase: $('#c-catch').value,
        appearance: draft.look,
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
  // A new role brings its colour unless one was picked.
  if (draft.look && Object.values(store.catalog.roles).some((r) => r.color === draft.look.shirt)) {
    draft.look.shirt = role.color;
    if ($('#create-dialog').open) renderWardrobe($('#c-wardrobe'), null, draft.look);
  }
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
  draft.look = freshLook('researcher');
  wardrobe.tab = 'hairStyle';
  renderWardrobe($('#c-wardrobe'), null, draft.look);
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
    <label class="setting"><input type="checkbox" data-setting="tools" ${store.settings.tools !== false ? 'checked' : ''}>
      <span><strong>업무 장비 쓰기</strong><small>📄 웹 페이지 읽기·🗂️ 작업 폴더는 처음부터, 🧭 전용 브라우저는 Lv2(리서치·기획 Lv2), 🌐 웹 검색은 리서치 Lv3, ⌨️ 터미널은 코딩·분석 Lv3, 🖥️ 내 컴퓨터는 Lv3에 열립니다. 웹 검색은 횟수만큼 추가 요금이 듭니다.</small></span></label>
    <h3 class="settings-h">🤖 에이전트</h3>
    <label class="setting"><input type="checkbox" data-setting="browser" ${store.settings.browser !== false ? 'checked' : ''}>
      <span><strong>🧭 전용 브라우저</strong><small>내 브라우저와 분리된 Chrome 창(보이지 않음)으로 사이트를 열고 조작합니다. 로그인 정보는 공유되지 않아요.${statusNote('browser')}</small></span></label>
    <label class="setting"><input type="checkbox" data-setting="shell" ${store.settings.shell !== false ? 'checked' : ''}>
      <span><strong>⌨️ 터미널</strong><small>작업 폴더 안에서 명령을 실행합니다.${statusNote('sandbox')}</small></span></label>
    <label class="setting"><input type="checkbox" data-setting="desktop" ${store.settings.desktop ? 'checked' : ''}>
      <span><strong>🖥️ 내 컴퓨터 조작</strong><small>실제 화면을 보고 마우스·키보드를 움직입니다. 켤 때 위험 안내에 동의해야 해요.${statusNote('desktop')}</small></span></label>
    <label class="setting select"><span><strong>자율성 상한</strong><small>캐릭터의 신뢰도가 높아도 이 단계까지만 묻지 않고 일해요.</small></span>
      <select data-setting-select="autonomyCap">${store.catalog.trust.map((tier) => `<option value="${tier.tier}" ${Number(store.settings.autonomyCap ?? 2) === tier.tier ? 'selected' : ''}>${tier.emoji} ${tier.name} — ${tier.desc}</option>`).join('')}</select></label>
    <dl class="kv">
      <dt>두뇌</dt><dd>${live ? 'Claude (실제 모델)' : '시뮬레이션 (오프라인)'}</dd>
      <dt>모델</dt><dd>${esc(store.brain.model)}</dd>
      <dt>Claude 켜기</dt><dd><code>ANTHROPIC_API_KEY=… npm start</code> (apps/agentville)</dd>
      <dt>모델 바꾸기</dt><dd><code>AGENTVILLE_MODEL</code> 환경 변수</dd>
      <dt>작업 폴더</dt><dd><code>${esc(store.agentStatus?.workspaceDir ?? '…')}</code></dd>
    </dl>`;
}

function statusNote(kind) {
  const status = store.agentStatus;
  if (!status) return '';
  if (kind === 'browser') return status.browser.ok ? ' <em class="ok">사용 가능</em>' : ` <em class="bad">${esc(status.browser.reason)}</em>`;
  if (kind === 'sandbox') return status.sandbox ? ` <em class="ok">샌드박스 ${esc(status.sandbox)}: 작업 폴더 밖에는 쓸 수 없어요</em>` : ' <em class="bad">샌드박스 없음: 읽기 전용이 아닌 명령은 매번 승인</em>';
  if (kind === 'desktop') {
    if (!status.desktop.ok) return ` <em class="bad">${esc(status.desktop.reason ?? '사용할 수 없음')}</em>`;
    return status.desktop.accessibility ? ` <em class="ok">${esc(status.desktop.platform)} ${Math.round(status.desktop.width)}×${Math.round(status.desktop.height)}</em>` : ` <em class="bad">${esc(status.desktop.note ?? '권한 필요')}</em>`;
  }
  return '';
}

async function openSettings() {
  renderSettings();
  $('#settings-dialog').showModal();
  try {
    store.agentStatus = await api('GET', '/api/agent/status');
    if ($('#settings-dialog').open) renderSettings();
  } catch { /* status is optional */ }
}

async function saveSetting(body) {
  const result = await api('POST', '/api/world', body);
  store.settings = result.settings;
  renderSettings();
  if (store.tab === 'character') renderCharacterPanel();
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
  if (tab === 'tasks') { renderAssigneePicker(); renderTasks(); if (store.tasksView === 'archive') setTasksView('archive'); }
  if (tab === 'chat') renderChat();
  if (tab === 'chronicle') { renderChronicle(); if (store.chronicleView === 'report') renderReport(); }
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
      case 'cancel-task': await api('POST', `/api/tasks/${id}/cancel`); break;
      case 'approve': await answerApproval(target); break;
      case 'toggle-dock': store.dockOpen = !store.dockOpen; renderApprovals(); break;
      case 'unattach': store.attachments.splice(Number(target.dataset.index), 1); renderAttachChips(); break;
      case 'tasks-view': setTasksView(target.dataset.view); break;
      case 'chronicle-view': setChronicleView(target.dataset.view); break;
      case 'report-days': store.reportDays = target.dataset.days === 'all' ? 'all' : Number(target.dataset.days); renderReport(); break;
      case 'open-archived': await openArchived(id); break;
      case 'wardrobe': openWardrobe(id); break;
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
      c.state = { ...c.state, pos: entry.pos, activity: entry.activity, taskId: entry.taskId, bubble: entry.bubble, waiting: entry.waiting };
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
    renderStopAll();
    if (store.tab === 'tasks' && store.tasksView === 'live') (isNew ? renderTasks() : rerenderTask(task));
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
  source.addEventListener('approval', (event) => {
    const entry = JSON.parse(event.data);
    store.approvals.set(entry.id, entry);
    renderApprovals();
    const task = store.tasks.get(entry.taskId);
    if (task && store.tab === 'tasks') rerenderTask(task);
  });
  source.addEventListener('approvalDone', (event) => {
    const { id, taskId } = JSON.parse(event.data);
    store.approvals.delete(id);
    renderApprovals();
    const task = store.tasks.get(taskId);
    if (task && store.tab === 'tasks') rerenderTask(task);
  });
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
  store.approvals = new Map((state.approvals ?? []).map((entry) => [entry.id, entry]));
  renderApprovals();
  renderStopAll();
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
  initArchive();
  initWardrobe();
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
  $('#open-settings').addEventListener('click', openSettings);
  $('#open-inbox').addEventListener('click', () => {
    store.dockOpen = true;
    renderApprovals();
    if (!store.approvals.size) toast({ emoji: '🙋', text: '지금은 확인할 요청이 없어요.' });
    else $('#approval-dock input, #approval-dock button.primary')?.focus();
  });
  $('#stop-all').addEventListener('click', async () => {
    try {
      const { cancelled } = await api('POST', '/api/stop');
      toast({ emoji: '🛑', text: cancelled ? `진행 중인 업무 ${cancelled}건을 멈췄어요.` : '멈출 업무가 없어요.' });
    } catch (error) {
      fail(error);
    }
  });
  $('#settings-body').addEventListener('change', async (event) => {
    const key = event.target.dataset.setting;
    const selectKey = event.target.dataset.settingSelect;
    try {
      if (selectKey) return await saveSetting({ [selectKey]: Number(event.target.value) });
      if (!key) return;
      if (key === 'desktop' && event.target.checked) {
        event.target.checked = false;
        const dialog = $('#consent-dialog');
        dialog.returnValue = '';
        dialog.showModal();
        dialog.addEventListener('close', async () => {
          if (dialog.returnValue !== 'agree') return;
          try { await saveSetting({ desktop: true, consent: true }); } catch (error) { fail(error); }
        }, { once: true });
        return;
      }
      await saveSetting({ [key]: event.target.checked });
    } catch (error) {
      fail(error);
    }
  });
  setInterval(() => { renderRoster(); refreshNeeds(); }, 1500);
  fetch('/api/agent/status').then((response) => response.json()).then((status) => { store.agentStatus = status; }).catch(() => {});
}

boot().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="error-box" style="margin:16px">AgentVille을 시작하지 못했어요: ${esc(error.message)}</div>`);
});
