// Declarations for the desktop host's direct imports; see config.mjs.
export function readConfig(): Record<string, unknown>;
export function readSection(section: string): Record<string, unknown>;
export function updateConfig(updater: (config: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown>;
export function invalidateConfigReadCache(): void;
