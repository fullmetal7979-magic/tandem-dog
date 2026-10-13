import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planSync } from './environment.mjs';
import { buildConversationExport } from './conversations.mjs';

const snap = (entries) => new Map(Object.entries(entries));

test('three-way plan: one-sided changes move, both-sided changes follow the direction', () => {
  const local = snap({ 'files/skills/a.md': 'A1', 'files/skills/b.md': 'B-local', 'files/skills/new.md': 'N' });
  const galaxy = snap({ 'files/skills/a.md': 'A1', 'files/skills/b.md': 'B-galaxy' });
  // First contact: nothing agreed yet, so differing keys are conflicts.
  const first = planSync(local, galaxy, {}, 'push');
  assert.deepEqual(
    first.up.map((entry) => entry.key),
    ['files/skills/b.md', 'files/skills/new.md']
  );
  assert.deepEqual(
    first.conflicts.map((entry) => entry.key),
    ['files/skills/b.md']
  );

  // After agreeing, only the side that moved wins.
  const agreed = first.base;
  const localAfter = snap({ 'files/skills/a.md': 'A1', 'files/skills/b.md': 'B-local', 'files/skills/new.md': 'N' });
  const galaxyAfter = snap({
    'files/skills/a.md': 'A2-from-work',
    'files/skills/b.md': 'B-local',
    'files/skills/new.md': 'N',
  });
  const second = planSync(localAfter, galaxyAfter, agreed, 'push');
  assert.deepEqual(second.down, [{ key: 'files/skills/a.md', text: 'A2-from-work' }]);
  assert.deepEqual(second.up, []);
  assert.deepEqual(second.conflicts, []);

  // A deletion on one side is a change like any other.
  const third = planSync(snap({ 'files/skills/a.md': 'A2-from-work', 'files/skills/b.md': 'B-local' }), galaxyAfter, second.base, 'pull');
  assert.deepEqual(third.up, [{ key: 'files/skills/new.md', text: null }]);
});

test('a conversation export carries only the conversation, redacted and fitted', () => {
  const session = {
    id: 'sess_desktop_abc',
    title: '로그인 화면',
    provider: 'anthropic-oauth',
    model: 'claude-opus-5-5',
    cwd: '/Users/me/app/web',
    updatedAt: 5,
    messages: [
      { role: 'system', content: 'built for this PC' },
      { role: 'user', content: 'use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 please' },
      { role: 'assistant', content: 'done' },
    ],
  };
  const doc = buildConversationExport(session, {
    planetId: 'github.com/me/app',
    planetRoot: '/Users/me/app',
    star: { id: 's1', name: '집 맥북', kind: 'mac' },
    now: 10,
  });
  assert.equal(doc.messages.length, 2);
  assert.equal(doc.messages.some((message) => message.role === 'system'), false);
  assert.doesNotMatch(JSON.stringify(doc.messages), /sk-ant/);
  assert.equal(doc.redactions, 1);
  assert.equal(doc.cwd, 'web');
  assert.equal(doc.star.name, '집 맥북');

  const big = { ...session, messages: Array.from({ length: 400 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2_000) })) };
  const fitted = buildConversationExport(big, { planetId: 'p', limit: 200_000 });
  assert.equal(fitted.trimmed, true);
  assert.ok(Buffer.byteLength(JSON.stringify(fitted.messages)) <= 200_000);
  assert.equal(fitted.messages[0].role, 'user');
});

test('environment sync writes the Galaxy, then this PC, and remembers the agreement', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = process.env.MIXDOG_HOME;
  process.env.MIXDOG_HOME = join(root, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.MIXDOG_HOME;
    else process.env.MIXDOG_HOME = previous;
  });
  const { syncEnvironmentIn, readSyncState } = await import('./environment.mjs');
  const { updateConfig, invalidateConfigReadCache } = await import('../shared/config.mjs');
  const dataDir = join(root, 'home', 'data');
  const galaxy = join(root, 'galaxy');
  mkdirSync(join(dataDir, 'skills', 'review'), { recursive: true });
  mkdirSync(galaxy, { recursive: true });
  writeFileSync(join(dataDir, 'skills', 'review', 'SKILL.md'), '# review\n');
  writeFileSync(join(dataDir, 'openai-oauth.json'), '{"access_token":"never-leaves"}');
  updateConfig(() => ({
    agent: {
      profile: { title: '형님', language: 'ko' },
      mcpServers: { search: { command: 'npx', env: { API_KEY: 'pc-secret' } } },
      providers: { 'openai-oauth': { enabled: true } },
      builtins: { git: { installed: true } },
    },
  }));
  invalidateConfigReadCache();

  const up = await syncEnvironmentIn(galaxy, { direction: 'push', dataDir, home: join(root, 'home') });
  const summary = await up.commitLocal();
  assert.ok(summary.up >= 3);
  const galaxyFile = (rel) => join(galaxy, 'environment', rel);
  assert.equal(readFileSync(galaxyFile('files/skills/review/SKILL.md'), 'utf8'), '# review\n');
  assert.match(readFileSync(galaxyFile('config/agent.profile.json'), 'utf8'), /형님/);
  assert.match(readFileSync(galaxyFile('config/agent.mcpServers.json'), 'utf8'), /\$\{secret\}/);
  assert.doesNotMatch(readFileSync(galaxyFile('config/agent.mcpServers.json'), 'utf8'), /pc-secret/);
  assert.equal(existsSync(galaxyFile('config/agent.providers.json')), false, 'provider sign-ins never sync');
  assert.equal(existsSync(galaxyFile('config/agent.builtins.json')), false, 'install markers never sync');
  assert.equal(existsSync(galaxyFile('files/openai-oauth.json')), false);
  assert.ok(Object.keys((await readSyncState(join(root, 'home'))).base).length >= 3);

  // Another star changed the profile; pulling brings it down and keeps this PC's secret.
  writeFileSync(galaxyFile('config/agent.profile.json'), `${JSON.stringify({ title: '대표님', language: 'ko' }, null, 2)}\n`);
  const down = await syncEnvironmentIn(galaxy, { direction: 'pull', dataDir, home: join(root, 'home') });
  await down.commitLocal();
  invalidateConfigReadCache();
  const { readConfig } = await import('../shared/config.mjs');
  const config = readConfig();
  assert.equal(config.agent.profile.title, '대표님');
  assert.equal(config.agent.mcpServers.search.env.API_KEY, 'pc-secret');
  assert.equal(config.agent.providers['openai-oauth'].enabled, true);
});
