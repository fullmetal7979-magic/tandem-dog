// 은하수 화면: the whole relay at a glance — verdict hero, the device map, the
// history of past turns, recent sessions, this device's identity and the
// second-PC checklist. Lives in the side dock.
import type { CosmosOverview } from '../../shared/contract-cosmos';
import { ago, kindGlyph } from './cosmos-format';
import { ConstellationTimeline } from './ConstellationTimeline';
import { CloneMessage, CosmosPending, GalaxySetup, NewStarChecklist, RelayOutcome, StarIdentity, VerdictHero, useProjectClone } from './CosmosParts';
import { StarMap } from './StarMap';
import { cosmosContinue, cosmosSeatHeldElsewhere, refreshCosmos, useCosmos } from './cosmos-store';

function SyncLine({ view, loading, pollError }: { view: CosmosOverview; loading: boolean; pollError: string }) {
  const stale = Boolean(view.offline || pollError);
  return (
    <p className="cosmos-sync-line" title={pollError || undefined}>
      <span className={`cosmos-sync-dot${stale ? ' is-offline' : ''}`} aria-hidden="true" />
      {view.offline
        ? '은하수에 연결하지 못했어요 · 마지막으로 받은 상태예요'
        : pollError
          ? `새 상태를 받지 못했어요 · 마지막 확인 ${ago(view.syncedAt)}`
          : `은하수와 맞춤: ${ago(view.syncedAt)}`}
      {loading && ' · 확인 중…'}
    </p>
  );
}

/** Opens Settings → providers (App listens; same plumbing as the rail's settings button). */
function openSettingsProviders(): void {
  window.dispatchEvent(new CustomEvent('cosmos:open-settings', { detail: { section: 'providers' } }));
}

function GalaxyPlanets({ view, projectPath }: { view: CosmosOverview; projectPath: string | null }) {
  const { isCloning, message, clone } = useProjectClone(projectPath);
  return (
    <section className="cosmos-card">
      <h3>🪐 은하수의 프로젝트</h3>
      <ul className="cosmos-planets">
        {view.planets.map((planet) => (
          <li key={planet.id}>
            <b>{planet.name}</b>
            <small>
              {planet.lastMoon ? `🌙 ${planet.lastMoon.name} · ${ago(planet.lastMoon.at)}${planet.lastMoon.note ? ` · “${planet.lastMoon.note}”` : ''}` : planet.lastSeat ? `☀️ ${planet.lastSeat.name} · ${ago(planet.lastSeat.at)}` : ''}
            </small>
            <code>{planet.remote}</code>
            {planet.id !== view.planet?.id && (
              <button
                type="button"
                className="cosmos-button cosmos-button--plain"
                disabled={isCloning(planet.remote)}
                onClick={() => void clone(planet.remote, planet.name)}
              >
                {isCloning(planet.remote) ? '받는 중…' : '이 기기에 받기'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <CloneMessage message={message} />
    </section>
  );
}

export function GalaxyPane({ projectPath, active = true }: { projectPath: string | null; active?: boolean }) {
  const key = projectPath || '';
  // A hidden dock tab stops watching (no polling); reopening shows the cached view.
  const entry = useCosmos(active ? key : null);
  const view = entry.view;
  if (!view) {
    return (
      <div className="cosmos-pane" aria-busy={entry.pollError ? undefined : 'true'}>
        {active && <CosmosPending projectPath={key} entry={entry} />}
      </div>
    );
  }
  const continueLocked = cosmosSeatHeldElsewhere(view);
  const context = { projectPath: key, entry, onOpenGalaxy: () => undefined };
  return (
    <div className="cosmos-pane">
      <header className="cosmos-pane-head">
        {view.ready ? <SyncLine view={view} loading={entry.loading} pollError={entry.pollError} /> : <span />}
        <button
          type="button"
          className="cosmos-link"
          disabled={entry.loading}
          aria-label="은하수 상태 새로고침"
          onClick={() => void refreshCosmos(key, { force: true })}
        >
          ↻ 새로고침
        </button>
      </header>
      {!view.ready ? (
        <>
          <GalaxySetup projectPath={projectPath} entry={entry} />
          <RelayOutcome projectPath={key} entry={entry} />
          <StarIdentity projectPath={projectPath} view={view} entry={entry} />
          <NewStarChecklist view={view} projectPath={projectPath} onOpenSettings={openSettingsProviders} />
        </>
      ) : (
        <>
          {projectPath && <VerdictHero context={context} compact />}
          <RelayOutcome projectPath={key} entry={entry} />
          {view.planet?.id ? (
            <section className="cosmos-card">
              <h3>기기 지도</h3>
              <StarMap view={view} compact active={active} />
            </section>
          ) : (
            <section className="cosmos-card">
              <h3>기기 {view.stars.length}개</h3>
              <ul className="cosmos-star-list">
                {view.stars.map((star) => (
                  <li key={star.id}>
                    <span className="cosmos-dot" style={{ background: star.color }} aria-hidden="true" />
                    {kindGlyph(star.kind)} {star.name}
                    {star.me ? ' · 이 기기' : ''}
                    <small>{ago(star.beat?.at || star.seenAt)}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view.seat && (
            <section className="cosmos-card">
              <h3>작업 기록</h3>
              <ConstellationTimeline history={view.seat.history} stars={view.stars} />
            </section>
          )}
          {view.conversations.length > 0 && projectPath && (
            <section className="cosmos-card">
              <h3>💬 은하수의 세션</h3>
              <ul className="cosmos-conversations">
                {view.conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <div>
                      <b>{conversation.title || '제목 없는 세션'}</b>
                      <small>
                        {kindGlyph(conversation.star?.kind)} {conversation.star?.name || '?'} · {ago(conversation.exportedAt)} · 메시지{' '}
                        {conversation.messageCount}개
                      </small>
                    </div>
                    <button
                      type="button"
                      className="cosmos-button cosmos-button--plain"
                      disabled={Boolean(entry.busy) || continueLocked}
                      title={continueLocked ? '다른 기기가 작업 중이라 이어갈 수 없어요' : undefined}
                      onClick={() => void cosmosContinue(key, conversation.id)}
                    >
                      이어가기
                    </button>
                  </li>
                ))}
              </ul>
              {continueLocked && <p className="cosmos-footnote">다른 기기가 작업 중이라 이어가기가 잠겨 있어요. 이어받은 뒤에 이어갈 수 있어요.</p>}
            </section>
          )}
          {view.planets.length > 0 && <GalaxyPlanets view={view} projectPath={projectPath} />}
          <StarIdentity projectPath={projectPath} view={view} entry={entry} />
          <NewStarChecklist view={view} projectPath={projectPath} onOpenSettings={openSettingsProviders} />
          <p className="cosmos-footnote">은하수 저장소: {view.remote || '이 기기에만 있음'}</p>
        </>
      )}
    </div>
  );
}
