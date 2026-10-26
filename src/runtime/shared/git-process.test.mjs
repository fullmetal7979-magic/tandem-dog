// git-process: only network commands get a default time limit; a local
// command is never SIGKILLed half-way (that leaves index.lock behind).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultGitTimeoutMs, gitTimeoutSignal, isNetworkGit, runGit } from './git-process.mjs';

test('only fetch, push, pull, clone and ls-remote get a default time limit', () => {
  for (const sub of ['fetch', 'push', 'pull', 'clone', 'ls-remote']) {
    assert.equal(isNetworkGit([sub]), true, sub);
    assert.equal(defaultGitTimeoutMs(['-c', 'k=v', '-C', '/x', sub, '--quiet']), 60_000, sub);
    assert.equal(gitTimeoutSignal([sub]), 'SIGKILL', sub);
  }
  for (const sub of ['add', 'commit', 'reset', 'checkout', 'switch', 'merge', 'rebase', 'gc', 'clean', 'stash', 'status', 'rev-parse', 'diff']) {
    assert.equal(isNetworkGit([sub]), false, sub);
    assert.equal(defaultGitTimeoutMs([sub]), 0, `${sub} runs without a default limit`);
    assert.equal(gitTimeoutSignal([sub]), 'SIGTERM', `${sub} is never SIGKILLed`);
  }
});

test('a local command outliving the old 20s default is not stopped; an explicit limit still applies', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'git-process-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // No limit given: a slow local command runs to the end.
  const slow = await runGit(dir, ['-c', 'alias.slow=!sleep 0.4; echo done', 'slow']);
  assert.equal(slow.code, 0);
  assert.equal(slow.stdout.trim(), 'done');
  assert.equal(slow.timedOut, undefined);
  // A caller-set limit stops it (with SIGTERM) and resolves non-zero.
  const started = Date.now();
  const stopped = await runGit(dir, ['-c', 'alias.slower=!sleep 5', 'slower'], { timeoutMs: 200 });
  assert.equal(stopped.timedOut, true);
  assert.notEqual(stopped.code, 0);
  assert.match(stopped.stderr, /timed out/);
  assert.ok(Date.now() - started < 3000);
});
