// 잠금 화면: another star is in this planet's seat, so this device must not
// edit it. A translucent space curtain covers the conversation pane (and its
// composer) with who is seated, for how long, and the one useful next step.
import { useState } from 'react';
import { ago, josa, kindGlyph } from './cosmos-format';
import { ActionNote, RelayOutcome } from './CosmosParts';
import { openCosmosGalaxy } from './CosmosHome';
import { cosmosAskTurn, cosmosSit, cosmosWithdraw, useCosmos } from './cosmos-store';

export function SeatLock({ projectPath }: { projectPath: string }) {
  const entry = useCosmos(projectPath);
  const view = entry.view;
  const [asking, setAsking] = useState(false);
  if (!view || (view.state !== 'occupied' && view.state !== 'stale')) return null;
  const holder = view.seat?.holder;
  const asked = view.seat?.requests.some((request) => request.star === view.star.id);
  const stale = view.state === 'stale';
  const busy = Boolean(entry.busy);
  return (
    <div className="cosmos-lock" role="dialog" aria-modal="false" aria-labelledby="cosmos-lock-title">
      <div className="cosmos-lock-card">
        <span className="cosmos-lock-icon" aria-hidden="true">
          {stale ? '⚠️' : '🔒'}
        </span>
        <h2 id="cosmos-lock-title">
          {kindGlyph(holder?.kind)} {josa(holder?.name || '다른 기기', '이가')} {stale ? '응답이 없어요' : '조종 중이에요'}
        </h2>
        <p>
          {stale
            ? `${ago(view.holderLastSeen)}부터 신호가 없어요. 그 기기가 꺼졌다면 넘겨받을 수 있어요.`
            : `조종 시작: ${ago(holder?.since)} · 같은 행성을 두 기기가 동시에 고치지 않도록 이 기기에서는 잠겨 있어요.`}
        </p>
        <RelayOutcome projectPath={projectPath} entry={entry} />
        {asking ? (
          <ActionNote
            action="request"
            busy={busy}
            onCancel={() => setAsking(false)}
            onSubmit={(note) => {
              setAsking(false);
              void cosmosAskTurn(projectPath, note);
            }}
          />
        ) : (
          <div className="cosmos-lock-actions">
            {stale ? (
              <button
                type="button"
                className="cosmos-button cosmos-button--danger cosmos-button--large"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${josa(holder?.name || '다른 기기', '이가')} 응답이 없어요. 조종석을 넘겨받을까요?`)) void cosmosSit(projectPath, { force: true });
                }}
              >
                ⚠️ 강제로 넘겨받기
              </button>
            ) : asked ? (
              <>
                <p className="cosmos-lock-waiting">📨 교대 요청을 보냈어요 · 응답을 기다리는 중</p>
                <button type="button" className="cosmos-link" disabled={busy} onClick={() => void cosmosWithdraw(projectPath)}>
                  요청 취소
                </button>
              </>
            ) : (
              <button type="button" className="cosmos-button cosmos-button--sun cosmos-button--large" disabled={busy} onClick={() => setAsking(true)}>
                🔁 교대 요청
              </button>
            )}
            <button type="button" className="cosmos-link" onClick={openCosmosGalaxy}>
              우주 지도 보기 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
