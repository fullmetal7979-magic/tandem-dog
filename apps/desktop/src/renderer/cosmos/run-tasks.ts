// ▶ 실행: what a project can run, read from its own files. package.json
// scripts (with the package manager its `packageManager` field or lockfile
// names), Makefile targets, justfile recipes, deno.json tasks and the everyday
// cargo / go commands of a Rust or Go project become big buttons; each run types its command into a fresh terminal of its
// own, so the output and Ctrl+C stay where a developer expects them and a
// command never lands in a shell that is still busy. Each task keeps its own
// terminal: starting one never stops another that is still running.

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface RunTask {
  id: string;
  kind: 'script' | 'make' | 'just' | 'deno' | 'cargo' | 'go';
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

/**
 * package.json's own word on its manager (Corepack's `"packageManager":
 * "pnpm@9.1.0"`), which wins over a lockfile left behind by another tool.
 */
export function packageManagerField(packageJson: string): PackageManager | null {
  try {
    const field = (JSON.parse(packageJson) as { packageManager?: unknown })?.packageManager;
    const name = typeof field === 'string' ? field.split('@')[0].trim().toLowerCase() : '';
    return name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : null;
  } catch {
    return null;
  }
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
  // "cargo build" / "go test" rank by their verb, like a script called build.
  const base = name.replace(/^(?:cargo|go)\s+/, '').split(/[:\s]/)[0].toLowerCase();
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

export function justfileName(rootFiles: Iterable<string>): string | null {
  const names = new Set(rootFiles);
  return ['justfile', 'Justfile', '.justfile'].find((name) => names.has(name)) ?? null;
}

/**
 * Recipes a button can run as they are: no `[private]` or `_hidden` ones, no
 * aliases or settings, and only recipes whose parameters all have defaults
 * (one that needs an argument would stop and wait for it).
 */
export function justRecipes(justfile: string): string[] {
  const recipes: string[] = [];
  let hidden = false;
  for (const line of justfile.split(/\r?\n/)) {
    if (/^\s*\[(?:[^\]]*\b)?private\b[^\]]*\]\s*$/.test(line)) {
      hidden = true;
      continue;
    }
    if (/^\s*\[.*\]\s*$/.test(line)) continue; // other attributes keep the flag for the recipe below
    const match = /^@?([A-Za-z][A-Za-z0-9_-]*)((?:\s+[^:]*?)?)\s*:(?![=:])/.exec(line);
    const wasHidden = hidden;
    if (line.trim() && !line.startsWith('#')) hidden = false;
    if (!match || /^(?:alias|set|export|import|mod)\b/.test(line)) continue;
    const params = match[2].trim().split(/\s+/).filter(Boolean);
    // `name param='x'`, `*args` and `+args` with a default are fine; a bare `param` is not.
    if (params.some((param) => !param.includes('=') && !param.startsWith('*'))) continue;
    if (wasHidden || match[1].startsWith('_') || recipes.includes(match[1])) continue;
    recipes.push(match[1]);
  }
  return recipes;
}

export function justTasks(justfile: string, file = 'justfile'): RunTask[] {
  if (!isRunnableName(file.replace(/^\./, ''))) return [];
  const flag = file === 'justfile' || file === 'Justfile' || file === '.justfile' ? '' : ` -f ${file}`;
  return justRecipes(justfile)
    .filter(isRunnableName)
    .map((name) => ({
      id: `just:${name}`,
      kind: 'just' as const,
      name,
      command: `just${flag} ${name}`,
      detail: `just ${name}`,
      icon: iconFor(name),
      primary: rank(name) < PRIMARY_ORDER.length,
    }));
}

/** deno.json / deno.jsonc, whose `tasks` run with `deno task`. Comments are allowed in the .jsonc one. */
export function denoConfigName(rootFiles: Iterable<string>): string | null {
  const names = new Set(rootFiles);
  return ['deno.json', 'deno.jsonc'].find((name) => names.has(name)) ?? null;
}

function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === '\\') out += text[++i] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else out += char;
  }
  // Trailing commas are allowed in JSONC too.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function denoTasks(denoJson: string): RunTask[] {
  let tasks: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(stripJsonComments(denoJson)) as { tasks?: unknown };
    if (parsed && typeof parsed.tasks === 'object' && parsed.tasks) tasks = parsed.tasks as Record<string, unknown>;
  } catch {
    return [];
  }
  return Object.entries(tasks)
    .filter(([name]) => isRunnableName(name))
    .map(([name, value]) => {
      // A task is a command string, or { command, description } in newer Deno.
      const body = typeof value === 'string' ? value : typeof (value as { command?: unknown })?.command === 'string' ? String((value as { command: string }).command) : '';
      return {
        id: `deno:${name}`,
        kind: 'deno' as const,
        name,
        command: `deno task ${name}`,
        detail: body.length > 80 ? `${body.slice(0, 79)}…` : body,
        icon: iconFor(name),
        primary: rank(name) < PRIMARY_ORDER.length,
      };
    });
}

