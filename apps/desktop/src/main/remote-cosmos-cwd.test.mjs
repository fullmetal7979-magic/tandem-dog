// A phone names a planet, never a path: cosmos* cwds map through the PC's
// registered projects and anything else is rejected before the verb runs.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRemoteMethods } from './remote-methods.ts';

function fixture() {
  const operations = [];
  const continued = [];
  const registered = new Map([
    ['p1', '/Users/me/planet'],
    ['/Users/me/planet', '/Users/me/planet'],
  ]);
  const methods = createRemoteMethods({
    host: {
      async projectDirectory(path) {
        const directory = registered.get(path);
        if (!directory) throw new Error('Project is not available.');
        return directory;
      },
      async invokeDesktopOperation(name, args) {
        operations.push([name, ...args]);
        return { ok: true };
      },
      async continueGalaxyConversation(cwd, id) {
        continued.push([cwd, id]);
        return { sessionId: 's1', snapshot: null };
      },
    },
  });
  return { methods, operations, continued };
}

const GUEST = { id: 'phone-123456', name: 'iPhone' };

test('cosmos verbs run in the registered project directory', async () => {
  const { methods, operations, continued } = fixture();
  await methods.cosmosSun(['p1', {}, GUEST]);
  await methods.cosmosMoon(['/Users/me/planet', { note: 'x' }, GUEST]);
  await methods.cosmosRequest(['p1', {}, GUEST]);
  await methods.cosmosOverview(['p1', null, GUEST]);
  await methods.cosmosOverview([null, null, GUEST]);
  await methods.cosmosContinueConversation(['p1', 'c1']);
  assert.deepEqual(
    operations.map(([name, cwd]) => [name, cwd]),
    [
      ['cosmosSun', '/Users/me/planet'],
      ['cosmosMoon', '/Users/me/planet'],
      ['cosmosRequest', '/Users/me/planet'],
      ['cosmosOverview', '/Users/me/planet'],
      ['cosmosOverview', null],
    ]
  );
  assert.deepEqual(continued, [['/Users/me/planet', 'c1']]);
});

test('a cwd that is not a registered project is rejected before anything runs', async () => {
  const { methods, operations, continued } = fixture();
  for (const cwd of ['/etc', '/Users/me/other', '../../root', 'C:\\Windows']) {
    await assert.rejects(methods.cosmosSun([cwd, {}, GUEST]), /등록된 프로젝트가 아니에요/, cwd);
    await assert.rejects(methods.cosmosMoon([cwd, {}, GUEST]), /등록된 프로젝트가 아니에요/, cwd);
    await assert.rejects(methods.cosmosRequest([cwd, {}, GUEST]), /등록된 프로젝트가 아니에요/, cwd);
    await assert.rejects(methods.cosmosOverview([cwd, null, GUEST]), /등록된 프로젝트가 아니에요/, cwd);
    await assert.rejects(methods.cosmosContinueConversation([cwd, null]), /등록된 프로젝트가 아니에요/, cwd);
  }
  await assert.rejects(methods.cosmosSun([undefined, {}, GUEST]), /cwd/);
  assert.deepEqual(operations, []);
  assert.deepEqual(continued, []);
});

test('the phone can 그래도 내려놓기 (force) but never asks for the PC run terminals', async () => {
  const { methods, operations } = fixture();
  await methods.cosmosMoon(['p1', { note: 'x', force: true, extra: 'dropped' }, GUEST]);
  await methods.cosmosMoon(['p1', { force: 'yes' }, GUEST]);
  await methods.cosmosOverview(['p1', { fetch: false, runs: true }, GUEST]);
  const moons = operations.filter(([name]) => name === 'cosmosMoon').map(([, , request]) => request);
  assert.equal(moons[0].force, true);
  assert.equal(moons[0].note, 'x');
  assert.equal('extra' in moons[0], false);
  assert.equal(moons[1].force, false, 'only an explicit true forces');
  const [, , options] = operations.find(([name]) => name === 'cosmosOverview');
  assert.deepEqual(options, { fetch: false });
});
