import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function localDesktopScript(action, platform = process.platform) {
  if (!['deploy', 'plan'].includes(action)) throw new Error(`Unknown local desktop action: ${action}`);
  if (platform === 'darwin') return action === 'plan' ? 'update:dev:mac:plan' : 'update:dev:mac';
  if (platform === 'win32') return action === 'plan' ? 'update:dev:plan' : 'update:dev:fast';
  throw new Error(`Installed-app updates are not configured for ${platform}. Use npm run build:local to build the desktop.`);
}

export function runLocalDesktop(action, args = [], env = process.env) {
  const script = localDesktopScript(action);
  // npm supplies its own JS entry, avoiding Windows .cmd quoting and a
  // dependency on PowerShell when invoked from a Mac.
  const npm = env.npm_execpath;
  if (!npm) throw new Error('Run this command through npm run deploy:local or npm run deploy:local:plan.');
  const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
  return spawn(process.execPath, [npm, 'run', script, '--prefix', desktop, ...(args.length ? ['--', ...args] : [])], {
    stdio: 'inherit', env,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const child = runLocalDesktop(process.argv[2] || 'deploy', process.argv.slice(3));
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
