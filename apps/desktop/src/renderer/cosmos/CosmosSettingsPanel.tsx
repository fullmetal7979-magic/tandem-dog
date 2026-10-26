// 설정 → 은하수: the Galaxy connection, this device's star, the relay
// address phones use for their turn, and the 심플/고급 mode.
import { useEffect, useState } from 'react';
import { GalaxySetup, NewStarChecklist, StarIdentity } from './CosmosParts';
import { openCosmosGalaxy } from './CosmosHome';
import { refreshCosmos, useCosmos } from './cosmos-store';

function RelaySetting({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current ?? '');
  const [message, setMessage] = useState('');
  useEffect(() => setUrl(current ?? ''), [current]);
  const save = async () => {
    try {
      await window.mixdogDesktop?.cosmosSetPreference?.('relayUrl', url.trim() || null);
      setMessage(url.trim() ? '저장했어요 · 앱을 다시 시작하면 연결돼요. 다른 기기에도 은하수로 전해져요.' : '릴레이를 껐어요.');
      void refreshCosmos('', { force: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="cosmos-card">
      <h3>📱 폰 릴레이 서버</h3>
      <p>
        폰으로 차례를 이어받을 때 쓰는 통로예요. 직접 운영하는 릴레이 서버 주소(<code>wss://…</code>)를 넣어 주세요. 대화는 종단간
        암호화되어 서버도 읽을 수 없어요. PC·맥끼리 교대할 때는 필요 없어요.
      </p>
      <form
        className="cosmos-identity-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="wss://relay.내도메인.com" aria-label="릴레이 서버 주소" />
        <button type="submit" className="cosmos-button cosmos-button--plain" disabled={(url.trim() || null) === current}>
          저장
        </button>
      </form>
      {message && <p role="status">{message}</p>}
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
                우주 지도 열기
              </button>
            </section>
          ) : (
            <GalaxySetup projectPath={null} entry={entry} />
          )}
          <StarIdentity projectPath={null} view={view} entry={entry} />
          <RelaySetting current={view.relayUrl ?? null} />
          <NewStarChecklist view={view} />
        </>
      ) : (
        <p className="cosmos-empty-note">✨ 은하수를 살펴보는 중이에요…</p>
      )}
    </div>
  );
}
