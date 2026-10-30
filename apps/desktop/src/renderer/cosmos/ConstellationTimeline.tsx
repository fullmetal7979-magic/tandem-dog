// 별자리 타임라인: who sat in the seat, when, and what they left behind. One
// lane per star, time running left → right; each turn is a bar in the star's
// colour, and consecutive turns are joined like a constellation so the relay
// reads as one path. Memos of 달 sit on the turn they closed.
import { useMemo } from 'react';
import type { CosmosSeatHistoryEntry, CosmosStar } from '../../shared/contract-cosmos';
import { ago, clipName, kindGlyph } from './cosmos-format';

const SHOWN = 14;
/** Lane labels share the 92px gutter with a glyph: longer names get an ellipsis (the full name is the label's title). */
const LABEL_CHARS = 7;
const LANE_H = 30;
const LEFT = 92;
const RIGHT = 12;
const W = 420;

interface Turn extends CosmosSeatHistoryEntry {
  lane: number;
  x1: number;
  x2: number;
  y: number;
}

export function ConstellationTimeline({ history, stars, now = Date.now() }: { history: CosmosSeatHistoryEntry[]; stars: CosmosStar[]; now?: number }) {
  // Memoised on the history itself: a new slice every render would rebuild the whole drawing.
  const recent = useMemo(() => history.slice(-SHOWN), [history]);
  const model = useMemo(() => {
    if (!recent.length) return null;
    // The axis spans the recorded turns themselves (with a little air), so a
    // morning of quick hand-overs is as readable as a week of long turns.
    const first = Math.min(...recent.map((turn) => turn.from));
    const span0 = Math.max(now - first, 10 * 60_000);
    const start = first - span0 * 0.06;
    const span = now - start;
    const laneIds: string[] = [];
    for (const turn of recent) if (!laneIds.includes(turn.star)) laneIds.push(turn.star);
    const width = W - LEFT - RIGHT;
    const xOf = (at: number) => LEFT + ((at - start) / span) * width;
    const turns: Turn[] = recent.map((turn) => {
      const lane = laneIds.indexOf(turn.star);
      const x1 = xOf(turn.from);
      const x2 = Math.max(x1 + 6, xOf(turn.to ?? now));
      return { ...turn, lane, x1, x2, y: 18 + lane * LANE_H };
    });
    const colorOf = (id: string) => stars.find((star) => star.id === id)?.color ?? recent.find((turn) => turn.star === id)?.color ?? 'var(--cosmos-moon-strong)';
    return { start, laneIds, turns, colorOf, height: 30 + laneIds.length * LANE_H };
  }, [recent, stars, now]);

  if (!model) {
    return <p className="cosmos-empty-note">아직 작업 기록이 없어요. 이어받기를 누르면 여기에 기록이 쌓여요.</p>;
  }
  const { turns, laneIds, colorOf, height, start } = model;
  return (
    <figure className="cosmos-timeline">
      {history.length > SHOWN && (
        <figcaption className="cosmos-timeline-caption">
          전체 {history.length}번 중 최근 {SHOWN}번
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`최근 작업 기록 ${turns.length}번`}>
        {laneIds.map((id, lane) => {
          const sample = recent.find((turn) => turn.star === id);
          return (
            <g key={id}>
              <line className="cosmos-lane" x1={LEFT} x2={W - RIGHT} y1={18 + lane * LANE_H} y2={18 + lane * LANE_H} />
              <text className="cosmos-lane-label" x={LEFT - 10} y={22 + lane * LANE_H} textAnchor="end">
                <title>{sample?.name}</title>
                {kindGlyph(sample?.kind)} {clipName(sample?.name, LABEL_CHARS)}
              </text>
            </g>
          );
        })}
        {turns.slice(1).map((turn, index) => {
          const prev = turns[index];
          return <line key={`link-${prev.star}-${prev.from}-${turn.star}-${turn.from}`} className="cosmos-constellation" x1={prev.x2} y1={prev.y} x2={turn.x1} y2={turn.y} />;
        })}
        {turns.map((turn) => (
          <g key={`${turn.star}-${turn.from}`}>
            <title>
              {`${turn.name} · ${new Date(turn.from).toLocaleString('ko-KR')} ~ ${turn.to ? new Date(turn.to).toLocaleString('ko-KR') : '지금'}${turn.memo ? `\n🌙 ${turn.memo}` : ''}${turn.forced ? '\n⚠️ 응답이 없어 넘겨받음' : ''}`}
            </title>
            <rect className={`cosmos-turn${turn.to ? '' : ' is-live'}${turn.forced ? ' is-forced' : ''}`} x={turn.x1} y={turn.y - 6} width={turn.x2 - turn.x1} height={12} rx={6} fill={colorOf(turn.star)} />
            <circle className="cosmos-turn-star" cx={turn.x1} cy={turn.y} r={4.5} />
            {turn.to && <circle className="cosmos-turn-star" cx={turn.x2} cy={turn.y} r={3} />}
          </g>
        ))}
        <text className="cosmos-axis" x={LEFT} y={height - 2}>
          {ago(start, now)}
        </text>
        <text className="cosmos-axis" x={W - RIGHT} y={height - 2} textAnchor="end">
          지금
        </text>
      </svg>
      <ol className="cosmos-timeline-list">
        {[...recent]
          .reverse()
          .slice(0, 5)
          .map((turn) => (
            <li key={`${turn.star}-${turn.from}`}>
              <span className="cosmos-dot" style={{ background: colorOf(turn.star) }} aria-hidden="true" />
              <b>{turn.name}</b>
              <span>{turn.to ? `${ago(turn.to, now)} 내려놓음` : '작업 중'}</span>
              {turn.memo && <q>{turn.memo}</q>}
              {turn.forced && <em>넘겨받음</em>}
            </li>
          ))}
      </ol>
    </figure>
  );
}
