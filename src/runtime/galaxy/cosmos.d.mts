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
/**
 * Why a project push failed. 'behind': the remote has newer commits;
 * 'rejected': the remote refused (permission, protected branch, hook);
 * 'push': connection/other; 'commit' | 'detached' | 'scan': local problems.
 */
export type CosmosPushFailure = 'behind' | 'rejected' | 'push' | 'commit' | 'detached' | 'scan';
/** moon({ force: true }) freed the seat although the work did not reach the remote. */
export interface CosmosUnpushed {
  reason: CosmosPushFailure | string;
  detail: string;
  committed: boolean;
  branch: string | null;
  ahead: number;
}
/**
 * moon() throws GalaxyError code 'push_failed' with { reason, canForce: true, project }
 * when the push fails and `force` is not set; call moon again with force: true
 * ("그래도 내려놓기") to free the seat anyway. Code 'secrets' is never forced.
 */
export function moon(
  options: CosmosVerbOptions & { root: string; note?: string; handoffTo?: string | null; session?: unknown; force?: boolean; syncEnvironment?: boolean }
): Promise<any>; // resolves with `unpushed: CosmosUnpushed | null` among its fields
export function requestTurn(options: CosmosVerbOptions & { root: string; note?: string; withdraw?: boolean }): Promise<any>;
export function heartbeat(options?: { planets?: string[]; dir?: string; home?: string }): Promise<unknown>;
export function overview(options?: CosmosVerbOptions & { fetch?: boolean }): Promise<any>;
