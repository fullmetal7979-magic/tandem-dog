/**
 * Desktop feature locks, in two layers:
 *  - DESKTOP_FEATURES: what this build ships at all (source-controlled).
 *  - COSMOS 심플 모드: the everyday subset. 고급 모드 shows every shipped
 *    feature. The mode is fixed per window (cosmos/ui-mode.ts reloads on a
 *    switch), so every gate below may still be read at module load.
 */
import { CURRENT_UI_MODE } from './cosmos/ui-mode';

type DesktopFeatureId =
  | 'sessions'
  | 'projects'
  | 'extensions'
  | 'schedules'
  | 'webhooks'
  | 'usage'
  | 'settings'
  | 'agents'
  | 'explorer'
  | 'sourceControl'
  | 'pullRequests'
  | 'tandem'
  | 'run';

const DESKTOP_FEATURES: Readonly<Record<DesktopFeatureId, boolean>> = {
  sessions: true,
  projects: true,
  extensions: true,
  schedules: true,
  webhooks: false,
  usage: true,
  settings: true,
  agents: true,
  explorer: true,
  sourceControl: true,
  pullRequests: false,
  tandem: true,
  run: true,
};

type DesktopSidebarDestination = 'sessions' | 'projects' | 'workflows' | 'extensions' | 'schedules' | 'webhooks';

export type DesktopUtilityDockTab = 'agents' | 'search' | 'run' | 'tandem' | 'source-control' | 'pull-requests';

const UTILITY_DOCK_FEATURES: Readonly<Record<DesktopUtilityDockTab, DesktopFeatureId>> = {
  agents: 'agents',
  search: 'explorer',
  run: 'run',
  tandem: 'tandem',
  'source-control': 'sourceControl',
  'pull-requests': 'pullRequests',
};

const UTILITY_DOCK_TABS: readonly DesktopUtilityDockTab[] = [
  'agents',
  'search',
  'run',
  'tandem',
  'source-control',
  'pull-requests',
];

// Simple mode keeps conversations, projects, files/search, ▶ run, the Galaxy
// and settings; agents, automation, extensions, usage and full source control are
// advanced tools.
const SIMPLE_MODE_FEATURES: ReadonlySet<DesktopFeatureId> = new Set(['sessions', 'projects', 'explorer', 'settings', 'tandem', 'run']);

export function desktopFeatureEnabled(feature: DesktopFeatureId): boolean {
  if (!DESKTOP_FEATURES[feature]) return false;
  return CURRENT_UI_MODE === 'advanced' || SIMPLE_MODE_FEATURES.has(feature);
}

export function desktopSidebarDestinationEnabled(destination: DesktopSidebarDestination): boolean {
  // Workflows ride on Projects in the build switch but are an advanced tool.
  if (destination === 'workflows') return desktopFeatureEnabled('projects') && CURRENT_UI_MODE === 'advanced';
  return desktopFeatureEnabled(destination);
}

export function desktopUtilityDockTabEnabled(tab: DesktopUtilityDockTab): boolean {
  return desktopFeatureEnabled(UTILITY_DOCK_FEATURES[tab]);
}

function firstEnabledDesktopUtilityDockTab(): DesktopUtilityDockTab | null {
  return UTILITY_DOCK_TABS.find(desktopUtilityDockTabEnabled) ?? null;
}

export const hasDesktopUtilityDockFeature = firstEnabledDesktopUtilityDockTab() !== null;
