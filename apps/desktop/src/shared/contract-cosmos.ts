// COSMOS relay surface: the Galaxy (은하수), stars (별), planets (행성) and the
// seat (조종석). Mirrors src/runtime/galaxy/cosmos.mjs; the desktop service
// runs those verbs and hands the renderer plain JSON.

export type CosmosStarKind = 'pc' | 'mac' | 'phone';
/** 'remote': a phone sits in the seat through THIS PC (the PC is locked, 되찾기 available). */
export type CosmosSeatState = 'empty' | 'mine' | 'occupied' | 'stale' | 'remote' | 'no_remote' | 'no_galaxy';

export interface CosmosStar {
  id: string;
  name: string;
  color: string;
  kind: CosmosStarKind;
  os?: string;
  host?: string;
  seenAt?: number;
  me?: boolean;
  beat?: { at: number; planets?: string[]; name?: string } | null;
}

export interface CosmosSeatPerson {
  star: string;
  name: string;
  kind: CosmosStarKind;
  color?: string;
}

export interface CosmosSeatHistoryEntry extends CosmosSeatPerson {
  from: number;
  to: number | null;
  memo?: string;
  via?: string;
  forced?: boolean;
}

export interface CosmosSeat {
  v: 1;
  planet: string;
  holder: (CosmosSeatPerson & { since: number; via?: string; host?: string | null }) | null;
  requests: Array<CosmosSeatPerson & { at: number; note?: string }>;
  handoffTo: string | null;
  history: CosmosSeatHistoryEntry[];
}

export interface CosmosPlanet {
  id: string | null;
  slug?: string | null;
  name: string;
  remote?: { name: string; url: string } | null;
}

export interface CosmosPlanetRecord {
  id: string;
  name: string;
  remote: string;
  lastSeat?: { star: string; name: string; at: number };
  lastMoon?: { star: string; name: string; at: number; note?: string };
}

export interface CosmosConversationSummary {
  id: string;
  title: string;
  star: { id: string; name: string; kind: CosmosStarKind } | null;
  exportedAt: number;
  messageCount: number;
}

