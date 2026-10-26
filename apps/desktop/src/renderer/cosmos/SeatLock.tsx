// 잠금 화면: another star is in this planet's seat, so this device must not
// edit it. By default this is a BANNER along the top of the conversation: who is
// seated, for how long, and the one useful next step — the transcript stays
// readable ("읽기만"). While the seat is held elsewhere the pane's composer is
// made inert (not merely covered), so typing stays impossible either way.
// "자세히" opens the full card as a modal dialog (aria-modal, focus trapped);
// Esc or "읽기만 볼게요" folds it back into the banner.
//
// Three shapes of "someone else is seated":
//  · another machine        → 🔁 넘겨 달라고 요청 (or ⚠️ 넘겨받기 when it went silent)
//
// Until the seat is known at all (first read still running) the composer is
// held the same way, with a one-line "확인 중" banner.
//  · a phone driving THIS PC → ↩️ 되찾기 (state 'remote')
//  · seen from that phone, the PC it drives holds the seat → 📱 폰으로 이어하기
import { useEffect, useRef, useState } from 'react';
import { ago, josa, kindGlyph, since } from './cosmos-format';
import { ActionNote, RelayOutcome, runCosmosAction } from './CosmosParts';
import { openCosmosGalaxy } from './CosmosHome';
import { cosmosAskTurn, cosmosSeatHeldElsewhere, cosmosSeatUnknown, cosmosSit, cosmosWithdraw, useCosmos } from './cosmos-store';

export function SeatLock({ projectPath }: { projectPath: string }) {
  const entry = useCosmos(projectPath);
  const view = entry.view;
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locked = cosmosSeatHeldElsewhere(view);
  const checking = cosmosSeatUnknown(entry, projectPath);
  const hold = locked || checking;
  // The card (note form included) needs room: asking always opens it.
  const open = expanded || asking;

  // Input stays disabled while another device holds the seat (or while that is
  // still being checked): this pane's composer becomes inert (no focus, no
  // clicks, no typing).
  useEffect(() => {
    if (!hold) return undefined;
    const pane = rootRef.current?.parentElement;
    const composers = pane ? [...pane.querySelectorAll<HTMLElement>('form.composer')] : [];
    for (const composer of composers) {
      composer.setAttribute('inert', '');
      composer.dataset.seatLocked = 'true';
    }
    return () => {
      for (const composer of composers) {
        composer.removeAttribute('inert');
        delete composer.dataset.seatLocked;
      }
    };
  }, [hold]);

  // Dialog behaviour for the expanded card: focus moves in, Tab wraps, Esc folds.
  useEffect(() => {
    if (!open || !locked) return undefined;
    const root = rootRef.current;
    const focusables = () =>
      root ? [...root.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, [href]')] : [];
    (focusables()[0] ?? root)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setAsking(false);
        setExpanded(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // The "자세히" button is re-created when the card folds; focus the new one.
      triggerRef.current?.focus?.();
    };
  }, [open, locked]);

  if (checking) {
    return (
      <div ref={rootRef} className="cosmos-lock cosmos-lock--banner cosmos-lock--checking" role="status">
        <div className="cosmos-lock-card">
          <span className="cosmos-lock-icon" aria-hidden="true">
            ⏳
          </span>
          <h2>작업 자리를 확인하는 중이에요</h2>
          <p>다른 기기가 작업 중인지 확인되면 바로 입력할 수 있어요.</p>
        </div>
      </div>
    );
  }
  if (!view || !locked) return null;
  const holder = view.seat?.holder;
  const holderName = holder?.name || '다른 기기';
  const asked = view.seat?.requests.some((request) => request.star === view.star.id);
  const remote = view.state === 'remote';
  const here = Boolean(view.here) && !remote;
  const stale = view.state === 'stale' && !here;
  const busy = Boolean(entry.busy);
  const context = { projectPath, entry, onOpenGalaxy: openCosmosGalaxy };

  let icon = '🔒';
  let title = `${kindGlyph(holder?.kind)} ${josa(holderName, '이가')} 작업 중이에요`;
  let detail = `작업 시작: ${ago(holder?.since)} · 같은 프로젝트를 두 기기가 동시에 고치지 않도록 이 기기에서는 잠겨 있어요.`;
  if (remote) {
    icon = '📱';
    title = `${josa(holderName, '이가')} 이 PC에서 원격으로 작업 중이에요`;
    detail = `${since(holder?.since)} · 폰과 이 PC가 동시에 고치지 않도록 여기서는 잠겨 있어요. 폰에서 내려놓기를 누르면 풀려요.`;
  } else if (here) {
    icon = '💻';
    detail = `작업 시작: ${ago(holder?.since)} · 지금 연결된 바로 그 PC예요. 넘겨 달라고 요청하지 않고 폰으로 이어갈 수 있고, 그 PC는 잠겨요.`;
  } else if (stale) {
    icon = '⚠️';
    title = `${kindGlyph(holder?.kind)} ${josa(holderName, '이가')} 응답이 없어요`;
    detail = `${ago(view.holderLastSeen)}부터 신호가 없어요. 그 기기가 꺼졌다면 넘겨받을 수 있어요.`;
  }

  const dialogProps = open
    ? ({ role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'cosmos-lock-title', tabIndex: -1 } as const)
    : ({ role: 'region', 'aria-labelledby': 'cosmos-lock-title' } as const);

  return (
    <div ref={rootRef} className={`cosmos-lock ${open ? 'cosmos-lock--card' : 'cosmos-lock--banner'}`} {...dialogProps}>
      <div className="cosmos-lock-card">
        <span className="cosmos-lock-icon" aria-hidden="true">
          {icon}
        </span>
        <h2 id="cosmos-lock-title">{title}</h2>
        <span className="cosmos-lock-readonly">📖 읽기만</span>
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
                <p className="cosmos-lock-waiting">📨 넘겨 달라고 요청했어요 · 응답을 기다리는 중</p>
                <button type="button" className="cosmos-link" disabled={busy} onClick={() => void cosmosWithdraw(projectPath)}>
                  요청 취소
                </button>
              </>
            ) : (
              <button type="button" className="cosmos-button cosmos-button--sun cosmos-button--large" disabled={busy} onClick={() => setAsking(true)}>
                🔁 넘겨 달라고 요청
              </button>
            )}
            <button type="button" className="cosmos-link" onClick={openCosmosGalaxy}>
              은하수 보기 →
            </button>
            {open ? (
              <button type="button" className="cosmos-link" onClick={() => setExpanded(false)}>
                읽기만 볼게요 (Esc)
              </button>
            ) : (
              <button ref={triggerRef} type="button" className="cosmos-link" aria-expanded="false" onClick={() => setExpanded(true)}>
                자세히
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
