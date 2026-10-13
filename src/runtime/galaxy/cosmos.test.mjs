// End-to-end relay over real git: two stars (separate MIXDOG_HOME), one bare
// Galaxy remote and one bare planet remote. Covers the user's whole loop —
// sit, work, request, leave for the requester, the requester sits and gets the
// project, the environment and the conversation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectGalaxy } from './galaxy-repo.mjs';
import { moon, overview, requestTurn, sun } from './cosmos.mjs';
import { updateStar } from './star.mjs';
import { invalidateConfigReadCache, readConfig, updateConfig } from '../shared/config.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'cosmos-e2e-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const galaxyRemote = join(root, 'galaxy.git');
  const planetRemote = join(root, 'app.git');
  git(root, 'init', '--quiet', '--bare', '-b', 'main', galaxyRemote);
  git(root, 'init', '--quiet', '--bare', '-b', 'main', planetRemote);
  // Seed the planet with one commit.
  const seed = join(root, 'seed');
  git(root, 'clone', '--quiet', planetRemote, seed);
  writeFileSync(join(seed, 'README.md'), '# app\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '--quiet', '-m', 'init');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  const star = (name) => {
    const home = join(root, name, 'home');
    const project = join(root, name, 'app');
    mkdirSync(join(home, 'data'), { recursive: true });
    git(root, 'clone', '--quiet', planetRemote, project);
    git(project, 'config', 'user.email', `${name}@test`);
    git(project, 'config', 'user.name', name);
    return { home, project, dir: join(home, 'galaxy'), name };
  };
  return { root, galaxyRemote, planetRemote, a: star('home-mac'), b: star('work-pc') };
}

const previousHome = process.env.MIXDOG_HOME;
test.after(() => {
  if (previousHome === undefined) delete process.env.MIXDOG_HOME;
  else process.env.MIXDOG_HOME = previousHome;
});

async function as(star, run) {
  process.env.MIXDOG_HOME = star.home;
  invalidateConfigReadCache();
  return run();
}

