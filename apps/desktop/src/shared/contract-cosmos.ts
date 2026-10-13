// COSMOS relay surface: the Galaxy (은하수), stars (별), planets (행성) and the
// seat (조종석). Mirrors src/runtime/galaxy/cosmos.mjs; the desktop service
// runs those verbs and hands the renderer plain JSON.

export type CosmosStarKind = 'pc' | 'mac' | 'phone';
export type CosmosSeatState = 'empty' | 'mine' | 'occupied' | 'stale' | 'no_remote' | 'no_galaxy';

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
  conversations: CosmosConversationSummary[];
  project?: CosmosProjectState | null;
  /** Relay server address shared through the Galaxy (phone turns). */
  relayUrl?: string | null;
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
  cosmosOverview?(cwd: string | null, options?: { fetch?: boolean; force?: boolean }): Promise<CosmosOverview>;
  cosmosSun?(cwd: string, request?: { force?: boolean }): Promise<CosmosOutcome<CosmosSunResult>>;
  cosmosMoon?(cwd: string, request?: { note?: string; handoffTo?: string | null; sessionId?: string | null }): Promise<CosmosOutcome<CosmosMoonResult>>;
  cosmosRequest?(cwd: string, request?: { note?: string; withdraw?: boolean }): Promise<CosmosOutcome<{ seat: CosmosSeat }>>;
  cosmosSetStar?(request: { name?: string; kind?: CosmosStarKind; color?: string }): Promise<CosmosStar>;
  /** Connect an existing Galaxy repository URL, or create the private `cosmos-galaxy` repo with gh. */
  cosmosSetupGalaxy?(request: { remoteUrl?: string | null; create?: boolean }): Promise<CosmosOutcome<CosmosGalaxySetupResult>>;
  cosmosHeartbeat?(planets: string[]): Promise<void>;
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
  cosmosContinueConversation: 'mixdog:cosmos-continue-conversation',
} as const;
