// 심플 / 고급 모드. Simple shows only what everyday relay work needs; advanced
// shows every tool COSMOS still ships. The mode is read once at startup (the
// feature gates are module-level constants), so switching reloads the window.
//
// Storage: localStorage for the instant first paint, mirrored into the shared
// config (desktop.uiMode) so the Galaxy carries the choice to every device.
export type CosmosUiMode = 'simple' | 'advanced';

export const UI_MODE_STORAGE_KEY = 'cosmos.ui-mode.v1';
const DEFAULT_MODE: CosmosUiMode = 'simple';

export function parseUiMode(value: unknown): CosmosUiMode | null {
  return value === 'simple' || value === 'advanced' ? value : null;
}

export function readUiMode(): CosmosUiMode {
  // Test/deployment override (scripts/test-env.mjs pins 'advanced' so the
  // full tool surface stays under test).
  const forced = parseUiMode((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.COSMOS_UI_MODE);
  if (forced) return forced;
  try {
    return parseUiMode(globalThis.localStorage?.getItem(UI_MODE_STORAGE_KEY)) ?? DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Fixed for this window's lifetime; see the header. */
export const CURRENT_UI_MODE: CosmosUiMode = readUiMode();

export function applyUiModeAttribute(mode: CosmosUiMode = CURRENT_UI_MODE): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.cosmosMode = mode;
}

/** Persist and reload so every gate re-reads the mode. */
export function switchUiMode(mode: CosmosUiMode, { reload = true } = {}): void {
  try {
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    /* storage-less host: the switch only lasts this window */
  }
  const desktop = (window as unknown as { mixdogDesktop?: { cosmosSetPreference?(key: 'uiMode', value: string): Promise<void> } })
    .mixdogDesktop;
  void desktop?.cosmosSetPreference?.('uiMode', mode).catch(() => undefined);
  if (reload && mode !== CURRENT_UI_MODE) window.location.reload();
}

/**
 * A mode synced from another device (config desktop.uiMode) is adopted for
 * the next start without interrupting this one.
 */
export function adoptSyncedUiMode(value: unknown): void {
  const mode = parseUiMode(value);
  if (!mode || mode === readUiMode()) return;
  try {
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
