import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCliInvocation } from '../../headless-command.mjs';
import { COSMOS_VERBS, cosmosVerb, runCosmosCli } from './cosmos-cli.mjs';

test('Korean and English relay verbs map to the same action', () => {
  assert.equal(cosmosVerb('해'), 'sun');
  assert.equal(cosmosVerb('start'), 'sun');
  assert.equal(cosmosVerb('달'), 'moon');
  assert.equal(cosmosVerb('finish'), 'moon');
  assert.equal(cosmosVerb('교대'), 'request');
  assert.equal(cosmosVerb('은하수'), 'status');
  assert.equal(cosmosVerb('연결'), 'connect');
  assert.equal(cosmosVerb('별'), 'star');
  assert.equal(cosmosVerb('nonsense'), null);
});

// Added with the plain wording; src/headless-command.mjs (COSMOS_RELAY_WORDS)
// has to learn them before `mixdog 이어받기` reaches this CLI.
const NEW_ALIASES = ['이어받기', '내려놓기', '요청', '기기'];

test('plain-word aliases map to the same actions as the old verbs', () => {
  assert.equal(cosmosVerb('이어받기'), 'sun');
  assert.equal(cosmosVerb('sit'), 'sun');
  assert.equal(cosmosVerb('내려놓기'), 'moon');
  assert.equal(cosmosVerb('leave'), 'moon');
  assert.equal(cosmosVerb('요청'), 'request');
  assert.equal(cosmosVerb('기기'), 'star');
});

test('the help speaks in devices, projects and sessions', async () => {
  const out = [];
  const code = await runCosmosCli(['도움말'], { out: { write: (s) => out.push(s) }, err: { write: (s) => out.push(s) } });
  assert.equal(code, 0);
  const help = out.join('');
  for (const word of ['이어받기', '내려놓기', '넘겨 달라고 요청']) assert.match(help, new RegExp(word));
  assert.doesNotMatch(help, /별|행성|교대|교신|조종|앉기|내리기/);
});

test('the CLI classifier routes the new plain-word aliases', () => {
  for (const word of NEW_ALIASES) assert.equal(classifyCliInvocation([word]).kind, 'cosmos', word);
});

test('the CLI classifier routes every relay verb without touching the TUI', () => {
  for (const word of COSMOS_VERBS.filter((verb) => !verb.startsWith('-') && verb !== 'help' && !NEW_ALIASES.includes(verb))) {
    const invocation = classifyCliInvocation([word, '메모 --looks-like-an-option']);
    assert.equal(invocation.kind, 'cosmos', word);
    assert.equal(invocation.skipHostPrelude, true);
    assert.deepEqual(invocation.cosmos.args, [word, '메모 --looks-like-an-option']);
  }
  assert.notEqual(classifyCliInvocation(['--help']).kind, 'cosmos');
});

const capture = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: { write: (s) => out.push(s) }, err: { write: (s) => err.push(s) } } };
};

test('a mistyped verb is an error with a suggestion, not the help on stdout', async () => {
  const { out, err, io } = capture();
  const code = await runCosmosCli(['statsu'], io);
  assert.equal(code, 1);
  assert.equal(out.join(''), '');
  assert.match(err.join(''), /모르는 명령이에요: statsu — 혹시 `cosmos status`\?/);
  const { suggestVerb } = await import('./cosmos-cli.mjs');
  assert.equal(suggestVerb('이어받가'), '이어받기');
  assert.equal(suggestVerb('완전히다른말'), null);
});

test('history and universe are relay verbs the CLI routes', () => {
  assert.equal(cosmosVerb('기록'), 'history');
  assert.equal(cosmosVerb('history'), 'history');
  assert.equal(cosmosVerb('우주'), 'universe');
  for (const word of ['기록', '우주', 'universe', 'history']) assert.equal(classifyCliInvocation([word]).kind, 'cosmos', word);
});

test('cosmos 우주 tells a repository’s universe, also as JSON', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'cosmos-universe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  git('init', '--quiet', '-b', 'main');
  for (const name of ['a', 'b', 'c']) {
    writeFileSync(join(root, name), name);
    git('add', name);
    git('commit', '--quiet', '-m', `add ${name}`);
  }
  git('tag', 'v1');
  writeFileSync(join(root, 'draft'), 'x');
  const text = capture();
  assert.equal(await runCosmosCli(['우주'], { ...text.io, cwd: root }), 0);
  const said = text.out.join('');
  assert.match(said, /빛 3개 \(커밋\)/);
  assert.match(said, /이름 붙은 빛 1개 \(태그\)/);
  assert.match(said, /성운 1개 \(커밋 전 변경\)/);
  assert.match(said, /가장 새 빛 방금 — add c/);
  assert.match(said, /“.+”/, 'the verse of the day');
  const asJson = capture();
  assert.equal(await runCosmosCli(['universe', '--json'], { ...asJson.io, cwd: root }), 0);
  const facts = JSON.parse(asJson.out.join(''));
  assert.equal(facts.lights, 3);
  assert.equal(facts.named, 1);
  assert.equal(facts.tethered, null, 'no upstream: nothing to say about pushing');
});

test('a terminal never names this device a phone', async () => {
  const { err, io } = capture();
  assert.equal(await runCosmosCli(['기기', '내 기계', 'phone'], io), 2);
  assert.match(err.join(''), /pc 또는 mac/);
});
