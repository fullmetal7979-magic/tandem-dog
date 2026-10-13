// COSMOS (코스모스) product identity: the single source of truth for every name
// that must differ from upstream Mixdog so both apps install and run side by side.
//
// Consumers
//  - App code (main, renderer, tests) imports these constants directly.
//  - electron-builder.yml cannot import TypeScript, so it carries the same
//    literals; packaging.test.mjs fails if the two ever drift apart.
//  - scripts/verify-update-metadata.mjs is plain Node and takes the expected
//    publish target from the environment (GITHUB_REPOSITORY in CI).
//
// Keep this file free of runtime imports: it is bundled into Electron main,
// the renderer and the plain-Node daemon, and loaded straight by tsx tests.

export const APP_NAME = 'COSMOS';
export const APP_ID = 'app.cosmos.desktop';
export const PROTOCOL_SCHEME = 'cosmos';
/** Packaged userData folder. Electron derives it from package.json "name",
 *  which electron-builder sets through extraMetadata.name, so the two must be
 *  equal; the artifact file-name prefix reuses it too. */
export const USER_DATA_DIR_NAME = 'cosmos-desktop';
/** userData folders of the builds COSMOS replaces, newest first. The first
 *  launch copies the newest one that exists so window layout, sign-ins kept by
 *  the desktop host and remote pairings survive the rename. */
export const LEGACY_USER_DATA_DIR_NAMES: readonly string[] = ['tandem-dog-desktop'];

// GitHub repository that hosts this fork's releases, issues and star button.
//
// The owner is not known at source level (it is whoever forks the repo), so it
// is a BUILD-TIME define: CI exports VITE_COSMOS_REPO_OWNER / VITE_COSMOS_REPO_NAME
// (from github.repository_owner / the repository name) before `npm run build`.
// electron-vite exposes every VITE_* variable as import.meta.env.VITE_* to the
// main, preload and renderer bundles. Without the variables (local builds,
// tsx tests, the plain-Node daemon where import.meta.env does not exist) the
// placeholders below apply: links then point at a repository that does not
// exist yet, which is intentional and visible instead of silently pointing at
// upstream.
const PLACEHOLDER_OWNER = 'OWNER';
const PLACEHOLDER_REPO = 'cosmos';

type BuildEnv = Record<string, string | undefined>;
const buildEnv: BuildEnv = (import.meta as unknown as { env?: BuildEnv }).env ?? {};

/** A define is used verbatim in URLs and `gh api` paths, so anything that is
 *  not a plausible GitHub owner/repository name falls back to the placeholder. */
function definedName(value: string | undefined, pattern: RegExp, fallback: string): string {
  const candidate = (value ?? '').trim();
  return pattern.test(candidate) ? candidate : fallback;
}

export const REPO_OWNER = definedName(
  buildEnv.VITE_COSMOS_REPO_OWNER,
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  PLACEHOLDER_OWNER
);
export const REPO_NAME = definedName(
  buildEnv.VITE_COSMOS_REPO_NAME,
  /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/,
  PLACEHOLDER_REPO
);
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const ISSUES_URL = `${REPO_URL}/issues`;
