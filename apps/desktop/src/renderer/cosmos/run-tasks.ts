// ▶ 실행: what a project can run, read from its own files. package.json
// scripts (with the package manager its lockfile names) and Makefile targets
// become big buttons; each run types its command into a fresh terminal of its
// own, so the output and Ctrl+C stay where a developer expects them and a
// command never lands in a shell that is still busy. Each task keeps its own
// terminal: starting one never stops another that is still running.

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface RunTask {
  id: string;
  kind: 'script' | 'make';
  name: string;
  /** What the button types into the terminal. */
  command: string;
  /** The script body / recipe hint shown under the name. */
  detail: string;
  icon: string;
  /** Everyday tasks (dev, start, build, test) lead the grid. */
  primary: boolean;
}

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

export function packageManagerFor(rootFiles: Iterable<string>): PackageManager {
  const names = new Set(rootFiles);
  return LOCKFILES.find(([file]) => names.has(file))?.[1] ?? 'npm';
}

export function makefileName(rootFiles: Iterable<string>): string | null {
  const names = new Set(rootFiles);
  return ['Makefile', 'makefile', 'GNUmakefile'].find((name) => names.has(name)) ?? null;
}

const PRIMARY_ORDER = ['dev', 'start', 'serve', 'build', 'test', 'lint', 'typecheck', 'format'];

function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (/^(dev|start|serve|watch|preview)\b/.test(n)) return '🚀';
  if (/build|compile|bundle|dist/.test(n)) return '🧱';
  if (/test|spec|e2e|check/.test(n)) return '🧪';
  if (/lint|typecheck|tsc|vet/.test(n)) return '🧹';
  if (/format|prettier|fmt/.test(n)) return '✨';
  if (/deploy|release|publish|ship/.test(n)) return '🛰️';
  if (/clean|reset|purge/.test(n)) return '🧽';
  if (/install|setup|bootstrap|init/.test(n)) return '📦';
  if (/db|migrate|seed/.test(n)) return '🗄️';
  if (/doc/.test(n)) return '📘';
  return '⚙️';
}

function rank(name: string): number {
  const base = name.split(/[:\s]/)[0].toLowerCase();
  const index = PRIMARY_ORDER.indexOf(base);
  return index < 0 ? PRIMARY_ORDER.length : index;
}

/** Lifecycle hooks run by npm itself; a button for them only confuses. */
const HIDDEN_SCRIPT = /^(pre|post)[a-z]|^(prepare|prepublishOnly|install|postinstall|preinstall)$/;

/**
 * Names that are safe to type into any shell (POSIX sh, cmd, PowerShell)
 * without quoting: word characters plus `: . @ / -`, no leading `-` (it would
 * read as an option) and no leading `@` (PowerShell splats it). Anything else
 * in package.json is skipped, never quoted: quoting differs per shell.
 */
const SAFE_NAME = /^[\w:.@/-]+$/;
export function isRunnableName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.startsWith('-') && !name.startsWith('@');
}

export function scriptCommand(pm: PackageManager, name: string): string {
  if (!isRunnableName(name)) throw new TypeError(`Unsafe script name: ${name}`);
  if (pm === 'npm') return name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`;
  if (pm === 'yarn') return `yarn ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return `pnpm ${name}`;
}

function packageScripts(packageJson: string): Array<[string, string]> {
  let scripts: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: unknown };
    if (parsed && typeof parsed.scripts === 'object' && parsed.scripts) scripts = parsed.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  return Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !HIDDEN_SCRIPT.test(entry[0]));
}

/** Scripts the list leaves out because their name is not safe to type; the pane says so. */
export function skippedScriptNames(packageJson: string): string[] {
  return packageScripts(packageJson)
    .map(([name]) => name)
    .filter((name) => !isRunnableName(name));
}

export function packageScriptTasks(packageJson: string, pm: PackageManager): RunTask[] {
  return packageScripts(packageJson)
    .filter(([name]) => isRunnableName(name))
    .map(([name, body]) => ({
      id: `script:${name}`,
      kind: 'script' as const,
      name,
      command: scriptCommand(pm, name),
      detail: body.length > 80 ? `${body.slice(0, 79)}…` : body,
      icon: iconFor(name),
      primary: rank(name) < PRIMARY_ORDER.length,
    }));
}

