// Shared, bounded Git process runner used by COSMOS and legacy CLI tools.
import { execFile } from 'node:child_process';
const MAX_OUTPUT = 8 * 1024 * 1024;

let baseEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' });

/**
 * Let a host supply the environment git children run with (the desktop app
 * passes its scrubbed child environment). Returns the previous provider.
 */
export function configureGitEnvironment(provider) {
  const prev = baseEnv;
  baseEnv = () => ({ ...provider(), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' });
  return prev;
}

const NETWORK_GIT = new Set(['fetch', 'push', 'pull', 'clone', 'ls-remote']);
// Only network commands get a default time limit: a stuck remote or credential
// helper must not hang COSMOS. Local commands (status, add, commit, reset, gc,
// checkout…) can legitimately run long on a big repository, and killing one
// half-way leaves index.lock and a half-written tree behind, so they run
// without a limit unless the caller asks for one.
const NETWORK_TIMEOUT_MS = 60_000;

/** The git subcommand of an argv (skips leading -c k=v / -C dir / --flag options). */
function gitSubcommand(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (a === '-c' || a === '-C' || a === '--git-dir' || a === '--work-tree') {
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    return a;
  }
  return '';
}

export function isNetworkGit(args) {
  return NETWORK_GIT.has(gitSubcommand(args));
}

/** Default time limit: 60s for network commands, none (0) for everything local. */
export function defaultGitTimeoutMs(args) {
  return isNetworkGit(args) ? NETWORK_TIMEOUT_MS : 0;
}

/**
 * How a timed-out command is stopped. A network command is only waiting on
 * the remote, so it is killed outright. A local command that the caller gave
 * a limit gets SIGTERM, which git handles by removing its lock files; it is
 * never SIGKILLed in the middle of writing the index or the tree.
 */
export function gitTimeoutSignal(args) {
  return isNetworkGit(args) ? 'SIGKILL' : 'SIGTERM';
}

/**
 * Run git and resolve {code, stdout, stderr}; never rejects on a non-zero exit.
 * A command that outlives `timeoutMs` (default 60s for network commands, no
 * limit for local ones; 0 disables) is stopped (see gitTimeoutSignal) and
 * resolves a non-zero result.
 */
export function runGit(cwd, args, { input, env, timeoutMs } = {}) {
  const limit = timeoutMs === undefined ? defaultGitTimeoutMs(args) : Number(timeoutMs) || 0;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const child = execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { ...baseEnv(), ...env } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        finish({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
    if (limit > 0) {
      // Own timer instead of execFile's: a grandchild (ssh, a credential
      // helper) can hold the pipes open long after git itself is killed.
      timer = setTimeout(() => {
        child.kill(gitTimeoutSignal(args));
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ code: 1, stdout: '', stderr: `git ${gitSubcommand(args)} timed out after ${Math.round(limit / 1000)}s\n`, timedOut: true });
      }, limit);
    }
    if (input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    }
  });
}

export const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
export async function repoRoot(cwd) {
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    const error = new Error(`git rev-parse failed: ${result.stderr.trim() || result.stdout.trim()}`);
    error.code = 'git_failed'; error.result = result; throw error;
  }
  return result.stdout.trim();
}
