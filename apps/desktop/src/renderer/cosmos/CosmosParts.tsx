// Shared COSMOS building blocks: the mark, the verdict hero with its single
// action, the step-by-step outcome of 해/달, Galaxy setup, the star name
// editor and the new-PC checklist.
import { useState } from 'react';
import type { CosmosOverview, CosmosStarKind } from '../../shared/contract-cosmos';
import { ACTION_LABEL, cosmosVerdict, josa, kindGlyph, type CosmosAction } from './cosmos-format';
import {
  clearCosmosNotice,
  cosmosAskTurn,
  cosmosContinue,
  cosmosLeave,
  cosmosRenameStar,
  cosmosSetupGalaxy,
  cosmosSit,
  cosmosWithdraw,
  type CosmosEntry,
} from './cosmos-store';

/** The ringed-planet mark (same artwork as the app icon). */
export function CosmosMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg className="cosmos-mark" viewBox="0 0 256 256" width={size} height={size} role={title ? 'img' : 'presentation'} aria-label={title}>
      <defs>
        <radialGradient id="cm-space" cx="0.37" cy="0.28" r="0.95">
          <stop offset="0" stopColor="#212468" />
          <stop offset="1" stopColor="#07091c" />
        </radialGradient>
        <linearGradient id="cm-planet" x1="0.15" y1="0.1" x2="0.85" y2="0.9">
          <stop offset="0" stopColor="#c7d2fe" />
          <stop offset="0.5" stopColor="#818cf8" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
        <linearGradient id="cm-ring" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <clipPath id="cm-front">
          <rect x="-100" y="0" width="200" height="40" />
        </clipPath>
      </defs>
      <rect width="256" height="256" rx="60" fill="url(#cm-space)" />
      <g fill="#fff">
        <circle cx="46" cy="58" r="3" />
        <circle cx="150" cy="44" r="2.4" />
        <circle cx="58" cy="202" r="2.4" />
        <circle cx="214" cy="176" r="3" />
      </g>
      <g transform="translate(120 140) rotate(-22)">
        <path fillRule="evenodd" fill="url(#cm-ring)" d="M-94 0A94 25 0 1 0 94 0A94 25 0 1 0-94 0ZM-73.3 0A73.3 19.5 0 1 0 73.3 0A73.3 19.5 0 1 0-73.3 0Z" />
      </g>
      <circle cx="120" cy="140" r="52" fill="url(#cm-planet)" />
      <g transform="translate(120 140) rotate(-22)" clipPath="url(#cm-front)">
        <path fillRule="evenodd" fill="url(#cm-ring)" d="M-94 0A94 25 0 1 0 94 0A94 25 0 1 0-94 0ZM-73.3 0A73.3 19.5 0 1 0 73.3 0A73.3 19.5 0 1 0-73.3 0Z" />
      </g>
      <path d="M198 38L203 55L220 60L203 65L198 82L193 65L176 60L193 55Z" fill="#fff7cc" />
    </svg>
  );
}

export interface CosmosActionContext {
  projectPath: string;
  entry: CosmosEntry;
  /** The open conversation on this planet, carried by 달. */
  sessionId?: string | null;
  onOpenGalaxy?: () => void;
}

/** Actions that take a one-line note first (shown inline; Electron has no prompt()). */
export const NOTE_ACTIONS: ReadonlySet<CosmosAction> = new Set<CosmosAction>(['moon', 'handoff', 'request']);

