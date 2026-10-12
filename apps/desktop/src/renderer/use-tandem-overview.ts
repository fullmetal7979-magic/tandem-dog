import { useCallback, useEffect, useRef, useState } from 'react';
import type { TandemOverview } from '../shared/contract-tandem';
import { createGitRefreshScheduler } from './git-refresh-scheduler';
import { subscribeProjectFileChanges } from './project-file-changes';

/** How often the panel re-reads the remote while it is the visible dock view. */
const TANDEM_FETCH_INTERVAL_MS = 60_000;

interface TandemOverviewState {
  projectPath: string;
  overview: TandemOverview | null;
  /** When the last remote-fetching read finished; the "checked N min ago" clock. */
  fetchedAt: number | null;
  loading: boolean;
  error: string;
}

const EMPTY_STATE: TandemOverviewState = {
  projectPath: '',
  overview: null,
  fetchedAt: null,
  loading: false,
  error: '',
};

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : String(reason ?? '');
}

/** Whether the host exposes the Tandem API (absent in older hosts and the remote phone shim). */
export function tandemApiAvailable(): boolean {
  return typeof window.mixdogDesktop?.tandemOverview === 'function';
}

/** Tandem dock state: the overview of the project's session, refreshed from
 *  Git evidence (project file changes, `mixdog:git-changed`, window focus)
 *  without touching the network, and from the remote (`fetch: true`) on entry,
 *  on manual refresh, on window focus and every minute while the tab shows.
 *  Nothing runs while the tab is inactive. */
export function useTandemOverview(projectPath: string, active: boolean) {
  const [state, setState] = useState<TandemOverviewState>(EMPTY_STATE);
  const requestEpoch = useRef(0);
  const fetchNext = useRef(true);

  const refresh = useCallback(
    async (options: { fetch?: boolean; force?: boolean } = {}) => {
      const fetchRemote = options.fetch === true;
      const epoch = ++requestEpoch.current;
      const api = window.mixdogDesktop;
      if (!projectPath || typeof api?.tandemOverview !== 'function') {
        setState({ ...EMPTY_STATE, projectPath });
        return;
      }
      setState((current) => ({
        ...(current.projectPath === projectPath ? current : { ...EMPTY_STATE, projectPath }),
        loading: true,
      }));
      try {
        const overview = await api.tandemOverview(projectPath, options.force === true ? { fetch: fetchRemote, force: true } : { fetch: fetchRemote });
        if (epoch !== requestEpoch.current) return;
        setState((current) => ({
          projectPath,
          overview,
          fetchedAt: fetchRemote ? Date.now() : current.projectPath === projectPath ? current.fetchedAt : null,
          loading: false,
          error: '',
        }));
      } catch (reason) {
        if (epoch !== requestEpoch.current) return;
        setState((current) => ({
          ...(current.projectPath === projectPath ? current : { ...EMPTY_STATE, projectPath }),
          loading: false,
          error: errorMessage(reason),
        }));
      }
    },
    [projectPath]
  );

  // Entry reads the remote once, then Git evidence keeps the local half fresh.
  // Same scheduler as the Source Control dock: debounced, one in flight.
  useEffect(() => {
    // A read still in flight when the tab or project changes must not land.
    const dropInFlight = () => {
      requestEpoch.current += 1;
    };
    if (!active || !projectPath) return dropInFlight;
    fetchNext.current = true;
    const scheduler = createGitRefreshScheduler(
      async () => {
        const fetch = fetchNext.current;
        fetchNext.current = false;
        await refresh({ fetch });
      },
      {
        safetyIntervalMs: 5 * 60_000,
        activityDebounceMs: 250,
        activityMinGapMs: 3_000,
        slowTaskMultiplier: 5,
      }
    );
    const signal = () => scheduler.signal();
    const refreshWithFetch = () => {
      fetchNext.current = true;
      scheduler.refreshNow();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') scheduler.pause();
      else scheduler.resume();
    };
    const unsubscribeProject = subscribeProjectFileChanges(projectPath, signal);
    window.addEventListener('focus', refreshWithFetch);
    window.addEventListener('mixdog:git-changed', signal);
    document.addEventListener('visibilitychange', visibilityChanged);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshWithFetch();
    }, TANDEM_FETCH_INTERVAL_MS);
    if (document.visibilityState !== 'hidden') scheduler.resume();
    return () => {
      dropInFlight();
      scheduler.dispose();
      unsubscribeProject();
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWithFetch);
      window.removeEventListener('mixdog:git-changed', signal);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [active, projectPath, refresh]);

  const current = state.projectPath === projectPath ? state : { ...EMPTY_STATE, projectPath };
  return {
    overview: current.overview,
    fetchedAt: current.fetchedAt,
    loading: current.loading,
    error: current.error,
    refresh,
  };
}
