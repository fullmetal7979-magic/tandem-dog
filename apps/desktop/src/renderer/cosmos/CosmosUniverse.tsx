// 행성의 우주: the hero of the space home. The open project is the planet in
// the middle, and the sky around it is made only of what the planet made —
// its commits as lights on the spiral arms, its uncommitted changes as 성운
// circling close. Every number the picture shows is also written as words
// below it, and pointing at a light names the commit it came from.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopGitLogEntry, DesktopGitStatus } from '../../shared/contract';
import type { PickedLight, SceneModel, UniverseScene } from './universe-canvas';
import { createUniverseScene } from './universe-canvas';
import type { UniverseCommit, UniverseFacts } from './universe-model';
import {
  GENESIS_HUE,
  UNIVERSE_LIMIT,
  layoutUniverse,
  lightCaption,
  planetPalette,
  tetheredCount,
  universeChips,
  universeSummary,
  universeVerse,
  verseOfTheDay,
} from './universe-model';

/** Before a project is chosen, the sky shows a little primordial 성운. */
const GENESIS_NEBULA = 14;
const REFRESH_MS = 60_000;

interface UniverseData {
  project: string;
  repository: boolean;
  upstream: boolean;
  nebula: number;
  commits: UniverseCommit[];
}

const EMPTY: UniverseData = { project: '', repository: false, upstream: false, nebula: 0, commits: [] };

/** The sky holds still under reduced motion, with the effects setting off, or while the app is hidden. */
function stillSky(): boolean {
  const root = document.documentElement;
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true ||
    root.dataset.workbenchEffects === 'off' ||
    root.dataset.appHidden === 'true' ||
    document.hidden
  );
}

function signature(data: UniverseData): string {
  const unpushed = data.commits.filter((commit) => !commit.pushed).length;
  return [data.project, data.repository, data.upstream, data.nebula, data.commits.length, data.commits[0]?.hash ?? '', unpushed].join('|');
}