/** Runs a verdict action; 'setup' opens the Galaxy screen. */
export function runCosmosAction(action: CosmosAction, { projectPath, entry, sessionId, onOpenGalaxy }: CosmosActionContext, note = ''): void {
  const view = entry.view;
  if (!action) return;
  if (action === 'setup') {
    onOpenGalaxy?.();
    return;
  }
  if (action === 'sun') void cosmosSit(projectPath);
  else if (action === 'force') {
    const holder = view?.seat?.holder?.name || '다른 기기';
    if (window.confirm(`${josa(holder, '이가')} 응답이 없어요. 조종석을 넘겨받을까요?\n그 기기에 남은 작업은 나중에 별도 브랜치로 보관돼요.`)) {
      void cosmosSit(projectPath, { force: true });
    }
  } else if (action === 'moon' || action === 'handoff') {
    const handoffTo = action === 'handoff' ? view?.seat?.requests[0]?.star ?? null : null;
    void cosmosLeave(projectPath, { note, handoffTo, sessionId: sessionId ?? null });
  } else if (action === 'request') void cosmosAskTurn(projectPath, note);
  else if (action === 'withdraw') void cosmosWithdraw(projectPath);
  else if (action === 'carry') void cosmosSit(projectPath);
  else if (action === 'reclaim') {
    const holder = view?.seat?.holder?.name || '폰';
    if (window.confirm(`${josa(holder, '이가')} 조종 중이에요. 이 PC로 되찾을까요?\n폰은 잠기고, 폰에서 하던 작업은 이 PC에 그대로 있어요.`)) {
      void cosmosSit(projectPath);
    }
  }
}

const NOTE_PROMPT: Partial<Record<Exclude<CosmosAction, null>, { label: string; placeholder: string; submit: string }>> = {
  moon: { label: '🌙 어디까지 했나요? 다음 기기에 보여 줄 한 줄', placeholder: '예) 로그인 화면 완성, API 연결은 다음에', submit: '🌙 저장하고 내리기' },
  handoff: { label: '🌙 넘겨주며 남길 한 줄', placeholder: '예) 테스트 3개 남았어요', submit: '🌙 마무리하고 넘기기' },
  request: { label: '🔁 교대 요청과 함께 보낼 말 (선택)', placeholder: '예) 회의실에서 이어서 할게요', submit: '🔁 교대 요청 보내기' },
};

/** Inline one-line note for 달/교대, so the hand-over always carries context. */
export function ActionNote({
  action,
  busy,
  onSubmit,
  onCancel,
}: {
  action: Exclude<CosmosAction, null>;
  busy: boolean;
  onSubmit(note: string): void;
  onCancel(): void;
}) {
  const [note, setNote] = useState('');
  const copy = NOTE_PROMPT[action];
  if (!copy) return null;
  return (
    <form
      className="cosmos-note"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(note.trim());
      }}
    >
      <label>
        <span>{copy.label}</span>
        {/* biome-ignore lint/a11y/noAutofocus: the note is the only thing this step asks for */}
        <input autoFocus value={note} maxLength={300} placeholder={copy.placeholder} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="cosmos-note-actions">
        <button type="submit" className={`cosmos-button cosmos-button--${action === 'request' ? 'plain' : 'moon'}`} disabled={busy}>
          {copy.submit}
        </button>
        <button type="button" className="cosmos-link" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

export function VerdictHero({
  context,
  compact = false,
}: {
  context: CosmosActionContext;
  compact?: boolean;
}) {
  const verdict = cosmosVerdict(context.entry.view);
  const busy = Boolean(context.entry.busy);
  const [composing, setComposing] = useState<CosmosAction>(null);
  const tone = (action: CosmosAction) =>
    action === 'sun' || action === 'carry' ? 'sun' : action === 'moon' || action === 'handoff' ? 'moon' : action === 'force' ? 'danger' : 'plain';
  return (
    <section className={`cosmos-hero cosmos-hero--${verdict.level}${compact ? ' cosmos-hero--compact' : ''}`} aria-live="polite">
      <span className="cosmos-hero-icon" aria-hidden="true">
        {verdict.icon}
      </span>
      <div className="cosmos-hero-text">
        <h2>{verdict.title}</h2>
        {verdict.detail && <p>{verdict.detail}</p>}
        {composing && (
          <ActionNote
            action={composing}
            busy={busy}
            onCancel={() => setComposing(null)}
            onSubmit={(note) => {
              runCosmosAction(composing, context, note);
              setComposing(null);
            }}
          />
        )}
      </div>
      {verdict.action && !composing && (
        <button
          type="button"
          className={`cosmos-button cosmos-button--${tone(verdict.action)}`}
          disabled={busy}
          onClick={() => (NOTE_ACTIONS.has(verdict.action) ? setComposing(verdict.action) : runCosmosAction(verdict.action, context))}
        >
          {busy ? '진행 중…' : ACTION_LABEL[verdict.action]}
        </button>
      )}
    </section>
  );
}