/** Explicit targets only: no pattern rules, no variables, no special targets. */
export function makeTargets(makefile: string): string[] {
  const targets: string[] = [];
  for (const line of makefile.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?!=)/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (name.includes('%') || name.startsWith('.') || targets.includes(name)) continue;
    targets.push(name);
  }
  return targets;
}

export function makeTasks(makefile: string, file = 'Makefile'): RunTask[] {
  if (!isRunnableName(file)) return [];
  const flag = file === 'Makefile' || file === 'makefile' || file === 'GNUmakefile' ? '' : ` -f ${file}`;
  return makeTargets(makefile)
    .filter(isRunnableName)
    .map((name) => ({
      id: `make:${name}`,
      kind: 'make' as const,
      name,
      command: `make${flag} ${name}`,
      detail: `make ${name}`,
      icon: iconFor(name),
      primary: rank(name) < PRIMARY_ORDER.length,
    }));
}

/** Everyday tasks first in a fixed order, the rest alphabetically. */
export function orderTasks(tasks: RunTask[]): RunTask[] {
  return [...tasks].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}

/** SHA-256 of a string as hex: the renderer has no sync crypto, and ids must be stable. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n += 1) if (primes.every((p) => n % p !== 0)) primes.push(n);
  const K = Uint32Array.from(primes, (n) => (Math.cbrt(n) % 1) * 2 ** 32);
  const H = Uint32Array.from(primes.slice(0, 8), (n) => (Math.sqrt(n) % 1) * 2 ** 32);
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, Math.floor((bytes.length * 8) / 2 ** 32));
  view.setUint32(total - 4, (bytes.length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  return Array.from(H, (word) => word.toString(16).padStart(8, '0')).join('');
}

/**
 * A run terminal id for one run of one project. The project part is a stable
 * 64-bit slice of the path's SHA-256 (the old 32-bit hash made collisions
 * between two projects plausible); `nonce` makes every run its own PTY so a
 * command is never typed into a shell that is still busy. The id must match
 * term_[A-Za-z0-9_-] and keeps the term_cosmos_run_ prefix.
 */
export function runTerminalId(projectPath: string, nonce = ''): string {
  const base = `term_cosmos_run_${sha256Hex(projectPath).slice(0, 16)}`;
  const suffix = nonce.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  return suffix ? `${base}_${suffix}` : base;
}

export interface RunTerminalApi {
  termEnsure(id: string | null, cwd?: string | null, shell?: string | null): Promise<{ id: string; replay: string }>;
  termWrite(id: string, data: string): void;
  /** Releases a finished run's PTY (and its on-screen view). */
  release(id: string): Promise<void>;
}

/** The PTY of each task's latest run, per project: `test` must not take `dev` down with it. */
const taskRuns = new Map<string, Map<string, string>>();

/** The latest run terminal of every task of a project, oldest first. */
export function projectRuns(projectPath: string): Array<{ taskId: string; terminalId: string }> {
  return [...(taskRuns.get(projectPath) ?? new Map<string, string>())].map(([taskId, terminalId]) => ({ taskId, terminalId }));
}

/**
 * Start a task in a brand-new PTY of its own, and type the command only once
 * that fresh shell exists, so it never goes into a process that is already
 * running in the foreground.
 *
 * Each task keeps its own PTY: running `test` leaves a `dev` server that is
 * still up alone. Re-running the same task restarts it, releasing that task's
 * previous PTY first. `previousId` is kept for older callers: it is released
 * only when it is this same task's earlier run, or when the task carries no
 * id (the old one-terminal-per-project behaviour); another task's terminal is
 * never killed on its behalf.
 */
export async function startRun(
  api: RunTerminalApi,
  projectPath: string,
  task: Pick<RunTask, 'command'> & Partial<Pick<RunTask, 'id'>>,
  previousId: string | null,
  nonce: string
): Promise<{ terminalId: string; restarted: string | null }> {
  const runs = taskRuns.get(projectPath) ?? new Map<string, string>();
  const ownPrevious = task.id ? (runs.get(task.id) ?? null) : previousId;
  if (ownPrevious) await api.release(ownPrevious).catch(() => undefined);
  if (task.id) runs.delete(task.id);
  const wanted = runTerminalId(projectPath, nonce);
  const opened = await api.termEnsure(wanted, projectPath, null);
  if (task.id) {
    runs.set(task.id, opened.id);
    taskRuns.set(projectPath, runs);
  }
  api.termWrite(opened.id, `${task.command}\r`);
  return { terminalId: opened.id, restarted: ownPrevious };
}
