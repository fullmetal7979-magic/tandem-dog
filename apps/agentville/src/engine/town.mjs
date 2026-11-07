// The town: clock, utility-AI daily life, movement, small talk, sleep, work
// placement, chat, reflection and the chronicle. It owns the persisted state
// and emits events that the server forwards to the browser over SSE.
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { ASPIRATIONS, KOREAN_NAMES, ROLES } from '../catalog/roles.mjs';
import { SKILLS } from '../catalog/skills.mjs';
import { MASTERY_PERKS, TOOLS, actionBudget, toolUnlockedBy, toolsUnlockedByLevel } from '../catalog/tools.mjs';
import { itemName, sanitizeAppearance, unlockedItems } from '../catalog/wardrobe.mjs';
import { START_TRUST, adjustTrust } from '../agent/policy.mjs';
import { Workspace } from '../agent/workspace.mjs';
import { EARNED_TRAIT_IDS, TRAITS } from '../catalog/traits.mjs';
import { ACTIVITIES, IDLE_ACTIVITY_IDS, SELF_STUDY_DAILY_CAP } from '../catalog/world.mjs';
import { FileStore, MAX_ATTACHMENTS } from '../files.mjs';
import { clamp, clockParts, eulReul, eunNeun, gwaWa, iGa, isNight, makeRng, newId, truncate } from '../util.mjs';
import { searchArchive } from './archive.mjs';
import {
  EFFORT_LABELS, addCharacterXp, addSkillXp, adjustFriendship, characterView, createCharacter, growAttributes, relationshipLabel,
} from './character.mjs';
import { distance, findPath, neighbourOf, spotsOf, tileKey } from './map.mjs';
import {
  addMemory, estimateImportance, looksLikePreference, markReflected, recentMemories, retrieveMemories, shouldReflect,
} from './memory.mjs';
import { addMoodlet, applyGains, computeMood, decayNeeds, expireMoodlets, urgency } from './needs.mjs';
import { compatibility, traitEffects } from './personality.mjs';
import { applyFeedback, followUpChecks } from './progression.mjs';
import { buildReport, recordDay, snapshotOf } from './report.mjs';
import { CHARACTER_SCHEMA, REFLECTION_SCHEMA, SMALLTALK_SCHEMA, chatMessages, personaSystem, reflectionPrompt } from './prompts.mjs';
import { chooseAssignees, createTask, rankCandidates } from './tasks.mjs';
import { runTask } from './workflow.mjs';
import { createOfflineBrain } from '../llm/offline.mjs';

const WALK_TILES_PER_MINUTE = 4;
const CHRONICLE_LIMIT = 300;
const CHAT_LIMIT = 120;
const START_MINUTE = 8 * 60 + 30;

// What the browser sees of a pending approval (never the resolver).
export function approvalView(entry) {
  const { finish, ...rest } = entry;
  return rest;
}

export function emptyState(seed = Date.now() % 1e9) {
  return {
    version: 1,
    seed,
    clock: { minute: START_MINUTE, speed: 1, paused: false },
    settings: { effortByLevel: true, llmSmallTalk: false, tools: true, browser: true, shell: true, desktop: false, autonomyCap: 2 },
    characters: {},
    tasks: {},
    taskOrder: [],
    chronicle: [],
    chats: {},
    history: [],
    nextChronicleId: 1,
  };
}

export class Town extends EventEmitter {
  constructor({ state = emptyState(), brain, save = null, seed = state.seed, files = new FileStore(), workspaceDir = join(tmpdir(), 'agentville-workspaces'), screens = null } = {}) {
    super();
    this.files = files;
    this.workspaceDir = workspaceDir;
    // Tests inject screens: (kind) => screen.
    this.screenFactory = screens;
    this.approvals = new Map();
    this.liveScreens = new Map();
    this.controllers = new Map();
    state.settings = { ...emptyState().settings, ...state.settings };
    // Saves from before growth reports: history starts now, and characters
    // without an arrival snapshot are measured from this moment on.
    state.history ??= [];
    for (const character of Object.values(state.characters)) {
      character.origin ??= { ...snapshotOf(character, state.clock.minute), migrated: true };
      character.userBond.trust ??= START_TRUST;
      character.toolMastery ??= {};
      character.wardrobeSeen ??= unlockedItems(character);
    }
    this.state = state;
    this.brain = brain;
    this.rng = makeRng(seed + state.clock.minute);
    this.saveFn = save;
    this.saveTimer = null;
    this.running = new Set();
    this.reflecting = new Map();
    this.chatterBrain = createOfflineBrain({ delayMs: 0 });
    // Interrupted work from a previous run cannot resume mid-stream.
    for (const task of Object.values(state.tasks)) {
      if (task.status === 'working' || task.status === 'queued') {
        task.status = 'error';
        task.error = '서버가 다시 시작되어 업무가 중단되었습니다. 다시 시도해 주세요.';
      }
    }
    for (const character of Object.values(state.characters)) {
      character.state.taskId = null;
      character.state.waiting = false;
      if (['working', 'meeting', 'chat'].includes(character.state.activity)) this.setIdle(character);
    }
  }

  get clock() { return this.state.clock; }
  get settings() { return this.state.settings; }
  get characters() { return this.state.characters; }
  get tasks() { return this.state.tasks; }

  emit(type, payload) {
    return super.emit('event', type, payload);
  }

