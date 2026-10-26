// The relay leg's 조종석 gate: writes from a phone go through only when the
// gate says so, reads never ask, and terminals are judged by the folder they
// were opened in.
import assert from 'node:assert/strict';
import test from 'node:test';
import { gateRemoteWrites, SEAT_GATED_GIT_METHODS } from './remote-seat-gate.ts';

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
