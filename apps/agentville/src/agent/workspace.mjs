// A character's work folder: the text editor and bash tools, confined to one
// root. On macOS every command runs under sandbox-exec, which lets it write
// only inside the root (and the temp folder) and hides key stores and browser
// profiles; on Linux bubblewrap does the same when installed. Without either
// sandbox the policy asks before every command that is not read-only.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class ToolError extends Error {}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.agentville-backup', '.agentville-tmp', '__pycache__', '.venv', 'venv']);
const MAX_OUTPUT = 30_000;
const MAX_VIEW = 60_000;
const MAX_FILE = 2 * 1024 * 1024;

let cachedSandbox;
export function detectSandbox() {
  if (cachedSandbox !== undefined) return cachedSandbox;
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) cachedSandbox = 'sandbox-exec';
  else if (process.platform === 'linux' && spawnSync('bwrap', ['--version']).status === 0) cachedSandbox = 'bwrap';
  else cachedSandbox = null;
  return cachedSandbox;
}

// Secrets that commands must not read even though reads are otherwise open.
const HIDDEN = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.netrc', '.npmrc', '.pypirc', '.config/gcloud', '.config/gh', 'Library/Keychains', 'Library/Cookies',
  'Library/Application Support/Google/Chrome', 'Library/Application Support/Firefox', 'Library/Safari', 'Library/Messages', 'Library/Mail'];

const quote = (path) => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function sandboxProfile(root, tmp) {
  const home = homedir();
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${quote(root)}) (subpath ${quote(tmp)}) (subpath "/private/var/folders") (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))`,
    `(deny file-read* ${HIDDEN.map((part) => `(subpath ${quote(join(home, part))})`).join(' ')})`,
  ].join('\n');
}

function cleanEnv(root, tmp) {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: root,
    TMPDIR: tmp,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'dumb',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
  };
}

function clip(text, max = MAX_OUTPUT) {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n… (${text.length - max}자 생략) …\n${text.slice(-half)}`;
}

const looksBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

export class Workspace {
  // own: the character's own folder (true) or a folder the user lent (false).
  constructor(root, { own = true, sandbox = detectSandbox(), timeoutMs = 60_000 } = {}) {
    mkdirSync(root, { recursive: true });
    this.root = realpathSync(root);
    this.own = own;
    this.sandbox = sandbox;
    this.timeoutMs = timeoutMs;
    this.tmp = join(this.root, '.agentville-tmp');
  }

  get sandboxed() {
    return Boolean(this.sandbox);
  }

  // Model-supplied paths are untrusted: resolve, follow symlinks, and insist
  // the result stays inside the root.
  resolve(path, { mustExist = false } = {}) {
    const raw = String(path ?? '').trim();
    if (!raw) throw new ToolError('경로가 비어 있습니다.');
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
    const target = isAbsolute(decoded) ? resolve(decoded) : resolve(this.root, decoded);
    const inside = (candidate) => candidate === this.root || candidate.startsWith(this.root + sep);
    if (!inside(target)) throw new ToolError(`작업 폴더(${this.root}) 밖의 경로는 쓸 수 없습니다: ${raw}`);
    // Walk up to the deepest existing ancestor and check its real location.
    let probe = target;
    while (!existsSync(probe) && probe !== this.root) probe = dirname(probe);
    const real = realpathSync(probe);
    if (!inside(real)) throw new ToolError(`심볼릭 링크가 작업 폴더 밖을 가리킵니다: ${raw}`);
    if (mustExist && !existsSync(target)) throw new ToolError(`파일이나 폴더가 없습니다: ${raw}`);
    return target;
  }

  relative(path) {
    return relative(this.root, path) || '.';
  }

  // ---- text editor (str_replace_based_edit_tool) ---------------------------------

  async edit(input = {}) {
    const command = input.command;
    switch (command) {
      case 'view': return this.view(input);
      case 'create': return this.create(input);
      case 'str_replace': return this.replace(input);
      case 'insert': return this.insert(input);
      default: throw new ToolError(`지원하지 않는 명령입니다: ${command}`);
    }
  }

  view({ path, view_range: range, max_characters: maxChars }) {
    const target = this.resolve(path, { mustExist: true });
    const stats = statSync(target);
    if (stats.isDirectory()) return { text: this.listing(target) };
    if (stats.size > MAX_FILE) throw new ToolError(`파일이 너무 큽니다 (${stats.size} bytes). bash로 일부만 보세요.`);
    const buffer = readFileSync(target);
    if (looksBinary(buffer)) return { text: `(이진 파일, ${buffer.length} bytes)` };
    const lines = buffer.toString('utf8').split('\n');
    let start = 1;
    let end = lines.length;
    if (Array.isArray(range) && range.length === 2) {
      start = Math.max(1, Number(range[0]) || 1);
      end = Number(range[1]) === -1 ? lines.length : Math.min(lines.length, Number(range[1]) || lines.length);
      if (start > end) throw new ToolError(`view_range가 잘못되었습니다: ${range}`);
    }
    const body = lines.slice(start - 1, end).map((line, index) => `${start + index}\t${line}`).join('\n');
    return { text: clip(body, Math.min(MAX_VIEW, Number(maxChars) || MAX_VIEW)) };
  }

