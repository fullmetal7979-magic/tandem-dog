/** One workspace; source-controlled switches define what this build ships. */

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

export function desktopFeatureEnabled(feature: DesktopFeatureId): boolean {
  return DESKTOP_FEATURES[feature];
}

export function desktopSidebarDestinationEnabled(destination: DesktopSidebarDestination): boolean {
  // Workflows ride on Projects in the build switch but are an advanced tool.
  if (destination === 'workflows') return desktopFeatureEnabled('projects');
  return desktopFeatureEnabled(destination);
}

export function desktopUtilityDockTabEnabled(tab: DesktopUtilityDockTab): boolean {
  return desktopFeatureEnabled(UTILITY_DOCK_FEATURES[tab]);
}

function firstEnabledDesktopUtilityDockTab(): DesktopUtilityDockTab | null {
  return UTILITY_DOCK_TABS.find(desktopUtilityDockTabEnabled) ?? null;
}

export const hasDesktopUtilityDockFeature = firstEnabledDesktopUtilityDockTab() !== null;
