// `cosmos` relay commands for the terminal. The desktop app drives the same
// orchestration (cosmos.mjs); these exist so any PC with only a shell can
// still take a turn, hand over, or check the Galaxy.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { connectGalaxy, galaxyDir } from './galaxy-repo.mjs';
import { moon, overview, requestTurn, sun } from './cosmos.mjs';
import { ensureStar, updateStar, STAR_KINDS } from './star.mjs';

const VERBS = {
  sun: ['해', 'sun', 'start', 'sit'],
  moon: ['달', 'moon', 'finish', 'leave'],
  request: ['교대', 'request', 'handover'],
  status: ['은하수', 'status', 'galaxy'],
  connect: ['연결', 'connect'],
  star: ['별', 'star'],
  help: ['help', '--help', '-h', '도움말'],
};

export const COSMOS_VERBS = Object.freeze(Object.values(VERBS).flat());

export function cosmosVerb(word) {
  const value = String(word ?? '').trim();
  for (const [verb, words] of Object.entries(VERBS)) if (words.includes(value)) return verb;
  return null;
}

const HELP = `코스모스 이어달리기 명령

  cosmos 해 [--force]            조종석에 앉기: 최신 작업·환경·교신을 받아 이 기기에서 이어 하기
  cosmos 달 ["메모"]             조종석에서 내리기: 저장·커밋·푸시하고 환경·교신을 은하수에 올리기
  cosmos 교대 ["메모"]           지금 조종 중인 기기에 교대 요청 (취소: cosmos 교대 --cancel)
  cosmos 은하수                  모든 별(기기)과 이 행성의 조종석 상태 보기
  cosmos 연결 <저장소 URL>       은하수(비공개 GitHub 저장소) 연결
  cosmos 별 "<이름>" [pc|mac]    이 기기의 별 이름 정하기

영어 이름도 됩니다: start, finish, request, status, connect, star.`;

const ago = (at) => {
  if (!at) return '기록 없음';
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
};

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
      if (!cwd || relative(root, cwd).startsWith('..')) continue;
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
  const verb = cosmosVerb(args.shift());
  const say = (line = '') => out.write(`${line}\n`);
  try {
    if (!verb || verb === 'help') {
      say(HELP);
      return verb ? 0 : 1;
    }
    if (verb === 'connect') {
      const url = args[0];
      if (!url) throw new Error('사용법: cosmos 연결 <비공개 저장소 URL>');
      const result = await connectGalaxy({ remoteUrl: url });
      say(`🌌 은하수 연결됨: ${result.remote}`);
      return 0;
    }
    if (verb === 'star') {
      const kind = args.find((arg) => STAR_KINDS.includes(arg));
      const name = args.filter((arg) => arg !== kind).join(' ').trim();
      const star = name || kind ? await updateStar({ ...(name ? { name } : {}), ...(kind ? { kind } : {}) }) : await ensureStar();
      say(`${kindIcon(star.kind)} 이 기기의 별: ${star.name}`);
      return 0;
    }
    if (verb === 'status') {
      const view = await overview({ root: cwd });
      if (!view.ready) {
        say('🌌 은하수가 아직 연결되지 않았어요. `cosmos 연결 <저장소 URL>`로 시작하세요.');
        return 1;
      }
      say(`🌌 은하수 ${view.remote || '(이 기기에만 있음)'}${view.offline ? `  ⚠️ ${view.offline}` : ''}`);
      say('');
      for (const star of view.stars) {
        const beat = star.beat?.at ? ago(star.beat.at) : '신호 없음';
        say(`  ${kindIcon(star.kind)} ${star.name}${star.me ? ' (이 기기)' : ''} · ${beat}`);
      }
      if (view.planet?.id && view.seat) {
        say('');
        const holder = view.seat.holder;
        const label = { mine: '🕹️ 내가 조종 중', occupied: `🔒 ${holder?.name} 조종 중`, stale: `⚠️ ${holder?.name} 응답 없음`, empty: '☄️ 조종석 비어 있음' }[view.state];
        say(`🪐 ${view.planet.name}: ${label}${holder ? ` · ${ago(holder.since)}부터` : ''}`);
        for (const request of view.seat.requests) say(`   🔁 ${request.name}이(가) 교대를 원해요${request.note ? `: ${request.note}` : ''}`);
      } else if (view.state === 'no_remote') {
        say('');
        say('🪐 이 폴더는 원격 저장소가 없어 이어달리기에 쓸 수 없어요.');
      }
      return 0;
    }
    if (verb === 'request') {
      const cancel = flag(args, '--cancel');
      const result = await requestTurn({ root: cwd, note: args.join(' '), withdraw: cancel });
      say(cancel ? '🔁 교대 요청을 취소했어요.' : `🔁 ${result.seat.holder?.name || '조종 중인 별'}에게 교대를 요청했어요.`);
      return 0;
    }
    if (verb === 'sun') {
      const force = flag(args, '--force');
      const result = await sun({ root: cwd, force });
      say(`☀️ ${result.planet.name}의 조종석에 앉았어요 (${result.star.name}).`);
      if (result.took) say(`   ⚠️ 응답이 없던 ${result.took.name}에게서 넘겨받았어요.`);
      if (result.rescue) say(`   🛟 이 기기에 남아 있던 작업을 ${result.rescue.branch} 브랜치에 보관했어요.`);
      const project = result.project;
      if (project?.pulled) say(`   ⬇️ 새 커밋 ${project.pulled}개를 받았어요.`);
      if (project && !project.ok) say(`   ⚠️ 프로젝트를 최신으로 맞추지 못했어요 (${project.error}). 직접 확인해 주세요.`);
      if (result.environment) say(`   🌌 환경: ${result.environment.down}개 받음, ${result.environment.up}개 올림`);
      if (result.conversation) {
        say(`   💬 이어갈 교신: "${result.conversation.title || '제목 없음'}" (${result.conversation.messageCount}개 메시지, ${result.conversation.star?.name || '?'})`);
        say('      코스모스 데스크톱에서 열면 이 교신을 그대로 이어서 진행해요.');
      }
      return 0;
    }
    if (verb === 'moon') {
      const note = args.join(' ').trim();
      const session = await latestSessionFor(cwd);
      const result = await moon({ root: cwd, note, session });
      say(`🌙 ${result.planet.name}의 조종석에서 내렸어요.`);
      if (result.project?.committed) say('   💾 변경 사항을 커밋했어요.');
      if (result.project?.pushed) say('   ⬆️ 원격 저장소에 올렸어요.');
      if (result.project && !result.project.ok) say(`   ⚠️ 프로젝트를 올리지 못했어요 (${result.project.error}).`);
      if (result.conversation) say(`   💬 교신 ${result.conversation.messageCount}개 메시지를 은하수에 올렸어요.`);
      if (result.handoffTo) say('   🔁 교대를 요청한 별을 위해 조종석을 비워 두었어요.');
      return 0;
    }
    return 1;
  } catch (error) {
    err.write(`⚠️ ${error instanceof Error ? error.message : String(error)}\n`);
    if (error?.secrets?.length) for (const finding of error.secrets) err.write(`   - ${finding.path}\n`);
    return 2;
  }
}

export { galaxyDir };
