// `cosmos` relay commands for the terminal. The desktop app drives the same
// orchestration (cosmos.mjs); these exist so any PC with only a shell can
// still take a turn, hand over, or check the Galaxy.
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { assertSafeRemoteUrl, connectGalaxy, galaxyDir } from './galaxy-repo.mjs';
import { scrubUrl, scrubUrlsInText } from './secrets.mjs';
import { moon, overview, requestTurn, sun } from './cosmos.mjs';
import { reservedUntil } from './seat.mjs';
import { ensureStar, updateStar } from './star.mjs';
import { universeFacts, universeLines } from './universe.mjs';
import { ago, josa, minutesUntil } from './words.mjs';

// The first Korean word of each verb is what the help shows; the older words
// (해/달/교대/별) keep working for anyone who learned them.
const VERBS = {
  sun: ['이어받기', '해', 'sun', 'start', 'sit'],
  moon: ['내려놓기', '달', 'moon', 'finish', 'leave'],
  request: ['요청', '교대', 'request', 'handover'],
  status: ['은하수', 'status', 'galaxy'],
  history: ['기록', 'history', 'turns'],
  universe: ['우주', 'universe'],
  connect: ['연결', 'connect'],
  star: ['기기', '별', 'star'],
  help: ['help', '--help', '-h', '도움말'],
};

/** A device names its own kind from the terminal; a phone's star is made by the phone. */
const TERMINAL_KINDS = ['pc', 'mac'];

export const COSMOS_VERBS = Object.freeze(Object.values(VERBS).flat());

export function cosmosVerb(word) {
  const value = String(word ?? '').trim();
  for (const [verb, words] of Object.entries(VERBS)) if (words.includes(value)) return verb;
  return null;
}

const HELP = `코스모스 이어받기 명령

  cosmos 이어받기 [--force]        최신 작업·환경·세션을 받아 이 기기에서 이어서 작업하기
  cosmos 내려놓기 ["메모"]         저장·커밋·푸시하고 환경·세션을 은하수에 올린 뒤 작업 자리 비우기
                                  (--force: 프로젝트를 올리지 못해도 내려놓기)
  cosmos 요청 ["메모"]             지금 작업 중인 기기에 넘겨 달라고 요청 (취소: cosmos 요청 --cancel)
  cosmos 은하수 [--json]           모든 기기와 이 프로젝트의 작업 상태 보기
  cosmos 기록 [--json]             이 프로젝트를 어느 기기가 언제 작업했는지 보기
  cosmos 우주 [--json]             이 프로젝트의 커밋 기록을 우주 그림처럼 요약해 보기
  cosmos 연결 <저장소 URL>         은하수(비공개 GitHub 저장소) 연결
  cosmos 기기 "<이름>" [pc|mac]    이 기기 이름 정하기

영어 이름도 됩니다: sit, leave, request, status, history, universe, connect, star.
예전 명령어도 그대로 쓸 수 있어요. --json 은 스크립트에서 읽기 좋은 JSON 으로 보여 줘요.`;

/** Edit distance, for "did you mean" on a mistyped verb. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

/** The verb word closest to a mistyped one, or null when none is close. */
export function suggestVerb(word) {
  const value = String(word ?? '').trim().toLowerCase();
  if (!value) return null;
  let best = null;
  for (const candidate of COSMOS_VERBS) {
    if (candidate.startsWith('-')) continue;
    const d = distance(value, candidate.toLowerCase());
    const allowed = /^[\x00-\x7f]+$/.test(candidate) ? 2 : 1;
    if (d <= allowed && (!best || d < best.d)) best = { word: candidate, d };
  }
  return best?.word ?? null;
}

