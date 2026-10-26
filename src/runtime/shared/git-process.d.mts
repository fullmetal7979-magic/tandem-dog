export interface GitResult { code: number; stdout: string; stderr: string; timedOut?: boolean; }
export function configureGitEnvironment(provider: () => Record<string, string | undefined>): () => Record<string, string | undefined>;
export function defaultGitTimeoutMs(args: string[]): number;
export function isNetworkGit(args: string[]): boolean;
export function gitTimeoutSignal(args: string[]): 'SIGKILL' | 'SIGTERM';
export function runGit(cwd: string, args: string[], opts?: { input?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<GitResult>;
export function repoRoot(cwd: string): Promise<string>;
export function oneLine(value: unknown): string;
