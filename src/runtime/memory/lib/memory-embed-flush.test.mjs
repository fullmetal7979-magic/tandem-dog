import assert from 'node:assert/strict';
import test from 'node:test';

import { flushEmbeddingDirty, flushSearchEmbeddings } from './memory-embed.mjs';
import { onnxRuntimeSupported } from '../../shared/onnx-runtime-support.mjs';

// On darwin-x64 the flush returns before touching the store (that gate is
// covered by onnx-unsupported.test.mjs). The transaction handling under test
// is plain JS, so run it as arm64 there to exercise it on every host.
const hostArch = Object.getOwnPropertyDescriptor(process, 'arch');
test.before(() => {
  if (!onnxRuntimeSupported()) Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
});
test.after(() => Object.defineProperty(process, 'arch', hostArch));

// Cancellation must survive the transaction teardown: the batch finally block
// runs COMMIT/ROLLBACK while the abort is already in flight, and a failure
// there used to replace the caller's abort reason with a store fault.
test('a cancelled flush reports the abort even when the rollback also fails', async () => {
  const controller = new AbortController();
  const cancelled = new Error('memory flush cancelled');
  const released = [];
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [{ id: '1' }] };
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      // The locked batch work is cut short by the caller's cancellation.
      controller.abort(cancelled);
      throw new Error('batch query failed');
    },
    release(error) {
      released.push(error);
    },
  };
  const db = {
    async query() {
      return { rows: [] };
    },
    _pool: { connect: async () => client },
  };

  await assert.rejects(
    () => flushEmbeddingDirty(db, { signal: controller.signal }),
    (error) => error === cancelled
  );
  assert.equal(released.length, 1, 'the connection is still released exactly once');
  assert.match(String(released[0]?.message), /rollback failed/, 'the poisoned connection is released with its error');
});

test('explicit maintenance respects cancellation while awaiting another callers flush', async () => {
  let releaseClaim;
  let enteredClaim;
  const claimed = new Promise((resolve) => {
    enteredClaim = resolve;
  });
  const client = {
    async query(sql) {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        enteredClaim();
        return new Promise((resolve) => {
          releaseClaim = () => resolve({ rows: [] });
        });
      }
      return { rows: [] };
    },
    release() {},
  };
  const db = { query: async () => ({ rows: [] }), _pool: { connect: async () => client } };
  const owner = flushEmbeddingDirty(db);
  await claimed;
  const controller = new AbortController();
  const cancelled = new Error('cancelled maintenance caller');
  const follower = assert.rejects(
    flushSearchEmbeddings(db, { signal: controller.signal }),
    (error) => error === cancelled
  );
  controller.abort(cancelled);
  releaseClaim();
  const [result] = await Promise.all([owner, follower]);
  assert.equal(result.succeeded, 0);
  assert.deepEqual(result.failed, []);
});

test('explicit maintenance refuses a successful result when an embedding batch failed', async () => {
  const client = {
    async query(sql) {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [{ id: '1' }] };
      throw new Error('embedding batch unavailable');
    },
    release() {},
  };
  const db = { query: async () => ({ rows: [] }), _pool: { connect: async () => client } };
  await assert.rejects(flushSearchEmbeddings(db), /embedding maintenance incomplete: failed=1/);
});
