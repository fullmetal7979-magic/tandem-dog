export const STAR_COLORS: string[];
export const STAR_KINDS: string[];
export interface Star {
  v: 1;
  id: string;
  name: string;
  color: string;
  kind: 'pc' | 'mac' | 'phone';
  os: string;
  host: string;
  createdAt: number;
}
export function cosmosHome(): string;
export function ensureStar(home?: string): Promise<Star>;
export function updateStar(patch: Partial<Star>, home?: string): Promise<Star>;
