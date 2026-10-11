import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dispatchSessionStart } from './session-start-hook.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepo({ session } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tandem-hook-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init');
  if (session !== undefined) {
    mkdirSync(join(dir, '.tandem'), { recursive: true });
    writeFileSync(join(dir, '.tandem', 'SESSION.md'), session);
  }
  return dir;
}

function makeDeps(cwd, dispatch) {
  const calls = [];
  return {
    calls,
    deps: {
      rt: {
        currentCwd: cwd,
        route: { model: 'm' },
        session: { id: 's1', messages: [], updatedAt: 0 },
      },
      hooks: {
        dispatch: async (event, payload) => {
          calls.push({ event, payload });
          return dispatch();
        },
      },
      hookCommonPayload: (extra) => ({ cwd, ...extra }),
    },
  };
}

const SESSION = '# Tandem 가상 세션\n\n## 목표\n결제 MVP\n\n## 다음 단계\n검증 로직\n\n## 작업 로그\n';

async function withoutOptOut(fn) {
  const before = process.env.MIXDOG_TANDEM_CONTEXT;
  delete process.env.MIXDOG_TANDEM_CONTEXT;
  try {
    return await fn();
  } finally {
    if (before !== undefined) process.env.MIXDOG_TANDEM_CONTEXT = before;
  }
}

test('SessionStart injects the Tandem session as hook context before the first turn', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    await withoutOptOut(async () => {
      const { deps, calls } = makeDeps(repo, () => ({}));
      await dispatchSessionStart(deps, 'startup', null);
      assert.equal(calls[0].event, 'SessionStart');
      const { messages } = deps.rt.session;
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, 'user');
      assert.match(messages[0].content, /^<system-reminder>\n# SessionStart Hook Context\n\[Tandem 가상 세션/);
      assert.match(messages[0].content, /## 다음 단계\n검증 로직/);
      assert.match(messages[0].content, /<\/system-reminder>$/);
      assert.deepEqual(messages[1], { role: 'assistant', content: '.' });
      assert.ok(deps.rt.session.updatedAt > 0);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('Tandem text joins the hook additionalContext in the same message', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    await withoutOptOut(async () => {
      const { deps } = makeDeps(repo, () => ({ additionalContext: ['hook says hi'] }));
      await dispatchSessionStart(deps, 'resume', null);
      assert.equal(deps.rt.session.messages.length, 2);
      const text = deps.rt.session.messages[0].content;
      assert.match(text, /# SessionStart Hook Context\nhook says hi\n\n\[Tandem 가상 세션/);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a failing hook does not lose the Tandem session', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    await withoutOptOut(async () => {
      const { deps } = makeDeps(repo, () => {
        throw new Error('hook blew up');
      });
      await dispatchSessionStart(deps, 'clear', null);
      assert.match(deps.rt.session.messages[0].content, /Tandem 가상 세션/);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('without SESSION.md (or when opted out) the session start adds nothing', async () => {
  const plain = makeRepo();
  const tandem = makeRepo({ session: SESSION });
  try {
    await withoutOptOut(async () => {
      const a = makeDeps(plain, () => ({}));
      await dispatchSessionStart(a.deps, 'startup', null);
      assert.deepEqual(a.deps.rt.session.messages, []);
    });
    const before = process.env.MIXDOG_TANDEM_CONTEXT;
    process.env.MIXDOG_TANDEM_CONTEXT = '0';
    try {
      const b = makeDeps(tandem, () => ({}));
      await dispatchSessionStart(b.deps, 'startup', null);
      assert.deepEqual(b.deps.rt.session.messages, []);
    } finally {
      if (before === undefined) delete process.env.MIXDOG_TANDEM_CONTEXT;
      else process.env.MIXDOG_TANDEM_CONTEXT = before;
    }
  } finally {
    rmSync(plain, { recursive: true, force: true });
    rmSync(tandem, { recursive: true, force: true });
  }
});

test('an aborted session start still throws the abort', async () => {
  const repo = makeRepo({ session: SESSION });
  try {
    await withoutOptOut(async () => {
      const controller = new AbortController();
      controller.abort(new Error('stop'));
      const { deps } = makeDeps(repo, () => ({}));
      await assert.rejects(dispatchSessionStart(deps, 'startup', controller.signal), /stop/);
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
