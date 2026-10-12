export type Desk = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export const SLOTS: Desk[];
export const SESSION_REL: string;

export interface GitResult { code: number; stdout: string; stderr: string }
export function configureGitEnvironment(provider: () => Record<string, string | undefined>): () => Record<string, string | undefined>;
export function runGit(cwd: string, args: string[], opts?: { input?: string; env?: Record<string, string> }): Promise<GitResult>;

export interface Session {
  goal: string;
  state: string;
  next: string;
  decisions: string[];
  log: string[];
  extra?: { name: string; body: string }[];
}
export function parseSession(md: string): Session;
export function renderSession(s: Partial<Session>): string;
export function readSession(root: string): Promise<Session | null>;
export function writeSession(root: string, s: Partial<Session>): Promise<void>;

export interface LogEntry { at: string; desk: string; tool: string; text: string; kind: 'leave' | 'resume' | 'note'; branch: string | null; memo: string }
export function logLine(e: { desk?: string | null; tool?: string | null; text: string; date?: Date }): string;
export function parseLogLine(line: string): LogEntry | null;
export function stamp(date?: Date): string;
export function oneLine(v: unknown): string;
export function isValidBranch(name: string): boolean;
export function isValidDesk(desk: string): desk is Desk;

export interface DeskConfig { desk: Desk | null; tool: string | null; base: string; host: string }
export function repoRoot(cwd: string): Promise<string>;
export function readDeskConfig(root: string): Promise<DeskConfig>;
export function writeDeskConfig(root: string, cfg: { desk?: Desk | null; tool?: string | null; base?: string | null }): Promise<void>;
export function ensureGitignore(root: string): Promise<void>;

export interface BranchInfo { name: string; head: string; upstream: string | null; ahead: number; behind: number; gone: boolean; ts: number; subject: string }
export interface LocalStatus { branch: string; head: string; branches: BranchInfo[]; dirty: string[]; at: number }
export interface RemoteBranch { name: string; head: string; ts: number; subject: string }
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean };
export function localStatus(root: string): Promise<LocalStatus>;
export function remoteBranches(root: string): Promise<RemoteBranch[]>;

export interface DeskRecord extends LocalStatus { v: 1; desk: Desk; tool: string | null; host: string; holding: string | null }
export function publishDesk(root: string, opts: { desk: Desk; tool?: string | null; status: LocalStatus; holding?: string | null; push?: boolean }): Promise<{ ref: string; commit: string; pushed: boolean; error: string | null }>;
export function fetchAll(root: string): Promise<GitResult>;
export function fetchDesks(root: string, opts?: { fetch?: boolean }): Promise<DeskRecord[]>;

export type RelKind = 'none' | 'ahead' | 'diverged' | 'behind' | 'stale' | 'ok';
export interface BranchOverview {
  branch: string;
  gh: RemoteBranch | null;
  rows: { desk: Desk; tool: string | null; host: string; at: number; holding: string | null; branch: BranchInfo | null; rel: { k: RelKind; label: string }; current: boolean; dirty: number }[];
  latest: { where: string[]; localOnly: boolean };
  holder: Desk | null;
  verdict: { level: 'ok' | 'warn' | 'bad'; text: string };
}
export function branchOverview(branch: string, data: { remote?: RemoteBranch[]; desks?: Partial<DeskRecord>[] }): BranchOverview;

export function context(root: string, opts?: { pull?: boolean }): Promise<string>;
export function leave(root: string, opts?: { memo?: string; next?: string; push?: boolean }): Promise<{ branch: string; committed: boolean; pushed: boolean; pushError: string | null; published: unknown }>;
export function resume(root: string, opts?: { branch?: string | null; push?: boolean }): Promise<{ branch: string; pulled: boolean; pullError: string | null; published: unknown; prompt: string }>;
export function heartbeat(root: string, opts?: { push?: boolean }): Promise<unknown>;
export function overview(root: string, opts?: { fetch?: boolean }): Promise<{ config: DeskConfig; session: Session | null; desks: DeskRecord[]; remote: RemoteBranch[]; local: LocalStatus; focus: BranchOverview; handoffs: LogEntry[] }>;
