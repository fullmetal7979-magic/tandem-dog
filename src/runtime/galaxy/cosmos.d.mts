// Types for the desktop host (apps/desktop imports the runtime module directly).
export interface CosmosVerbOptions {
  root?: string | null;
  dir?: string;
  home?: string;
}
export function sun(options: CosmosVerbOptions & { root: string; force?: boolean; via?: string; host?: string | null; syncEnvironment?: boolean }): Promise<any>;
export function moon(options: CosmosVerbOptions & { root: string; note?: string; handoffTo?: string | null; session?: unknown; syncEnvironment?: boolean }): Promise<any>;
export function requestTurn(options: CosmosVerbOptions & { root: string; note?: string; withdraw?: boolean }): Promise<any>;
export function heartbeat(options?: { planets?: string[]; dir?: string; home?: string }): Promise<unknown>;
export function overview(options?: CosmosVerbOptions & { fetch?: boolean }): Promise<any>;
