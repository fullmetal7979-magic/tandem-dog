// The version that is actually executing: the renderer bundle's own
// package.json version (stamped at build time) plus the Electron runtime the
// window reports. Settings → System shows the runtime's reported version;
// this is what the open window is RUNNING.

export interface RunningVersion {
  app: string;
  electron: string;
  chrome: string;
}

function userAgentToken(userAgent: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}/([0-9][0-9A-Za-z.+-]*)`).exec(userAgent);
  return match ? match[1] : '';
}

export function runningVersion(appVersion: string, userAgent: string): RunningVersion {
  return {
    app: String(appVersion || '').trim(),
    electron: userAgentToken(userAgent || '', 'Electron'),
    chrome: userAgentToken(userAgent || '', 'Chrome'),
  };
}

/** One-line form for the About row and for bug reports ("v1.0.12 · Electron 39.2.0"). */
export function runningVersionLabel(version: RunningVersion): string {
  const parts = [version.app ? `v${version.app.replace(/^v/, '')}` : ''];
  if (version.electron) parts.push(`Electron ${version.electron}`);
  return parts.filter(Boolean).join(' · ');
}
