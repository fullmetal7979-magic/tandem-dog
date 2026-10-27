import { useState } from 'react';
import type { CosmosAction } from './cosmos-format';
import { since, cosmosVerdict } from './cosmos-format';
import { ActionNote, CosmosMark, NOTE_ACTIONS, RelayOutcome, runCosmosAction } from './CosmosParts';
import { StarMap } from './StarMap';
import { useCosmos } from './cosmos-store';

export function openCosmosGalaxy(): void {
  window.dispatchEvent(new CustomEvent('cosmos:open-galaxy'));
}

/** The first big button changes with the seat; one face per action. */
type SunFace = { tone: string; icon: string; title: string; sub: string };
const SUN_FACE: Record<'sun' | 'request' | 'force' | 'reclaim' | 'carry', SunFace> = {
  sun: { tone: 'sun', icon: '☀️', title: '이어받기', sub: '최신 코드·환경·세션을 받아 시작' },
  request: { tone: 'plain', icon: '🔁', title: '넘겨 달라고 요청', sub: '' },
  force: { tone: 'danger', icon: '⚠️', title: '넘겨받기', sub: '응답 없는 기기 대신 이어받기' },
  reclaim: { tone: 'plain', icon: '↩️', title: '이어받기', sub: '폰에서 작업 중 · 이 기기로 가져오기' },
  carry: { tone: 'sun', icon: '📱', title: '폰으로 이어하기', sub: '연결된 기기의 작업을 그대로 이어받기' },
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
    <section className="cosmos-home cosmos-home--focused" aria-label="코스모스 홈">
      <header className="cosmos-home-head">
        <CosmosMark size={32} />
        <div><h1>{projectLabel || view?.planet?.name || '새 작업'}</h1><p>{projectPath?'현재 프로젝트에서 개발을 이어가세요.':'모델을 고르고 아래에 작업을 입력하세요.'}</p></div>
      </header>
      {projectPath && <p className="cosmos-home-status" role="status"><span className="cosmos-dot" aria-hidden="true"/> {cosmosVerdict(view).title}{state==='mine'?` · ${since(holder?.since)}`:''}</p>}
      {projectPath && <RelayOutcome projectPath={projectPath} entry={entry} />}
      <div className="cosmos-home-actions" role="group" aria-label="작업 시작">
        {!projectPath && <button type="button" className="cosmos-button cosmos-button--plain" onClick={()=>window.dispatchEvent(new CustomEvent('cosmos:open-projects'))}>프로젝트 열기</button>}
        {projectPath && relayReady && state!=='mine' && <button type="button" className={`cosmos-button cosmos-button--${face.tone}`} disabled={busy} onClick={()=>press(sunAction)}>{face.icon} {face.title}</button>}
        {projectPath && relayReady && state==='mine' && <button type="button" className="cosmos-button cosmos-button--moon" disabled={busy} onClick={()=>press(view?.seat?.requests.length?'handoff':'moon')}>저장하고 작업 넘기기</button>}
        {projectPath && !relayReady && <button type="button" className="cosmos-link" onClick={openCosmosGalaxy}>다른 기기와 연결</button>}
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
        <details className="cosmos-home-devices"><summary>연결된 기기 보기</summary><button type="button" className="cosmos-home-map" onClick={openCosmosGalaxy} aria-label="은하수 화면 열기"><StarMap view={view} compact /></button></details>
      ) : null}

    </section>
  );
}