type Step = { label: string; state: 'done' | 'warn' | 'skip' };

function sunSteps(entry: CosmosEntry): Step[] {
  const result = entry.lastSun;
  if (!result) return [];
  const project = result.project;
  return [
    {
      label: project?.pulled ? `프로젝트 받기 · 새 커밋 ${project.pulled}개` : project?.ok === false ? `프로젝트 받기 · 확인 필요 (${project.error})` : '프로젝트 받기 · 이미 최신',
      state: project?.ok === false ? 'warn' : 'done',
    },
    {
      label: result.environment ? `환경 맞추기 · ${result.environment.down}개 받음${result.environment.conflicts.length ? ` · 충돌 ${result.environment.conflicts.length}개(백업함)` : ''}` : '환경 맞추기',
      state: result.environment?.conflicts.length ? 'warn' : 'done',
    },
    {
      label: result.conversation ? `교신 찾음 · “${result.conversation.title || '제목 없음'}” ${result.conversation.messageCount}개 메시지` : '이어갈 교신 없음',
      state: result.conversation ? 'done' : 'skip',
    },
    { label: result.took ? `조종석 앉기 · ${result.took.name}에게서 넘겨받음` : '조종석 앉기', state: result.took ? 'warn' : 'done' },
    ...(result.rescue ? [{ label: `남은 작업 보관 · ${result.rescue.branch}`, state: 'warn' as const }] : []),
  ];
}

function moonSteps(entry: CosmosEntry): Step[] {
  const result = entry.lastMoon;
  if (!result) return [];
  const project = result.project;
  return [
    { label: project?.committed ? '저장 · 변경 사항 커밋' : '저장 · 바뀐 것 없음', state: 'done' },
    {
      label: project?.pushed ? '올리기 · 원격 저장소에 푸시' : project?.ok === false ? `올리기 · 확인 필요 (${project.error})` : '올리기 · 이미 최신',
      state: project?.ok === false ? 'warn' : 'done',
    },
    { label: result.environment ? `은하수 · 환경 ${result.environment.up}개 올림` : '은하수', state: 'done' },
    { label: result.conversation ? `교신 · ${result.conversation.messageCount}개 메시지 올림` : '교신 · 올릴 대화 없음', state: result.conversation ? 'done' : 'skip' },
    { label: result.handoffTo ? '조종석 · 교대 요청한 기기에게 넘김' : '조종석 · 비움', state: 'done' },
  ];
}

const STEP_GLYPH: Record<Step['state'], string> = { done: '✓', warn: '!', skip: '–' };

