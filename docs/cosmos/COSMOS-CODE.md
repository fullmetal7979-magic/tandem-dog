# COSMOS CODE · 코스모스 코드

> 하나의 행성이 자신의 우주를 짓는다.

COSMOS CODE는 Mixdog 기반 COSMOS의 새 이름이자 앞으로의 발전 방향이다. 이 문서는 세 가지를 정한다. 제품의 철학과 우주 문법, OpenCode 분석에서 가져올 설계, 우리만의 기능 지도다. 다음 담당자는 이 문서와 [설계](DESIGN.md)부터 읽는다.

## 1. 이름

- 제품 이름은 **COSMOS CODE (코스모스 코드)**, 줄여서 COSMOS다. 화면의 표기와 문서부터 바꾼다.
- 명령은 `cosmos`를 유지하고 옛 이름 `mixdog`도 계속 동작한다. 앱 번들 `COSMOS.app`, 사용자 데이터 경로, 프로토콜 식별자는 호환성 때문에 바꾸지 않는다.

## 2. 철학 — 우주 문법

코드를 만드는 일을 우주가 생겨나는 일로 본다. 프로젝트 하나가 행성이고, 그 행성이 만든 모든 것이 하늘을 채운다. 우주는 바깥에 따로 있지 않다. 만드는 손끝에서 시작된다.

| 우주의 이름 | 실제로는 | 화면에서 |
|---|---|---|
| 🪐 행성 | 프로젝트(저장소) | 홈 가운데의 행성. 이름에서 나온 고유한 색 |
| ✦ 빛 | 커밋 | 나선 팔 위의 빛. 행성에 가까울수록 최근, 지평선에 가까울수록 오래됨 |
| 첫 빛 | 루트 커밋 | 십자 광채 |
| 이름 붙은 빛 | 태그 | 십자 광채와 태그 이름 |
| 두 길이 만난 빛 | 병합 커밋 | 조금 더 큰 빛 |
| ☁︎ 성운 | 커밋 전 변경 파일 | 행성 곁을 도는 입자 |
| 매인 빛 | 푸시 전 커밋 | 행성과 점선 실로 이어짐 |
| ⭐ 별 | 내 기기 | 기기 지도(기존) |
| 🌌 은하수 | 비공개 동기화 저장소 | 은하수 화면(기존) |
| ☀️ 해 / 🌙 달 | 작업 시작 / 저장하고 넘기기 | 홈의 큰 버튼(기존) |
| 🕹️ 조종석 | 한 번에 한 기기만 작업 | 잠금 화면(기존) |
| 별자리 | 교대 기록 | 교대 타임라인(기존) |

철학에서 나온 설계 규칙:

1. **모든 빛은 행성에서 태어난다.** 의미를 가진 빛은 전부 실제 데이터에서 나온다. 데이터가 없는 장식은 배경 먼지뿐이다.
2. **시적인 이름 옆에는 쉬운 말.** `빛 128 · 커밋`, `성운 7 · 커밋 전 변경`처럼 둘을 함께 쓴다. 색과 모양만으로 상태를 알리지 않는다.
3. **우주는 조용하다.** 움직임은 느리고 초당 30프레임을 넘지 않는다. 동작 줄이기, 작업 효과 끄기, 숨긴 창, 화면 밖에서는 멈춘다.
4. **같은 행성은 어느 기기에서나 같은 하늘.** 색과 위치는 이름과 커밋 해시에서 정해진다. 새 커밋이 생겨도 기존 빛은 자리를 지키고 조금씩 바깥으로 밀려날 뿐이다.
5. **지운 것도 궤적으로 남는다.** 되돌릴 수 있다는 감각을 화면에서 보여 준다(시간 되감기, 아래 5장).

하늘에는 날마다 한 문장이 뜬다. 같은 날 같은 행성에서는 바뀌지 않는다. 문장 목록은 `apps/desktop/src/renderer/cosmos/universe-model.ts`의 `COSMOS_VERSES`에 있다.

## 3. OpenCode 분석

