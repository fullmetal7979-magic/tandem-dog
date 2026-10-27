// Round-4 UX 4: a finished reply is announced once; switching sessions and
// paging history are silent, and the transcript is not a live region.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { installTestDom } from './test-support/test-dom.mjs';

test('busy → idle in the same session announces once; a session switch does not', async (t) => {
  const { root, document } = installTestDom(t, { rootId: 'root' });
  const { useTurnAnnouncement } = await import('./use-turn-announcement.ts');
  function Probe({ busy, sessionKey }) {
    return React.createElement('p', { id: 'probe' }, useTurnAnnouncement(busy, sessionKey));
  }
  const show = (props) => act(async () => root.render(React.createElement(Probe, props)));
  const text = () => document.getElementById('probe').textContent;
  await show({ busy: false, sessionKey: 'a' });
  assert.equal(text(), '');
  await show({ busy: true, sessionKey: 'a' });
  assert.equal(text(), '');
  await show({ busy: false, sessionKey: 'a' });
  assert.notEqual(text(), '', 'the finished reply is announced');
  await show({ busy: true, sessionKey: 'a' });
  await show({ busy: false, sessionKey: 'b' });
  assert.equal(text(), '', 'switching to another session says nothing');
});

test('the transcript scroller is not a live region; the status line is', () => {
  const source = readFileSync(new URL('./Conversation.tsx', import.meta.url), 'utf8');
  const scroller = source.slice(source.indexOf('className="transcript"'), source.indexOf('tabIndex={0}', source.indexOf('className="transcript"')));
  assert.match(scroller, /aria-live="off"/);
  assert.doesNotMatch(scroller, /aria-live="polite"/);
  assert.match(source, /role="status" aria-live="polite">\s*\{turnNotice\}/);
});
