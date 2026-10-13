// ▶ 실행: what a project can run, read from its own files. package.json
// scripts (with the package manager its lockfile names) and Makefile targets
// become big buttons; each one types its command into the project's own run
// terminal, so the output, Ctrl+C and the shell history stay where a developer
// expects them.

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

export function scriptCommand(pm: PackageManager, name: string): string {
  const safe = /^[\w:.@/-]+$/.test(name) ? name : `'${name.replace(/'/g, `'\\''`)}'`;
  if (pm === 'npm') return name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${safe}`;
  if (pm === 'yarn') return `yarn ${safe}`;
  if (pm === 'bun') return `bun run ${safe}`;
  return `pnpm ${safe}`;
}

export function packageScriptTasks(packageJson: string, pm: PackageManager): RunTask[] {
  let scripts: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: unknown };
    if (parsed && typeof parsed.scripts === 'object' && parsed.scripts) scripts = parsed.scripts as Record<string, unknown>;
  } catch {
    return [];
  }
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !HIDDEN_SCRIPT.test(entry[0]))
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
  const flag = file === 'Makefile' || file === 'makefile' || file === 'GNUmakefile' ? '' : ` -f ${file}`;
  return makeTargets(makefile).map((name) => ({
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

/** One run terminal per project; the PTY id must match term_[A-Za-z0-9_-]. */
export function runTerminalId(projectPath: string): string {
  let hash = 5381;
  for (let i = 0; i < projectPath.length; i += 1) hash = ((hash * 33) ^ projectPath.charCodeAt(i)) >>> 0;
  return `term_cosmos_run_${hash.toString(36)}`;
}
