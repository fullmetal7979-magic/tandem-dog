export function normalizeRemoteUrl(url: string): string;
export function planetSlug(planetId: string): string;
export function planetForRoot(root: string): Promise<{ id: string | null; slug: string | null; name: string; remote: { name: string; url: string } | null }>;
