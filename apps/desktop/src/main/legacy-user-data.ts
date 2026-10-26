// One-time carry-over of the Electron profile from the build COSMOS replaces.
//
// The packaged userData folder follows the product's package name, so the
// rename to COSMOS would otherwise start from an empty profile: window layout,
// renderer preferences and remote pairings all live there. The first launch
// copies the newest legacy folder that exists; after that the COSMOS folder
// exists and nothing is ever copied again. Engine data (~/.mixdog) is shared
// and needs no migration.
import { cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

// Chromium's per-run locks and regenerable caches stay behind: a copied lock
// would make the new profile look owned, and caches only cost copy time.
const SKIPPED_ENTRIES = new Set([
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'Crashpad',
  // Device credentials never travel: the old build stays a registered relay
  // device and E2EE endpoint, so COSMOS makes its own device id and identity
  // (and re-pairs phones) instead of two installs answering as one.
  'relay-device.json',
  'relay-device-revocations.json',
  'relay-e2ee.json',
  'remote-bridge.token',
  'remote-push.json',
]);

/** Where a copy in flight lives; only a finished copy is renamed to the real name. */
export const MIGRATION_SUFFIX = '.migrating';

export interface LegacyUserDataMigration {
  /** Legacy folder the profile was copied from, or null when nothing moved. */
  from: string | null;
  error?: string;
}

export function migrateLegacyUserData(
  appDataDir: string,
  targetName: string,
  legacyNames: readonly string[]
): LegacyUserDataMigration {
  const target = join(appDataDir, targetName);
  if (existsSync(target)) return { from: null };
  const staging = `${target}${MIGRATION_SUFFIX}`;
  for (const name of legacyNames) {
    const source = join(appDataDir, name);
    if (!existsSync(source)) continue;
    try {
      // A half-finished copy from a crashed launch is thrown away and redone:
      // the real folder only ever appears complete, via one rename.
      rmSync(staging, { recursive: true, force: true });
      cpSync(source, staging, {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter: (path) => !SKIPPED_ENTRIES.has(basename(path)),
      });
      renameSync(staging, target);
      return { from: source };
    } catch (error) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        /* the next launch clears it before copying */
      }
      return { from: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { from: null };
}
