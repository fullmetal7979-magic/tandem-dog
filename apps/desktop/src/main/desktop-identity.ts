import { APP_ID, APP_NAME } from '../shared/fork-identity';

/** Windows resolves notification branding through the shortcut's AUMID.
 * Sharing the installed ID with electron.exe lets a probe replace Tandem Dog's
 * sender name/icon in the shell cache, even with an isolated userData path. */
const IDENTITIES = {
  installed: { appId: APP_ID, name: APP_NAME },
  development: { appId: `${APP_ID}.dev`, name: `${APP_NAME} Dev` },
  probe: { appId: `${APP_ID}.notification-probe`, name: `${APP_NAME} Notification Test` },
} as const;

export function desktopIdentity(edition: keyof typeof IDENTITIES) {
  return IDENTITIES[edition];
}
