// Whole-file replacement that a reader never sees half-written: write a
// sibling temp file, then rename it over the target. The temp name is unique
// per call (pid + random), so two writers in one process — or two processes
// that happen to share a pid across a container boundary — never write into
// each other's temp file, and a failed write leaves no stray temp behind.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function atomicTempPath(path) {
  return `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
}

export async function writeFileAtomic(path, text, { mkdirs = true } = {}) {
  if (mkdirs) await mkdir(dirname(path), { recursive: true });
  const tmp = atomicTempPath(path);
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function writeJsonAtomic(path, value) {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
