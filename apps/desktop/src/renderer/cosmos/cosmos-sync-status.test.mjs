// What the Galaxy screens say about freshness and about entries both sides
// changed: the remote check and the environment match are two different clocks,
// and a conflict names the entry, the side that won and where the other went.
import assert from 'node:assert/strict';
import test from 'node:test';

const NOW = 1_800_000_000_000;
const view = (patch = {}) => ({ ready: true, syncedAt: NOW - 3 * 60 * 60_000, ...patch });

test('the sync line tells the last Galaxy check apart from the last environment match', async () => {
  const { syncLineText } = await import('./GalaxyPane.tsx');
  assert.equal(syncLineText(view(), '', NOW), '은하수와 맞춤: 3시간 전', 'an older service without fetchedAt reads as before');
  assert.equal(syncLineText(view({ fetchedAt: NOW - 2 * 60_000 }), '', NOW), '은하수 확인: 2분 전 · 환경 맞춤: 3시간 전');
  assert.equal(
    syncLineText(view({ fetchedAt: NOW - 40 * 60_000, offline: 'network down' }), '', NOW),
    '은하수에 연결하지 못했어요 · 40분 전에 받은 상태예요'
  );
  assert.equal(syncLineText(view({ offline: 'x' }), '', NOW), '은하수에 연결하지 못했어요 · 마지막으로 받은 상태예요');
  assert.equal(syncLineText(view({ fetchedAt: NOW - 5 * 60_000 }), 'boom', NOW), '새 상태를 받지 못했어요 · 마지막 확인 5분 전');
});

test('environment conflicts list each entry, the side that applied and a cap', async () => {
  const { environmentConflictRows } = await import('./CosmosParts.tsx');
  assert.deepEqual(environmentConflictRows(null), []);
  assert.deepEqual(environmentConflictRows({ conflicts: [] }), []);
  assert.deepEqual(
    environmentConflictRows({
      conflicts: [
        { key: 'files/agents.json', kept: 'galaxy' },
        { key: 'config/model', kept: 'local' },
      ],
      backupDir: '/home/me/.cosmos/backups/cosmos-conflicts/x',
    }),
    [
      { key: 'files/agents.json', text: '은하수 쪽을 적용 · 이 기기 쪽은 백업' },
      { key: 'config/model', text: '이 기기 쪽을 올림 · 은하수 쪽은 백업' },
    ]
  );
  const many = Array.from({ length: 11 }, (_, i) => ({ key: `files/${i}.json`, kept: 'galaxy' }));
  const rows = environmentConflictRows({ conflicts: many });
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.at(-1), { key: '', text: '외 3개' });
});
