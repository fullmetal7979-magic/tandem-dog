// JSON persistence with atomic writes (write temp file, then rename).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'world.json');

export function loadState(file = DEFAULT_DATA_FILE) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    return state?.version === 1 ? state : null;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[agentville] 저장 파일을 읽지 못했습니다: ${error.message}`);
    return null;
  }
}

// Infinity (sleeping/working "until") is not valid JSON; store it as null.
const replacer = (key, value) => (value === Infinity ? null : value);

export function saveState(state, file = DEFAULT_DATA_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, replacer));
  renameSync(temp, file);
}

export function reviveState(state) {
  for (const character of Object.values(state.characters ?? {})) {
    if (character.state.until === null) character.state.until = Infinity;
  }
  return state;
}
