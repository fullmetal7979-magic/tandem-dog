import type { DesktopApi } from '../../shared/contract';
import { REPO_NAME, REPO_OWNER } from '../../shared/fork-identity';

// Keyed by the fork repository so a star recorded for upstream Mixdog (or for
// a different fork owner) never paints "Starred" here.
const STARRED_KEY = `tandemdog.desktop.github-starred.${REPO_OWNER}.${REPO_NAME}`;

export function readGithubStarred(): boolean {
  try {
    return window.localStorage.getItem(STARRED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberGithubStarred(starred: boolean): boolean {
  if (starred) {
    try {
      window.localStorage.setItem(STARRED_KEY, 'true');
    } catch {
      /* Keep the current UI state when storage is unavailable. */
    }
  }
  return starred;
}

/** One gh star probe; a confirmed star is remembered so the next surface
 *  paints "Starred" at once instead of flipping from "Star". */
export async function probeGithubStarred(
  host: Partial<Pick<DesktopApi, 'githubStarStatus'>> | undefined
): Promise<{ available: boolean; starred: boolean } | null> {
  const status = await host?.githubStarStatus?.();
  if (!status) return null;
  return { available: status.available === true, starred: rememberGithubStarred(status.starred === true) };
}
