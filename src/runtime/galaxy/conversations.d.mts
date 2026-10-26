export function readConversationIn(galaxy: string | { json(rel: string): Promise<any>; names(relDir: string): Promise<string[]> }, planetId: string, id?: string | null): Promise<any>;
