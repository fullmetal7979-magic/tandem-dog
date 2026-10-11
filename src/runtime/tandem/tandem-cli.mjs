// `mixdog tandem <sub>`: the cross-platform command line for the Tandem
// virtual session (replaces the POSIX-only .tandem/tandem.sh). All behaviour
// lives in tandem-core.mjs; this file parses arguments and prints results.
//
//   mixdog tandem init [<A-H> ["<account>"]]
//   mixdog tandem context [--no-pull]
//   mixdog tandem status [--no-fetch]
//   mixdog tandem leave "<memo>" ["<next>"] [--no-push]
//   mixdog tandem resume [<branch>] [--no-push]
//   mixdog tandem desk <A-H> ["<account>"]

import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SESSION_REL,
  SLOTS,
  context,
  isValidBranch,
  isValidDesk,
  leave,
  overview,
  readDeskConfig,
  repoRoot,
  resume,
  runGit,
  writeDeskConfig,
  writeSession,
} from './tandem-core.mjs';

export const TANDEM_USAGE_LINES = [
  'Usage: mixdog tandem <command>',
  '',
  'One coding session that follows you across PCs and AI accounts. The session',
  'lives in .tandem/SESSION.md of your git repository.',
  '',
  'Commands:',
  '  init [<A-H> ["<account>"]]    create .tandem/SESSION.md, desk config and the AGENTS.md/CLAUDE.md section',
  '  context [--no-pull]           pull, then print the session an agent should read',
  '  status [--no-fetch]           which PC holds the latest version; one row per desk',
  '  leave "<memo>" ["<next>"]     log, commit, push and publish this PC before you switch (--no-push: stay local)',
  '  resume [<branch>]             fetch, switch to <branch>, pull, log, then print the continue prompt',
  '  desk <A-H> ["<account>"]      name this PC (desk letter) and the AI account used on it',
];

/** The section appended to AGENTS.md and CLAUDE.md by `init`. */
export const TANDEM_AGENT_SECTION = [
  '## Tandem 가상 세션',
  '- 이 저장소는 여러 PC와 여러 AI(Claude, Codex)가 하나의 세션으로 이어서 작업합니다.',
  '- 작업을 시작하기 전에 `mixdog tandem context` 를 실행해 출력된 세션(목표, 현재 상태, 다음 단계, 결정 사항, 작업 로그)을 이전 대화처럼 여기고 이어서 작업하세요. (Mixdog 안에서는 자동으로 들어갑니다.)',
  '- 결정 사항은 반드시 지키세요.',
  "- 작업을 마치면 .tandem/SESSION.md 의 '현재 상태'·'다음 단계'를 고치고 '작업 로그'에 한 줄을 더하세요.",
  '- 사용자가 PC를 옮긴다고 하면 `mixdog tandem leave "한 일" "다음 할 일"` 을 실행하세요.',
  '',
].join('\n');

const AGENT_SECTION_HEADING = /^##[ \t]+Tandem 가상 세션[ \t]*$/m;
const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md'];
const USAGE_EXIT = 2;

class UsageError extends Error {}

// ---------------------------------------------------------------- helpers

/** Split argv into positional arguments and the boolean flags this command knows. */
function splitArgs(args, flags) {
  const positional = [];
  const set = new Set();
  for (const arg of args) {
    if (flags.includes(arg)) set.add(arg);
    else positional.push(String(arg));
  }
  return { positional, flags: set };
}

function expectCount(positional, min, max, usage) {
  if (positional.length < min || positional.length > max) throw new UsageError(`usage: mixdog tandem ${usage}`);
}

/** Terminal columns of a string: Hangul and CJK take two. */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

function formatTable(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => displayWidth(row[col] ?? ''))));
  return rows
    .map((row) =>
      row
        .map((cell, col) => (col === row.length - 1 ? cell : `${cell}${' '.repeat(widths[col] - displayWidth(cell))}`))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectBase(root) {
  const head = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const fromRemote = head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') : '';
  if (isValidBranch(fromRemote)) return fromRemote;
  for (const name of ['main', 'master']) {
    if ((await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])).code === 0) return name;
  }
  const current = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  return isValidBranch(current) && current !== 'HEAD' ? current : 'main';
}

/** Append the Tandem section to an agent instruction file unless it is already there. */
async function ensureAgentSection(root, name) {
  const path = join(root, name);
  let current = null;
  try {
    current = await readFile(path, 'utf8');
  } catch {
    /* missing: created below */
  }
  if (current !== null && AGENT_SECTION_HEADING.test(current)) return 'present';
  const eol = current?.includes('\r\n') ? '\r\n' : '\n';
  const section = TANDEM_AGENT_SECTION.replace(/\n/g, eol);
  let head = '';
  if (current?.trim()) {
    head = current.endsWith(eol + eol) ? current : current + (current.endsWith(eol) ? eol : eol + eol);
  }
  await writeFile(path, head + section, 'utf8');
  return current === null ? 'created' : 'appended';
}

// ---------------------------------------------------------------- commands

