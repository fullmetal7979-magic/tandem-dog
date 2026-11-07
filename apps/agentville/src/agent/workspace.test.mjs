import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ToolError, Workspace, detectSandbox } from './workspace.mjs';

const base = mkdtempSync(join(tmpdir(), 'agentville-ws-test-'));
after(() => rmSync(base, { recursive: true, force: true }));
let count = 0;
const fresh = (options) => new Workspace(join(base, `w${count++}`), options);

test('paths stay inside the work folder, symlinks included', () => {
  const space = fresh();
  const outside = mkdtempSync(join(base, 'outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'no');
  symlinkSync(outside, join(space.root, 'link'));
  assert.equal(space.resolve('a/b.txt'), join(space.root, 'a', 'b.txt'));
  assert.equal(space.resolve(join(space.root, 'x.md')), join(space.root, 'x.md'));
  for (const path of ['../escape.txt', '/etc/passwd', 'a/../../escape', '%2e%2e/escape', 'link/secret.txt', 'link/new.txt', '']) {
    assert.throws(() => space.resolve(path), ToolError, path);
  }
  assert.throws(() => space.resolve('missing.txt', { mustExist: true }), /없습니다/);
});

test('the text editor views, creates, replaces and inserts with backups', async () => {
  const space = fresh();
  const created = await space.edit({ command: 'create', path: '메모/할일.md', file_text: '첫 줄\n둘째 줄\n셋째 줄' });
  assert.equal(created.changed, '메모/할일.md');
  assert.match((await space.edit({ command: 'view', path: '메모/할일.md' })).text, /^1\t첫 줄\n2\t둘째 줄\n3\t셋째 줄$/);
  assert.equal((await space.edit({ command: 'view', path: '메모/할일.md', view_range: [2, -1] })).text, '2\t둘째 줄\n3\t셋째 줄');
  await space.edit({ command: 'str_replace', path: '메모/할일.md', old_str: '둘째 줄', new_str: '2번째 줄 $& $1' });
  assert.equal(readFileSync(join(space.root, '메모/할일.md'), 'utf8'), '첫 줄\n2번째 줄 $& $1\n셋째 줄', 'replacement text is literal');
  await space.edit({ command: 'insert', path: '메모/할일.md', insert_line: 0, insert_text: '# 제목' });
  assert.match(readFileSync(join(space.root, '메모/할일.md'), 'utf8'), /^# 제목\n첫 줄/);
  const backups = readdirSync(join(space.root, '.agentville-backup', '메모'));
  assert.equal(backups.length, 2, 'every change of an existing file is backed up');
  await assert.rejects(space.edit({ command: 'str_replace', path: '메모/할일.md', old_str: '없는 글' }), /찾지 못했습니다/);
  await space.edit({ command: 'create', path: 'twice.txt', file_text: 'a a' });
  await assert.rejects(space.edit({ command: 'str_replace', path: 'twice.txt', old_str: 'a', new_str: 'b' }), /2곳/);
  await assert.rejects(space.edit({ command: 'insert', path: 'twice.txt', insert_line: 9, insert_text: 'x' }), /insert_line/);
  await assert.rejects(space.edit({ command: 'delete', path: 'twice.txt' }), /지원하지 않는/);
  const listing = (await space.edit({ command: 'view', path: '.' })).text;
  assert.match(listing, /메모\//);
  assert.match(listing, /twice\.txt \(3 bytes\)/);
  assert.doesNotMatch(listing, /agentville-backup/, 'backups are hidden from the listing');
});

test('changes since a snapshot are the files the character left', async () => {
  const space = fresh();
  writeFileSync(join(space.root, 'old.txt'), 'old');
  const before = space.snapshot();
  await space.edit({ command: 'create', path: '결과/보고서.md', file_text: '# 보고서' });
  assert.deepEqual(space.changesSince(before), [{ path: '결과/보고서.md', size: Buffer.byteLength('# 보고서'), created: true }]);
});

test('bash runs in the folder with a clean environment', async () => {
  process.env.AGENTVILLE_TEST_SECRET = 'do-not-leak';
  const space = fresh();
  const result = await space.bash({ command: 'pwd; echo "[$AGENTVILLE_TEST_SECRET]"; echo $HOME' });
  delete process.env.AGENTVILLE_TEST_SECRET;
  assert.equal(result.error, false);
  const [pwd, secret, home] = result.text.split('\n');
  assert.equal(pwd, space.root);
  assert.equal(secret, '[]', 'secrets in the server environment are not passed on');
  assert.equal(home, space.root);
  const failed = await space.bash({ command: 'exit 3' });
  assert.equal(failed.error, true);
  assert.match(failed.text, /종료 코드 3/);
  await assert.rejects(space.bash({ command: '  ' }), /비어/);
  assert.match((await space.bash({ restart: true })).text, /다시 시작/);
});

test('bash stops at the time limit and when the task is stopped', async () => {
  const space = fresh({ timeoutMs: 300 });
  const started = Date.now();
  const slow = await space.bash({ command: 'sleep 5; echo never' });
  assert.equal(slow.error, true);
  assert.match(slow.text, /시간 초과/);
  assert.ok(Date.now() - started < 3000);

  const controller = new AbortController();
  const patient = new Workspace(space.root, { timeoutMs: 10_000 });
  setTimeout(() => controller.abort(), 100);
  const begun = Date.now();
  const stopped = await patient.bash({ command: 'sleep 5' }, { signal: controller.signal });
  assert.equal(stopped.error, true);
  assert.ok(Date.now() - begun < 3000, 'abort kills the process group');
});

test('the sandbox lets commands write only inside the work folder', { skip: detectSandbox() !== 'sandbox-exec' && 'macOS sandbox-exec only' }, async () => {
  const space = fresh();
  const probe = `/tmp/agentville-sandbox-probe-${process.pid}-${Date.now()}`;
  const inside = await space.bash({ command: 'echo ok > inside.txt && mkdir -p sub && touch sub/x && cat inside.txt' });
  assert.equal(inside.text, 'ok');
  const outside = await space.bash({ command: `touch ${probe}` });
  assert.equal(outside.error, true);
  assert.equal(existsSync(probe), false, 'nothing was written outside');
  const python = await space.bash({ command: 'python3 -c "open(\'py.txt\',\'w\').write(\'hi\')" && cat py.txt' });
  if (!/command not found|No such file/.test(python.text)) assert.equal(python.text, 'hi');
});

test('a folder the user lent is marked as not the character\'s own', () => {
  const lent = join(base, 'lent');
  mkdirSync(lent);
  const space = new Workspace(lent, { own: false, sandbox: null });
  assert.equal(space.own, false);
  assert.equal(space.sandboxed, false);
});
