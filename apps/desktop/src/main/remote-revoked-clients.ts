// Browsers this desktop revoked, kept on the desktop itself.
//
// Revoking a browser deletes its token on the relay, but every paired browser
// proves the same pairing secret in its E2EE hello. A relay that lost (or
// never applied) the revocation would let the revoked browser back in, so the
// desktop refuses those client ids itself, at open and again at hello. A new
// pairing the user approves for the same browser lifts the revocation.
import { join } from 'node:path';

import { readSecretFile, writeSecretFile } from './secret-file';

/** Far more than the paired-browser ceiling; oldest entries fall off first. */
const MAX_REVOKED = 256;

export interface RevokedClientStore {
  has(clientId: string): boolean;
  revoke(clientId: string): Promise<void>;
  /** The user approved a new pairing for this browser. */
  restore(clientId: string): Promise<void>;
}

export async function loadRevokedClientStore(userDataPath: string): Promise<RevokedClientStore> {
  const path = join(userDataPath, 'remote-revoked-clients.json');
  const ids: string[] = [];
  try {
    const raw = JSON.parse((await readSecretFile(path)) || '{}') as { revoked?: unknown };
    if (Array.isArray(raw.revoked)) {
      for (const id of raw.revoked) if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
    }
  } catch {
    /* unreadable: start empty rather than lock every browser out */
  }
  const set = new Set(ids);
  let writing = Promise.resolve();
  const save = (): Promise<void> => {
    const snapshot = JSON.stringify({ version: 1, revoked: [...set].slice(-MAX_REVOKED) });
    writing = writing.catch(() => undefined).then(() => writeSecretFile(path, snapshot));
    return writing;
  };
  return {
    has: (clientId) => set.has(clientId),
    revoke: async (clientId) => {
      if (!clientId || set.has(clientId)) return;
      set.add(clientId);
      while (set.size > MAX_REVOKED) set.delete(set.values().next().value as string);
      await save();
    },
    restore: async (clientId) => {
      if (!set.delete(clientId)) return;
      await save();
    },
  };
}