async function cmdContext(root, args, out) {
  const { positional, flags } = splitArgs(args, ['--no-pull']);
  expectCount(positional, 0, 0, 'context [--no-pull]');
  out.stdout(`${await context(root, { pull: !flags.has('--no-pull') })}\n`);
  return 0;
}

const LEVEL_TAG = { ok: '좋음', warn: '주의', bad: '문제' };

async function cmdStatus(root, args, out) {
  const { positional, flags } = splitArgs(args, ['--no-fetch']);
  expectCount(positional, 0, 0, 'status [--no-fetch]');
  const ov = await overview(root, { fetch: !flags.has('--no-fetch') });
  const { config, focus } = ov;
  const me = config.desk ? `데스크 ${config.desk} · ${config.tool || '?'}` : '데스크 미지정';
  const lines = [`Tandem 상태 · 이 PC: ${me}`, `브랜치 ${focus.branch} — [${LEVEL_TAG[focus.verdict.level] || focus.verdict.level}] ${focus.verdict.text}`];
  const where = focus.latest.where.map((w) => (w === 'github' ? 'GitHub' : `데스크 ${w}`));
  lines.push(`최신 버전: ${where.length ? where.join(', ') : '알 수 없음'}${focus.latest.localOnly ? ' (아직 푸시 전)' : ''}`);
  if (focus.holder) lines.push(`이어받은 데스크: ${focus.holder}`);
  lines.push('');
  if (focus.rows.length) {
    const rows = [['데스크', '도구', 'PC', `${focus.branch} 상태`, '비고']];
    for (const row of focus.rows) {
      const notes = [];
      if (row.desk === config.desk) notes.push('이 PC');
      if (row.current) notes.push('체크아웃 중');
      if (row.dirty) notes.push(`변경 ${row.dirty}개`);
      if (row.desk === focus.holder) notes.push('이어받음');
      rows.push([row.desk, row.tool || '?', row.host || '?', row.rel.label, notes.join(', ')]);
    }
    lines.push(formatTable(rows));
  } else {
    lines.push('아직 등록된 데스크가 없어요. `mixdog tandem desk A "<계정 이름>"` 으로 이 PC에 이름을 붙이세요.');
  }
  const recent = ov.handoffs.slice(-3);
  if (recent.length) {
    lines.push('', '최근 기록:');
    for (const h of recent) {
      const what = h.kind === 'leave' ? `떠남 (${h.branch})` : h.kind === 'resume' ? `이어받음 (${h.branch})` : h.text;
      lines.push(`- ${h.at} · 데스크 ${h.desk} · ${what}${h.kind === 'leave' && h.memo ? `: ${h.memo}` : ''}`);
    }
  }
  out.stdout(`${lines.join('\n')}\n`);
  return 0;
}

async function cmdLeave(root, args, out) {
  const { positional, flags } = splitArgs(args, ['--no-push']);
  expectCount(positional, 1, 2, 'leave "<memo>" ["<next>"] [--no-push]');
  const [memo, next = ''] = positional;
  if (!memo.trim()) throw new UsageError('usage: mixdog tandem leave "<memo>" ["<next>"] [--no-push]');
  const push = !flags.has('--no-push');
  const r = await leave(root, { memo, next, push });
  out.stdout(`Tandem: ${r.branch} 에 ${r.committed ? '커밋했어요' : '커밋할 변경이 없었어요'}.\n`);
  let code = 0;
  if (!push) {
    out.stdout('Tandem: --no-push 라서 푸시하지 않았어요. 다른 PC에서 이어가려면 푸시가 필요해요.\n');
  } else if (r.pushed) {
    out.stdout('Tandem: 푸시했어요.\n');
  } else {
    out.stderr(`(Tandem: 푸시 실패 - 네트워크나 권한을 확인하세요.)${r.pushError ? `\n${r.pushError}` : ''}\n`);
    code = 1;
  }
  if (!r.published) {
    out.stdout('Tandem: 데스크가 정해지지 않아 상태는 공개하지 않았어요. `mixdog tandem desk A "<계정 이름>"` 으로 정하세요.\n');
  } else if (push && r.published.pushed) {
    out.stdout('Tandem: 이 PC의 상태를 공개했어요. 다른 PC에서 `mixdog tandem status` 로 볼 수 있어요.\n');
  } else if (push) {
    out.stderr(`(Tandem: 이 PC의 상태를 공개하지 못했어요.${r.published.error ? ` ${r.published.error}` : ''})\n`);
  }
  return code;
}

async function cmdResume(root, args, out) {
  const { positional, flags } = splitArgs(args, ['--no-push']);
  expectCount(positional, 0, 1, 'resume [<branch>] [--no-push]');
  const [branch = null] = positional;
  if (branch !== null && !isValidBranch(branch)) throw new UsageError(`invalid branch name: ${JSON.stringify(branch)}`);
  const r = await resume(root, { branch, push: !flags.has('--no-push') });
  if (!r.pulled) out.stderr(`(Tandem: pull 중 충돌 - 해결 후 다시 실행하세요.)${r.pullError ? `\n${r.pullError}` : ''}\n`);
  out.stderr(`Tandem: ${r.branch} 를 최신으로 맞추고 이어받기를 기록했어요.\n`);
  out.stdout(`${r.prompt}\n`);
  return 0;
}

