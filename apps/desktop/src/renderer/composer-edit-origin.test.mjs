import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composerEditOriginLabel,
  nextComposerEditOrigin,
  queueRestoreHandedBack,
} from './composer-edit-origin.ts';

test('a restored queued follow-up or rewound prompt is named until the draft is emptied', () => {
  assert.equal(queueRestoreHandedBack({ count: 1, text: 'later' }), true);
  assert.equal(queueRestoreHandedBack({ count: 0, text: '' }), false);
  assert.equal(queueRestoreHandedBack(undefined), false);
  assert.equal(queueRestoreHandedBack({ text: 'restored' }), true);

  assert.equal(nextComposerEditOrigin('queue', 'edited text'), 'queue');
  assert.equal(nextComposerEditOrigin('queue', '  '), '');
  assert.equal(nextComposerEditOrigin('rewind', ''), '');

  assert.match(composerEditOriginLabel('queue', true), /end of the queue/);
  assert.match(composerEditOriginLabel('queue', false), /sends it now/);
  assert.match(composerEditOriginLabel('rewind', false), /earlier message/);
  assert.equal(composerEditOriginLabel('', true), '');
});
