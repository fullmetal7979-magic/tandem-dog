// Many small git objects in ONE process: `git cat-file --batch` answers every
// `<rev>:<path>` line on stdin with `<oid> <type> <size>\n<bytes>\n` (or
// `<spec> missing`). The Galaxy polls stars and beats every few seconds, so
// one spawn instead of one per device matters on Windows, where a git spawn is
// slow. Only for UTF-8 text (the Galaxy's JSON): sizes are counted in bytes.
import { runGit } from '../shared/git-process.mjs';

/**
 * Map spec → text (null when missing or not a blob). Returns null when the
 * batch itself fails or its output cannot be parsed: callers then read one by
 * one, so a quirk of git never costs a result.
 */
export async function readBlobTexts(dir, specs) {
  const out = new Map();
  if (!specs.length) return out;
  if (specs.some((spec) => /[\r\n]/.test(spec))) return null;
  const r = await runGit(dir, ['cat-file', '--batch'], { input: specs.map((spec) => `${spec}\n`).join('') });
  if (r.code !== 0) return null;
  const bytes = Buffer.from(r.stdout, 'utf8');
  let at = 0;
  for (const spec of specs) {
    const end = bytes.indexOf(10, at);
    if (end < 0) return null;
    const header = bytes.subarray(at, end).toString('utf8');
    at = end + 1;
    if (/ (?:missing|ambiguous)$/.test(header)) {
      out.set(spec, null);
      continue;
    }
    const match = /^[0-9a-f]+ ([a-z]+) (\d+)$/.exec(header);
    if (!match) return null;
    const size = Number(match[2]);
    if (bytes[at + size] !== 10) return null;
    out.set(spec, match[1] === 'blob' ? bytes.subarray(at, at + size).toString('utf8') : null);
    at += size + 1;
  }
  return out;
}

export function parseJsonOr(text, fallback = null) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
