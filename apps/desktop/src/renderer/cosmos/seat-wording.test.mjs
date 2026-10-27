// One word for this device in every seat string (round-4 UX 6): "이 기기",
// and 이어받기 rather than 되찾기. A device's own name (and the device-kind
// label 'PC') may still say PC; a sentence about "this/that PC" may not.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const DIR = new URL('./', import.meta.url);
const BANNED = /(이|그|연결된|다른) PC|되찾/;

test('seat strings say 기기 and 이어받기, never 이 PC / 되찾기', () => {
  for (const name of readdirSync(DIR)) {
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) continue;
    const code = readFileSync(new URL(name, DIR), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const hit = code.split('\n').find((line) => BANNED.test(line));
    assert.equal(hit, undefined, `${name}: ${hit?.trim()}`);
  }
});
