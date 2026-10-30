// Pure presentation rules for the COSMOS relay: Korean particles, relative
// time, device glyphs and the ONE-sentence verdict every surface (home hero,
// titlebar seat badge, Galaxy screen) agrees on.
import type { CosmosOverview, CosmosSeatPerson, CosmosStar, CosmosStarKind } from '../../shared/contract-cosmos';

export type CosmosLevel = 'ok' | 'warn' | 'bad' | 'info';
/** reclaim: this PC takes the seat back from its own phone · carry: the phone takes over from the PC it drives. */
export type CosmosAction = 'setup' | 'sun' | 'moon' | 'handoff' | 'request' | 'withdraw' | 'force' | 'reclaim' | 'carry' | null;

export interface CosmosVerdict {
  level: CosmosLevel;
  icon: string;
  title: string;
  detail: string;
  action: CosmosAction;
  /** What a screen reader hears when the state changes: the title without its ticking clock. */
  live?: string;
}

// The same reading rules as src/runtime/galaxy/words.mjs (the terminal and the
// main process speak through that one); cosmos-format.test.mjs holds them together.
const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
// Spelled-out letters (an acronym is read letter by letter): 엘 엠 엔 알.
const LETTER_NAME_BATCHIM = new Set(['l', 'm', 'n', 'r']);
// Final consonants that stay a 받침 when an English word is read in Korean (맥, 북, 앱, 챗, 픽셀).
const WORD_FINAL_BATCHIM = new Set(['b', 'c', 'k', 'l', 'm', 'n', 'p', 't']);

export type FinalSound = 'open' | 'rieul' | 'closed';

/** How a name ends when read aloud: no 받침, a ㄹ 받침, another 받침, or null when it cannot be told. */
export function finalSound(word: string): FinalSound | null {
  // Trailing emoji, brackets and punctuation are not read: "집 맥북 💻" ends in 북.
  const token = /([\uac00-\ud7a3]+|[A-Za-z]+|[0-9]+)[^\uac00-\ud7a3A-Za-z0-9]*$/u.exec(String(word ?? '').trim())?.[1];
  if (!token) return null;
  const last = token.slice(-1);
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return jong === 0 ? 'open' : jong === 8 ? 'rieul' : 'closed';
  }
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

/** Whether a name ends in a final consonant, as read aloud in Korean. */
export function endsWithBatchim(word: string): boolean | null {
  const sound = finalSound(word);
  return sound === null ? null : sound !== 'open';
}

export type ParticlePair = '이가' | '을를' | '은는' | '와과' | '으로';
const PAIRS: Record<ParticlePair, [string, string]> = { 이가: ['이', '가'], 을를: ['을', '를'], 은는: ['은', '는'], 와과: ['과', '와'], 으로: ['으로', '로'] };

/** name + 이/가, 을/를, 은/는, 와/과, (으)로 picked by pronunciation. */
export function josa(name: string, pair: ParticlePair): string {
  const sound = finalSound(name);
  const [closedForm, openForm] = PAIRS[pair];
  if (sound === null) return `${name}${closedForm}(${openForm})`;
  // 로 also follows a ㄹ 받침: 서울로, 파일로.
  const closed = pair === '으로' ? sound === 'closed' : sound !== 'open';
  return `${name}${closed ? closedForm : openForm}`;
}