test('the whole relay: sit, lock out, request, hand over, continue with the same environment and conversation', async (t) => {
  const w = world(t);
  await as(w.a, async () => {
    await updateStar({ name: '집 맥북', kind: 'mac' }, w.a.home);
    await connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote });
    updateConfig(() => ({ agent: { profile: { title: '형님', language: 'ko' } } }));
  });
  await as(w.b, async () => {
    await updateStar({ name: '회사 PC', kind: 'pc' }, w.b.home);
    await connectGalaxy({ dir: w.b.dir, remoteUrl: w.galaxyRemote });
  });

  // ☀️ 집 맥북 takes the seat.
  const first = await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  assert.equal(first.seat.holder.name, '집 맥북');
  assert.equal(first.planet.id.endsWith('app'), true);

  // 회사 PC is locked out and asks for a turn.
  await as(w.b, () =>
    assert.rejects(sun({ root: w.b.project, dir: w.b.dir, home: w.b.home }), (error) => error.code === 'seat_occupied' && error.holder.name === '집 맥북')
  );
  await as(w.b, () => requestTurn({ root: w.b.project, dir: w.b.dir, home: w.b.home, note: '회사에서 이어서 할게요' }));
  const seen = await as(w.a, () => overview({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  assert.equal(seen.state, 'mine');
  assert.equal(seen.seat.requests[0].name, '회사 PC');

  // Work happens on 집 맥북, including a file that must never leave it.
  writeFileSync(join(w.a.project, 'login.js'), 'export const login = () => true;\n');
  writeFileSync(join(w.a.project, 'deploy-notes.txt'), 'token: sk-proj-abcdefghijklmnopqrstuvwxyz\n');
  await as(w.a, () =>
    assert.rejects(
      moon({ root: w.a.project, dir: w.a.dir, home: w.a.home, note: '로그인 완성' }),
      (error) => error.code === 'secrets' && error.secrets.some((finding) => finding.path === 'deploy-notes.txt')
    )
  );
  writeFileSync(join(w.a.project, '.gitignore'), 'deploy-notes.txt\n');

  // 🌙 집 맥북 leaves with its conversation; the seat is held for 회사 PC.
  const session = {
    id: 'sess_desktop_one',
    title: '로그인 만들기',
    provider: 'anthropic-oauth',
    model: 'claude-opus-5-5',
    cwd: w.a.project,
    messages: [
      { role: 'system', content: 'local' },
      { role: 'user', content: '로그인 화면 만들어줘' },
      { role: 'assistant', content: 'login.js를 만들었어요.' },
    ],
  };
  const left = await as(w.a, () => moon({ root: w.a.project, dir: w.a.dir, home: w.a.home, note: '로그인 완성', session }));
  assert.equal(left.project.pushed, true);
  assert.equal(left.handoffTo !== null, true);
  assert.equal(left.conversation.messageCount, 2);

  // ☀️ 회사 PC sits: project, environment and conversation all arrive.
  const second = await as(w.b, () => sun({ root: w.b.project, dir: w.b.dir, home: w.b.home }));
  assert.equal(second.seat.holder.name, '회사 PC');
  assert.equal(second.project.ok, true);
  assert.ok(existsSync(join(w.b.project, 'login.js')), 'the pushed work reached the other PC');
  assert.equal(existsSync(join(w.b.project, 'deploy-notes.txt')), false, 'the secret stayed home');
  assert.equal(second.conversation.title, '로그인 만들기');
  assert.equal(second.conversation.messages.length, 2);
  await as(w.b, () => {
    assert.equal(readConfig().agent.profile.title, '형님', 'the profile followed the user');
  });
  assert.match(readFileSync(join(w.b.dir, 'planets.json'), 'utf8'), /로그인 완성/);

  const finalView = await as(w.a, () => overview({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  assert.equal(finalView.state, 'occupied');
  assert.equal(finalView.seat.holder.name, '회사 PC');
  assert.deepEqual(
    finalView.seat.history.map((entry) => entry.name),
    ['집 맥북', '회사 PC']
  );
});

test('the phone turn: a phone sits through the PC it drives, the PC is locked, others still have to ask', async (t) => {
  const w = world(t);
  const phone = { id: 'browser-1234', name: '내 폰' };
  await as(w.a, async () => {
    await updateStar({ name: '집 맥북', kind: 'mac' }, w.a.home);
    await connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote });
  });
  await as(w.b, async () => {
    await updateStar({ name: '회사 PC', kind: 'pc' }, w.b.home);
    await connectGalaxy({ dir: w.b.dir, remoteUrl: w.galaxyRemote });
  });
  const opts = (s, extra = {}) => ({ root: s.project, dir: s.dir, home: s.home, ...extra });

  // 집 맥북 sits, then its user walks away and picks up the phone: the phone
  // takes the baton through the same machine without a 달.
  await as(w.a, () => sun(opts(w.a)));
  const phoneSat = await as(w.a, () => sun(opts(w.a, { guest: phone })));
  assert.equal(phoneSat.seat.holder.kind, 'phone');
  assert.equal(phoneSat.seat.holder.via, 'relay');
  assert.equal(phoneSat.passed.name, '집 맥북');
  assert.equal(phoneSat.rescue, null);

  // The PC it drives sees 'remote'; the phone sees 'mine'; 회사 PC is locked out.
  assert.equal((await as(w.a, () => overview(opts(w.a)))).state, 'remote');
  const fromPhone = await as(w.a, () => overview(opts(w.a, { guest: phone })));
  assert.equal(fromPhone.state, 'mine');
  assert.equal(fromPhone.star.kind, 'phone');
  await as(w.b, () => assert.rejects(sun(opts(w.b)), (error) => error.code === 'seat_occupied'));

  // The phone finishes (🌙 runs on the PC) and leaves the seat for 회사 PC.
  writeFileSync(join(w.a.project, 'phone.txt'), 'from the phone\n');
  await as(w.b, () => requestTurn(opts(w.b)));
  const left = await as(w.a, () => moon(opts(w.a, { guest: phone, note: '폰에서 마무리' })));
  assert.equal(left.project.pushed, true);
  assert.equal(left.seat.holder, null);
  const next = await as(w.b, () => sun(opts(w.b)));
  assert.equal(next.seat.holder.name, '회사 PC');
  assert.equal(readFileSync(join(w.b.project, 'phone.txt'), 'utf8'), 'from the phone\n');
  const memoRow = next.seat.history.find((row) => row.kind === 'phone');
  assert.equal(memoRow.memo, '폰에서 마무리');
});

test('the PC reclaims its seat from its own phone at any time (되찾기)', async (t) => {
  const w = world(t);
  const phone = { id: 'browser-9', name: '내 폰' };
  await as(w.a, () => connectGalaxy({ dir: w.a.dir, remoteUrl: w.galaxyRemote }));
  await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home, guest: phone }));
  const back = await as(w.a, () => sun({ root: w.a.project, dir: w.a.dir, home: w.a.home }));
  assert.equal(back.seat.holder.via, 'local');
  assert.equal(back.passed.kind, 'phone');
  assert.equal(back.seat.history.at(-2).memo, '이 PC로 되찾음');
});