/** git log + status for the planet, refreshed on focus and once a minute while shown. */
function useUniverseData(projectPath: string, active: boolean): UniverseData {
  const [data, setData] = useState<UniverseData>(EMPTY);
  useEffect(() => {
    const desktop = window.mixdogDesktop;
    if (!projectPath || !active || (!desktop?.gitLog && !desktop?.gitStatus)) return undefined;
    let alive = true;
    let loading = false;
    // Refreshes skip a hidden window; the first look and a focus always read.
    const load = async (refresh = false) => {
      if (loading || (refresh && document.hidden)) return;
      loading = true;
      try {
        const [status, log] = await Promise.allSettled([
          desktop.gitStatus?.(projectPath, { skipLineStats: true }),
          desktop.gitLog?.(projectPath, '', 0, UNIVERSE_LIMIT),
        ]);
        if (!alive) return;
        const state: DesktopGitStatus | undefined = status.status === 'fulfilled' ? status.value : undefined;
        const entries: DesktopGitLogEntry[] = log.status === 'fulfilled' && Array.isArray(log.value) ? log.value : [];
        const next: UniverseData = {
          project: projectPath,
          repository: state ? state.repository : entries.length > 0,
          upstream: Boolean(state?.upstream),
          nebula: state?.files.length ?? 0,
          commits: entries.map((entry) => ({
            hash: entry.hash,
            shortHash: entry.shortHash,
            subject: entry.subject,
            author: entry.author,
            authoredAt: entry.authoredAt,
            pushed: entry.pushed,
            parents: entry.parents,
            tags: entry.tags,
          })),
        };
        setData((previous) => (signature(previous) === signature(next) ? previous : next));
      } finally {
        loading = false;
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [projectPath, active]);
  // A different project never shows the last one's sky while its own loads.
  return data.project === projectPath ? data : EMPTY;
}

export function CosmosUniverse({
  projectPath,
  planetName,
  subtitle,
  active = true,
}: {
  projectPath: string;
  planetName: string;
  subtitle?: string;
  active?: boolean;
}) {
  const data = useUniverseData(projectPath, active);
  const hasProject = Boolean(projectPath);
  const lights = useMemo(() => layoutUniverse(data.commits), [data.commits]);
  const palette = useMemo(() => (hasProject ? planetPalette(planetName) : planetPalette('cosmos', GENESIS_HUE)), [hasProject, planetName]);
  const facts: UniverseFacts = {
    planetName,
    hasProject,
    repository: data.repository,
    lights: lights.length,
    beyond: lights.length >= UNIVERSE_LIMIT,
    nebula: data.nebula,
    tethered: tetheredCount(lights, data.upstream),
  };
  const verse = universeVerse(facts);
  const chips = universeChips(facts);
  const epigraph = verseOfTheDay(planetName);
  const model = useMemo<SceneModel>(
    () => ({
      seed: hasProject ? planetName : 'cosmos',
      palette,
      lights,
      nebula: hasProject ? data.nebula : GENESIS_NEBULA,
      tethers: data.upstream,
    }),
    [hasProject, planetName, palette, lights, data.nebula, data.upstream]
  );

  const skyRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<UniverseScene | null>(null);
  const modelRef = useRef(model);
  const activeRef = useRef(active);
  const syncRef = useRef<() => void>(() => {});
  const [pointed, setPointed] = useState<PickedLight | null>(null);

  // The scene is made once the sky has a size (never in a zero-size or
  // canvas-less host) and moves only while it can actually be seen.
  useEffect(() => {
    const sky = skyRef.current;
    const canvas = canvasRef.current;
    if (!sky || !canvas) return undefined;
    let scene: UniverseScene | null = null;
    let onScreen = true;
    const sync = () => scene?.setRunning(onScreen && activeRef.current && !stillSky());
    const measure = () => {
      const width = sky.clientWidth;
      const height = sky.clientHeight;
      if (!width || !height) return;
      if (!scene) {
        scene = createUniverseScene(canvas);
        if (!scene) return;
        sceneRef.current = scene;
        scene.update(modelRef.current);
      }
      scene.resize(width, height, Math.min(2, window.devicePixelRatio || 1));
      sync();
    };
    syncRef.current = sync;
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(sky);
    const intersect =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            sync();
          });
    intersect?.observe(sky);
    const settings = typeof MutationObserver === 'undefined' ? null : new MutationObserver(sync);
    settings?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workbench-effects', 'data-app-hidden'] });
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    motionQuery?.addEventListener?.('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      resize?.disconnect();
      intersect?.disconnect();
      settings?.disconnect();
      motionQuery?.removeEventListener?.('change', sync);
      document.removeEventListener('visibilitychange', sync);
      scene?.destroy();
      sceneRef.current = null;
      syncRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    modelRef.current = model;
    sceneRef.current?.update(model);
    setPointed(null);
  }, [model]);

  useEffect(() => {
    activeRef.current = active;
    syncRef.current();
  }, [active]);

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!scene || !canvas || event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    const hit = scene.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (hit?.light.hash === pointed?.light.hash) return;
    scene.setHover(hit?.light.hash ?? null);
    setPointed(hit);
  };
  const leave = () => {
    sceneRef.current?.setHover(null);
    setPointed(null);
  };

  const caption = pointed ? lightCaption(pointed.light) : null;
  const skyWidth = skyRef.current?.clientWidth ?? 0;
  const tipLeft = pointed ? Math.min(Math.max(pointed.x, 150), Math.max(150, skyWidth - 150)) : 0;

  return (
    <div className="cosmos-universe" data-planet-hue={palette.hue}>
      <div ref={skyRef} className="cosmos-universe-sky" onPointerMove={point} onPointerLeave={leave}>
        <canvas ref={canvasRef} className="cosmos-universe-canvas" aria-hidden="true" />
        <div className="cosmos-universe-head">
          <span className="cosmos-universe-wordmark">코스모스 코드</span>
          <h1>{planetName}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <p className="cosmos-universe-epigraph">{epigraph}</p>
        <div className="cosmos-universe-foot">
          <p className="cosmos-universe-line">{verse.line}</p>
          <p className="cosmos-universe-detail">{verse.detail}</p>
          {chips.length > 0 && (
            <ul className="cosmos-universe-chips">
              {chips.map((chip) => (
                <li key={chip.name}>
                  <b>{chip.name}</b> {chip.value} <span>· {chip.plain}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {pointed && caption && (
          <div
            className={`cosmos-universe-tip${pointed.y < 110 ? ' is-below' : ''}`}
            style={{ left: tipLeft, top: pointed.y }}
            aria-hidden="true"
          >
            <strong>{caption.title}</strong>
            <span className="cosmos-universe-tip-meta">{caption.meta}</span>
            {caption.note && <span className="cosmos-universe-tip-note">{caption.note}</span>}
          </div>
        )}
      </div>
      <p className="sr-only">{universeSummary(facts)}</p>
    </div>
  );
}
