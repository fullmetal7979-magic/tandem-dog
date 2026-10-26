export class GalaxyError extends Error {
  code: string;
  [key: string]: unknown;
}
export function galaxyDir(home?: string): string;
export function galaxyReady(dir?: string): Promise<boolean>;
export function galaxyRemote(dir?: string): Promise<string | null>;
export function connectGalaxy(options?: { dir?: string; remoteUrl?: string | null }): Promise<{ dir: string; remote: string | null }>;
export function pullGalaxy(dir?: string): Promise<{ remote: string | null; head: string | null }>;
export function readGalaxyJson(dir: string, rel: string, fallback?: unknown): Promise<any>;
export const SQUASH_COMMIT_THRESHOLD: number;
export function scrubUrl(url: string): string;
export function assertSafeRemoteUrl(url: string): string;
export function fetchGalaxy(dir?: string): Promise<{ remote: string | null; fetched: boolean }>;
export interface GalaxyReader {
  ref: string | null;
  text(rel: string): Promise<string | null>;
  json(rel: string, fallback?: unknown): Promise<any>;
  names(relDir: string): Promise<string[]>;
}
export function galaxyReader(dir?: string): Promise<GalaxyReader>;
export function withLock<T>(dir: string, run: () => Promise<T>, options?: { waitMs?: number; staleMs?: number; refreshMs?: number }): Promise<T>;
