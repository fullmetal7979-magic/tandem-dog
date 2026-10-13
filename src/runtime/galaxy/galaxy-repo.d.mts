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