  saveSoon(delay = 1500) {
    if (!this.saveFn || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveFn(this.state);
    }, delay);
    this.saveTimer.unref?.();
  }

  // ---- chronicle & events -------------------------------------------------

  chronicle({ emoji, text, charId = null, toast = false }) {
    const entry = { id: this.state.nextChronicleId++, minute: this.clock.minute, emoji, text, charId };
    this.state.chronicle.push(entry);
    if (this.state.chronicle.length > CHRONICLE_LIMIT) this.state.chronicle.splice(0, this.state.chronicle.length - CHRONICLE_LIMIT);
    this.emit('chronicle', entry);
    if (toast) this.emit('toast', { emoji, text, charId });
    return entry;
  }

  recordEvents(events, charId = null) {
    for (const event of events) {
      const character = this.characters[event.charId ?? charId];
      const name = character?.name ?? '';
      switch (event.type) {
        case 'levelUp': {
          const gained = Object.entries(event.gained).map(([id, value]) => `${id.toUpperCase()}+${value}`).join(' ');
          const effort = event.effortUp ? ` · 사고 깊이 '${EFFORT_LABELS[event.effortUp]}'로 상승!` : '';
          this.chronicle({ emoji: '🎉', text: `${name} 레벨 ${event.level} 달성! (${gained})${effort}`, charId: character?.id, toast: true });
          for (const toolId of character ? toolsUnlockedByLevel(character, event.level) : []) this.announceTool(character, toolId, `레벨 ${event.level}이 되어`);
          break;
        }
        case 'skillUp': {
          const unlock = { 2: ' · 계획 단계 해금', 4: ' · 자기 검토 단계 해금', 6: ' · 기억 활용 확장', 8: ' · 채점 기준표 해금', 10: ' · 장인 모드' }[event.level] ?? '';
          const perk = event.perk ? ` — 새 노하우: ${event.perk}` : '';
          this.chronicle({ emoji: '📈', text: `${name}의 ${SKILLS[event.skill].name} Lv${event.level}${unlock}${perk}`, charId: character?.id, toast: Boolean(unlock || event.perk) });
          const toolId = character ? toolUnlockedBy(character, event.skill, event.level) : null;
          if (toolId) this.announceTool(character, toolId, `${SKILLS[event.skill].name} 실력이 늘어`);
          break;
        }
        case 'mastery': {
          const tool = TOOLS[event.tool];
          const budget = actionBudget(character, event.tool);
          this.chronicle({ emoji: tool.emoji, text: `${name}의 ${tool.name} 숙련도 Lv${event.level} — ${MASTERY_PERKS[event.level] ?? '손에 익었다'}${Number.isFinite(budget) ? ` (한 업무에 ${budget}번까지)` : ''}`, charId: character?.id, toast: event.level >= 3 });
          break;
        }
        case 'trust': {
          const up = event.to.tier > event.from.tier;
          this.chronicle({ emoji: up ? '🤝' : '💔', text: up ? `사용자가 ${eulReul(name)} 더 믿게 됐다: ${event.from.emoji} ${event.from.name} → ${event.to.emoji} ${event.to.name}` : `${name}에 대한 신뢰가 줄었다: ${event.from.name} → ${event.to.name}`, charId: character?.id, toast: true });
          if (character) addMemory(character, { kind: 'milestone', text: up ? `사용자가 나를 더 믿어 주게 됐다 (${event.to.name}).` : `사용자의 신뢰를 조금 잃었다 (${event.to.name}). 더 신중해야겠다.`, importance: 8, minute: this.clock.minute });
          break;
        }
        case 'trait':
          this.chronicle({ emoji: '✨', text: `${name}에게 새로운 특성이 생겼다: ${event.emoji} ${event.name}`, charId: character?.id, toast: true });
          break;
        case 'aspiration': {
          const def = ASPIRATIONS[event.aspiration];
          const text = event.done ? `${name}의 꿈 "${def.name}"이 이루어졌다!` : `${name}의 꿈 "${def.name}" ${event.stage}단계 달성: ${event.label}`;
          this.chronicle({ emoji: event.done ? '🏅' : '🌠', text, charId: character?.id, toast: true });
          break;
        }
        case 'friendship': {
          const a = this.characters[event.a];
          const b = this.characters[event.b];
          if (a && b) this.chronicle({ emoji: event.level >= 75 ? '💖' : '😊', text: `${gwaWa(a.name)} ${iGa(b.name)} ${event.level >= 75 ? '단짝이' : '친구가'} 되었다`, toast: true });
          break;
        }
        default:
          break;
      }
    }
    if (events.length) {
      for (const id of new Set(events.map((event) => event.charId ?? charId).filter(Boolean))) {
        if (this.characters[id]) this.checkWardrobe(this.characters[id]);
        this.emitCharacter(id);
      }
    }
  }

  announceTool(character, toolId, reason) {
    const tool = TOOLS[toolId];
    this.chronicle({ emoji: tool.emoji, text: `${iGa(character.name)} 새 장비를 손에 넣었다: ${tool.name} — ${tool.desc}`, charId: character.id, toast: true });
    addMemory(character, { kind: 'milestone', text: `${reason} ${tool.name}을(를) 쓸 수 있게 됐다.`, importance: 8, minute: this.clock.minute });
  }

  // New wardrobe items are announced once.
  checkWardrobe(character) {
    const seen = new Set(character.wardrobeSeen ?? []);
    const fresh = unlockedItems(character).filter((key) => !seen.has(key));
    if (!fresh.length) return;
    character.wardrobeSeen = [...seen, ...fresh];
    this.chronicle({ emoji: '👗', text: `${character.name}의 옷장에 새 아이템: ${fresh.map(itemName).join(', ')}`, charId: character.id, toast: true });
  }

  changeTrust(character, delta) {
    const change = adjustTrust(character, delta);
    if (change) this.recordEvents([{ type: 'trust', charId: character.id, ...change }], character.id);
    return change;
  }

  // ---- approvals: the character asks before acting ------------------------------

  requestApproval({ task, character, kind, tool, summary, detail = null, options = [], point = null, signal = null }) {
    const id = newId('a');
    const live = this.liveScreens.get(task.id);
    const entry = {
      id, taskId: task.id, charId: character.id, kind, tool, summary, detail, options,
      point, screen: live && (tool === 'browser' || tool === 'desktop') ? { seq: live.seq, width: live.width, height: live.height } : null,
      createdAt: this.clock.minute, at: Date.now(),
    };
    return new Promise((resolve) => {
      const finish = (answer) => {
        if (!this.approvals.has(id)) return;
        this.approvals.delete(id);
        signal?.removeEventListener('abort', onAbort);
        character.state.waiting = [...this.approvals.values()].some((other) => other.charId === character.id);
        this.emit('approvalDone', { id, taskId: task.id, decision: answer.decision });
        this.emitTask(task);
        resolve(answer);
      };
      const onAbort = () => finish({ decision: 'deny', note: '업무가 중단됨' });
      entry.finish = finish;
      this.approvals.set(id, entry);
      signal?.addEventListener('abort', onAbort, { once: true });
      character.state.waiting = true;
      this.bubble(character, kind === 'question' ? '🙋 여쭤볼 게 있어요' : '🙋 확인해 주세요', 9999);
      this.emit('approval', approvalView(entry));
      this.emit('toast', { emoji: '🙋', text: `${character.name}: ${truncate(summary, 60)}`, charId: character.id });
      this.emitTask(task);
    });
  }

  resolveApproval(id, { decision, note = '', answer = '' } = {}) {
    const entry = this.approvals.get(id);
    if (!entry) throw new Error('이미 처리됐거나 없는 요청이에요.');
    const choice = ['allow', 'allowAll', 'deny'].includes(decision) ? decision : entry.kind === 'question' ? 'allow' : null;
    if (!choice) throw new Error('decision은 allow, allowAll, deny 중 하나예요.');
    const character = this.characters[entry.charId];
    if (character) this.bubble(character, choice === 'deny' ? '🙇 알겠어요' : '👍 고마워요!', 12);
    entry.finish({ decision: choice, note: truncate(String(note ?? '').trim(), 400), answer: truncate(String(answer ?? '').trim(), 2000) });
    return { ok: true };
  }

  pendingApprovals() {
    return [...this.approvals.values()].map(approvalView);
  }

  setLiveScreen(taskId, shot) {
    const seq = (this.liveScreens.get(taskId)?.seq ?? 0) + 1;
    this.liveScreens.set(taskId, { ...shot, seq });
  }

  // A lent folder must exist and must not be the whole disk, home or a
  // system folder.
  checkFolder(folder) {
    const raw = String(folder ?? '').trim().replace(/^~(?=\/|$)/, homedir());
    if (!raw) return null;
    const path = resolvePath(raw);
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`폴더를 찾을 수 없어요: ${raw}`);
    const real = realpathSync(path);
    const home = realpathSync(homedir());
    const forbidden = ['/', home, '/System', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/Library', '/Applications', '/opt', '/dev', '/boot', '/proc', '/sys'];
    if (forbidden.includes(real) || ['/System/', '/usr/', '/bin/', '/sbin/', '/etc/', '/dev/', '/proc/', '/sys/', join(home, 'Library') + '/'].some((prefix) => (real + '/').startsWith(prefix))) {
      throw new Error('이 폴더는 맡길 수 없어요. 작업할 하위 폴더를 골라 주세요.');
    }
    return real;
  }

  workspaceFor(character, task) {
    if (task.folder) return new Workspace(task.folder, { own: false });
    return new Workspace(join(this.workspaceDir, character.id), { own: true });
  }

  makeScreen(kind) {
    return this.screenFactory ? this.screenFactory(kind) : null;
  }

  cancelTask(id) {
    const task = this.tasks[id];
    if (!task || task.status !== 'working') throw new Error('진행 중인 업무만 멈출 수 있어요.');
    const controller = this.controllers.get(id);
    if (!controller) throw new Error('이 업무는 지금 멈출 수 없어요.');
    controller.abort();
    return { ok: true };
  }

  cancelAll() {
    let count = 0;
    for (const controller of this.controllers.values()) {
      controller.abort();
      count += 1;
    }
    return { cancelled: count };
  }

  emitTask(task) {
    this.emit('task', task);
  }

  emitCharacter(id) {
    const character = this.characters[id];
    if (character) this.emit('character', characterView(character, this.clock.minute));
  }

  // ---- characters ----------------------------------------------------------

  addCharacter(input) {
    const character = createCharacter(input, { minute: this.clock.minute, rng: this.rng });
    character.desk = this.freeDeskIndex();
    character.origin = snapshotOf(character, this.clock.minute);
    this.characters[character.id] = character;
    this.state.chats[character.id] = [];
    const role = ROLES[character.role];
    this.chronicle({ emoji: '🏡', text: `${role.emoji} ${role.name} ${iGa(character.name)} 마을에 이사 왔다`, charId: character.id, toast: true });
    this.emitCharacter(character.id);
    this.saveSoon();
    return character;
  }

  // A card exported from AgentVille keeps its growth, traits and long-term
  // memories, but arrives as a newcomer: fresh id, needs, relationships, place.
  adoptCharacter(full) {
    const base = createCharacter({ name: full.name, role: full.role, traits: [] }, { minute: this.clock.minute, rng: this.rng });
    const items = Array.isArray(full.memory?.items) ? full.memory.items.slice(-400) : [];
    const character = {
      ...base,
      ...full,
      id: base.id,
      name: truncate(String(full.name ?? base.name), 16),
      role: ROLES[full.role] ? full.role : base.role,
      skills: { ...base.skills, ...(full.skills ?? {}) },
      stats: { ...base.stats, ...(full.stats ?? {}), tasksByCat: { ...(full.stats?.tasksByCat ?? {}) } },
      traits: Array.isArray(full.traits) ? full.traits.filter((trait) => TRAITS[trait?.id]) : base.traits,
      quirks: Array.isArray(full.quirks) ? full.quirks.slice(-8) : [],
      needs: base.needs,
      moodlets: [],
      relationships: {},
      userBond: { affinity: 20, ratings: [], trust: START_TRUST },
      toolMastery: { ...(full.toolMastery ?? {}) },
      flags: { burnedOut: false },
      drift: null,
      memory: items.length ? { items, sinceReflection: 0, nextId: Math.max(0, ...items.map((item) => item.id ?? 0)) + 1 } : base.memory,
      state: base.state,
      createdAt: this.clock.minute,
    };
    character.desk = this.freeDeskIndex();
    // Growth from the old town is history; reports here start on arrival.
    character.origin = snapshotOf(character, this.clock.minute);
    this.characters[character.id] = character;
    this.state.chats[character.id] = [];
    addMemory(character, { kind: 'milestone', text: '다른 마을에서 AgentVille로 이사 왔다. 예전 경험은 그대로 기억한다.', importance: 6, minute: this.clock.minute });
    this.chronicle({ emoji: '📦', text: `Lv${character.level} ${iGa(character.name)} 다른 마을에서 이사 왔다`, charId: character.id, toast: true });
    this.emitCharacter(character.id);
    this.saveSoon();
    return character;
  }

  async draftCharacter(description) {
    const text = truncate(String(description ?? '').trim(), 600);
    const taken = new Set(Object.values(this.characters).map((c) => c.name));
    const result = await this.brain.json({
      system: 'AgentVille 마을의 캐릭터 디자이너다. 설명에 맞는, 함께 일하고 싶은 매력적인 AI 동료 캐릭터를 만든다. Big Five 값은 0~100 정수다.',
      messages: [{ role: 'user', content: `${text || '아무나 재미있는 캐릭터'}\n\n가능한 꿈 id: ${Object.keys(ASPIRATIONS).join(', ')}\n이미 마을에 있는 이름(피할 것): ${[...taken].join(', ') || '없음'}` }],
      schema: CHARACTER_SCHEMA,
      effort: 'low',
      meta: { kind: 'character', description: text, salt: this.clock.minute },
    });
    const role = ROLES[result.role] ? result.role : 'researcher';
    const freeNames = KOREAN_NAMES.filter((name) => !taken.has(name));
    const proposed = truncate(String(result.name ?? '').trim(), 16);
    return {
      name: proposed && !taken.has(proposed) ? proposed : (freeNames.length ? this.rng.pick(freeNames) : proposed || '새내기'),
      role,
      bio: truncate(result.bio, 500),
      speech: ['polite', 'casual', 'formal'].includes(result.speech) ? result.speech : 'polite',
      traits: (result.traits ?? []).filter((id) => TRAITS[id]?.kind === 'start').slice(0, 3),
      aspiration: ASPIRATIONS[result.aspiration] ? result.aspiration : ROLES[role].aspiration,
      catchphrase: truncate(result.catchphrase ?? '', 40),
      bigFive: { O: result.openness, C: result.conscientiousness, E: result.extraversion, A: result.agreeableness, N: result.neuroticism },
    };
  }

  freeDeskIndex() {
    const used = new Set(Object.values(this.characters).map((c) => c.desk));
    const desks = spotsOf('d');
    for (let index = 0; index < desks.length; index++) if (!used.has(index)) return index;
    return Object.keys(this.characters).length % desks.length;
  }

  updateCharacter(id, patch) {
    const character = this.characters[id];
    if (!character) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) character.name = truncate(patch.name.trim(), 16);
    if (typeof patch.bio === 'string') character.bio = truncate(patch.bio.trim(), 500);
    if (typeof patch.catchphrase === 'string') character.catchphrase = truncate(patch.catchphrase.trim(), 40);
    if (['polite', 'casual', 'formal'].includes(patch.speech)) character.speech = patch.speech;
    if (patch.aspiration && ASPIRATIONS[patch.aspiration] && patch.aspiration !== character.aspiration.id) {
      character.aspiration = { id: patch.aspiration, stage: 0, done: false };
    }
    if (patch.appearance && typeof patch.appearance === 'object') {
      const { appearance, rejected } = sanitizeAppearance(character, patch.appearance);
      if (rejected.length && Object.keys(patch.appearance).length === rejected.length) throw new Error('아직 잠긴 아이템이에요. 조건을 채우면 열려요.');
      character.appearance = appearance;
      this.bubble(character, '✨ 어때요?', 20);
    }
    this.emitCharacter(id);
    this.saveSoon();
    return character;
  }

  removeCharacter(id) {
    const character = this.characters[id];
    if (!character || character.state.taskId) return false;
    delete this.characters[id];
    delete this.state.chats[id];
    for (const other of Object.values(this.characters)) {
      delete other.relationships[id];
      if (other.state.with === id) this.setIdle(other);
    }
    this.chronicle({ emoji: '👋', text: `${iGa(character.name)} 마을을 떠났다` });
    this.emit('removed', { id });
    this.saveSoon();
    return true;
  }

  // ---- tasks ---------------------------------------------------------------

  previewTask(input) {
    const task = createTask(input, { minute: this.clock.minute });
    const choice = chooseAssignees(this, task);
    return { category: task.category, difficulty: task.difficulty, title: task.title, mode: choice.mode, assignees: choice.assignees, lead: choice.lead, ranking: choice.ranking };
  }

  submitTask(input) {
    const task = createTask(input, { minute: this.clock.minute });
    if (!task.prompt) throw new Error('업무 내용을 입력해 주세요.');
    const ids = Array.isArray(input.attachments) ? [...new Set(input.attachments)] : [];
    if (ids.length > MAX_ATTACHMENTS) throw new Error(`첨부 파일은 ${MAX_ATTACHMENTS}개까지예요.`);
    task.attachments = ids.map((id) => this.files.meta(id));
    if (task.attachments.some((meta) => !meta)) throw new Error('첨부 파일을 찾을 수 없어요. 다시 올려 주세요.');
    task.folder = input.folder ? this.checkFolder(input.folder) : null;
    if (task.folder && task.equipment === 'auto') task.equipment = 'files';
    // Agent equipment works on one screen or folder: solo only.
    if (['browser', 'files', 'desktop'].includes(task.equipment) && task.mode === 'auto') task.mode = 'solo';
    const choice = chooseAssignees(this, task);
    if (!choice.assignees.length) throw new Error(Object.keys(this.characters).length ? '지금은 모두 바빠요. 잠시 뒤 다시 맡겨 주세요.' : '먼저 캐릭터를 만들어 주세요.');
    task.mode = choice.mode;
    task.assignees = choice.assignees;
    task.lead = choice.lead;
    this.tasks[task.id] = task;
    this.state.taskOrder.unshift(task.id);
    const names = task.assignees.map((id) => this.characters[id].name).join(', ');
    this.chronicle({ emoji: task.mode === 'team' ? '🧠' : '📝', text: `${names}${task.mode === 'team' ? '(팀 숙고)' : ''}에게 "${task.title}" 업무가 맡겨졌다`, charId: task.lead });
    this.start(task);
    return task;
  }

  // ---- archive and reports -------------------------------------------------

  archive(query) {
    return searchArchive(this, query);
  }

  report(days) {
    return buildReport(this, { days });
  }

  // A one-line wrap-up of the day that just ended, in the chronicle.
  closeDay(day) {
    const report = buildReport(this, { fromDay: day - 1 });
    const { tasks, xp, star } = report.town;
    if (!tasks && !xp) return;
    const starName = star ? this.characters[star]?.name : null;
    this.chronicle({ emoji: '📊', text: `${day}일차 결산: 업무 ${tasks}건 · 경험치 +${xp}${starName ? ` · 오늘의 주인공 ${starName}` : ''}` });
  }

  retryTask(id) {
    const task = this.tasks[id];
    if (!task || task.status !== 'error') return null;
    const busy = task.assignees.some((charId) => !this.characters[charId] || this.characters[charId].state.taskId);
    if (busy) throw new Error('담당자가 다른 일을 하고 있거나 마을을 떠났습니다.');
    task.steps = [];
    task.output = '';
    task.comment = '';
    this.start(task);
    return task;
  }

  start(task) {
    const job = runTask(this, task).finally(() => this.running.delete(job));
    this.running.add(job);
    return job;
  }

  async idle() {
    while (this.running.size || this.reflecting.size) await Promise.all([...this.running, ...this.reflectionJobs()]);
  }

  reflectionJobs() {
    return [...this.reflecting.values()].map((entry) => entry.job).filter(Boolean);
  }

  feedback(id, rating, comment) {
    const task = this.tasks[id];
    if (!task || task.status !== 'done') throw new Error('완료된 업무만 평가할 수 있어요.');
    const firstRating = task.rating == null;
    const events = applyFeedback(this, task, rating, comment);
    this.recordEvents(events);
    // Good work earns trust; disappointing work costs some.
    if (firstRating) {
      const delta = { 5: 7, 4: 5, 3: 1, 2: -3, 1: -5 }[task.rating] ?? 0;
      for (const charId of task.assignees) if (this.characters[charId] && delta) this.changeTrust(this.characters[charId], task.mode === 'team' ? delta * 0.6 : delta);
    }
    const names = task.assignees.map((charId) => this.characters[charId]?.name).filter(Boolean).join(', ');
    this.chronicle({ emoji: '⭐', text: `사용자가 ${names}의 "${task.title}"에 별 ${task.rating}개를 줬다`, charId: task.lead });
    for (const charId of task.assignees) {
      this.emitCharacter(charId);
      if (this.characters[charId]) this.maybeReflect(this.characters[charId]);
    }
    this.emitTask(task);
    this.saveSoon();
    return task;
  }

  beginWork(character, task) {
    const team = task.mode === 'team' && task.assignees.length > 1;
    character.state.taskId = task.id;
    character.state.with = null;
    const spot = team ? this.freeSpot('m', character) : spotsOf('d')[character.desk ?? 0];
    this.moveTo(character, spot);
    character.state.activity = team ? 'meeting' : 'working';
    character.state.until = Infinity;
    this.bubble(character, `${team ? '🧠' : '💼'} ${truncate(task.title, 14)}`, 9999);
    if (isNight(this.clock.minute) && !traitEffects(character).nightWorker) this.bubble(character, '🥱 야근이다…', 20);
  }

  endWork(character, task) {
    character.state.taskId = null;
    this.setIdle(character);
    this.bubble(character, task.status === 'done' ? '✅ 끝냈다!' : '😵 문제가 생겼어', 25);
    this.emitCharacter(character.id);
  }

  // ---- chat with the user ---------------------------------------------------

  async chat(id, message) {
    const character = this.characters[id];
    if (!character) throw new Error('캐릭터를 찾을 수 없어요.');
    const text = truncate(String(message ?? '').trim(), 2000);
    if (!text) throw new Error('메시지를 입력해 주세요.');
    const history = (this.state.chats[id] ??= []);
    const minute = this.clock.minute;
    const memories = retrieveMemories(character, text, { k: 5, now: minute, touch: false });
    const system = `${personaSystem(character, this, { focus: text, memoryCount: 5 })}\n\n[대화 모드] 지금은 사용자와 1:1로 대화 중이다. 자연스럽게 2~5문장으로 답한다. 긴 결과물이 필요한 요청이면 업무로 맡겨 달라고 제안한다.`;
    const messages = chatMessages(history, text);
    history.push({ role: 'user', text, minute });
    this.emit('chat', { charId: id, role: 'user', text, minute });
    this.bubble(character, '💬 …', 10);
    let reply;
    try {
      reply = await this.brain.text({
        system, messages, effort: 'low', maxTokens: 8000,
        meta: { kind: 'chat', character, message: text, memories, salt: history.length },
        onText: (delta) => this.emit('chatDelta', { charId: id, delta }),
      });
    } catch (error) {
      history.pop();
      throw new Error(this.brain.describeError(error));
    }
    reply = reply.trim();
    history.push({ role: 'char', text: reply, minute: this.clock.minute });
    if (history.length > CHAT_LIMIT) history.splice(0, history.length - CHAT_LIMIT);

    addMemory(character, { kind: 'chat', text: `사용자: "${truncate(text, 120)}" / 나: "${truncate(reply, 120)}"`, importance: estimateImportance(text), minute });
    if (looksLikePreference(text)) addMemory(character, { kind: 'preference', text: `사용자가 말한 선호: ${truncate(text, 200)}`, importance: 8, minute });
    character.stats.chats += 1;
    character.userBond.affinity = clamp(character.userBond.affinity + 0.5, 0, 100);
    character.needs.social = clamp(character.needs.social + 4, 0, 100);
    addMoodlet(character, 'userChat', minute);
    growAttributes(character, 'counseling', 0.1);
    const events = [...addCharacterXp(character, 4, { minute, rng: this.rng }), ...addSkillXp(character, 'counseling', 3, { minute }), ...followUpChecks(character, minute)];
    this.recordEvents(events, id);
    this.bubble(character, `💬 ${truncate(reply, 18)}`, 20);
    this.emit('chat', { charId: id, role: 'char', text: reply, minute: this.clock.minute });
    this.emitCharacter(id);
    this.maybeReflect(character);
    this.saveSoon();
    return reply;
  }

  // ---- reflection -----------------------------------------------------------

  maybeReflect(character) {
    if (!shouldReflect(character) || this.reflecting.has(character.id)) return null;
    const entry = { job: null };
    this.reflecting.set(character.id, entry);
    const job = this.reflect(character).finally(() => this.reflecting.delete(character.id));
    entry.job = job;
    return job;
  }

  async reflect(character) {
    const minute = this.clock.minute;
    const memories = recentMemories(character, 20);
    markReflected(character);
    let result;
    try {
      result = await this.brain.json({
        system: personaSystem(character, this, { memoryCount: 0 }),
        messages: [{ role: 'user', content: reflectionPrompt(character, memories, EARNED_TRAIT_IDS) }],
        schema: REFLECTION_SCHEMA,
        effort: 'low',
        meta: { kind: 'reflection', character },
      });
    } catch (error) {
      this.chronicle({ emoji: '⚠️', text: `${character.name}의 성찰 실패: ${this.brain.describeError(error)}`, charId: character.id });
      return;
    }
    if (!this.characters[character.id]) return;
    for (const insight of (result.insights ?? []).slice(0, 3)) {
      if (insight?.trim()) addMemory(character, { kind: 'reflection', text: insight.trim(), importance: 8, minute });
    }
    const note = String(result.personality_note ?? '').trim();
    if (note) {
      character.quirks.push({ text: truncate(note, 160), minute });
      if (character.quirks.length > 8) character.quirks.shift();
    }
    if (TRAITS[result.trait_hint] && TRAITS[result.trait_hint].kind === 'earned') character.flags.traitHint = result.trait_hint;
    character.stats.reflections += 1;
    character.memory.sinceReflection = 0;
    addMoodlet(character, 'insight', minute);
    const first = result.insights?.[0];
    this.chronicle({ emoji: '🔮', text: `${eunNeun(character.name)} 지난 일을 돌아봤다: "${truncate(first ?? note, 60)}"`, charId: character.id, toast: true });
    if (note) this.chronicle({ emoji: '🪞', text: `${character.name}의 성격 메모가 늘었다: "${truncate(note, 60)}"`, charId: character.id });
    this.recordEvents(followUpChecks(character, minute), character.id);
    this.emitCharacter(character.id);
    this.saveSoon();
  }

  // ---- daily life -------------------------------------------------------------

  setIdle(character) {
    character.state.activity = 'idle';
    character.state.with = null;
    character.state.path = [];
    character.state.until = this.clock.minute;
    character.state.phase = null;
  }

  bubble(character, text, minutes) {
    character.state.bubble = { text, until: this.clock.minute + minutes };
  }

  occupiedTiles(except) {
    const taken = new Set();
    for (const other of Object.values(this.characters)) {
      if (other.id === except?.id) continue;
      const target = other.state.path.length ? other.state.path[other.state.path.length - 1] : other.state.pos;
      taken.add(tileKey(target));
    }
    return taken;
  }

  freeSpot(letter, character) {
    const taken = this.occupiedTiles(character);
    const spots = spotsOf(letter).filter((spot) => !taken.has(tileKey(spot)));
    if (!spots.length) return null;
    // Prefer nearby spots so nobody marches across town for coffee.
    const sorted = spots.sort((a, b) => distance(a, character.state.pos) - distance(b, character.state.pos));
    return sorted[Math.floor(this.rng() * Math.min(4, sorted.length))];
  }

  moveTo(character, spot) {
    if (!spot) return false;
    const path = findPath(character.state.pos, spot);
    if (!path) return false;
    character.state.path = path;
    character.state.moveAcc = 0;
    return true;
  }

  activityUtility(character, id, effects) {
    const activity = ACTIVITIES[id];
    const { hour } = clockParts(this.clock.minute);
    const duration = (activity.minutes[0] + activity.minutes[1]) / 2;
    let utility = 0.05;
    for (const [need, gain] of Object.entries(activity.gains)) if (gain > 0) utility += gain * duration * urgency(character, need) / 10;
    const { O, E, N } = character.bigFive;
    const preference = {
      read: 0.75 + O / 250 + (100 - E) / 400,
      game: 0.8 + E / 300,
      walk: 0.8 + O / 300,
      nap: 0.85 + N / 300,
      coffee: 0.9 + E / 400,
      lunch: activity.peak && hour >= activity.peak[0] && hour < activity.peak[1] ? 2.6 : 0.35,
      daydream: 0.55,
    }[id] ?? 1;
    utility *= preference * (effects.activity[id] ?? 1);
    if (character.state.lastActivity === id) utility *= 0.5;
    const last = character.state.lastDone?.[id];
    if (last != null && this.clock.minute - last < (activity.cooldown ?? 0)) utility *= id === 'lunch' ? 0.03 : 0.3;
    return utility;
  }

  chooseActivity(character) {
    const effects = traitEffects(character);
    const options = IDLE_ACTIVITY_IDS.map((id) => [id, this.activityUtility(character, id, effects)]);
    if (character.needs.social < 75) {
      const partner = this.findChatPartner(character);
      if (partner) {
        const chat = ACTIVITIES.chat;
        const utility = chat.gains.social * 16 * urgency(character, 'social') / 10 * (0.6 + character.bigFive.E / 100) * (effects.activity.chat ?? 1) + 0.1;
        options.push([{ chat: partner }, utility]);
      }
    }
    options.sort((a, b) => b[1] - a[1]);
    return this.rng.weighted(options.slice(0, 3).map(([value, utility]) => [value, utility ** 2]));
  }

  findChatPartner(character) {
    const candidates = Object.values(this.characters).filter((other) => other.id !== character.id
      && other.state.activity !== 'sleep' && !other.state.taskId && other.state.activity !== 'chat'
      && distance(other.state.pos, character.state.pos) <= 14
      && (character.state.lastPartner !== other.id || this.rng.chance(0.3)));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => (character.relationships[b.id]?.friendship ?? 0) - (character.relationships[a.id]?.friendship ?? 0) + (this.rng() - 0.5) * 30)[0];
  }

  startActivity(character, choice) {
    const minute = this.clock.minute;
    if (choice && typeof choice === 'object' && choice.chat) return this.startChat(character, choice.chat);
    const activity = ACTIVITIES[choice] ?? ACTIVITIES.daydream;
    const id = ACTIVITIES[choice] ? choice : 'daydream';
    const duration = this.rng.int(activity.minutes[0], activity.minutes[1]);
    if (activity.spot) {
      const spot = this.freeSpot(activity.spot, character);
      if (!spot || !this.moveTo(character, spot)) return this.startActivity(character, 'daydream');
    }
    character.state.activity = id;
    character.state.lastActivity = id;
    character.state.lastDone = { ...(character.state.lastDone ?? {}), [id]: minute };
    character.state.until = minute + duration + Math.ceil(character.state.path.length / WALK_TILES_PER_MINUTE);
    this.bubble(character, `${activity.emoji} ${activity.name}`, 12);
    return id;
  }

  startChat(character, partner) {
    const minute = this.clock.minute;
    const spot = neighbourOf(partner.state.pos, this.occupiedTiles(character));
    if (!spot || !this.moveTo(character, spot)) return this.startActivity(character, 'daydream');
    for (const [self, other] of [[character, partner], [partner, character]]) {
      self.state.activity = 'chat';
      self.state.with = other.id;
      self.state.lastPartner = other.id;
      self.state.phase = self === character ? 'approach' : 'wait';
      self.state.until = minute + 40;
    }
    partner.state.path = [];
    this.bubble(character, `👋 ${partner.name}!`, 6);
    return 'chat';
  }

  async beginTalk(a, b) {
    const minute = this.clock.minute;
    const duration = this.rng.int(ACTIVITIES.chat.minutes[0], ACTIVITIES.chat.minutes[1]);
    const talk = { id: newId('talk'), topic: '', lines: [], tone: 'warm', start: minute, end: minute + duration };
    for (const self of [a, b]) {
      self.state.phase = 'talk';
      self.state.until = talk.end;
      self.state.talk = talk;
    }
    const useLlm = this.settings.llmSmallTalk && this.brain.live;
    const brain = useLlm ? this.brain : this.chatterBrain;
    try {
      const result = await brain.json({
        system: `${personaSystem(a, this, { memoryCount: 2, focus: b.name })}\n\n상대: ${b.name} (${ROLES[b.role].name}). ${b.bio}`,
        messages: [{ role: 'user', content: `${gwaWa(a.name)} ${b.name}의 짧은 잡담을 만들어 줘. 두 사람의 성격이 드러나게, 각 대사는 25자 이내.` }],
        schema: SMALLTALK_SCHEMA,
        effort: 'low',
        maxTokens: 3000,
        meta: { kind: 'smalltalk', character: a, salt: `${b.id}:${minute}` },
      });
      talk.topic = truncate(result.topic ?? '', 30);
      talk.lines = (result.lines ?? []).slice(0, 6).map((line) => truncate(String(line).replace(/^[^:：]{1,8}[:：]\s*/, ''), 40));
      talk.tone = result.tone ?? 'warm';
    } catch {
      talk.lines = ['요즘 어때?', '그럭저럭!', '이따 커피 한잔?', '좋지!'];
      talk.topic = '안부';
    }
  }

  updateTalk(a, b) {
    const talk = a.state.talk;
    if (!talk || !talk.lines.length) return;
    const span = Math.max(1, talk.end - talk.start);
    const index = Math.min(talk.lines.length - 1, Math.floor(((this.clock.minute - talk.start) / span) * talk.lines.length));
    if (talk.shown === index) return;
    talk.shown = index;
    const speaker = index % 2 === 0 ? a : b;
    this.bubble(speaker, talk.lines[index], 3);
  }

  finishTalk(a, b) {
    const minute = this.clock.minute;
    const talk = a.state.talk ?? { topic: '안부', tone: 'warm' };
    const toneDelta = { warm: 2, neutral: 0, awkward: -2, heated: -5 }[talk.tone] ?? 0;
    const delta = 3 + compatibility(a, b) * 4 + traitEffects(a).socialDelta + traitEffects(b).socialDelta + toneDelta + (this.rng() - 0.5) * 3;
    const crossed = adjustFriendship(a, b, delta, minute);
    for (const [self, other] of [[a, b], [b, a]]) {
      applyGains(self, ACTIVITIES.chat.gains, Math.max(1, talk.end - talk.start));
      self.stats.smallTalks += 1;
      addMoodlet(self, delta > 0 ? 'goodChat' : 'awkwardChat', minute);
      const label = relationshipLabel(self.relationships[other.id].friendship).label;
      addMemory(self, { kind: 'social', text: `${gwaWa(other.name)} ${talk.topic || '이런저런 이야기'}에 대해 수다를 떨었다. (${label})`, importance: crossed ? 6 : 3, minute });
      self.state.talk = null;
      this.setIdle(self);
    }
    if (crossed) this.recordEvents([crossed]);
    for (const self of [a, b]) this.recordEvents(followUpChecks(self, minute), self.id);
  }

  // ---- tick -------------------------------------------------------------------

  tick(realMs = 250) {
    if (this.clock.paused) return;
    const minutes = (realMs / 1000) * this.clock.speed;
    if (minutes <= 0) return;
    const before = this.clock.minute;
    this.clock.minute += minutes;
    const now = this.clock.minute;
    const night = isNight(now);
    const wokeUp = isNight(before) && !night;
    const day = Math.floor(now / 1440);
    if (day !== Math.floor(before / 1440)) {
      this.closeDay(day);
      recordDay(this.state, now);
    }

    for (const character of Object.values(this.characters)) {
      expireMoodlets(character, now);
      const state = character.state;
      const working = Boolean(state.taskId);
      if (decayNeeds(character, minutes, { working, night }) === 'burnout') {
        addMoodlet(character, 'burnout', now);
        this.chronicle({ emoji: '🪫', text: `${iGa(character.name)} 완전히 지쳐 버렸다… 쉬게 해 주세요`, charId: character.id, toast: true });
      }
      if (state.bubble && state.bubble.until <= now) state.bubble = null;

      this.walk(character, minutes);
      if (working) continue;

      if (state.activity === 'chat') {
        this.tickChat(character, now);
        continue;
      }
      const activity = ACTIVITIES[state.activity];
      if (activity && !state.path.length) {
        applyGains(character, activity.gains, minutes);
        if (activity.xpPerMinute) this.selfStudy(character, activity.xpPerMinute * minutes);
      }
      if (state.activity === 'sleep') {
        if (wokeUp || !night) {
          if (character.needs.energy > 80) addMoodlet(character, 'wellRested', now);
          this.setIdle(character);
          this.bubble(character, '🌅 좋은 아침!', 15);
        }
        continue;
      }
      if (night) {
        const bed = this.freeSpot('z', character);
        if (bed && this.moveTo(character, bed)) {
          state.activity = 'sleep';
          state.until = Infinity;
          this.bubble(character, '😴 잘 자', 10);
        }
        continue;
      }
      if (state.until <= now && !state.path.length) {
        if (state.activity !== 'idle') this.setIdle(character);
        this.startActivity(character, this.chooseActivity(character));
      }
    }
    if (Math.floor(before / 60) !== Math.floor(now / 60)) this.saveSoon(100);
  }

  walk(character, minutes) {
    const state = character.state;
    if (!state.path.length) return;
    state.moveAcc = (state.moveAcc ?? 0) + minutes * WALK_TILES_PER_MINUTE;
    while (state.moveAcc >= 1 && state.path.length) {
      state.pos = state.path.shift();
      state.moveAcc -= 1;
    }
    if (!state.path.length) state.moveAcc = 0;
  }

  tickChat(character, now) {
    const state = character.state;
    const partner = this.characters[state.with];
    if (!partner || partner.state.with !== character.id || partner.state.taskId) {
      this.setIdle(character);
      return;
    }
    if (state.phase === 'approach' && !state.path.length) {
      if (distance(state.pos, partner.state.pos) <= 1) this.beginTalk(character, partner);
      else this.setIdle(character);
      return;
    }
    if (state.phase === 'talk' && state.talk) {
      if (character.id < partner.id) this.updateTalk(character, partner);
      if (now >= state.talk.end && character.id < partner.id) this.finishTalk(character, partner);
      return;
    }
    if (now >= state.until) this.setIdle(character);
  }

  // Reading in the library trickles XP into the skill the character dreams of.
  selfStudy(character, amount) {
    const { day } = clockParts(this.clock.minute);
    const ledger = character.state.study?.day === day ? character.state.study : { day, xp: 0 };
    character.state.study = ledger;
    if (ledger.xp >= SELF_STUDY_DAILY_CAP) return;
    ledger.xp += amount;
    const aspiration = ASPIRATIONS[character.aspiration.id];
    const dream = Object.keys(SKILLS).find((id) => aspiration?.stages.some((stage) => stage.label.includes(SKILLS[id].name)));
    const skillId = dream ?? Object.keys(ROLES[character.role].skills)[0];
    character.stats.readMinutes += amount / ACTIVITIES.read.xpPerMinute;
    const events = addSkillXp(character, skillId, amount, { minute: this.clock.minute });
    if (events.length) this.recordEvents([...events, ...followUpChecks(character, this.clock.minute)], character.id);
  }

  // ---- views ------------------------------------------------------------------

  snapshot() {
    const now = this.clock.minute;
    return {
      clock: this.clock,
      settings: this.settings,
      brain: { name: this.brain.name, live: this.brain.live, model: this.brain.model },
      characters: Object.values(this.characters).map((character) => characterView(character, now)),
      tasks: this.state.taskOrder.map((id) => this.tasks[id]).filter(Boolean).slice(0, 60),
      chronicle: this.state.chronicle.slice(-120),
      chats: this.state.chats,
      approvals: this.pendingApprovals(),
    };
  }

  tickView() {
    return {
      clock: this.clock,
      characters: Object.values(this.characters).map((character) => ({
        id: character.id,
        pos: character.state.pos,
        activity: character.state.activity,
        taskId: character.state.taskId,
        waiting: Boolean(character.state.waiting),
        bubble: character.state.bubble,
        mood: computeMood(character),
        needs: character.needs,
      })),
    };
  }

  ranking(input) {
    return rankCandidates(this, createTask(input, { minute: this.clock.minute }));
  }
}
