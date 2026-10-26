import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCliInvocation } from '../../headless-command.mjs';
import { COSMOS_VERBS, cosmosVerb, runCosmosCli } from './cosmos-cli.mjs';

test('Korean and English relay verbs map to the same action', () => {
  assert.equal(cosmosVerb('해'), 'sun');
  assert.equal(cosmosVerb('start'), 'sun');
  assert.equal(cosmosVerb('달'), 'moon');
  assert.equal(cosmosVerb('finish'), 'moon');
  assert.equal(cosmosVerb('교대'), 'request');
  assert.equal(cosmosVerb('은하수'), 'status');
  assert.equal(cosmosVerb('연결'), 'connect');
  assert.equal(cosmosVerb('별'), 'star');
  assert.equal(cosmosVerb('nonsense'), null);
});

// Added with the plain wording; src/headless-command.mjs (COSMOS_RELAY_WORDS)
// has to learn them before `mixdog 이어받기` reaches this CLI.
const NEW_ALIASES = ['이어받기', '내려놓기', '요청', '기기'];

test('plain-word aliases map to the same actions as the old verbs', () => {
  assert.equal(cosmosVerb('이어받기'), 'sun');
  assert.equal(cosmosVerb('sit'), 'sun');
  assert.equal(cosmosVerb('내려놓기'), 'moon');
  assert.equal(cosmosVerb('leave'), 'moon');
  assert.equal(cosmosVerb('요청'), 'request');
  assert.equal(cosmosVerb('기기'), 'star');
});

test('the help speaks in devices, projects and sessions', async () => {
  const out = [];
  const code = await runCosmosCli(['도움말'], { out: { write: (s) => out.push(s) }, err: { write: (s) => out.push(s) } });
  assert.equal(code, 0);
  const help = out.join('');
  for (const word of ['이어받기', '내려놓기', '넘겨 달라고 요청']) assert.match(help, new RegExp(word));
  assert.doesNotMatch(help, /별|행성|교대|교신|조종|앉기|내리기/);
});

test('the CLI classifier routes the new plain-word aliases', () => {
  for (const word of NEW_ALIASES) assert.equal(classifyCliInvocation([word]).kind, 'cosmos', word);
});

test('the CLI classifier routes every relay verb without touching the TUI', () => {
  for (const word of COSMOS_VERBS.filter((verb) => !verb.startsWith('-') && verb !== 'help' && !NEW_ALIASES.includes(verb))) {
    const invocation = classifyCliInvocation([word, '메모 --looks-like-an-option']);
    assert.equal(invocation.kind, 'cosmos', word);
    assert.equal(invocation.skipHostPrelude, true);
    assert.deepEqual(invocation.cosmos.args, [word, '메모 --looks-like-an-option']);
  }
  assert.notEqual(classifyCliInvocation(['--help']).kind, 'cosmos');
});
