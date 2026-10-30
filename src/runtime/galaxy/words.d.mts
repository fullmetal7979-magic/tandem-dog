export type ParticlePair = '이가' | '을를' | '은는' | '와과' | '으로';
export function finalSound(word: string): 'open' | 'rieul' | 'closed' | null;
export function endsWithBatchim(word: string): boolean | null;
export function josa(name: string, pair: ParticlePair): string;
export function ago(at: number | null | undefined, now?: number): string;
export function minutesUntil(at: number, now?: number): number;
