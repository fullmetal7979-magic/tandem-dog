// The relay leg's 조종석 gate: writes from a phone go through only when the
// gate says so, reads never ask, and terminals are judged by the folder they
// were opened in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { gateRemoteWrites, REMOTE_INSTALL_MESSAGE, SEAT_GATED_GIT_METHODS } from './remote-seat-gate.ts';

function table(calls) {
  const record = (name) => (params) => {
    calls.push([name, ...params]);
    return name === 'termEnsure' ? { id: 't1', replay: '' } : 'ok';
  };
  return Object.fromEntries(
    ['gitCommit', 'gitStatus', 'writeProjectFile', 'readProjectFile', 'submitToSession', 'submitNewTask', 'termEnsure', 'termWrite', 'termDispose'].map((name) => [name, record(name)])
  );
}

test('writes ask the seat for the right folder; reads never ask', async () => {
  const calls = [];
  const asked = [];
  const methods = gateRemoteWrites(table(calls), {
    gate: async (cwd) => {
      asked.push(cwd);
      return cwd === '/locked' ? '🔒 집 맥북이 조종 중이에요.' : null;
    },
    projectDirectory: async (id) => (id === 'p-locked' ? '/locked' : '/free'),
    sessionCwd: async (id) => (id === 's-locked' ? '/locked' : '/free'),
  });

  assert.equal(await methods.gitCommit(['/free', 'msg']), 'ok');
  await assert.rejects(methods.gitCommit(['/locked', 'msg']), /집 맥북이 조종 중/);
  await assert.rejects(methods.writeProjectFile(['p-locked', 'a.txt', 'x']), (error) => error.code === 'seat_refused');
  await assert.rejects(methods.submitToSession(['s-locked', 'hi']), /조종 중/);
  await assert.rejects(methods.submitNewTask(['hi', {}, { projectPath: 'p-locked' }]), /조종 중/);
  assert.equal(await methods.submitNewTask(['hi', {}, {}]), 'ok');

  asked.length = 0;
  assert.equal(methods.gitStatus(['/locked']), 'ok');
  assert.equal(methods.readProjectFile(['p-locked', 'a.txt']), 'ok');
  assert.deepEqual(asked, [], 'reads do not consult the seat');
  assert.equal(calls.some(([name, cwd]) => name === 'gitCommit' && cwd === '/locked'), false, 'a refused write never runs');
});

test('a terminal is judged by the folder it was opened in', async () => {
  const calls = [];
  // The host opened t1 where the phone asked; forgetting it releases the id.
  const opened = new Map();
  const base = table(calls);
  const methods = gateRemoteWrites(
    {
      ...base,
      termEnsure: (params) => {
        const result = base.termEnsure(params);
        if (!opened.has(result.id)) opened.set(result.id, params[1] || null);
        return result;
      },
      termDispose: (params) => {
        opened.delete(params[0]);
        return base.termDispose(params);
      },
    },
    {
      gate: async (cwd) => (cwd === '/locked' ? 'locked' : null),
      projectDirectory: async () => null,
      sessionCwd: async () => null,
      terminalCwd: (id) => (opened.has(id) ? opened.get(id) : undefined),
    }
  );
  await methods.termEnsure([null, '/locked', null]);
  await assert.rejects(methods.termWrite(['t1', 'rm -rf build\n']), /locked/);
  await methods.termDispose(['t1']);
  assert.equal(await methods.termWrite(['t1', 'ls\n']), 'ok', 'a forgotten terminal falls back to the open gate');
});

test('every git lane that moves the checkout or the remote is gated', () => {
  for (const name of ['gitCommit', 'gitPush', 'gitPull', 'gitCheckoutBranch', 'gitResetToCommit', 'gitStashPop']) {
    assert.ok(SEAT_GATED_GIT_METHODS.includes(name), name);
  }
  for (const name of ['gitStatus', 'gitLog', 'gitDiff', 'gitShow']) assert.ok(!SEAT_GATED_GIT_METHODS.includes(name), name);
});