/** What the last 해/달 actually did, step by step, or why it was refused. */
export function RelayOutcome({ projectPath, entry }: { projectPath: string; entry: CosmosEntry }) {
  const steps = entry.lastSun ? sunSteps(entry) : moonSteps(entry);
  if (entry.busy === 'sun' || entry.busy === 'moon') {
    const labels = entry.busy === 'sun' ? ['프로젝트 받기', '환경 맞추기', '교신 찾기', '조종석 앉기'] : ['저장', '올리기', '은하수', '교신', '조종석 비우기'];
    return (
      <div className="cosmos-outcome is-running" role="status">
        <b>{entry.busy === 'sun' ? '☀️ 앉는 중…' : '🌙 마무리하는 중…'}</b>
        <ol className="cosmos-steps">
          {labels.map((label) => (
            <li key={label} className="is-pending">
              <span aria-hidden="true">·</span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (entry.refusal) {
    return (
      <div className="cosmos-outcome cosmos-outcome--refused" role="alert">
        <b>⚠️ {entry.refusal.message}</b>
        {entry.refusal.secrets?.length ? (
          <ul className="cosmos-secret-list">
            {entry.refusal.secrets.map((finding) => (
              <li key={finding.path}>
                <code>{finding.path}</code> {finding.reason === 'file' ? '비밀 파일' : '토큰처럼 보이는 내용'}
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="cosmos-link" onClick={() => clearCosmosNotice(projectPath)}>
          닫기
        </button>
      </div>
    );
  }
  if (entry.error) {
    return (
      <div className="cosmos-outcome cosmos-outcome--refused" role="alert">
        <b>⚠️ {entry.error}</b>
        <button type="button" className="cosmos-link" onClick={() => clearCosmosNotice(projectPath)}>
          닫기
        </button>
      </div>
    );
  }
  if (!steps.length) return null;
  const conversation = entry.lastSun?.conversation;
  return (
    <div className="cosmos-outcome" role="status">
      <b>{entry.lastSun ? '☀️ 조종석에 앉았어요' : '🌙 마무리했어요 · 다른 기기에서 ☀️을 누르면 이어져요'}</b>
      <ol className="cosmos-steps">
        {steps.map((step) => (
          <li key={step.label} className={`is-${step.state}`}>
            <span aria-hidden="true">{STEP_GLYPH[step.state]}</span>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="cosmos-outcome-actions">
        {conversation && (
          <button type="button" className="cosmos-button cosmos-button--sun" disabled={Boolean(entry.busy)} onClick={() => void cosmosContinue(projectPath, conversation.id)}>
            💬 이 교신 이어가기
          </button>
        )}
        <button type="button" className="cosmos-link" onClick={() => clearCosmosNotice(projectPath)}>
          확인
        </button>
      </div>
    </div>
  );
}

/** First contact: create the private Galaxy with gh, or adopt an existing URL. */
export function GalaxySetup({ projectPath, entry }: { projectPath: string | null; entry: CosmosEntry }) {
  const [url, setUrl] = useState('');
  const busy = entry.busy === 'setup';
  return (
    <section className="cosmos-card cosmos-setup">
      <h3>🌌 은하수 연결</h3>
      <p>
        내 GitHub에 비공개 저장소 <code>cosmos-galaxy</code>를 하나 두고, 설정·스킬·기억·교신을 모든 기기가 함께 써요. 비밀번호와 API 키는
        절대 올라가지 않아요.
      </p>
      <div className="cosmos-setup-actions">
        <button type="button" className="cosmos-button cosmos-button--sun cosmos-button--large" disabled={busy} onClick={() => void cosmosSetupGalaxy(projectPath, { create: true })}>
          {busy ? '연결하는 중…' : '✨ 내 GitHub에 은하수 만들기 / 찾기'}
        </button>
      </div>
      <details className="cosmos-setup-advanced">
        <summary>이미 있는 저장소 주소로 연결</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim()) void cosmosSetupGalaxy(projectPath, { remoteUrl: url.trim() });
          }}
        >
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/나/cosmos-galaxy.git" aria-label="은하수 저장소 주소" />
          <button type="submit" className="cosmos-button cosmos-button--plain" disabled={busy || !url.trim()}>
            연결
          </button>
        </form>
      </details>
    </section>
  );
}

const KINDS: Array<{ value: CosmosStarKind; label: string }> = [
  { value: 'mac', label: '💻 맥' },
  { value: 'pc', label: '🖥️ PC' },
];

/** This device's name and kind, as other stars see it. */
export function StarIdentity({ projectPath, view, entry }: { projectPath: string | null; view: CosmosOverview; entry: CosmosEntry }) {
  const [name, setName] = useState(view.star.name);
  const dirty = name.trim() && name.trim() !== view.star.name;
  return (
    <section className="cosmos-card cosmos-identity">
      <h3>
        <span className="cosmos-dot cosmos-dot--large" style={{ background: view.star.color }} aria-hidden="true" />
        이 기기의 별
      </h3>
      <form
        className="cosmos-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) void cosmosRenameStar(projectPath, { name: name.trim() });
        }}
      >
        <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} aria-label="별 이름" />
        <button type="submit" className="cosmos-button cosmos-button--plain" disabled={!dirty || entry.busy === 'star'}>
          이름 저장
        </button>
      </form>
      <div className="cosmos-segment" role="radiogroup" aria-label="기기 종류">
        {KINDS.map((kind) => (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={view.star.kind === kind.value}
            className={view.star.kind === kind.value ? 'is-on' : ''}
            onClick={() => void cosmosRenameStar(projectPath, { kind: kind.value })}
          >
            {kind.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** New-PC readiness: everything a fresh star needs, with a progress ring. */
export function NewStarChecklist({ view, onOpenSettings }: { view: CosmosOverview; onOpenSettings?: () => void }) {
  const items = [
    { label: 'git 사용 가능', done: true, hint: '' },
    { label: '은하수 연결', done: view.ready, hint: '위의 은하수 연결을 눌러 주세요.' },
    { label: '은하수와 동기화', done: Boolean(view.syncedAt), hint: '☀️ 앉기를 한 번 하면 맞춰져요.' },
    { label: '이 기기 이름 짓기', done: Boolean(view.star.name), hint: '' },
    { label: '행성(프로젝트)에 원격 저장소', done: Boolean(view.planet?.id), hint: '프로젝트를 GitHub 등에 올려 주세요.' },
    { label: '다른 별(기기)과 연결됨', done: view.stars.length > 1, hint: '다른 기기에서도 같은 은하수를 연결하세요.' },
  ];
  const done = items.filter((item) => item.done).length;
  const ratio = done / items.length;
  const circumference = 2 * Math.PI * 22;
  return (
    <section className="cosmos-card cosmos-checklist">
      <div className="cosmos-checklist-head">
        <svg viewBox="0 0 56 56" width="56" height="56" role="img" aria-label={`준비 ${done}/${items.length}`}>
          <circle cx="28" cy="28" r="22" className="cosmos-ring-track" />
          <circle
            cx="28"
            cy="28"
            r="22"
            className="cosmos-ring-fill"
            strokeDasharray={`${circumference * ratio} ${circumference}`}
            transform="rotate(-90 28 28)"
          />
          <text x="28" y="33" textAnchor="middle" className="cosmos-ring-text">
            {done}/{items.length}
          </text>
        </svg>
        <div>
          <h3>새 기기 준비</h3>
          <p>{done === items.length ? '모든 준비가 끝났어요 ✨' : '체크가 모두 켜지면 어느 기기에서든 바로 이어서 작업해요.'}</p>
        </div>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.label} className={item.done ? 'is-done' : ''}>
            <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
            <span>{item.label}</span>
            {!item.done && item.hint && <small>{item.hint}</small>}
          </li>
        ))}
      </ul>
      {onOpenSettings && (
        <button type="button" className="cosmos-link" onClick={onOpenSettings}>
          AI 계정은 관제실에서 로그인해요 →
        </button>
      )}
    </section>
  );
}

export function StarList({ view }: { view: CosmosOverview }) {
  return (
    <ul className="cosmos-star-list">
      {view.stars.map((star) => (
        <li key={star.id}>
          <span className="cosmos-dot" style={{ background: star.color }} aria-hidden="true" />
          <span>
            {kindGlyph(star.kind)} {star.name}
            {star.me ? ' · 이 기기' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
