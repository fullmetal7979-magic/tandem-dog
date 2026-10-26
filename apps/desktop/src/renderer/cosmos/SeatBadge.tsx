// 작업 자리 배지: always-visible relay state in the titlebar. Clicking it opens
// the Galaxy screen; the colour, icon and words all carry the same state.
import { useEffect } from 'react';
import { cosmosVerdict, since } from './cosmos-format';
import { openCosmosGalaxy } from './CosmosHome';
import { useCosmos } from './cosmos-store';
import { adoptSyncedUiMode } from './ui-mode';

export function SeatBadge({ projectPath }: { projectPath: string | null }) {
  const entry = useCosmos(projectPath || '');
  const view = entry.view;
  // A mode chosen on another device arrives through the Galaxy config.
  useEffect(() => adoptSyncedUiMode(view?.uiMode), [view?.uiMode]);
  if (!window.mixdogDesktop?.cosmosOverview) return null;
  let label = '✨ 은하수';
  let tone = 'info';
  if (view && !view.ready) {
    label = '🌌 은하수 연결하기';
  } else if (view?.planet?.id && view.seat) {
    const holder = view.seat.holder;
    if (view.state === 'mine') {
      label = view.seat.requests.length ? `🔁 ${view.seat.requests[0].name} 교대 요청` : `작업 중 · ${since(holder?.since)}`;
      tone = view.seat.requests.length ? 'warn' : 'ok';
    } else if (view.state === 'remote') {
      label = `📱 ${holder?.name} 원격 작업 중`;
      tone = 'warn';
    } else if (view.state === 'occupied') {
      label = `🔒 ${holder?.name} 작업 중`;
      tone = 'warn';
    } else if (view.state === 'stale') {
      label = `⚠️ ${holder?.name} 응답 없음`;
      tone = 'bad';
    } else {
      label = '☄️ 작업 자리 비어 있음';
    }
  } else if (view?.state === 'no_remote') {
    label = '🛰️ 혼자 쓰는 행성';
  }
  const verdict = cosmosVerdict(view);
  return (
    <button
      type="button"
      className={`cosmos-seat-badge cosmos-seat-badge--${tone}`}
      onClick={openCosmosGalaxy}
      title={`${verdict.title}${verdict.detail ? `\n${verdict.detail}` : ''}`}
      aria-label={`${label}. 은하수 화면 열기`}
    >
      {label}
    </button>
  );
}