test('a gate or resolver that throws refuses the write instead of letting it through', async () => {
  const calls = [];
  const broken = gateRemoteWrites(table(calls), {
    gate: async () => {
      throw new Error('overview crashed');
    },
    projectDirectory: async () => '/free',
    sessionCwd: async () => '/free',
  });
  await assert.rejects(broken.gitCommit(['/free', 'msg']), (error) => error.code === 'seat_refused' && /확인하지 못해/.test(error.message));
  await assert.rejects(broken.writeProjectFile(['p', 'a', 'x']), (error) => error.code === 'seat_refused');

  const noResolver = gateRemoteWrites(table(calls), {
    gate: async () => null,
    projectDirectory: async () => {
      throw new Error('registry offline');
    },
    sessionCwd: async () => {
      throw new Error('daemon down');
    },
  });
  await assert.rejects(noResolver.writeProjectFile(['p', 'a', 'x']), (error) => error.code === 'seat_refused');
  await assert.rejects(noResolver.submitToSession(['s', 'hi']), (error) => error.code === 'seat_refused');
  assert.equal(calls.length, 0, 'no refused write ran');
});

test('cosmosContinueConversation and githubRequest are seat-gated lanes', async () => {
  assert.ok(SEAT_GATED_GIT_METHODS.includes('githubRequest'));
  const calls = [];
  const named = (name) => (params) => {
    calls.push([name, ...params]);
    return 'ok';
  };
  const methods = gateRemoteWrites(
    { cosmosContinueConversation: named('cosmosContinueConversation'), githubRequest: named('githubRequest') },
    {
      gate: async (cwd) => (cwd === '/locked' ? 'locked' : null),
      projectDirectory: async (id) => (id === 'p-locked' ? '/locked' : '/free'),
      sessionCwd: async () => null,
    }
  );
  await assert.rejects(methods.cosmosContinueConversation(['p-locked', null]), /locked/);
  await assert.rejects(methods.githubRequest(['/locked', {}]), /locked/);
  assert.equal(await methods.cosmosContinueConversation(['p-free', null]), 'ok');
  assert.equal(await methods.githubRequest(['/free', {}]), 'ok');
});

test('a terminal the PC opened is judged by the host, or by every project when unknown', async () => {
  const calls = [];
  const asked = [];
  const gate = async (cwd) => {
    asked.push(cwd);
    return cwd === '/locked' ? 'locked' : null;
  };
  // The host knows term_cosmos_run_a lives in a locked folder.
  const known = gateRemoteWrites(table(calls), {
    gate,
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    terminalCwd: (id) => (id === 'term_cosmos_run_a' ? '/locked' : id === 'term_cosmos_run_b' ? '/free' : undefined),
  });
  await assert.rejects(known.termWrite(['term_cosmos_run_a', 'npm run dev\r']), /locked/);
  assert.equal(await known.termWrite(['term_cosmos_run_b', 'ls\r']), 'ok');

  // The host cannot say: one locked project refuses, none locked lets it by.
  const unknown = gateRemoteWrites(table(calls), {
    gate,
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    projectDirectories: async () => ['/free', '/locked'],
  });
  await assert.rejects(unknown.termWrite(['term_cosmos_run_zzz', 'x\r']), /locked/);
  const freeOnly = gateRemoteWrites(table(calls), {
    gate,
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    projectDirectories: async () => ['/free'],
  });
  assert.equal(await freeOnly.termWrite(['term_cosmos_run_zzz', 'x\r']), 'ok');

  const failing = gateRemoteWrites(table(calls), {
    gate: async () => {
      throw new Error('boom');
    },
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    projectDirectories: async () => ['/free'],
  });
  await assert.rejects(failing.termWrite(['term_cosmos_run_zzz', 'x\r']), (error) => error.code === 'seat_refused');
});

test('termEnsure on an existing PC terminal with a null cwd is refused while the PC holds the seat', async () => {
  const calls = [];
  const asked = [];
  // Like the real gate: a folder-less write goes ahead, the PC-held planet does not.
  const gate = async (cwd) => {
    asked.push(cwd);
    return cwd === '/locked' ? '🔒 이 PC가 작업 중이에요.' : null;
  };
  const methods = gateRemoteWrites(
    {
      ...table(calls),
      // Ensuring an id that already runs on the PC reuses that PTY, whatever folder was asked for.
      termEnsure: (params) => {
        calls.push(['termEnsure', ...params]);
        return { id: 'term_cosmos_run_a', replay: '$ ' };
      },
    },
    {
      gate,
      projectDirectory: async () => null,
      sessionCwd: async () => null,
      terminalCwd: (id) => (id === 'term_cosmos_run_a' ? '/locked' : undefined),
    }
  );
  await methods.termEnsure(['term_cosmos_run_a', null, null]);
  await assert.rejects(methods.termWrite(['term_cosmos_run_a', 'rm -rf .\r']), (error) => error.code === 'seat_refused');
  await methods.termEnsure(['term_cosmos_run_a', '/free', null]);
  await assert.rejects(methods.termWrite(['term_cosmos_run_a', 'rm -rf .\r']), /작업 중/);
  assert.equal(asked.includes('/free') || asked.includes(null), false, "the phone's folder is never what the seat is asked about");
  assert.equal(calls.some(([name]) => name === 'termWrite'), false, 'the refused keystrokes never reached the PTY');
});

