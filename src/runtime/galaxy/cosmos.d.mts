// Types for the desktop host (apps/desktop imports the runtime module directly).
export interface CosmosGuest {
  /** The phone's browser id (stable per phone). */
  id: string;
  name?: string | null;
}
export interface CosmosVerbOptions {
  root?: string | null;
  /** A phone driving this PC over the relay acts as its own star. */
  guest?: CosmosGuest | null;
  dir?: string;
  home?: string;
}
export function sun(options: CosmosVerbOptions & { root: string; force?: boolean; syncEnvironment?: boolean }): Promise<any>;
export function moon(options: CosmosVerbOptions & { root: string; note?: string; handoffTo?: string | null; session?: unknown; force?: boolean; syncEnvironment?: boolean }): Promise<any>;
export function requestTurn(options: CosmosVerbOptions & { root: string; note?: string; withdraw?: boolean }): Promise<any>;
export function heartbeat(options?: { planets?: string[]; dir?: string; home?: string }): Promise<unknown>;
export function overview(options?: CosmosVerbOptions & { fetch?: boolean }): Promise<any>;
