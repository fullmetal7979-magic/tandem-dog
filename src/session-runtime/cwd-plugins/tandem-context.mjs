// cwd-plugins/tandem-context.mjs — the Tandem virtual-session block injected
// into new sessions when the cwd's git repo carries .tandem/SESSION.md.
//
// Session start must stay fast and offline: this reads the local checkout only
// (tandem-core `context(root, { pull: false })` runs plain git/file reads, no
// fetch or pull), is bounded by a short timeout, runs no project-provided
// command, and never throws. No SESSION.md means no block at all.
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { featureEnvOverride } from '../../runtime/agent/orchestrator/runtime-core/config-helpers.mjs';
import { settleWithin } from '../../runtime/shared/abort-race.mjs';
import { context as tandemSessionContext, SESSION_REL } from '../../runtime/tandem/tandem-core.mjs';
import { bootProfile } from '../boot-profile.mjs';

// Budget for the injected block in UTF-8 bytes (bytes track token cost more
// evenly across scripts than characters do).
export const TANDEM_CONTEXT_MAX_BYTES = 12 * 1024;
// Skip, rather than slowly read, a SESSION.md that is not a real session note.
const TANDEM_SESSION_MAX_FILE_BYTES = 1024 * 1024;
export const TANDEM_CONTEXT_TIMEOUT_MS = 1500;
const TRUNCATED_MARK = '\n- ...';
const LOG_HEADING = /^##\s+작업 로그\s*$/;
const logOmitted = (count) => `- ... (오래된 작업 로그 ${count}줄 생략)`;

/** Cut to a UTF-8 byte budget on a character boundary, with a marker. */
function cutToBytes(text, maxBytes) {
  const budget = maxBytes - Buffer.byteLength(TRUNCATED_MARK, 'utf8');
  // A byte cut can split a multi-byte character; drop its replacement chars.
  const head = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8').replace(/\uFFFD+$/, '');
  return `${head.replace(/\s+\S*$/, '')}${TRUNCATED_MARK}`;
}

/**
 * Fit the context into the byte budget. The work log is chronological, so the
 * oldest entries go first (goal, state, next steps and decisions stay whole);
 * only if that is not enough is the text cut at the end.
 */
export function fitTandemContext(text, maxBytes = TANDEM_CONTEXT_MAX_BYTES) {
  const bytes = (value) => Buffer.byteLength(value, 'utf8');
  let out = String(text ?? '').trim();
  if (bytes(out) <= maxBytes) return out;

  const lines = out.split('\n');
  const heading = lines.findIndex((line) => LOG_HEADING.test(line));
  if (heading >= 0) {
    // The log section ends at the next heading or the trailing status line.
    let end = heading + 1;
    while (end < lines.length && !/^##\s/.test(lines[end]) && !/^브랜치: /.test(lines[end])) end += 1;
    const entries = [];
    for (let i = heading + 1; i < end; i += 1) if (lines[i].startsWith('- ')) entries.push(i);
    // Drop the oldest entries until the text plus one marker line fits; the
    // newest entry always stays.
    const markerBytes = bytes(logOmitted(entries.length)) + 1;
    let size = bytes(out) + markerBytes;
    let drop = 0;
    while (drop < entries.length - 1 && size > maxBytes) {
      size -= bytes(lines[entries[drop]]) + 1;
      drop += 1;
    }
    if (drop > 0) {
      const dropped = new Set(entries.slice(0, drop));
      const kept = [];
      lines.forEach((line, i) => {
        if (i === entries[0]) kept.push(logOmitted(drop));
        if (!dropped.has(i)) kept.push(line);
      });
      out = kept.join('\n').trim();
    }
  }
  return bytes(out) <= maxBytes ? out : cutToBytes(out, maxBytes);
}

async function isFile(path, maxBytes = Infinity) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size <= maxBytes;
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nearest git checkout root at or above `cwd` that holds .tandem/SESSION.md,
 * or null. Walks the directory tree instead of spawning git: a `.git` entry
 * (directory, or file for worktrees and submodules) marks the checkout root.
 */
export async function findTandemRoot(cwd) {
  let dir = String(cwd ?? '').trim();
  if (!dir) return null;
  for (;;) {
    if (await exists(join(dir, '.git'))) {
      return (await isFile(join(dir, SESSION_REL), TANDEM_SESSION_MAX_FILE_BYTES)) ? dir : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The Tandem block for a new session in `cwd`, or '' when there is none
 * (opted out, not a repo, no SESSION.md, timeout, any error).
 */
export async function loadTandemContext(cwd, { timeoutMs = TANDEM_CONTEXT_TIMEOUT_MS, maxBytes = TANDEM_CONTEXT_MAX_BYTES } = {}) {
  // Explicit opt-out (MIXDOG_TANDEM_CONTEXT=0/false/no/off).
  if (featureEnvOverride('MIXDOG_TANDEM_CONTEXT') === false) {
    bootProfile('tandem-context:skipped');
    return '';
  }
  const startedAt = performance.now();
  try {
    const root = await findTandemRoot(cwd);
    if (!root) {
      bootProfile('tandem-context:none');
      return '';
    }
    const result = await settleWithin(tandemSessionContext(root, { pull: false }), timeoutMs);
    if (!result.settled) {
      bootProfile('tandem-context:timeout');
      return '';
    }
    return fitTandemContext(result.value, maxBytes);
  } catch {
    return '';
  } finally {
    bootProfile('tandem-context:done', { ms: (performance.now() - startedAt).toFixed(1) });
  }
}
