// 우주 홈: the first thing every new 세션 shows. One glance answers "where is
// my work and can I start here?", and three big buttons do the rest:
//   ☀️ 이어받기 (or 🔁 교대 요청 when another device is working) · 🌙 내려놓기 · 💬 새 세션
import { useState } from 'react';
import type { CosmosAction } from './cosmos-format';
import { since } from './cosmos-format';
import { ActionNote, CosmosMark, NOTE_ACTIONS, RelayOutcome, VerdictHero, runCosmosAction } from './CosmosParts';
import { StarMap } from './StarMap';
import { useCosmos } from './cosmos-store';

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return '깊은 밤이에요';
  if (hour < 11) return '좋은 아침이에요';
  if (hour < 17) return '좋은 오후예요';
  if (hour < 21) return '좋은 저녁이에요';
  return '오늘도 수고했어요';
}

export function openCosmosGalaxy(): void {
  window.dispatchEvent(new CustomEvent('cosmos:open-galaxy'));
}

function focusComposer(): void {
  const field = document.querySelector<HTMLTextAreaElement>('form.composer textarea');
  field?.focus();
}

/** The first big button changes with the seat; one face per action. */
type SunFace = { tone: string; icon: string; title: string; sub: string };
const SUN_FACE: Record<'sun' | 'request' | 'force' | 'reclaim' | 'carry', SunFace> = {
  sun: { tone: 'sun', icon: '☀️', title: '이어받기', sub: '최신 작업·환경·세션을 받아 시작' },
  request: { tone: 'plain', icon: '🔁', title: '교대 요청', sub: '' },
  force: { tone: 'danger', icon: '⚠️', title: '넘겨받기', sub: '응답 없는 기기 대신 이어받기' },
  reclaim: { tone: 'plain', icon: '↩️', title: '되찾기', sub: '폰에서 작업 중 · 이 PC로 가져오기' },
  carry: { tone: 'sun', icon: '📱', title: '폰으로 이어하기', sub: '연결된 PC의 작업을 그대로 이어받기' },
};

export function CosmosHome({ projectPath, projectLabel }: { projectPath: string; projectLabel?: string }) {
  const entry = useCosmos(projectPath);
  const view = entry.view;
  const [composing, setComposing] = useState<CosmosAction>(null);
  const state = view?.state ?? null;
  const context = { projectPath, entry, onOpenGalaxy: openCosmosGalaxy };
  const relayReady = Boolean(view?.ready && view.planet?.id);
  const sunAction: CosmosAction =
    state === 'remote'
      ? 'reclaim'
      : view?.here && (state === 'occupied' || state === 'stale')
        ? 'carry'
        : state === 'occupied'
          ? 'request'
          : state === 'stale'
            ? 'force'
            : 'sun';
  const face: SunFace = SUN_FACE[sunAction as keyof typeof SUN_FACE] ?? SUN_FACE.sun;
  const busy = Boolean(entry.busy);
  const press = (action: CosmosAction) => {
    if (!relayReady) {
      openCosmosGalaxy();
      return;
    }
    if (NOTE_ACTIONS.has(action)) setComposing(action);
    else runCosmosAction(action, context);
  };
  const holder = view?.seat?.holder;

  return (
    <section className="cosmos-home" aria-label="우주 홈">
      <header className="cosmos-home-head">
        <CosmosMark size={44} />
        <div>
          <h1>{greeting()}</h1>
          <p>
            {view ? (
              <>
                <span className="cosmos-dot" style={{ background: view.star.color }} aria-hidden="true" /> 이 기기는 <b>{view.star.name}</b>
                {projectPath && (
                  <>
                    {' · '}🪐 <b>{view.planet?.name || projectLabel || '프로젝트'}</b>
                  </>
                )}
              </>
            ) : (
              '코스모스 · 어느 기기에서든 같은 세션으로'
            )}
          </p>
        </div>
      </header>

      {projectPath ? <VerdictHero context={context} /> : null}
      {projectPath && <RelayOutcome projectPath={projectPath} entry={entry} />}

      <div className="cosmos-big-buttons" role="group" aria-label="이어달리기">
        <button
          type="button"
          className={`cosmos-big cosmos-big--${face.tone}`}
          disabled={busy || !projectPath || state === 'mine'}
          onClick={() => press(sunAction)}
        >
          <span className="cosmos-big-icon" aria-hidden="true">
            {face.icon}
          </span>
          <span className="cosmos-big-title">{face.title}</span>
          <span className="cosmos-big-sub">
            {state === 'mine'
              ? `이미 이어받았어요 · ${since(holder?.since)}`
              : sunAction === 'request'
                ? `${holder?.name || '다른 기기'}에게 부탁하기`
                : face.sub}
          </span>
        </button>
        <button
          type="button"
          className="cosmos-big cosmos-big--moon"
          disabled={busy || !projectPath || state !== 'mine'}
          onClick={() => press(view?.seat?.requests.length ? 'handoff' : 'moon')}
        >
          <span className="cosmos-big-icon" aria-hidden="true">
            🌙
          </span>
          <span className="cosmos-big-title">내려놓기</span>
          <span className="cosmos-big-sub">{state === 'mine' ? '저장·올리고 자리 비우기' : '이어받은 뒤에 쓸 수 있어요'}</span>
        </button>
        <button type="button" className="cosmos-big cosmos-big--plain" onClick={focusComposer}>
          <span className="cosmos-big-icon" aria-hidden="true">
            💬
          </span>
          <span className="cosmos-big-title">새 세션</span>
          <span className="cosmos-big-sub">아래 입력창에 바로 물어보기</span>
        </button>
      </div>
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

      {view?.ready && view.planet?.id ? (
        <button type="button" className="cosmos-home-map" onClick={openCosmosGalaxy} aria-label="은하수 화면 열기">
          <StarMap view={view} compact />
        </button>
      ) : null}
      {!projectPath && <p className="cosmos-empty-note">🪐 프로젝트를 고르면 작업 상태와 우주 지도가 보여요.</p>}
    </section>
  );
}
