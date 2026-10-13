import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCliInvocation } from '../../headless-command.mjs';
import { COSMOS_VERBS, cosmosVerb } from './cosmos-cli.mjs';

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

test('the CLI classifier routes every relay verb without touching the TUI', () => {
  for (const word of COSMOS_VERBS.filter((verb) => !verb.startsWith('-') && verb !== 'help')) {
    const invocation = classifyCliInvocation([word, '메모 --looks-like-an-option']);
    assert.equal(invocation.kind, 'cosmos', word);
    assert.equal(invocation.skipHostPrelude, true);
    assert.deepEqual(invocation.cosmos.args, [word, '메모 --looks-like-an-option']);
  }
  assert.notEqual(classifyCliInvocation(['--help']).kind, 'cosmos');
});