기준: [sst/opencode](https://github.com/sst/opencode) `dev` 브랜치 `2e29481`(2026-10-30). MIT 라이선스. 이 작업은 구조와 아이디어만 참고했고 코드는 가져오지 않았다. 앞으로 코드를 옮겨 오면 `NOTICE.md`와 `LICENSES/`에 MIT 고지를 추가한다.

### 구조

Bun과 Effect 기반 TypeScript 모노레포이고 패키지가 약 40개다.

- `core`: 화면 없는 엔진. 세션·에이전트·권한·도구·스냅샷·MCP·스킬·프로바이더.
- `schema`·`protocol` → `server`(HttpApi) → `client`(생성된 SDK). 의존 방향이 한쪽으로만 흐른다.
- 화면: `tui`(터미널), `app`(웹), `desktop`. 모두 같은 서버에 붙는다.
- `plugin`: 공개 플러그인 API. `sdk`는 client·core·server를 묶는다.

### 가져올 만한 설계

1. **엔진과 화면의 분리.** 백그라운드 서비스 하나에 터미널·웹·데스크톱이 동시에 붙는다. 화면을 더해도 엔진은 그대로다.
2. **모든 것이 플러그인.** 기본 에이전트·명령·스킬·프로바이더·웹 검색·VCS까지 내장 플러그인으로 등록된다. 플러그인은 `ctx.<영역>.transform(editor => …)`로 레지스트리를 편집하고, `tool.execute.before` 같은 훅으로 동작에 끼어든다. 등록은 플러그인 범위에 묶여서 플러그인이 닫히면 자동으로 풀린다.
3. **에이전트는 모드와 권한의 묶음.** 주 에이전트 `build`(기본)와 `plan`(읽기 전용)을 Tab으로 바꾸고, 하위 에이전트 `general`·`explore`를 따로 둔다.
4. **권한 규칙.** `{action, resource, effect: allow | ask | deny}` 와일드카드 규칙을 에이전트마다 둔다. 거절할 때 남긴 피드백을 모델에 돌려준다. 사람이 없는 예약 실행에는 별도 규칙을 쓴다.
5. **단계별 스냅샷.** git 기반 스냅샷으로 단계마다 diff를 만들고 파일 단위로 되돌린다.
6. **숨은 보조 에이전트.** 제목·요약·압축을 각자 짧은 지침을 가진 숨은 에이전트가 맡는다.
7. **역할 기반 테마 토큰.** 색이 아니라 의미(피드백·폼·동작)로 토큰을 고르고, 없으면 스키마부터 늘린다.

### 하지 않을 것

OpenCode를 포크해서 새로 시작하지 않는다. 기기 간 이어달리기(조종석·은하수·릴레이·폰)와 데스크톱 작업 공간은 COSMOS가 이미 앞서 있다. 런타임(Node·Electron)도 다르다. 위 설계를 COSMOS 구조에 맞춰 옮긴다.

### 대응표

| OpenCode | COSMOS 현재 | 다음 단계 |
|---|---|---|
| 헤드리스 엔진 + HTTP 서버 + SDK | `src/session-runtime`, 세션 데몬, 데스크톱 IPC | 공개 계약·SDK 없음 → **궤도 API** |
| 플러그인 transform·훅 | `src/session-runtime/services/hook-bus`, 내장 스킬(`src/defaults`) | 레지스트리 편집형 확장 없음 → **위성** |
| build/plan 에이전트 | `src/agents`(worker·reviewer·security …), `src/workflows` | 읽기 전용 모드 전환 → **관측/창조** |
| 권한 규칙 | `hook-bus/tool-gate.mjs`, 승인 카드 | 한 파일·한 모델의 규칙 → **중력 규칙** |
| 스냅샷·되돌리기 | `src/runtime/workbench/snapshots.mjs`, 복원 지점 | 우주 화면에 연결 → **시간 되감기** |
| 제목·요약·압축 | 세션 제목, 압축 runner | 유지 |
| 여러 화면이 한 서버에 | 은하수·릴레이·폰 | COSMOS가 앞섬. 유지·강화 |

## 4. 기능 지도

✅ 구현됨 · ▶ 다음 · ○ 이후

| | 기능 | 설명 |
|---|---|---|
| ✅ | **행성의 우주** | 홈 화면. 프로젝트의 git 기록으로 그린 은하. 빛을 가리키면 그 커밋의 제목·작성자·시간을 보여 준다. 새 커밋이 생기면 빛 하나가 행성에서 떠나 자리를 잡는다 |
| ✅ | 이어달리기 | 조종석·해·달·교대·은하수·별·릴레이(기존) |
| ✅ | **터미널의 우주** | `cosmos 우주`·`cosmos 기록`·`--json`. 화면과 같은 말(조사 규칙 `galaxy/words.mjs`)과 같은 시구 |
| ✅ | **개선 100** | 비밀 보호·원자적 쓰기·조종석 규칙·대화 색인·키보드 탐색·▶ 실행 소스 확장·릴레이 종료. [IMPROVEMENTS-100.md](IMPROVEMENTS-100.md) |
| ▶ | **위성** (확장) | OpenCode transform 패턴의 COSMOS판. 아래 초안 |
| ▶ | **관측 / 창조** | Tab으로 전환. 관측은 읽기 전용(편집 거부, 명령은 확인), 창조는 기본 모드 |
| ▶ | **중력 규칙** | `allow·ask·deny` 와일드카드 규칙을 프로젝트 파일 하나에. 마지막으로 맞는 규칙이 이긴다. 무인 실행용 규칙을 분리 |
| ○ | **시간 되감기** | 빛을 눌러 그 커밋의 diff와 복원 지점을 연다. 성운을 작업 스냅샷과 잇는다 |
| ○ | **궤도 API** | 엔진의 HTTP 계약과 생성 SDK. 웹·폰·CLI가 같은 엔진을 쓴다 |
| ○ | **성단** | 은하수에 등록된 여러 행성을 하나의 지도로 |

### 위성 초안

설계 초안이다. 아직 구현하지 않았다.

```js
// .cosmos/satellites/reviewer-kr/index.mjs
export default {
  id: 'reviewer-kr',
  setup(orbit) {
    orbit.agent.transform((agents) => {
      agents.update('reviewer-kr', (agent) => {
        agent.mode = 'subagent';
        agent.description = '한국어로 회귀 위험을 검토한다';
      });
    });
    orbit.on('tool.before', (event) => {
      if (event.tool === 'shell' && /rm -rf/.test(event.input.command)) event.deny('위험한 삭제');
    });
  },
};
```

- 궤도(편집 가능한 영역): `agent`·`command`·`skill`·`tool`·`theme`부터 시작한다.
- 등록은 위성 범위에 묶고 위성을 끄면 자동으로 해제한다.
- 비밀값은 은하수와 같은 규칙으로 다룬다. `${secret}` 자리표시만 동기화한다.
- 은하수에 위성 목록을 올려 다른 기기에서도 같은 궤도를 쓴다.

## 5. 행성의 우주 — 구현 메모

| 파일 | 역할 |
|---|---|
| `apps/desktop/src/renderer/cosmos/universe-model.ts` | 순수 계산: 배치, 색, 문장, 칩, 요약 |
| `apps/desktop/src/renderer/cosmos/universe-canvas.ts` | Canvas 2D 화가. React 없음 |
| `apps/desktop/src/renderer/cosmos/CosmosUniverse.tsx` | 데이터 읽기, 크기·가시성 감시, 글자 층 |
| `apps/desktop/src/renderer/cosmos/cosmos-universe.test.mjs` | 모델·화면 테스트 |
| `apps/desktop/src/renderer/desktop/40-cosmos.css` | `.cosmos-universe*` 스타일 |

- **데이터**: 기존 IPC `gitLog(cwd, '', 0, 240)`와 `gitStatus(cwd, { skipLineStats: true })`만 쓴다. 새 IPC는 없다. 처음 보일 때, 창 포커스 때, 보이는 동안 60초마다 읽는다.
- **배치**: 최신 커밋이 반지름 0.2, 가장 오래된 커밋이 1. 팔과 흩어짐은 커밋 해시에서 정한다. 그래서 새 커밋이 와도 하늘이 뒤섞이지 않는다.
- **성능**: 정적인 하늘은 한 번만 그려 둔다. 빛의 광채는 색상 30°마다 스프라이트를 재사용한다. 초당 최대 30프레임. 동작 줄이기, `data-workbench-effects=off`, `data-app-hidden=true`, 숨긴 문서, 화면 밖, 크기 0에서는 정지 화면 한 장만 그린다.
- **접근성**: 캔버스는 `aria-hidden`. 같은 내용을 글자 층과 `sr-only` 요약으로 전한다. 홈의 실시간 알림 영역은 조종석 상태 하나만 유지한다.
- **테마**: 우주 창은 두 테마 모두 어둡다. 밤하늘은 깊은 밤, 새벽은 지평선에 첫 빛이 걸린 밤이다.

## 6. 검증

```sh
cd apps/desktop
node --import ./scripts/test-env.mjs --import tsx ../../scripts/test-direct.mjs \
  src/renderer/cosmos/cosmos-universe.test.mjs src/renderer/cosmos/cosmos-store.test.mjs src/renderer/cosmos/cosmos-visuals.test.mjs
npm run typecheck
```

화면 확인에는 실제 컴포넌트·CSS와 이 저장소의 git 기록을 쓰는 Vite 하네스를 썼다. 커밋 29개·240개·빈 저장소·프로젝트 없음, 밤하늘·새벽, 너비 760·420px, 빛 가리키기, 새 커밋 탄생을 확인했다. 하네스는 저장소에 두지 않았다.

## 7. 다음 담당자에게

- 빛은 이제 키보드로도 오간다(←→, Home/End, 엔터 키로 해시 복사). 시간 되감기는 이 탐색 위에 diff·복원 지점을 여는 것으로 잇는다.
- 기록은 최근 240개까지 그린다. 그보다 오래된 빛은 지평선 너머로 보고 `240+`로 표시한다.
- `desktop/workbench-feedback.css`의 `.cosmos-home--focused .cosmos-home-head` 규칙은 이제 쓰이지 않는다. 작업 도구 쪽 동시 작업과 겹치지 않도록 이번에는 손대지 않았다.
- 창 제목, 첫 실행 마법사, 설치 앱 이름의 표기 변경은 패키징·배포 검증이 필요해서 다음 단계로 남겼다.