/** The everyday commands of a Rust crate; `run` only for a package (a bare workspace has nothing to run). */
export function cargoTasks(cargoToml: string): RunTask[] {
  const isPackage = /^\s*\[package\]\s*$/m.test(cargoToml);
  const commands: Array<[string, string]> = [
    ...(isPackage ? ([['run', 'cargo run']] as Array<[string, string]>) : []),
    ['build', 'cargo build'],
    ['test', 'cargo test'],
    ['check', 'cargo check'],
    ['clippy', 'cargo clippy'],
  ];
  return commands.map(([name, command]) => ({
    id: `cargo:${name}`,
    kind: 'cargo' as const,
    name: `cargo ${name}`,
    command,
    detail: command,
    icon: name === 'run' ? '🚀' : iconFor(name),
    primary: ['run', 'build', 'test'].includes(name),
  }));
}

/** The everyday commands of a Go module. */
export function goTasks(): RunTask[] {
  return ([
    ['build', 'go build ./...'],
    ['test', 'go test ./...'],
    ['vet', 'go vet ./...'],
  ] as Array<[string, string]>).map(([name, command]) => ({
    id: `go:${name}`,
    kind: 'go' as const,
    name: `go ${name}`,
    command,
    detail: command,
    icon: iconFor(name),
    primary: name !== 'vet',
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

/** The short, PTY-safe tag of a task id carried in its run terminal ids. */
export function runTaskTag(taskId: string): string {
  return `t${sha256Hex(taskId).slice(0, 8)}`;
}

/**
 * A run terminal id for one run of one project. The project part is a stable
 * 64-bit slice of the path's SHA-256 (the old 32-bit hash made collisions
 * between two projects plausible); `nonce` makes every run its own PTY so a
 * command is never typed into a shell that is still busy. With a `taskId` the
 * id also carries that task's tag (`_t<8 hex>_<nonce>`), so a run found again
 * after a reload re-attaches to its task. The id must match
 * term_[A-Za-z0-9_-] and keeps the term_cosmos_run_ prefix.
 */
export function runTerminalId(projectPath: string, nonce = '', taskId = ''): string {
  const base = `term_cosmos_run_${sha256Hex(projectPath).slice(0, 16)}`;
  const suffix = nonce.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (taskId) return `${base}_${runTaskTag(taskId)}_${suffix || '0'}`;
  return suffix ? `${base}_${suffix}` : base;
}

/** The task tag a run terminal id carries, or '' for an untagged (older) run. */
export function runTerminalTaskTag(projectPath: string, terminalId: string): string {
  const base = runTerminalId(projectPath);
  if (!terminalId.startsWith(`${base}_`)) return '';
  return /^(t[0-9a-f]{8})_/.exec(terminalId.slice(base.length + 1))?.[1] ?? '';
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

/** Forget one run (its tab was closed). Returns whether it was tracked. */
export function forgetRun(projectPath: string, terminalId: string): boolean {
  const runs = taskRuns.get(projectPath);
  if (!runs) return false;
  for (const [taskId, id] of runs) {
    if (id !== terminalId) continue;
    runs.delete(taskId);
    if (!runs.size) taskRuns.delete(projectPath);
    return true;
  }
  return false;
}

const ADOPTED = 'adopted:';

/** A run found live in the service after a reload whose task is not (yet) known, only its terminal. */
export function isAdoptedRun(taskId: string): boolean {
  return taskId.startsWith(ADOPTED);
}

/**
 * One live run terminal as the service reports it. Older services send bare
 * ids; newer ones add whether the shell is busy (a command in the
 * foreground) and whether it exited. `running` is null when neither is known.
 */
export interface LiveRun {
  id: string;
  running: boolean | null;
}

export function normalizeLiveRuns(entries: unknown): LiveRun[] {
  if (!Array.isArray(entries)) return [];
  const out: LiveRun[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push({ id: entry, running: null });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; busy?: unknown; exited?: unknown };
    if (typeof row.id !== 'string') continue;
    const exited = typeof row.exited === 'boolean' ? row.exited : null;
    const busy = typeof row.busy === 'boolean' ? row.busy : null;
    const running = exited === true ? false : busy !== null ? busy : exited === false ? true : null;
    out.push({ id: row.id, running });
  }
  return out;
}

/** Rebuild a run map with one key renamed in place, so tab order holds. */
function rekey(runs: Map<string, string>, from: string, to: string): Map<string, string> {
  return new Map([...runs].map(([key, id]) => [key === from ? to : key, id]));
}

/**
 * Re-adopt run terminals the desktop service still has for this project (the
 * renderer forgot them on reload, the PTYs and their dev servers did not
 * stop). Only this project's `term_cosmos_run_*` ids are taken; ones already
 * tracked are left alone. A terminal whose id carries the tag of one of
 * `taskIds` (and that task has no run yet) is re-attached to that task, so ▶
 * on it restarts the run instead of starting a second one. Entries are bare
 * ids or `{ id, busy?, exited? }`. Returns the ids newly adopted.
 */
export function adoptRuns(projectPath: string, terminalIds: readonly unknown[], taskIds: readonly string[] = []): string[] {
  const base = runTerminalId(projectPath);
  const runs = taskRuns.get(projectPath) ?? new Map<string, string>();
  const known = new Set(runs.values());
  const adopted: string[] = [];
  for (const { id } of normalizeLiveRuns(terminalIds)) {
    if (known.has(id) || !(id === base || id.startsWith(`${base}_`))) continue;
    runs.set(`${ADOPTED}${id}`, id);
    known.add(id);
    adopted.push(id);
  }
  if (adopted.length) taskRuns.set(projectPath, runs);
  if (taskIds.length) reattachRuns(projectPath, taskIds);
  return adopted;
}

/**
 * Give adopted runs back their task once the task list is known: an adopted
 * terminal tagged with a task that has no run of its own becomes that task's
 * run. Returns the task ids re-attached.
 */
export function reattachRuns(projectPath: string, taskIds: readonly string[]): string[] {
  let runs = taskRuns.get(projectPath);
  if (!runs) return [];
  const attached: string[] = [];
  for (const taskId of taskIds) {
    if (runs.has(taskId)) continue;
    const tag = runTaskTag(taskId);
    const found = [...runs].find(([key, id]) => isAdoptedRun(key) && runTerminalTaskTag(projectPath, id) === tag);
    if (!found) continue;
    runs = rekey(runs, found[0], taskId);
    attached.push(taskId);
  }
  if (attached.length) taskRuns.set(projectPath, runs);
  return attached;
}

/**
 * Start a task in a brand-new PTY of its own, and type the command only once
 * that fresh shell exists, so it never goes into a process that is already
 * running in the foreground.
 *
 * Each task keeps its own PTY: running `test` leaves a `dev` server that is
 * still up alone. Re-running the same task restarts it, releasing that task's
 * previous PTY first, including one adopted after a reload whose id carries
 * this task's tag. `previousId` is kept for older callers: it is released
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
  if (task.id) reattachRuns(projectPath, [task.id]);
  const runs = taskRuns.get(projectPath) ?? new Map<string, string>();
  const ownPrevious = task.id ? (runs.get(task.id) ?? null) : previousId;
  if (ownPrevious) await api.release(ownPrevious).catch(() => undefined);
  if (task.id) {
    // Earlier runs of this task adopted after a reload are its runs too.
    const tag = runTaskTag(task.id);
    for (const [key, id] of [...runs]) {
      if (!isAdoptedRun(key) || runTerminalTaskTag(projectPath, id) !== tag) continue;
      await api.release(id).catch(() => undefined);
      runs.delete(key);
    }
    runs.delete(task.id);
  }
  const wanted = runTerminalId(projectPath, nonce, task.id ?? '');
  const opened = await api.termEnsure(wanted, projectPath, null);
  if (task.id) {
    runs.set(task.id, opened.id);
    taskRuns.set(projectPath, runs);
  }
  api.termWrite(opened.id, `${task.command}\r`);
  return { terminalId: opened.id, restarted: ownPrevious };
}

/** TerminalPane keeps each terminal's view (size, scroll) under this key. */
export const TERMINAL_VIEW_STATE_KEY = 'mixdog.desktop-terminal-view.v1';

/** Drop a closed run terminal's saved view so the record does not grow forever. */
export function clearRunTerminalViewState(terminalId: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = globalThis.localStorage ?? null): void {
  try {
    if (!storage) return;
    const stored = JSON.parse(storage.getItem(TERMINAL_VIEW_STATE_KEY) || '{}') as Record<string, unknown>;
    if (!stored || typeof stored !== 'object' || !(terminalId in stored)) return;
    delete stored[terminalId];
    storage.setItem(TERMINAL_VIEW_STATE_KEY, JSON.stringify(stored));
  } catch {
    // Unavailable or corrupt storage: the saved view is a convenience only.
  }
}
