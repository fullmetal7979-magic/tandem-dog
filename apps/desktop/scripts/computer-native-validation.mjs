import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { nativeBinaryRunsOn } from '../../../scripts/native-binary-arch.mjs';

const execute = promisify(execFile);
/** Refuse placeholders before packaging. Cross-built targets still receive a
 * header check; matching hosts also verify the real backend's version protocol. */
export async function validateComputerNative(binary, target, run = execute) {
  const bytes = await readFile(binary);
  if (!nativeBinaryRunsOn(bytes, target.arch)) throw new Error(`Computer Use binary has the wrong architecture for ${target.key}.`);
  if (process.platform === target.platform && process.arch === target.arch) {
    const { stdout } = await run(binary, ['--version'], { timeout: 5000, maxBuffer: 64 * 1024 });
    if (!/^mixdog-computer \d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(stdout))
      throw new Error('Computer Use backend version check failed; refusing to package a placeholder.');
  }
  return createHash('sha256').update(bytes).digest('hex');
}
