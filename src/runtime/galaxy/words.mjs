// The words COSMOS speaks in the terminal and in refusals: Korean particles
// picked by how a name is read aloud, and relative time. The desktop keeps the
// same rules in apps/desktop/src/renderer/cosmos/cosmos-format.ts (a parity
// test holds the two together).

const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
// Spelled-out letters (an acronym is read letter by letter): 엘 엠 엔 알.
const LETTER_NAME_BATCHIM = new Set(['l', 'm', 'n', 'r']);
// Final consonants that stay a 받침 when an English word is read in Korean
// (맥, 북, 앱, 챗, 픽셀, 시스템). g/d/x/s/r usually do not (블로그, 패드, 맥스, 서버).
const WORD_FINAL_BATCHIM = new Set(['b', 'c', 'k', 'l', 'm', 'n', 'p', 't']);

/**
 * How a name ends when read aloud in Korean: 'open' (no 받침), 'rieul' (a ㄹ
 * 받침, which takes 로 like an open syllable), 'closed' (any other 받침), or
 * null when it cannot be told (an emoji, a symbol).
 */
export function finalSound(word) {
  // Trailing emoji, brackets and punctuation are not read: "집 맥북 💻" ends in 북.
  const token = /([\uac00-\ud7a3]+|[A-Za-z]+|[0-9]+)[^\uac00-\ud7a3A-Za-z0-9]*$/u.exec(String(word ?? '').trim())?.[1];
  if (!token) return null;
  const last = token.slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return jong === 0 ? 'open' : jong === 8 ? 'rieul' : 'closed';
  }
  // 영 일 이 삼 사 오 육 칠 팔 구
  if (/[0-9]/.test(last)) return '178'.includes(last) ? 'rieul' : DIGIT_BATCHIM.has(last) ? 'closed' : 'open';
  const lower = token.toLowerCase();
  if (token.length <= 4 && token === token.toUpperCase()) {
    const letter = lower.slice(-1);
    return letter === 'l' || letter === 'r' ? 'rieul' : LETTER_NAME_BATCHIM.has(letter) ? 'closed' : 'open';
  }
  if (lower.endsWith('ng')) return 'closed';
  // A silent e after n/m/l: phone 폰, game 게임, file 파일.
  if (/[nml]e$/.test(lower) && lower.length > 2) return lower.endsWith('le') ? 'rieul' : 'closed';
  const final = lower.slice(-1);
  if (final === 'l') return 'rieul';
  return WORD_FINAL_BATCHIM.has(final) ? 'closed' : 'open';
}

/** Whether a name ends in a final consonant, as read aloud in Korean; null when it cannot be told. */
export function endsWithBatchim(word) {
  const sound = finalSound(word);
  return sound === null ? null : sound !== 'open';
}

const PAIRS = { 이가: ['이', '가'], 을를: ['을', '를'], 은는: ['은', '는'], 와과: ['과', '와'], 으로: ['으로', '로'] };

/** name + 이/가, 을/를, 은/는, 와/과, (으)로 picked by pronunciation; both forms when it cannot be told. */
export function josa(name, pair) {
  const text = String(name ?? '');
  const forms = PAIRS[pair];
  if (!forms) throw new TypeError(`unknown particle pair: ${pair}`);
  const sound = finalSound(text);
  if (sound === null) return `${text}${forms[0]}(${forms[1]})`;
  // 로 also follows a ㄹ 받침: 서울로, 파일로.
  const closed = pair === '으로' ? sound === 'closed' : sound !== 'open';
  return `${text}${closed ? forms[0] : forms[1]}`;
}

/** "방금" · "5분 전" · "3시간 전" · "4일 전" · "2주 전" · "3개월 전" · "1년 전". */
export function ago(at, now = Date.now()) {
  if (!at) return '기록 없음';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}일 전`;
  if (days < 60) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

/** Whole minutes until `at`, at least 1 while it is still ahead; 0 once it has passed. */
export function minutesUntil(at, now = Date.now()) {
  const left = Number(at) - now;
  return left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : 0;
}
