// Trust and autonomy. A character earns the user's trust by doing good work
// and by asking before it acts; trust decides how much it may do without
// asking. The user's own cap (settings.autonomyCap) always wins, and some
// actions are asked about, or refused, whatever the trust.
import { clamp, round1 } from '../util.mjs';

export const TIERS = [
  { tier: 1, min: 0, name: '신입', emoji: '🐣', desc: '화면 보기·읽기만 혼자 하고, 클릭·입력·파일 수정은 하나하나 물어봐요.' },
  { tier: 2, min: 25, name: '견습', emoji: '🌱', desc: '전용 브라우저와 자기 작업 폴더 안에서는 혼자 조작해요. 맡겨 준 폴더·내 컴퓨터는 물어봐요.' },
  { tier: 3, min: 50, name: '믿음직', emoji: '🤝', desc: '맡겨 준 폴더 작업과 네트워크 명령도 혼자 해요. 내 컴퓨터 조작은 물어봐요.' },
  { tier: 4, min: 75, name: '오른팔', emoji: '🦾', desc: '내 컴퓨터 조작까지 혼자 해요. 결과가 큰 일(구매·전송·삭제·로그인)은 언제나 먼저 물어봐요.' },
];
export const START_TRUST = 10;

export function tierOf(trust) {
  return [...TIERS].reverse().find((entry) => (trust ?? 0) >= entry.min) ?? TIERS[0];
}

// The tier actually in effect: earned trust, capped by the user's setting.
export function effectiveTier(character, settings = {}) {
  const earned = tierOf(character.userBond?.trust ?? START_TRUST).tier;
  const cap = clamp(Math.round(Number(settings.autonomyCap ?? 2)), 1, 4);
  return Math.min(earned, cap);
}

// Trust moves slowly and is bounded per task so one long session cannot
// farm it. Returns the tier change, if any.
export function adjustTrust(character, delta) {
  const bond = character.userBond;
  const before = tierOf(bond.trust ?? START_TRUST);
  bond.trust = round1(clamp((bond.trust ?? START_TRUST) + delta, 0, 100));
  const after = tierOf(bond.trust);
  return after.tier !== before.tier ? { from: before, to: after } : null;
}

// ---- risk classification -----------------------------------------------------------

// Read-only screen members never change anything.
const SCREEN_READ = new Set(['screenshot', 'zoom', 'cursor_position', 'wait', 'mouse_move', 'scroll']);

// Shell: commands that are refused outright, whatever anyone approves.
const REFUSED = [
  /(^|[\s;&|(])sudo(\s|$)/, /(^|[\s;&|(])su(\s|$)/, /\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]+\s+)*(\/|~|\$HOME|\/\*)(\s|$)/,
  /\bmkfs\b/, /\bdd\b[^\n]*\bof=\/dev\//, /:\(\)\s*\{/, /\b(shutdown|reboot|halt|poweroff)\b/, /\blaunchctl\b/, /\bdiskutil\s+(erase|partition|zero)/,
  /\bcsrutil\b/, /\bnvram\b/, /\bsecurity\s+(find|dump|delete)-/, /\b(chmod|chown)\s+-R\s+[^\s]*\s+\/(\s|$)/, />\s*\/dev\/(disk|sd|nvme)/,
  /\bcrontab\s+-r\b/, /\bkillall\b/, /\bpkill\b/, /\bosascript\b/, /\bdefaults\s+write\b/,
];
const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'rg', 'find', 'pwd', 'echo', 'printf', 'file', 'stat', 'du', 'df', 'which', 'date',
  'sort', 'uniq', 'cut', 'tr', 'jq', 'column', 'diff', 'tree', 'basename', 'dirname', 'realpath', 'md5', 'shasum', 'sha256sum', 'true', 'test', 'mdls',
]);
const NETWORK = /\b(curl|wget|pip3?\s+install|npm\s+(i|install|ci|add)|npx|yarn|pnpm|brew|git\s+(clone|pull|push|fetch)|ssh|scp|rsync|nc|telnet|ftp)\b/;

// 'refuse' | 'read' | 'write' | 'network'
export function classifyCommand(command) {
  const text = String(command ?? '').trim();
  if (!text) return 'read';
  if (REFUSED.some((pattern) => pattern.test(text))) return 'refuse';
  if (NETWORK.test(text)) return 'network';
  // Read-only only when every piped stage is a read-only program and nothing
  // is redirected or chained.
  if (/[;&`]|\$\(|>|<\(/.test(text)) return 'write';
  const stages = text.split('|').map((part) => part.trim().split(/\s+/)[0]);
  const findWrites = /\bfind\b[^|]*\s-(delete|exec|execdir|ok|fprint)/.test(text);
  if (!findWrites && stages.every((program) => READ_ONLY.has(program))) return 'read';
  return 'write';
}

const EDIT_READ = new Set(['view']);

// Decides one action: 'auto' (go), 'ask' (needs the user's OK) or 'refuse'.
// `ctx`: { tier, sandboxed, ownFolder, allowAll }
export function decide(tool, input, ctx) {
  const { tier, sandboxed = false, ownFolder = true, allowAll = false } = ctx;
  switch (tool) {
    case 'browser': {
      if (SCREEN_READ.has(input.name) || input.name === 'read_page') return 'auto';
      if (allowAll) return 'auto';
      if (input.name === 'browser_open') return tier >= 2 || input.fromTask ? 'auto' : 'ask';
      return tier >= 2 ? 'auto' : 'ask';
    }
    case 'desktop': {
      if (input.name === 'screenshot' || input.name === 'zoom' || input.name === 'cursor_position' || input.name === 'wait') return 'auto';
      if (allowAll) return 'auto';
      return tier >= 4 ? 'auto' : 'ask';
    }
    case 'files': {
      if (EDIT_READ.has(input.command)) return 'auto';
      if (allowAll) return 'auto';
      return tier >= (ownFolder ? 2 : 3) ? 'auto' : 'ask';
    }
    case 'shell': {
      const risk = classifyCommand(input.command);
      if (input.restart) return 'auto';
      if (risk === 'refuse') return 'refuse';
      if (risk === 'read') return 'auto';
      if (allowAll) return 'auto';
      // Without a sandbox the command could write anywhere: always ask.
      if (!sandboxed) return 'ask';
      if (risk === 'network') return tier >= 3 ? 'auto' : 'ask';
      return tier >= (ownFolder ? 2 : 3) ? 'auto' : 'ask';
    }
    default:
      return 'ask';
  }
}

export function trustPublic() {
  return TIERS;
}