export function ago(at: number | null | undefined, now = Date.now()): string {
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

/** "47분째" / "3시간째" / "5일째" / "2주째" — how long something has been going on. */
export function since(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return '방금부터';
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간째`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days}일째` : `${Math.floor(days / 7)}주째`;
}

/** Whole minutes until `at`, at least 1 while it is still ahead; 0 once it has passed. */
export function minutesUntil(at: number | null | undefined, now = Date.now()): number {
  const left = Number(at) - now;
  return left > 0 ? Math.max(1, Math.ceil(left / 60_000)) : 0;
}

/**
 * A name cut to `max` characters with an ellipsis, for SVG labels that cannot
 * wrap. An emoji or a Hangul syllable is never cut in half; the full name
 * belongs in a title/tooltip next to it.
 */
export function clipName(text: string | null | undefined, max: number): string {
  const chars = Array.from(String(text ?? ''));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

export function kindGlyph(kind: CosmosStarKind | string | undefined): string {
  return kind === 'mac' ? '💻' : kind === 'phone' ? '📱' : kind === 'pc' ? '🖥️' : '⭐';
}

export function kindLabel(kind: CosmosStarKind | string | undefined): string {
  return kind === 'mac' ? '맥' : kind === 'phone' ? '폰' : 'PC';
}

/** 0 (fresh) … 1 (long gone): how faded a star is drawn. */
export function starFade(star: Pick<CosmosStar, 'beat' | 'seenAt'>, now = Date.now()): number {
  const last = Math.max(star.beat?.at || 0, star.seenAt || 0);
  if (!last) return 1;
  const hours = (now - last) / 3_600_000;
  if (hours < 0.25) return 0;
  return Math.min(1, Math.log10(1 + hours) / 2);
}

export function isOnline(star: Pick<CosmosStar, 'beat'>, now = Date.now()): boolean {
  return Boolean(star.beat?.at && now - star.beat.at < 12 * 60_000);
}

function who(person: CosmosSeatPerson | null | undefined): string {
  return person?.name || '다른 기기';
}

/** The one sentence (and one action) that describes this planet's relay right now. */
export function cosmosVerdict(view: CosmosOverview | null, now = Date.now()): CosmosVerdict {
  if (!view) return { level: 'info', icon: '✨', title: '은하수 상태를 확인하는 중이에요…', detail: '', action: null };
  if (!view.ready) {
    return {
      level: 'info',
      icon: '🌌',
      title: '은하수를 연결하면 어느 기기에서든 이어서 일할 수 있어요',
      detail: '비공개 GitHub 저장소 하나로 설정·스킬·세션이 모든 기기에 따라다녀요.',
      action: 'setup',
    };
  }
  if (!view.planet) {
    return { level: 'info', icon: '🪐', title: '프로젝트를 열면 누가 작업 중인지 보여요', detail: '', action: null };
  }
  if (view.state === 'no_remote' || !view.planet.id) {
    return {
      level: 'warn',
      icon: '🛰️',
      title: '이 프로젝트는 원격 저장소가 없어 이 기기에서만 쓸 수 있어요',
      detail: 'GitHub 등에 저장소를 만들어 올리면 다른 기기에서 이어받아 작업할 수 있어요.',
      action: null,
    };
  }
  const seat = view.seat;
  const me = view.star.id;
  const project = view.project;
  const behind = project?.behind || 0;
  const unsaved = (project?.dirty || 0) + (project?.ahead || 0);
  if (view.state === 'empty') {
    const waitingForMe = seat?.handoffTo === me;
    const reservedForOther = seat?.handoffTo && seat.handoffTo !== me;
    const lastMoon = seat?.history.at(-1);
    const opensIn = minutesUntil(view.reservedUntil, now);
    if (reservedForOther && (opensIn || !view.reservedUntil)) {
      const target = view.stars.find((star) => star.id === seat?.handoffTo);
      return {
        level: 'info',
        icon: '⏳',
        title: `${josa(target?.name || '넘겨 달라고 요청한 기기', '을를')} 위해 자리를 비워 두었어요`,
        live: `${josa(target?.name || '넘겨 달라고 요청한 기기', '을를')} 위해 자리를 비워 두었어요`,
        detail: opensIn ? `${opensIn}분 뒤에도 이어받지 않으면 누구나 이어받을 수 있어요.` : '잠시 뒤에도 이어받지 않으면 누구나 이어받을 수 있어요.',
        action: 'sun',
      };
    }
    return {
      level: waitingForMe ? 'ok' : 'info',
      icon: '☄️',
      title: waitingForMe ? '내 차례예요 · 이어받아서 계속하세요' : '지금은 아무도 작업하지 않아요',
      detail: [
        lastMoon?.to ? `마지막: ${josa(lastMoon.name, '이가')} ${ago(lastMoon.to, now)} 내려놓았어요${lastMoon.memo ? ` — “${lastMoon.memo}”` : ''}` : '',
        behind ? `새 커밋 ${behind}개를 받아올게요.` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'sun',
    };
  }
  if (view.state === 'mine' && view.pendingRescue) {
    // The last 이어받기 took the seat but stopped before this checkout was
    // set aside and caught up: running it again finishes that part.
    return {
      level: 'warn',
      icon: '⚠️',
      title: '이어받기가 중간에 멈췄어요',
      detail: '이 기기에 남아 있던 예전 작업을 보관하고 최신으로 맞추는 단계가 끝나지 않았어요. 이어받기를 다시 누르면 마저 해요.',
      action: 'sun',
    };
  }
  if (view.state === 'mine') {
    const request = seat?.requests[0];
    if (request) {
      return {
        level: 'warn',
        icon: '🔁',
        title: `${josa(request.name, '이가')} 넘겨 달라고 요청했어요`,
        detail: request.note ? `“${request.note}” · 마무리하면 바로 넘겨줄게요.` : '마무리하면 바로 넘겨줄게요.',
        action: 'handoff',
      };
    }
    return {
      level: unsaved ? 'info' : 'ok',
      icon: '🕹️',
      title: `지금 이 기기에서 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      live: '지금 이 기기에서 작업 중이에요',
      detail: unsaved ? `아직 올리지 않은 변경 ${unsaved}건 · 떠날 때 내려놓기를 누르면 모두 저장돼요.` : '다른 기기로 옮길 때 내려놓기를 누르세요.',
      action: 'moon',
    };
  }
  if (view.state === 'remote') {
    return {
      level: 'warn',
      icon: '📱',
      title: `${josa(who(seat?.holder), '이가')} 이 기기에서 원격으로 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      live: `${josa(who(seat?.holder), '이가')} 이 기기에서 원격으로 작업 중이에요`,
      detail: '겹쳐 고치지 않도록 여기서는 잠겨 있어요. 폰에서 내려놓기를 누르거나, 지금 이 기기로 이어받을 수 있어요.',
      action: 'reclaim',
    };
  }
  if (view.here && (view.state === 'occupied' || view.state === 'stale')) {
    return {
      level: 'info',
      icon: '💻',
      title: `${josa(who(seat?.holder), '이가')} 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      live: `${josa(who(seat?.holder), '이가')} 작업 중이에요`,
      detail: '지금 연결된 바로 그 기기라서 넘겨 달라고 요청하지 않고 폰으로 이어갈 수 있어요. 그 기기는 잠겨요.',
      action: 'carry',
    };
  }
  if (view.state === 'occupied') {
    const asked = seat?.requests.some((request) => request.star === me);
    return {
      level: asked ? 'info' : 'warn',
      icon: asked ? '📨' : '🔒',
      title: asked
        ? `넘겨 달라고 요청했어요 · ${josa(who(seat?.holder), '이가')} 마무리하면 알려 드릴게요`
        : `${josa(who(seat?.holder), '이가')} 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      live: asked ? undefined : `${josa(who(seat?.holder), '이가')} 작업 중이에요`,
      detail: asked ? '확인은 1분마다 해요.' : '겹쳐 고치지 않도록 이 기기에서는 잠겨 있어요.',
      action: asked ? 'withdraw' : 'request',
    };
  }
  return {
    level: 'bad',
    icon: '⚠️',
    title: `${josa(who(seat?.holder), '이가')} ${ago(view.holderLastSeen, now)}부터 응답이 없어요`,
    live: `${josa(who(seat?.holder), '이가')} 응답이 없어요`,
    detail: '그 기기가 꺼졌다면 넘겨받을 수 있어요. 그 기기에 남은 작업은 나중에 따로 보관돼요.',
    action: 'force',
  };
}

/**
 * A failure as the user should read it. Electron wraps main-process errors as
 * "Error invoking remote method 'cosmos:sun': Error: …"; only the last part is
 * meant for people.
 */
export function cosmosErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  // Errors re-thrown across processes stack their prefixes ("Error: TypeError: …").
  const plain = text
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:(?:[A-Z][A-Za-z]*)?Error:\s*)+/, '')
    .trim();
  return plain || '알 수 없는 문제가 생겼어요.';
}

export const ACTION_LABEL: Record<Exclude<CosmosAction, null>, string> = {
  setup: '🌌 은하수 연결',
  sun: '☀️ 이어받기',
  moon: '🌙 내려놓기',
  handoff: '🌙 내려놓고 넘기기',
  request: '🔁 넘겨 달라고 요청',
  withdraw: '요청 취소',
  force: '⚠️ 강제로 넘겨받기',
  reclaim: '↩️ 이 기기로 이어받기',
  carry: '📱 폰으로 이어하기',
};