test('termEnsure on a terminal the host cannot place falls back to every project', async () => {
  const calls = [];
  const methods = gateRemoteWrites(table(calls), {
    gate: async (cwd) => (cwd === '/locked' ? 'locked' : null),
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    terminalCwd: () => undefined,
    projectDirectories: async () => ['/free', '/locked'],
  });
  await methods.termEnsure(['t1', '/free', null]);
  await assert.rejects(methods.termWrite(['t1', 'x\r']), /locked/);
});

// Audit round 3, security 1: a write with no folder, or one outside every
// registered project, could `cd` into any project. With a Galaxy ready it is
// refused while any project is held by another device; an empty seat, or no
// Galaxy at all, lets it through as before.
test('no folder, no project or a folder outside every project is judged by every registered project', async () => {
  const calls = [];
  const heldAsked = [];
  let galaxyReady = true;
  // The real held rule: only a project another device holds refuses; without a Galaxy nothing does.
  const heldGate = async (cwd) => {
    heldAsked.push(cwd);
    return galaxyReady && cwd === '/projects/held' ? '🔒 회사 PC가 held 프로젝트에서 작업 중이에요.' : null;
  };
  const methods = gateRemoteWrites(
    {
      ...table(calls),
      termEnsure: (params) => {
        calls.push(['termEnsure', ...params]);
        return { id: params[0] || 't-home', replay: '' };
      },
    },
    {
      // The folder's own seat: a folder that is no planet answers null.
      gate: async (cwd) => (galaxyReady && cwd === '/projects/held' ? 'held' : null),
      heldGate,
      projectDirectory: async (id) => (id === 'p-free' ? '/projects/free' : null),
      sessionCwd: async (id) => (id === 's-home' ? '/Users/me' : null),
      projectDirectories: async () => ['/projects/free', '/projects/empty', '/projects/held'],
      terminalCwd: (id) => (id === 't-none' ? null : id === 't-home' ? '/Users/me' : undefined),
    }
  );

  await methods.termEnsure(['t-none', null, null]);
  await assert.rejects(methods.termWrite(['t-none', 'cd /projects/held && rm -rf .\r']), /작업 중/);
  await methods.termEnsure(['t-home', '~', null]);
  await assert.rejects(methods.termWrite(['t-home', 'ls\r']), /작업 중/);
  await assert.rejects(methods.submitNewTask(['hi', {}, {}]), /작업 중/);
  await assert.rejects(methods.submitToSession(['s-home', 'hi']), /작업 중/);
  await assert.rejects(methods.gitCommit(['~', 'msg']), /작업 중/);
  await assert.rejects(methods.gitCommit(['/tmp/stray-clone', 'msg']), /작업 중/);
  assert.ok(heldAsked.includes('/projects/held'));
  // Inside a registered project, only that project's own seat counts.
  assert.equal(await methods.gitCommit(['/projects/free/src', 'msg']), 'ok');
  assert.equal(await methods.submitNewTask(['hi', {}, { projectPath: 'p-free' }]), 'ok');
  assert.equal(calls.some(([name]) => name === 'termWrite'), false, 'refused keystrokes never reached a PTY');

  // No Galaxy ready: the every-project rule finds nothing held, the old allow stands.
  galaxyReady = false;
  assert.equal(await methods.submitNewTask(['hi', {}, {}]), 'ok');
  assert.equal(await methods.gitCommit(['~', 'msg']), 'ok');
  await new Promise((resolve) => setTimeout(resolve, 1_600)); // past the terminal verdict reuse
  assert.equal(await methods.termWrite(['t-none', 'ls\r']), 'ok');
});

test('an empty seat elsewhere does not block a folder-less write; a failed project list refuses it', async () => {
  const calls = [];
  const methods = gateRemoteWrites(table(calls), {
    gate: async () => '☄️ 아무도 작업하지 않아요.',
    heldGate: async () => null,
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    projectDirectories: async () => ['/projects/empty'],
  });
  assert.equal(await methods.submitNewTask(['hi', {}, {}]), 'ok');

  const broken = gateRemoteWrites(table(calls), {
    gate: async () => null,
    heldGate: async () => null,
    projectDirectory: async () => null,
    sessionCwd: async () => null,
    projectDirectories: async () => {
      throw new Error('registry offline');
    },
  });
  await assert.rejects(broken.submitNewTask(['hi', {}, {}]), (error) => error.code === 'seat_refused');
});

