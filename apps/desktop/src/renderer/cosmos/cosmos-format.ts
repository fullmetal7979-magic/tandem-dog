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
}

const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
const LATIN_BATCHIM = new Set(['l', 'm', 'n', 'r']);

/** Whether a name ends in a final consonant, as read aloud in Korean. */
export function endsWithBatchim(word: string): boolean | null {
  const last = String(word ?? '').trim().slice(-1);
  if (!last) return null;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/\d/.test(last)) return DIGIT_BATCHIM.has(last);
  if (/[a-z]/i.test(last)) return LATIN_BATCHIM.has(last.toLowerCase());
  return null;
}

/** name + 이/가, 을/를, 은/는, 와/과 picked by pronunciation. */
export function josa(name: string, pair: '이가' | '을를' | '은는' | '와과'): string {
  const batchim = endsWithBatchim(name);
  const [withBatchim, without] = { 이가: ['이', '가'], 을를: ['을', '를'], 은는: ['은', '는'], 와과: ['과', '와'] }[pair];
  if (batchim === null) return `${name}${withBatchim}(${without})`;
  return `${name}${batchim ? withBatchim : without}`;
}

export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '기록 없음';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

/** "47분째" / "3시간째" — how long something has been going on. */
export function since(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return '방금부터';
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}시간째` : `${Math.floor(hours / 24)}일째`;
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
      detail: '비공개 GitHub 저장소 하나로 설정·스킬·교신이 모든 기기에 따라다녀요.',
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
      title: '이 행성은 원격 저장소가 없어 이 기기에서만 쓸 수 있어요',
      detail: 'GitHub 등에 저장소를 만들어 올리면 다른 기기와 교대로 이어서 작업할 수 있어요.',
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
    if (reservedForOther) {
      const target = view.stars.find((star) => star.id === seat?.handoffTo);
      return {
        level: 'info',
        icon: '⏳',
        title: `${josa(target?.name || '교대를 요청한 기기', '을를')} 위해 자리를 비워 두었어요`,
        detail: '잠시 뒤에도 앉지 않으면 누구나 앉을 수 있어요.',
        action: 'sun',
      };
    }
    return {
      level: waitingForMe ? 'ok' : 'info',
      icon: '☄️',
      title: waitingForMe ? '내 차례예요 · 이어받아서 계속하세요' : '지금은 아무도 작업하지 않아요',
      detail: [
        lastMoon?.to ? `마지막: ${josa(lastMoon.name, '이가')} ${ago(lastMoon.to, now)} 내렸어요${lastMoon.memo ? ` — “${lastMoon.memo}”` : ''}` : '',
        behind ? `새 커밋 ${behind}개를 받아올게요.` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      action: 'sun',
    };
  }
  if (view.state === 'mine') {
    const request = seat?.requests[0];
    if (request) {
      return {
        level: 'warn',
        icon: '🔁',
        title: `${josa(request.name, '이가')} 교대를 원해요`,
        detail: request.note ? `“${request.note}” · 마무리하면 바로 넘겨줄게요.` : '마무리하면 바로 넘겨줄게요.',
        action: 'handoff',
      };
    }
    return {
      level: unsaved ? 'info' : 'ok',
      icon: '🕹️',
      title: `지금 이 기기에서 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      detail: unsaved ? `아직 올리지 않은 변경 ${unsaved}건 · 떠날 때 내려놓기를 누르면 모두 저장돼요.` : '다른 기기로 옮길 때 내려놓기를 누르세요.',
      action: 'moon',
    };
  }
  if (view.state === 'remote') {
    return {
      level: 'warn',
      icon: '📱',
      title: `${josa(who(seat?.holder), '이가')} 이 PC에서 원격으로 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      detail: '겹쳐 고치지 않도록 여기서는 잠겨 있어요. 폰에서 내려놓기를 누르거나, 지금 이 PC로 되찾을 수 있어요.',
      action: 'reclaim',
    };
  }
  if (view.here && (view.state === 'occupied' || view.state === 'stale')) {
    return {
      level: 'info',
      icon: '💻',
      title: `${josa(who(seat?.holder), '이가')} 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      detail: '지금 연결된 바로 그 PC라서 교대 없이 폰으로 이어갈 수 있어요. 그 PC는 잠겨요.',
      action: 'carry',
    };
  }
  if (view.state === 'occupied') {
    const asked = seat?.requests.some((request) => request.star === me);
    return {
      level: asked ? 'info' : 'warn',
      icon: asked ? '📨' : '🔒',
      title: asked
        ? `교대 요청을 보냈어요 · ${josa(who(seat?.holder), '이가')} 마무리하면 알려 드릴게요`
        : `${josa(who(seat?.holder), '이가')} 작업 중이에요 · ${since(seat?.holder?.since, now)}`,
      detail: asked ? '확인은 1분마다 해요.' : '겹쳐 고치지 않도록 이 기기에서는 잠겨 있어요.',
      action: asked ? 'withdraw' : 'request',
    };
  }
  return {
    level: 'bad',
    icon: '⚠️',
    title: `${josa(who(seat?.holder), '이가')} ${ago(view.holderLastSeen, now)}부터 응답이 없어요`,
    detail: '그 기기가 꺼졌다면 넘겨받을 수 있어요. 그 기기에 남은 작업은 나중에 따로 보관돼요.',
    action: 'force',
  };
}

export const ACTION_LABEL: Record<Exclude<CosmosAction, null>, string> = {
  setup: '🌌 은하수 연결',
  sun: '☀️ 이어받기',
  moon: '🌙 내려놓기',
  handoff: '🌙 내려놓고 넘기기',
  request: '🔁 교대 요청',
  withdraw: '요청 취소',
  force: '⚠️ 강제로 넘겨받기',
  reclaim: '↩️ 이 PC로 되찾기',
  carry: '📱 폰으로 이어하기',
};
