// 우주 홈: the first thing every new 교신 shows. One glance answers "where is
// my work and can I start here?", and three big buttons do the rest:
//   ☀️ 앉기 (or 🔁 교대 요청 when another star is seated) · 🌙 내리기 · 💬 새 교신
import { useState } from 'react';
import type { CosmosAction } from './cosmos-format';
import { since } from './cosmos-format';
import { ActionNote, CosmosMark, NOTE_ACTIONS, RelayOutcome, VerdictHero, runCosmosAction } from './CosmosParts';
import { StarMap } from './StarMap';
import { useCosmos } from './cosmos-store';

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return '깊은 밤이에요 🌌';
  if (hour < 11) return '좋은 아침이에요 ☀️';
  if (hour < 17) return '좋은 오후예요 🪐';
  if (hour < 21) return '좋은 저녁이에요 🌙';
  return '별이 빛나는 밤이에요 ✨';
}

export function openCosmosGalaxy(): void {
  window.dispatchEvent(new CustomEvent('cosmos:open-galaxy'));
}

function focusComposer(): void {
  const field = document.querySelector<HTMLTextAreaElement>('form.composer textarea');
  field?.focus();
}

export function CosmosHome({ projectPath, projectLabel }: { projectPath: string; projectLabel?: string }) {
  const entry = useCosmos(projectPath);
  const view = entry.view;
  const [composing, setComposing] = useState<CosmosAction>(null);
  const state = view?.state ?? null;
  const context = { projectPath, entry, onOpenGalaxy: openCosmosGalaxy };
  const relayReady = Boolean(view?.ready && view.planet?.id);
  const sunAction: CosmosAction = state === 'occupied' ? 'request' : state === 'stale' ? 'force' : 'sun';
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
                    {' · '}🪐 <b>{view.planet?.name || projectLabel || '행성'}</b>
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
          className={`cosmos-big cosmos-big--${sunAction === 'sun' ? 'sun' : sunAction === 'force' ? 'danger' : 'plain'}`}
          disabled={busy || !projectPath || state === 'mine'}
          onClick={() => press(sunAction)}
        >
          <span className="cosmos-big-icon" aria-hidden="true">
            {sunAction === 'sun' ? '☀️' : sunAction === 'force' ? '⚠️' : '🔁'}
          </span>
          <span className="cosmos-big-title">{sunAction === 'sun' ? '앉기' : sunAction === 'force' ? '넘겨받기' : '교대 요청'}</span>
          <span className="cosmos-big-sub">
            {state === 'mine'
              ? `이미 앉아 있어요 · ${since(holder?.since)}`
              : sunAction === 'request'
                ? `${holder?.name || '다른 기기'}에게 부탁하기`
                : sunAction === 'force'
                  ? '응답 없는 기기 대신 앉기'
                  : '최신 작업·환경·교신을 받아 시작'}
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
          <span className="cosmos-big-title">내리기</span>
          <span className="cosmos-big-sub">{state === 'mine' ? '저장·올리고 조종석 비우기' : '앉아 있을 때 쓸 수 있어요'}</span>
        </button>
        <button type="button" className="cosmos-big cosmos-big--plain" onClick={focusComposer}>
          <span className="cosmos-big-icon" aria-hidden="true">
            💬
          </span>
          <span className="cosmos-big-title">새 교신</span>
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
      {!projectPath && <p className="cosmos-empty-note">🪐 행성(프로젝트)을 고르면 조종석과 우주 지도가 보여요.</p>}
    </section>
  );
}