const clock = (at) =>
  new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function lasted(from, to) {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}시간 ${minutes % 60}분` : `${hours}시간`;
}

const kindIcon = (kind) => ({ mac: '💻', pc: '🖥️', phone: '📱' })[kind] || '⭐';

/** The newest saved session whose working folder is inside `root`. */
export async function latestSessionFor(root, dataDir = resolvePluginData()) {
  const dir = join(dataDir, 'sessions');
  let names = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return null;
  }
  const dated = [];
  for (const name of names) {
    const info = await stat(join(dir, name)).catch(() => null);
    if (info) dated.push({ name, at: info.mtimeMs });
  }
  dated.sort((a, b) => b.at - a.at);
  for (const { name } of dated.slice(0, 40)) {
    try {
      const session = JSON.parse(await readFile(join(dir, name), 'utf8'));
      const cwd = String(session?.cwd || '');
      if (!cwd) continue;
      // Outside the project: above it, or (Windows) on another drive, where
      // relative() gives back an absolute path.
      const rel = relative(root, cwd);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      if (!(session.messages || []).some((message) => message?.role === 'user')) continue;
      return session;
    } catch {
      /* unreadable or mid-write: skip */
    }
  }
  return null;
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

export async function runCosmosCli(argv, { cwd = process.cwd(), out = process.stdout, err = process.stderr } = {}) {
  const args = [...argv];
  const word = args.shift();
  const verb = cosmosVerb(word);
  const say = (line = '') => out.write(`${line}\n`);
  const json = flag(args, '--json');
  const sayJson = (value) => say(JSON.stringify(value, null, 2));
  try {
    if (!verb && word !== undefined && String(word).trim()) {
      const near = suggestVerb(word);
      err.write(`⚠️ 모르는 명령이에요: ${word}${near ? ` — 혹시 \`cosmos ${near}\`?` : ''}\n   쓸 수 있는 명령: cosmos 도움말\n`);
      return 1;
    }
    if (!verb || verb === 'help') {
      say(HELP);
      return verb ? 0 : 1;
    }
    if (verb === 'universe') {
      const facts = await universeFacts(cwd);
      if (json) sayJson(facts);
      else for (const line of universeLines(facts)) say(line);
      return facts.repository ? 0 : 1;
    }
    if (verb === 'connect') {
      const url = args[0];
      if (!url) throw new Error('사용법: cosmos 연결 <비공개 저장소 URL>');
      assertSafeRemoteUrl(url);
      const result = await connectGalaxy({ remoteUrl: url });
      say(`🌌 은하수 연결됨: ${scrubUrl(result.remote)}`);
      return 0;
    }
    if (verb === 'star') {
      if (args.some((arg) => arg.toLowerCase() === 'phone')) throw new Error('이 기기 종류는 pc 또는 mac 만 고를 수 있어요. 폰은 폰에서 연결하면 저절로 폰으로 보여요.');
      const kind = args.find((arg) => TERMINAL_KINDS.includes(arg.toLowerCase()))?.toLowerCase();
      const name = args.filter((arg) => arg.toLowerCase() !== kind).join(' ').trim();
      const star = name || kind ? await updateStar({ ...(name ? { name } : {}), ...(kind ? { kind } : {}) }) : await ensureStar();
      say(`${kindIcon(star.kind)} 이 기기 이름: ${star.name}`);
      return 0;
    }
    if (verb === 'status' || verb === 'history') {
      const view = await overview({ root: cwd });
      if (json) {
        sayJson(verb === 'history' ? { planet: view.planet ?? null, history: view.seat?.history ?? [] } : view);
        return view.ready ? 0 : 1;
      }
      if (!view.ready) {
        say('🌌 은하수가 아직 연결되지 않았어요. `cosmos 연결 <저장소 URL>`로 시작하세요.');
        return 1;
      }
      if (verb === 'history') {
        const turns = (view.seat?.history ?? []).slice(-12).reverse();
        if (!view.planet?.id) {
          say('🪐 이 폴더는 원격 저장소가 없어 작업 기록이 없어요.');
          return 1;
        }
        say(`📜 ${view.planet.name} 작업 기록 (최근 ${turns.length}번)`);
        if (!turns.length) say('   아직 기록이 없어요. `cosmos 이어받기`를 하면 여기에 쌓여요.');
        const now = Date.now();
        for (const turn of turns) {
          const span = turn.to ? `${clock(turn.from)} ~ ${clock(turn.to)} (${lasted(turn.from, turn.to)})` : `${clock(turn.from)}부터 지금까지 (${lasted(turn.from, now)})`;
          say(`  ${kindIcon(turn.kind)} ${turn.name || '이름 없는 기기'} · ${span}${turn.forced ? ' · ⚠️ 응답이 없어 넘겨받음' : ''}`);
          if (turn.memo) say(`     “${turn.memo}”`);
        }
        return 0;
      }
      const synced = view.syncedAt ? ` · 환경 맞춤 ${ago(view.syncedAt)}` : '';
      say(`🌌 은하수 ${view.remote ? scrubUrl(view.remote) : '(이 기기에만 있음)'}${synced}${view.offline ? `  ⚠️ ${scrubUrlsInText(view.offline)}` : ''}`);
      say('');
      for (const star of view.stars) {
        const beat = star.beat?.at ? ago(star.beat.at) : '신호 없음';
        say(`  ${kindIcon(star.kind)} ${star.name}${star.me ? ' (이 기기)' : ''} · ${beat}`);
      }
      if (view.planet?.id && view.seat) {
        say('');
        const holder = view.seat.holder;
        const label = { mine: '🕹️ 이 기기에서 작업 중', remote: '📱 폰이 이 기기를 통해 작업 중', occupied: `🔒 ${holder?.name} 작업 중`, stale: `⚠️ ${holder?.name} 응답 없음`, empty: '☄️ 아무도 작업하지 않음' }[view.state];
        say(`🪐 ${view.planet.name}: ${label}${holder ? ` · ${ago(holder.since)}부터` : ''}`);
        for (const request of view.seat.requests) say(`   🔁 ${josa(request.name || '다른 기기', '이가')} 넘겨 달라고 요청했어요${request.note ? `: ${request.note}` : ''}`);
        const opensIn = minutesUntil(reservedUntil(view.seat));
        if (view.state === 'empty' && view.seat.handoffTo && opensIn) {
          const target = view.seat.handoffTo === view.star.id ? '이 기기' : view.seat.requests.find((request) => request.star === view.seat.handoffTo)?.name || '다른 기기';
          say(`   ⏳ ${josa(target, '을를')} 위해 비워 둔 자리예요 · ${opensIn}분 뒤에는 누구나 이어받을 수 있어요.`);
        }
        if (view.pendingRescue) say('   ⚠️ 지난 이어받기가 중간에 멈췄어요. `cosmos 이어받기`를 다시 하면 마저 해요.');
        if (view.project?.behind) say(`   ⬇️ 받아올 새 커밋 ${view.project.behind}개`);
        const unsaved = (view.project?.dirty || 0) + (view.project?.ahead || 0);
        if (view.state === 'mine' && unsaved) say(`   💾 아직 올리지 않은 변경 ${unsaved}건 · 떠날 때 \`cosmos 내려놓기\``);
      } else if (view.state === 'no_remote') {
        say('');
        say('🪐 이 폴더는 원격 저장소가 없어 이어달리기에 쓸 수 없어요.');
      }
      return 0;
    }
    if (verb === 'request') {
      const cancel = flag(args, '--cancel');
      const result = await requestTurn({ root: cwd, note: args.join(' '), withdraw: cancel });
      if (result.empty) {
        say('☄️ 지금은 아무도 작업하지 않아요. 요청할 필요 없이 `cosmos 이어받기`로 바로 이어받을 수 있어요.');
        return 0;
      }
      if (result.mine) {
        say('🕹️ 이미 이 기기에서 작업 중이에요.');
        return 0;
      }
      say(
        cancel
          ? '🔁 넘겨 달라는 요청을 취소했어요.'
          : result.updated
            ? '🔁 요청 메모를 바꿨어요.'
            : `🔁 ${result.seat.holder?.name || '작업 중인 기기'}에게 넘겨 달라고 요청했어요.`
      );
      return 0;
    }
    if (verb === 'sun') {
      const force = flag(args, '--force');
      const result = await sun({ root: cwd, force });
      say(`☀️ ${josa(result.planet.name, '을를')} 이어받았어요 (${result.star.name}).`);
      if (result.took) say(`   ⚠️ 응답이 없던 ${result.took.name}에게서 넘겨받았어요.`);
      if (result.moved) say('   📱 폰 작업을 이 기기로 옮겨 이어받았어요.');
      if (result.rescue) {
        say(`   🛟 이 기기에 남아 있던 작업을 ${result.rescue.branch} 브랜치에 보관했어요.`);
        if (!result.rescue.pushed) say('      이 브랜치는 이 기기에만 있어요 (원격 저장소에 올리지 않았어요).');
        for (const finding of result.rescue.secrets || []) say(`      - 비밀 정보가 있어 올리지 않음: ${finding.path}`);
      }
      if (result.rescueFailed) {
        say(`   ⚠️ 이 기기에 남아 있던 작업을 보관하지 못해 그대로 두었어요 (${result.rescueFailed.failed}). 직접 확인해 주세요.`);
      }
      const project = result.project;
      if (project?.pulled) say(`   ⬇️ 새 커밋 ${project.pulled}개를 받았어요.`);
      if (project && !project.ok) say(`   ⚠️ 프로젝트를 최신으로 맞추지 못했어요 (${project.error}). 직접 확인해 주세요.`);
      if (result.environment) say(`   🌌 환경: ${result.environment.down}개 받음, ${result.environment.up}개 올림`);
      if (result.conversation) {
        say(`   💬 이어갈 세션: "${result.conversation.title || '제목 없음'}" (${result.conversation.messageCount}개 메시지, ${result.conversation.star?.name || '?'})`);
        say('      코스모스 데스크톱에서 열면 이 세션을 그대로 이어서 진행해요.');
      }
      return 0;
    }
    if (verb === 'moon') {
      // --force: free the seat even when the project could not be pushed.
      const force = flag(args, '--force');
      const note = args.join(' ').trim();
      const session = await latestSessionFor(cwd);
      const result = await moon({ root: cwd, note, session, forcePush: force });
      say(`🌙 ${josa(result.planet.name, '을를')} 내려놓았어요.`);
      if (result.project?.committed) say('   💾 변경 사항을 커밋했어요.');
      if (result.project?.pushed) say('   ⬆️ 원격 저장소에 올렸어요.');
      if (result.unpushed) {
        say(`   ⚠️ 프로젝트를 원격 저장소에 올리지 않은 채로 내려놓았어요 (${result.unpushed.reason}).`);
        say('      작업은 이 기기에만 있어요. 다른 기기에서 이어받기 전에 이 기기에서 올려 주세요.');
      }
      if (result.conversation) say(`   💬 세션 메시지 ${result.conversation.messageCount}개를 은하수에 올렸어요.`);
      if (result.handoffTo) say('   🔁 넘겨 달라고 요청한 기기를 위해 작업 자리를 비워 두었어요.');
      return 0;
    }
    return 1;
  } catch (error) {
    err.write(`⚠️ ${scrubUrlsInText(error instanceof Error ? error.message : String(error))}\n`);
    if (error?.code === 'push_failed' && error.canForce) err.write('   올리지 않은 채로 내려놓으려면: cosmos 내려놓기 --force\n');
    if (error?.secrets?.length) for (const finding of error.secrets) err.write(`   - ${finding.path}\n`);
    return 2;
  }
}

export { galaxyDir };
