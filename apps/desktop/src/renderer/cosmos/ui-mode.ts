// Legacy preference compatibility. COSMOS now has one development workspace;
// optional destinations are exposed through the rail's More menu.
export type CosmosUiMode = 'simple' | 'advanced';
export const UI_MODE_STORAGE_KEY = 'cosmos.ui-mode.v1';
export function parseUiMode(value: unknown): CosmosUiMode | null {
  return value === 'simple' || value === 'advanced' ? value : null;
}
export function readUiMode(): CosmosUiMode { return 'advanced'; }
export const CURRENT_UI_MODE: CosmosUiMode = readUiMode();
export function applyUiModeAttribute(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.cosmosMode = 'advanced';
}
/** Existing integrations may still submit this preference. Never reload. */
export function switchUiMode(_mode: CosmosUiMode, _options: { reload?: boolean } = {}): void {
  applyUiModeAttribute();
}
export function adoptSyncedUiMode(_value: unknown): void { /* retired preference */ }