export interface CosmosProjectState {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

export interface CosmosOverview {
  star: CosmosStar;
  ready: boolean;
  remote: string | null;
  syncedAt: number;
  offline?: string | null;
  stars: CosmosStar[];
  planets: CosmosPlanetRecord[];
  planet: CosmosPlanet | null;
  seat: CosmosSeat | null;
  state: CosmosSeatState | null;
  holderLastSeen?: number;
  /** The last 이어받기 took the seat but did not finish rescuing and catching up this checkout. */
  pendingRescue?: boolean;
  /** The holder is on this same machine (this PC ⇄ the phone driving it): take the seat directly. */
  here?: boolean;
  conversations: CosmosConversationSummary[];
  project?: CosmosProjectState | null;
  /** Relay server address shared through the Galaxy (phone turns). */
  relayUrl?: string | null;
  /**
   * Live ▶ 실행 terminals (term_cosmos_run_*) of this project in the desktop
   * service, present only when the overview was asked with `runs: true`: a
   * reloaded run pane re-adopts them instead of leaving dev servers orphaned.
   * `busy`: a command holds the foreground (null when unknown); `exited`: the
   * shell itself ended. Older services sent bare ids.
   */
  runs?: Array<string | { id: string; busy: boolean | null; exited: boolean }>;
}

export interface CosmosEnvironmentSummary {
  down: number;
  up: number;
  conflicts: Array<{ key: string; kept: 'galaxy' | 'local' }>;
  backupDir: string | null;
}

export interface CosmosSunResult {
  planet: CosmosPlanet;
  seat: CosmosSeat;
  took: CosmosSeatPerson | null;
  /** Taken over from the same machine (this PC ⇄ the phone driving it). */
  passed?: CosmosSeatPerson | null;
  rescue: { branch: string; commits: number; dirty: number } | null;
  environment: CosmosEnvironmentSummary | null;
  project: (CosmosProjectState & { ok: boolean; pulled?: number; error?: string; skipped?: string }) | null;
  conversation: CosmosConversationSummary | null;
}

export interface CosmosMoonResult {
  planet: CosmosPlanet;
  seat: CosmosSeat | null;
  handoffTo: string | null;
  project: (CosmosProjectState & { ok: boolean; committed?: boolean; pushed?: boolean; error?: string }) | null;
  /** Set when 그래도 내려놓기 (force) freed the seat although the push failed: the work stayed on this device. */
  unpushed?: { reason?: string; committed?: boolean; branch?: string | null; ahead?: number } | null;
  environment: CosmosEnvironmentSummary | null;
  conversation: { id: string; messageCount: number; trimmed: boolean } | null;
}

/** A refused verb (seat taken, secrets found, …) comes back as data, not as a thrown error. */
export interface CosmosRefusal {
  refused: true;
  code: string;
  message: string;
  seat?: CosmosSeat | null;
  holder?: CosmosSeatPerson | null;
  lastSeen?: number;
  secrets?: Array<{ path: string; reason: 'file' | 'content' }>;
  /**
   * Why push_failed: 'behind' (the remote moved), 'rejected' (refused by the
   * remote: permissions, a protected branch), 'push', 'commit', … Free text
   * from the runtime; read it defensively.
   */
  reason?: string;
  /** push_failed: false when the runtime says 그래도 내려놓기 cannot apply (missing: offered). */
  canForce?: boolean;
}

export type CosmosOutcome<T> = T | CosmosRefusal;

export function isCosmosRefusal(value: unknown): value is CosmosRefusal {
  return Boolean(value && typeof value === 'object' && (value as { refused?: unknown }).refused === true);
}

export interface CosmosGalaxySetupResult {
  remote: string | null;
  created: boolean;
}

export interface DesktopCosmosApi {
  /** `fetch: false` reads the last pull only (no network); `runs: true` adds the project's live ▶ 실행 terminals. */
  cosmosOverview?(cwd: string | null, options?: { fetch?: boolean; force?: boolean; runs?: boolean }): Promise<CosmosOverview>;
  cosmosSun?(cwd: string, request?: { force?: boolean }): Promise<CosmosOutcome<CosmosSunResult>>;
  /** `force: true` (그래도 내려놓기) releases the seat even when the push failed; unpushed work stays on this device. */
  cosmosMoon?(
    cwd: string,
    request?: { note?: string; handoffTo?: string | null; sessionId?: string | null; force?: boolean }
  ): Promise<CosmosOutcome<CosmosMoonResult>>;
  cosmosRequest?(cwd: string, request?: { note?: string; withdraw?: boolean }): Promise<CosmosOutcome<{ seat: CosmosSeat }>>;
  cosmosSetStar?(request: { name?: string; kind?: CosmosStarKind; color?: string }): Promise<CosmosStar>;
  /** Connect an existing Galaxy repository URL, or create the private `cosmos-galaxy` repo with gh. */
  cosmosSetupGalaxy?(request: { remoteUrl?: string | null; create?: boolean }): Promise<CosmosOutcome<CosmosGalaxySetupResult>>;
  cosmosHeartbeat?(planets: string[]): Promise<void>;
  /** Shared COSMOS preferences that travel through the Galaxy (the relay address). */
  cosmosSetPreference?(key: 'relayUrl', value: string | null): Promise<void>;
  /** Open a new session carrying the planet's latest (or the named) Galaxy conversation. */
  cosmosContinueConversation?(cwd: string, conversationId?: string | null): Promise<{ sessionId: string }>;
}

export const COSMOS_IPC = {
  cosmosOverview: 'mixdog:cosmos-overview',
  cosmosSun: 'mixdog:cosmos-sun',
  cosmosMoon: 'mixdog:cosmos-moon',
  cosmosRequest: 'mixdog:cosmos-request',
  cosmosSetStar: 'mixdog:cosmos-set-star',
  cosmosSetupGalaxy: 'mixdog:cosmos-setup-galaxy',
  cosmosHeartbeat: 'mixdog:cosmos-heartbeat',
  cosmosSetPreference: 'mixdog:cosmos-set-preference',
  cosmosContinueConversation: 'mixdog:cosmos-continue-conversation',
} as const;
