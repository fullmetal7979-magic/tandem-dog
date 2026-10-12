// Tandem: one coding session that follows the user across PCs and AI accounts.
// The canonical session is .tandem/SESSION.md in the user's repository; each
// PC publishes its git status to refs/tandem/desks/<desk>. See
// src/runtime/tandem/tandem-core.mjs for the model these types mirror.

export type TandemDesk = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export const TANDEM_DESKS: readonly TandemDesk[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export interface TandemSession {
  goal: string;
  state: string;
  next: string;
  decisions: string[];
  log: string[];
}

export interface TandemDeskConfig {
  desk: TandemDesk | null;
  tool: string | null;
  base: string;
  host: string;
}

export interface TandemBranchInfo {
  name: string;
  head: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  ts: number;
  subject: string;
}

export interface TandemDeskRecord {
  desk: TandemDesk;
  tool: string | null;
  host: string;
  holding: string | null;
  branch: string;
  head: string;
  branches: TandemBranchInfo[];
  dirty: string[];
  at: number;
}

export interface TandemRemoteBranch {
  name: string;
  head: string;
  ts: number;
  subject: string;
}

export type TandemRelation = 'none' | 'ahead' | 'diverged' | 'behind' | 'stale' | 'ok';

export interface TandemBranchOverview {
  branch: string;
  gh: TandemRemoteBranch | null;
  rows: Array<{
    desk: TandemDesk;
    tool: string | null;
    host: string;
    at: number;
    holding: string | null;
    branch: TandemBranchInfo | null;
    rel: { k: TandemRelation; label: string };
    current: boolean;
    dirty: number;
  }>;
  /** 'github' and/or desk letters holding the newest commit of `branch`. */
  latest: { where: string[]; localOnly: boolean };
  holder: TandemDesk | null;
  verdict: { level: 'ok' | 'warn' | 'bad'; text: string };
}

export interface TandemHandoff {
  at: string;
  desk: string;
  tool: string;
  text: string;
  kind: 'leave' | 'resume' | 'note';
  branch: string | null;
  memo: string;
}

export interface TandemOverview {
  /** False when the folder is not a git repository with an `origin` remote. */
  available: boolean;
  reason?: string;
  root?: string;
  config?: TandemDeskConfig;
  session?: TandemSession | null;
  desks?: TandemDeskRecord[];
  remote?: TandemRemoteBranch[];
  focus?: TandemBranchOverview;
  handoffs?: TandemHandoff[];
}

export interface TandemLeaveRequest {
  memo: string;
  next?: string;
}

export interface TandemLeaveResult {
  branch: string;
  committed: boolean;
  pushed: boolean;
  pushError: string | null;
}

export interface TandemResumeRequest {
  branch?: string | null;
}

export interface TandemResumeResult {
  branch: string;
  pulled: boolean;
  pullError: string | null;
  /** Prompt to paste into an agent that does not read .tandem/SESSION.md itself. */
  prompt: string;
}

export interface TandemSetDeskRequest {
  desk: TandemDesk;
  /** Account label shown to other PCs, e.g. "Claude 개인" or "Codex". */
  tool?: string | null;
}

/** Renderer-facing API, merged into DesktopApi (all optional, like the rest). */
export interface DesktopTandemApi {
  /** `fetch` is throttled to once per 30 s per project unless `force` (manual refresh). */
  tandemOverview?(cwd: string, options?: { fetch?: boolean; force?: boolean }): Promise<TandemOverview>;
  tandemLeave?(cwd: string, request: TandemLeaveRequest): Promise<TandemLeaveResult>;
  tandemResume?(cwd: string, request: TandemResumeRequest): Promise<TandemResumeResult>;
  tandemSetDesk?(cwd: string, request: TandemSetDeskRequest): Promise<TandemDeskConfig>;
  tandemContext?(cwd: string): Promise<string>;
  tandemSaveSession?(cwd: string, session: Partial<TandemSession>): Promise<TandemSession>;
}

export const TANDEM_IPC = {
  tandemOverview: 'mixdog:tandem-overview',
  tandemLeave: 'mixdog:tandem-leave',
  tandemResume: 'mixdog:tandem-resume',
  tandemSetDesk: 'mixdog:tandem-set-desk',
  tandemContext: 'mixdog:tandem-context',
  tandemSaveSession: 'mixdog:tandem-save-session',
} as const;
