// 우주 지도: the planet's session is the sun at the centre; every device is a
// star. The one star in the seat rides the inner gold "조종석" orbit, the rest
// rest on the outer orbit, faded by how long they have been silent. A star
// asking for a turn sends a dashed arrow to the seat; a hand-over flies a
// comet from the old holder to the new one. Every state is also written as
// text under the star — colour is never the only signal.
import { useEffect, useMemo, useState } from 'react';
import type { CosmosOverview, CosmosStar } from '../../shared/contract-cosmos';
import { ago, isOnline, josa, kindGlyph, since, starFade } from './cosmos-format';

const W = 640;
const H = 380;
const CX = W / 2;
const CY = 168;
// Resting stars take these outer-orbit angles in order (degrees, y down), so
// the first few sit left and right of the planet and labels never clip.
const REST_ANGLES = [195, 345, 150, 30, 235, 305, 115, 65];
const INNER = 104;
const OUTER_X = 250;
const OUTER_Y = 128;

interface Placed {
  star: CosmosStar;
  x: number;
  y: number;
  seated: boolean;
  asking: boolean;
  label: string;
  sub: string;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function place(view: CosmosOverview, now: number): Placed[] {
  const holder = view.seat?.holder?.star ?? null;
  const askers = new Set(view.seat?.requests.map((request) => request.star) ?? []);
  const stars = [...view.stars];
  // A holder that has not published its star record yet still gets a body.
  if (holder && !stars.some((star) => star.id === holder) && view.seat?.holder) {
    const h = view.seat.holder;
    stars.push({ id: h.star, name: h.name, kind: h.kind, color: h.color || '#fbbf24', beat: null });
  }
  const resting = stars.filter((star) => star.id !== holder);
  const out: Placed[] = [];
  for (const star of stars) {
    if (star.id !== holder) continue;
    const angle = (-52 * Math.PI) / 180;
    out.push({
      star,
      x: CX + INNER * Math.cos(angle),
      y: CY + INNER * Math.sin(angle),
      seated: true,
      asking: false,
      label: star.me ? `${star.name} (이 기기)` : star.name,
      sub: `🕹️ ${since(view.seat?.holder?.since, now)} 조종 중`,
    });
  }
  resting.forEach((star, index) => {
    const angle = ((REST_ANGLES[index % REST_ANGLES.length] + Math.floor(index / REST_ANGLES.length) * 12) * Math.PI) / 180;
    const online = isOnline(star, now);
    out.push({
      star,
      x: CX + OUTER_X * Math.cos(angle),
      y: CY + OUTER_Y * Math.sin(angle),
      seated: false,
      asking: askers.has(star.id),
      label: star.me ? `${star.name} (이 기기)` : star.name,
      sub: askers.has(star.id) ? '🔁 교대 요청 중' : online ? '🟢 켜져 있음' : `💤 ${ago(star.beat?.at || star.seenAt, now)}`,
    });
  });
  return out;
}

export function StarMap({ view, compact = false }: { view: CosmosOverview; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const placed = useMemo(() => place(view, now), [view, now]);
  const seated = placed.find((entry) => entry.seated) ?? null;
  const planetName = view.planet?.name || '행성';
  const motion = !reducedMotion();
  const seatEmpty = !seated;
  const summary = seated
    ? `${josa(seated.star.name, '이가')} 조종 중. 다른 별 ${placed.length - 1}개.`
    : `조종석이 비어 있어요. 별 ${placed.length}개.`;

  return (
    <figure className={`cosmos-starmap${compact ? ' cosmos-starmap--compact' : ''}`}>
      <svg viewBox={compact ? `20 34 ${W - 40} ${H - 64}` : `0 0 ${W} ${H}`} role="img" aria-label={`${planetName} 우주 지도: ${summary}`}>
        <defs>
          <radialGradient id="cosmos-sun-glow">
            <stop offset="0" stopColor="var(--cosmos-sun)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--cosmos-sun)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cosmos-planet-body" cx="0.35" cy="0.3">
            <stop offset="0" stopColor="#c7d2fe" />
            <stop offset="0.55" stopColor="#818cf8" />
            <stop offset="1" stopColor="#3730a3" />
          </radialGradient>
          <marker id="cosmos-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--cosmos-warn)" />
          </marker>
        </defs>
        {/* outer resting orbit and the inner seat orbit */}
        <ellipse className="cosmos-orbit" cx={CX} cy={CY} rx={OUTER_X} ry={OUTER_Y} />
        <circle className={`cosmos-orbit cosmos-orbit--seat${seatEmpty ? ' is-empty' : ''}`} cx={CX} cy={CY} r={INNER} />
        <text className="cosmos-orbit-label" x={CX} y={CY - INNER - 8} textAnchor="middle">
          조종석 궤도 · 한 번에 한 기기
        </text>
        {/* the session: a ringed planet with a sun-like glow while someone sits */}
        {!seatEmpty && <circle cx={CX} cy={CY} r={70} fill="url(#cosmos-sun-glow)" />}
        <circle cx={CX} cy={CY} r={34} fill="url(#cosmos-planet-body)" />
        <ellipse className="cosmos-planet-ring" cx={CX} cy={CY} rx={54} ry={13} transform={`rotate(-20 ${CX} ${CY})`} />
        <text className="cosmos-planet-name" x={CX} y={CY + 58} textAnchor="middle">
          🪐 {planetName}
        </text>
        {/* turn requests: dashed arrows toward the seat */}
        {seated &&
          placed
            .filter((entry) => entry.asking)
            .map((entry) => (
              <line
                key={`ask-${entry.star.id}`}
                className={`cosmos-ask-line${motion ? ' is-moving' : ''}`}
                x1={entry.x}
                y1={entry.y}
                x2={seated.x + (entry.x - seated.x) * 0.16}
                y2={seated.y + (entry.y - seated.y) * 0.16}
                markerEnd="url(#cosmos-arrow)"
              />
            ))}
        {placed.map((entry) => {
          const fade = entry.seated ? 0 : starFade(entry.star, now);
          const radius = entry.seated ? 20 : 16;
          // The seated star sits close to the planet: its label goes to the side.
          const side = entry.seated;
          const lx = side ? entry.x + radius + 12 : entry.x;
          const ly = side ? entry.y - 4 : entry.y + radius + 20;
          return (
            <g key={entry.star.id} className="cosmos-star" style={{ opacity: 1 - fade * 0.55 }}>
              {entry.seated && <circle cx={entry.x} cy={entry.y} r={radius + 12} className="cosmos-seat-halo" />}
              {entry.star.me && <circle cx={entry.x} cy={entry.y} r={radius + 5} className="cosmos-me-ring" />}
              <circle cx={entry.x} cy={entry.y} r={radius} fill={entry.star.color} className="cosmos-star-body" />
              <text x={entry.x} y={entry.y + 5} textAnchor="middle" className="cosmos-star-glyph">
                {kindGlyph(entry.star.kind)}
              </text>
              <text x={lx} y={ly} textAnchor={side ? 'start' : 'middle'} className="cosmos-star-name">
                {entry.label}
              </text>
              <text x={lx} y={ly + 18} textAnchor={side ? 'start' : 'middle'} className="cosmos-star-sub">
                {entry.sub}
              </text>
            </g>
          );
        })}
        {/* hand-over comet: flies once from the previous holder to the new one */}
        {motion && view.seat && <Comet view={view} placed={placed} />}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function Comet({ view, placed }: { view: CosmosOverview; placed: Placed[] }) {
  const last = view.seat?.history ?? [];
  const to = last.at(-1);
  const from = last.length > 1 ? last.at(-2) : null;
  const [key, setKey] = useState('');
  const handoff = from && to && from.star !== to.star && !to.to && Date.now() - to.from < 120_000 ? `${from.star}>${to.star}@${to.from}` : '';
  useEffect(() => {
    if (handoff && handoff !== key) setKey(handoff);
  }, [handoff, key]);
  if (!handoff || !from || !to) return null;
  const a = placed.find((entry) => entry.star.id === from.star);
  const b = placed.find((entry) => entry.star.id === to.star);
  if (!a || !b) return null;
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - 60;
  const path = `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
  return (
    <g key={key} className="cosmos-comet" aria-hidden="true">
      <path d={path} className="cosmos-comet-trail" />
      <circle r={5} className="cosmos-comet-head">
        <animateMotion dur="1.4s" repeatCount="1" fill="freeze" path={path} />
      </circle>
    </g>
  );
}