  listing(dir, depth = 2) {
    const out = [];
    const walk = (current, level) => {
      if (out.length > 400) return;
      let entries = [];
      try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.agentville')) continue;
        const full = join(current, entry.name);
        const rel = this.relative(full);
        if (entry.isDirectory()) {
          out.push(`${rel}/`);
          if (level < depth && !SKIP_DIRS.has(entry.name)) walk(full, level + 1);
        } else {
          let size = 0;
          try { size = statSync(full).size; } catch { /* vanished */ }
          out.push(`${rel} (${size} bytes)`);
        }
      }
    };
    walk(dir, 1);
    return out.length ? out.join('\n') : '(빈 폴더)';
  }

  backup(target) {
    if (!existsSync(target)) return;
    const dest = join(this.root, '.agentville-backup', `${this.relative(target)}.${Date.now()}`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(target, dest);
  }

  create({ path, file_text: text }) {
    const target = this.resolve(path);
    if (existsSync(target) && statSync(target).isDirectory()) throw new ToolError('폴더 경로에는 파일을 만들 수 없습니다.');
    mkdirSync(dirname(target), { recursive: true });
    this.backup(target);
    writeFileSync(target, String(text ?? ''));
    return { text: `파일을 저장했습니다: ${this.relative(target)}`, changed: this.relative(target) };
  }

  readText(target) {
    const buffer = readFileSync(target);
    if (looksBinary(buffer)) throw new ToolError('이진 파일은 편집할 수 없습니다.');
    return buffer.toString('utf8');
  }

  replace({ path, old_str: oldStr, new_str: newStr = '' }) {
    const target = this.resolve(path, { mustExist: true });
    const text = this.readText(target);
    const needle = String(oldStr ?? '');
    if (!needle) throw new ToolError('old_str가 비어 있습니다.');
    const count = text.split(needle).length - 1;
    if (count === 0) throw new ToolError('바꿀 문자열을 찾지 못했습니다. 공백과 줄바꿈까지 정확히 맞춰 주세요.');
    if (count > 1) throw new ToolError(`바꿀 문자열이 ${count}곳에 있습니다. 앞뒤 문맥을 더 넣어 한 곳만 맞게 해 주세요.`);
    this.backup(target);
    writeFileSync(target, text.replace(needle, () => String(newStr)));
    return { text: `수정했습니다: ${this.relative(target)}`, changed: this.relative(target) };
  }

  insert({ path, insert_line: line, insert_text: insertText = '' }) {
    const target = this.resolve(path, { mustExist: true });
    const lines = this.readText(target).split('\n');
    const at = Number(line);
    if (!Number.isInteger(at) || at < 0 || at > lines.length) throw new ToolError(`insert_line은 0~${lines.length} 사이여야 합니다.`);
    this.backup(target);
    lines.splice(at, 0, ...String(insertText).split('\n'));
    writeFileSync(target, lines.join('\n'));
    return { text: `${at}번째 줄 뒤에 넣었습니다: ${this.relative(target)}`, changed: this.relative(target) };
  }

  // ---- bash -------------------------------------------------------------------------

  spawnArgs(command) {
    if (this.sandbox === 'sandbox-exec') return ['/usr/bin/sandbox-exec', ['-p', sandboxProfile(this.root, this.tmp), '/bin/bash', '-c', command]];
    if (this.sandbox === 'bwrap') {
      return ['bwrap', ['--ro-bind', '/', '/', '--bind', this.root, this.root, '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
        ...HIDDEN.flatMap((part) => (existsSync(join(homedir(), part)) ? ['--tmpfs', join(homedir(), part)] : [])), '--die-with-parent', '--', '/bin/bash', '-c', command]];
    }
    return ['/bin/bash', ['-c', command]];
  }

  async bash(input = {}, { signal } = {}) {
    if (input.restart) return { text: '셸을 다시 시작했습니다. (명령마다 새 셸에서 실행됩니다)' };
    const command = String(input.command ?? '').trim();
    if (!command) throw new ToolError('명령이 비어 있습니다.');
    mkdirSync(this.tmp, { recursive: true });
    const [file, args] = this.spawnArgs(command);
    return new Promise((resolvePromise) => {
      const child = spawn(file, args, { cwd: this.root, env: cleanEnv(this.root, this.tmp), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let timedOut = false;
      const append = (chunk) => {
        if (output.length < MAX_OUTPUT * 2) output += chunk.toString('utf8');
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      const kill = () => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      };
      const timer = setTimeout(() => { timedOut = true; kill(); }, this.timeoutMs);
      const onAbort = () => kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolvePromise({ text: `실행 실패: ${error.message}`, error: true });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const body = clip(output.trimEnd()) || '(출력 없음)';
        if (timedOut) return resolvePromise({ text: `${body}\n(시간 초과: ${Math.round(this.timeoutMs / 1000)}초가 지나 중단했습니다)`, error: true, code });
        resolvePromise({ text: code ? `${body}\n(종료 코드 ${code})` : body, error: code !== 0, code });
      });
    });
  }

  // ---- results ---------------------------------------------------------------------

  // Files with their modification times, to diff before and after a task.
  snapshot(limit = 3000) {
    const seen = new Map();
    const walk = (dir, depth) => {
      if (seen.size >= limit || depth > 6) return;
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.agentville') || SKIP_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile()) {
          try { seen.set(this.relative(full), statSync(full).mtimeMs); } catch { /* vanished */ }
        }
      }
    };
    walk(this.root, 0);
    return seen;
  }

  changesSince(before, limit = 20) {
    const after = this.snapshot();
    const changed = [];
    for (const [path, mtime] of after) {
      if (before.get(path) !== mtime) changed.push(path);
    }
    return changed.sort().slice(0, limit).map((path) => {
      let size = 0;
      try { size = lstatSync(join(this.root, path)).size; } catch { /* vanished */ }
      return { path, size, created: !before.has(path) };
    });
  }
}
