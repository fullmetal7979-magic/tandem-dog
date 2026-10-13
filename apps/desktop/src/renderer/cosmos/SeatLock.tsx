// 잠금 화면: another star is in this planet's seat, so this device must not
// edit it. A translucent space curtain covers the conversation pane (and its
// composer) with who is seated, for how long, and the one useful next step.
//
// Three shapes of "someone else is seated":
//  · another machine        → 🔁 교대 요청 (or ⚠️ 넘겨받기 when it went silent)
//  · a phone driving THIS PC → ↩️ 되찾기 (state 'remote')
//  · seen from that phone, the PC it drives holds the seat → 📱 폰으로 이어하기
import { useState } from 'react';
import { ago, josa, kindGlyph, since } from './cosmos-format';
import { ActionNote, RelayOutcome, runCosmosAction } from './CosmosParts';
import { openCosmosGalaxy } from './CosmosHome';
import { cosmosAskTurn, cosmosSit, cosmosWithdraw, useCosmos } from './cosmos-store';

export function SeatLock({ projectPath }: { projectPath: string }) {
  const entry = useCosmos(projectPath);
  const view = entry.view;
  const [asking, setAsking] = useState(false);
  if (!view || (view.state !== 'occupied' && view.state !== 'stale' && view.state !== 'remote')) return null;
  const holder = view.seat?.holder;
  const holderName = holder?.name || '다른 기기';
  const asked = view.seat?.requests.some((request) => request.star === view.star.id);
  const remote = view.state === 'remote';
  const here = Boolean(view.here) && !remote;
  const stale = view.state === 'stale' && !here;
  const busy = Boolean(entry.busy);
  const context = { projectPath, entry, onOpenGalaxy: openCosmosGalaxy };

  let icon = '🔒';
  let title = `${kindGlyph(holder?.kind)} ${josa(holderName, '이가')} 조종 중이에요`;
  let detail = `조종 시작: ${ago(holder?.since)} · 같은 행성을 두 기기가 동시에 고치지 않도록 이 기기에서는 잠겨 있어요.`;
  if (remote) {
    icon = '📱';
    title = `${josa(holderName, '이가')} 이 PC를 원격으로 조종 중이에요`;
    detail = `${since(holder?.since)} · 폰과 이 PC가 동시에 고치지 않도록 여기서는 잠겨 있어요. 폰에서 🌙 달을 누르면 풀려요.`;
  } else if (here) {
    icon = '💻';
    detail = `조종 시작: ${ago(holder?.since)} · 지금 연결된 바로 그 PC예요. 교대 없이 폰으로 이어갈 수 있고, 그 PC는 잠겨요.`;
  } else if (stale) {
    icon = '⚠️';
    title = `${kindGlyph(holder?.kind)} ${josa(holderName, '이가')} 응답이 없어요`;
    detail = `${ago(view.holderLastSeen)}부터 신호가 없어요. 그 기기가 꺼졌다면 넘겨받을 수 있어요.`;
  }

  return (
    <div className="cosmos-lock" role="dialog" aria-modal="false" aria-labelledby="cosmos-lock-title">
      <div className="cosmos-lock-card">
        <span className="cosmos-lock-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 id="cosmos-lock-title">{title}</h2>
        <p>{detail}</p>
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
            {remote ? (
              <button
                type="button"
                className="cosmos-button cosmos-button--plain cosmos-button--large"
                disabled={busy}
                onClick={() => runCosmosAction('reclaim', context)}
              >
                ↩️ 이 PC로 되찾기
              </button>
            ) : here ? (
              <button
                type="button"
                className="cosmos-button cosmos-button--sun cosmos-button--large"
                disabled={busy}
                onClick={() => void cosmosSit(projectPath)}
              >
                📱 폰으로 이어하기
              </button>
            ) : stale ? (
              <button
                type="button"
                className="cosmos-button cosmos-button--danger cosmos-button--large"
                disabled={busy}
                onClick={() => runCosmosAction('force', context)}
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
