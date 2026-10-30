// 설정 → 은하수: the Galaxy connection, this device's star and the relay
// address phones use for their turn.
import { useEffect, useState } from 'react';
import { CosmosPending, GalaxySetup, StarIdentity } from './CosmosParts';
import { cosmosErrorText } from './cosmos-format';
import { openCosmosGalaxy } from './CosmosHome';
import { refreshCosmos, useCosmos } from './cosmos-store';

/**
 * The address problem the service would refuse, said before anything is sent:
 * wss:// everywhere, ws:// only on this machine, never a user name or password.
 */
export function relayUrlProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return '주소 모양이 아니에요. wss://relay.내도메인.com 처럼 넣어 주세요.';
  }
  if (parsed.username || parsed.password) return '릴레이 주소에는 아이디·비밀번호를 넣을 수 없어요.';
  if (parsed.protocol === 'wss:') return null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'ws:' && local) return null;
  return '릴레이 주소는 wss:// 로 시작해야 해요. (ws:// 는 이 컴퓨터 안에서 개발할 때만 쓸 수 있어요.)';
}

function RelaySetting({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setUrl(current ?? ''), [current]);
  const problem = relayUrlProblem(url);
  const save = async () => {
    if (problem) {
      setMessage({ ok: false, text: problem });
      return;
    }
    try {
      await window.mixdogDesktop?.cosmosSetPreference?.('relayUrl', url.trim() || null);
      setMessage({ ok: true, text: url.trim() ? '저장했어요 · 앱을 다시 시작하면 연결돼요. 다른 기기에도 은하수로 전해져요.' : '릴레이를 껐어요.' });
      void refreshCosmos('', { force: true });
    } catch (error) {
      setMessage({ ok: false, text: cosmosErrorText(error) });
    }
  };
  return (
    <section className="cosmos-card">
      <h3>📱 폰 릴레이 서버</h3>
      <p>
        폰에서 이어받을 때 쓰는 통로예요. 직접 운영하는 릴레이 서버 주소(<code>wss://…</code>)를 넣어 주세요. 세션 내용은 종단간
        암호화되어 서버도 읽을 수 없어요. PC·맥끼리 이어받을 때는 필요 없어요.
      </p>
      <form
        className="cosmos-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setMessage(null);
          }}
          placeholder="wss://relay.내도메인.com"
          aria-label="릴레이 서버 주소"
          aria-invalid={problem ? true : undefined}
          spellCheck={false}
          autoCapitalize="off"
        />
        <button type="submit" className="cosmos-button cosmos-button--plain" disabled={(url.trim() || null) === current}>
          저장
        </button>
      </form>
      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? undefined : 'cosmos-field-error'}>
          {message.text}
        </p>
      ) : (
        problem && <p className="cosmos-field-hint">{problem}</p>
      )}
    </section>
  );
}

export function CosmosSettingsPanel() {
  const entry = useCosmos('');
  const view = entry.view;
  return (
    <div className="cosmos-settings">
      {view ? (
        <>
          {view.ready ? (
            <section className="cosmos-card">
              <h3>🌌 은하수</h3>
              <p>
                연결됨 · <code>{view.remote || '이 기기에만 있음'}</code>
              </p>
              <button type="button" className="cosmos-button cosmos-button--plain" onClick={openCosmosGalaxy}>
                은하수 화면 열기
              </button>
            </section>
          ) : (
            <GalaxySetup projectPath={null} entry={entry} />
          )}
          <StarIdentity projectPath={null} view={view} entry={entry} />
          <RelaySetting current={view.relayUrl ?? null} />
          <button type="button" className="cosmos-button cosmos-button--plain" onClick={openCosmosGalaxy}>연결 준비 상태 보기</button>
        </>
      ) : (
        <CosmosPending projectPath="" entry={entry} />
      )}
    </div>
  );
}