// ------------------------------------------------------------------ round 4

test('a registered project that is no planet (`~`) does not open the planets under it', async () => {
  const calls = [];
  const held = new Map([['/home/me/app', '🔒 회사 PC에서 app 프로젝트를 작업 중이에요.']]);
  const methods = gateRemoteWrites(table(calls), {
    gate: async () => null,
    // `~` is registered, is not a repo: "go ahead, but I am no planet".
    verdict: async (cwd) => (cwd === '/home/me/app' ? { refusal: held.get(cwd), planet: true } : { refusal: null, planet: false }),
    heldGate: async (folder) => held.get(folder) ?? null,
    projectDirectory: async (id) => (id === 'home' ? '/home/me' : '/home/me/app'),
    projectDirectories: async () => ['/home/me', '/home/me/app'],
    sessionCwd: async () => null,
  });
  // A file written through the `~` project would land in app: refused while app is held elsewhere.
  await assert.rejects(methods.writeProjectFile(['home', 'app/src/x.ts', 'x']), /회사 PC에서 app 프로젝트를 작업 중/);
  await assert.rejects(methods.gitCommit(['/home/me', 'msg']), /app 프로젝트/);
  // Nothing held anywhere: the plain folder writes freely again.
  held.clear();
  assert.equal(await methods.writeProjectFile(['home', 'notes.txt', 'x']), 'ok');
});

test('session writers follow the session folder; a deny never needs the seat; installs never run from the phone', async () => {
  const calls = [];
  const asked = [];
  const base = table(calls);
  for (const name of ['resolveToolApprovalForSession', 'inheritSession', 'invokeCapability']) {
    base[name] = (params, context) => {
      calls.push([name, context?.clientId ?? null, ...params]);
      return 'ok';
    };
  }
  const methods = gateRemoteWrites(base, {
    gate: async (cwd) => {
      asked.push(cwd);
      return cwd === '/locked' || cwd === null ? '🔒 다른 기기에서 작업 중이에요.' : null;
    },
    projectDirectory: async () => null,
    sessionCwd: async (id) => (id === 's-locked' ? '/locked' : '/free'),
  });
  const caller = { clientId: 'browser-1' };
  // Approving lets the agent write: gated. Denying is always allowed.
  await assert.rejects(methods.resolveToolApprovalForSession(['s-locked', 'a1', { approved: true }], caller), /작업 중/);
  assert.equal(await methods.resolveToolApprovalForSession(['s-locked', 'a1', { approved: false }], caller), 'ok');
  await assert.rejects(methods.inheritSession(['s-locked', null], caller), /작업 중/);
  assert.equal(await methods.inheritSession(['s-free', null], caller), 'ok');
  // Reverting a turn rewrites the session's files.
  await assert.rejects(methods.invokeCapability([{ capability: 'revertTurnReview', args: [], sessionId: 's-locked' }], caller), /작업 중/);
  assert.equal(await methods.invokeCapability([{ capability: 'revertTurnReviewFile', args: [], sessionId: 's-free' }], caller), 'ok');
  // A scheduled run names no folder: the every-project rule (here: no folder → refused).
  await assert.rejects(methods.invokeCapability([{ capability: 'runScheduleNow', args: ['x'] }], caller), /작업 중/);
  // Installers are refused outright, in the phone user's words.
  for (const capability of ['addMcpServer', 'addPlugin', 'installBuiltinFeature', 'installLocalProviderModel', 'enablePluginMcp', 'setSystemShell']) {
    await assert.rejects(methods.invokeCapability([{ capability, args: [] }], caller), (error) => error.message === REMOTE_INSTALL_MESSAGE);
  }
  // Read-only capabilities pass unasked.
  asked.length = 0;
  assert.equal(await methods.invokeCapability([{ capability: 'getTurnReviewDiff', args: [], sessionId: 's-locked' }], caller), 'ok');
  assert.deepEqual(asked, []);
  // The caller's identity reaches the wrapped method.
  assert.ok(calls.filter(([name]) => name === 'invokeCapability').every(([, clientId]) => clientId === 'browser-1'));
});