async function cmdDesk(root, args, out) {
  const { positional } = splitArgs(args, []);
  expectCount(positional, 0, 2, 'desk <A-H> ["<account>"]');
  if (positional.length === 0) {
    const cfg = await readDeskConfig(root);
    out.stdout(`Tandem: 이 PC = ${cfg.desk ? `데스크 ${cfg.desk} (${cfg.tool || '?'})` : '데스크 미지정'}\n`);
    out.stdout('바꾸려면: mixdog tandem desk <A-H> ["<account>"]\n');
    return 0;
  }
  const desk = positional[0].trim().toUpperCase();
  if (!isValidDesk(desk)) throw new UsageError(`desk must be one of ${SLOTS.join(', ')} (got ${JSON.stringify(positional[0])})`);
  await writeDeskConfig(root, { desk, tool: positional[1] ?? null });
  const cfg = await readDeskConfig(root);
  out.stdout(`Tandem: 이 PC = 데스크 ${cfg.desk} (${cfg.tool || '?'})\n`);
  return 0;
}

async function cmdInit(root, args, out) {
  const { positional } = splitArgs(args, []);
  expectCount(positional, 0, 2, 'init [<A-H> ["<account>"]]');
  let desk = null;
  if (positional.length) {
    desk = positional[0].trim().toUpperCase();
    if (!isValidDesk(desk)) throw new UsageError(`desk must be one of ${SLOTS.join(', ')} (got ${JSON.stringify(positional[0])})`);
  }
  const done = [];

  if (await pathExists(join(root, SESSION_REL))) {
    done.push(`- ${SESSION_REL}: 이미 있어요 (그대로 둠)`);
  } else {
    await writeSession(root, { goal: '', state: '', next: '', decisions: [], log: [] });
    done.push(`- ${SESSION_REL}: 새로 만들었어요`);
  }

  const base = (await pathExists(join(root, '.tandem', 'base'))) ? null : await detectBase(root);
  await writeDeskConfig(root, { desk, tool: positional[1] ?? null, base });
  const cfg = await readDeskConfig(root);
  done.push(`- 이 PC: ${cfg.desk ? `데스크 ${cfg.desk} (${cfg.tool || '?'})` : '데스크 미지정'} · 기준 브랜치 ${cfg.base}`);

  const words = { created: '새로 만들었어요', appended: 'Tandem 섹션을 추가했어요', present: '이미 Tandem 섹션이 있어요 (그대로 둠)' };
  for (const name of AGENT_FILES) done.push(`- ${name}: ${words[await ensureAgentSection(root, name)]}`);

  const steps = [];
  steps.push(`${SESSION_REL} 의 '목표'를 채우세요.`);
  if (!cfg.desk) steps.push('이 PC에 이름을 붙이세요: mixdog tandem desk A "<계정 이름>"');
  steps.push('저장소에 올리세요: git add .tandem AGENTS.md CLAUDE.md && git commit -m "tandem: init" && git push');
  steps.push('다른 PC에서는: git pull → mixdog tandem desk B "<계정 이름>" → mixdog tandem resume');
  steps.push('PC를 옮길 때: mixdog tandem leave "한 일" "다음 할 일"');
  out.stdout(`Tandem을 준비했어요.\n${done.join('\n')}\n\n다음 단계:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`);
  return 0;
}

const COMMANDS = { context: cmdContext, status: cmdStatus, leave: cmdLeave, resume: cmdResume, desk: cmdDesk, init: cmdInit };

/**
 * Run `mixdog tandem <args...>` and resolve the exit code (0 ok, 1 failed,
 * 2 bad usage). Output goes through `stdout`/`stderr` writers so tests and
 * hosts can capture it.
 */
export async function runTandemCli(args = [], { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const out = { stdout: (text) => stdout.write(text), stderr: (text) => stderr.write(text) };
  const [sub, ...rest] = args.map((arg) => String(arg ?? ''));
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    const text = `${TANDEM_USAGE_LINES.join('\n')}\n`;
    if (sub) out.stdout(text);
    else out.stderr(text);
    return sub ? 0 : USAGE_EXIT;
  }
  const command = COMMANDS[sub.toLowerCase()];
  if (!command) {
    out.stderr(`mixdog tandem: unknown command ${JSON.stringify(sub)}\n${TANDEM_USAGE_LINES.join('\n')}\n`);
    return USAGE_EXIT;
  }
  try {
    let root;
    try {
      root = await repoRoot(cwd);
    } catch {
      out.stderr('Tandem: git 저장소 안에서 실행하세요. (git이 설치되어 있어야 해요.)\n');
      return 1;
    }
    return await command(root, rest, out);
  } catch (error) {
    if (error instanceof UsageError) {
      out.stderr(`mixdog tandem: ${error.message}\n`);
      return USAGE_EXIT;
    }
    out.stderr(`mixdog tandem ${sub}: ${error?.message || String(error)}\n`);
    return 1;
  }
}
