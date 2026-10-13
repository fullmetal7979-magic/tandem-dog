// 은하수 화면: the whole relay at a glance — verdict hero, the star map, the
// constellation of past turns, recent conversations, this device's identity
// and the new-device checklist. Lives in the side dock (where Tandem was).
import type { CosmosOverview } from '../../shared/contract-cosmos';
import { ago, kindGlyph } from './cosmos-format';
import { ConstellationTimeline } from './ConstellationTimeline';
import { GalaxySetup, NewStarChecklist, RelayOutcome, StarIdentity, VerdictHero } from './CosmosParts';
import { StarMap } from './StarMap';
import { cosmosContinue, refreshCosmos, useCosmos } from './cosmos-store';

function SyncLine({ view, loading }: { view: CosmosOverview; loading: boolean }) {
  return (
    <p className="cosmos-sync-line">
      <span className={`cosmos-sync-dot${view.offline ? ' is-offline' : ''}`} aria-hidden="true" />
      {view.offline ? '은하수에 연결하지 못했어요 · 마지막으로 받은 상태예요' : `은하수와 맞춤: ${ago(view.syncedAt)}`}
      {loading && ' · 확인 중…'}
    </p>
  );
}

export function GalaxyPane({ projectPath, active = true }: { projectPath: string | null; active?: boolean }) {
  const key = projectPath || '';
  const entry = useCosmos(key);
  void active;
  const view = entry.view;
  if (!view) {
    return (
      <div className="cosmos-pane" aria-busy="true">
        <p className="cosmos-empty-note">✨ 은하수를 살펴보는 중이에요…</p>
      </div>
    );
  }
  const context = { projectPath: key, entry, onOpenGalaxy: () => undefined };
  return (
    <div className="cosmos-pane">
      <header className="cosmos-pane-head">
        {view.ready ? <SyncLine view={view} loading={entry.loading} /> : <span />}
        <button type="button" className="cosmos-link" disabled={entry.loading} onClick={() => void refreshCosmos(key, { force: true })}>
          ↻ 새로고침
        </button>
      </header>
      {!view.ready ? (
        <>
          <GalaxySetup projectPath={projectPath} entry={entry} />
          <RelayOutcome projectPath={key} entry={entry} />
          <StarIdentity projectPath={projectPath} view={view} entry={entry} />
          <NewStarChecklist view={view} />
        </>
      ) : (
        <>
          {projectPath && <VerdictHero context={context} compact />}
          <RelayOutcome projectPath={key} entry={entry} />
          {view.planet?.id ? (
            <section className="cosmos-card">
              <h3>우주 지도</h3>
              <StarMap view={view} compact />
            </section>
          ) : (
            <section className="cosmos-card">
              <h3>별 {view.stars.length}개</h3>
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
              <h3>별자리 · 조종 기록</h3>
              <ConstellationTimeline history={view.seat.history} stars={view.stars} />
            </section>
          )}
          {view.conversations.length > 0 && projectPath && (
            <section className="cosmos-card">
              <h3>💬 은하수의 교신</h3>
              <ul className="cosmos-conversations">
                {view.conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <div>
                      <b>{conversation.title || '제목 없는 교신'}</b>
                      <small>
                        {kindGlyph(conversation.star?.kind)} {conversation.star?.name || '?'} · {ago(conversation.exportedAt)} · 메시지{' '}
                        {conversation.messageCount}개
                      </small>
                    </div>
                    <button
                      type="button"
                      className="cosmos-button cosmos-button--plain"
                      disabled={Boolean(entry.busy) || view.state === 'occupied'}
                      onClick={() => void cosmosContinue(key, conversation.id)}
                    >
                      이어가기
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view.planets.length > 0 && (
            <section className="cosmos-card">
              <h3>🪐 은하수의 행성</h3>
              <ul className="cosmos-planets">
                {view.planets.map((planet) => (
                  <li key={planet.id}>
                    <b>{planet.name}</b>
                    <small>
                      {planet.lastMoon ? `🌙 ${planet.lastMoon.name} · ${ago(planet.lastMoon.at)}${planet.lastMoon.note ? ` · “${planet.lastMoon.note}”` : ''}` : planet.lastSeat ? `☀️ ${planet.lastSeat.name} · ${ago(planet.lastSeat.at)}` : ''}
                    </small>
                    <code>{planet.remote}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <StarIdentity projectPath={projectPath} view={view} entry={entry} />
          <NewStarChecklist view={view} />
          <p className="cosmos-footnote">은하수 저장소: {view.remote || '이 기기에만 있음'}</p>
        </>
      )}
    </div>
  );
}
