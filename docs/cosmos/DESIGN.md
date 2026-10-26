# COSMOS 개발 작업 공간

## 2026-10-26 개선 결정

| 조사 결과 | 구현한 개선·제거 | 확인 방법 |
|---|---|---|
| 심플/고급 전환이 창을 다시 불러오고 개발 도구를 숨김 | 작업 공간을 하나로 통합. 기존 모드 설정을 받아도 새로고침하지 않음 | task-session-history.test.mjs |
| 추론 프리셋과 추론 강도 선택이 같은 값을 중복 제어 | 중복 프리셋 제거. 모델별 추론 강도·속도 선택 유지 | development-chat-ui.test.mjs |
| 모델 변경으로 세션 목록이 늘어나 작업이 나뉘어 보임 | 원본 기록을 보존하며 이어받기. 작업 ID로 묶고 이력 버튼으로 이전 모델 기록 확인 | desktop-session-metadata-favorite.test.mjs, task-session-history.test.mjs |
| 입력·첨부파일이 창 재시작 때 소실 | 기기 내 IndexedDB에 자동 복구 저장. 작업별 분리, 최근 20개·7일·전체 256M 문자 예산 | composer-draft-store.slow.test.mjs |
| 토큰 수만으로 비용을 통제하기 어려움 | 다음 입력량·입력 가치 추정, 요청별 토큰·USD·모델 요청 횟수 한도 | execution-budget.test.mjs, context-status.test.mjs |
| 기존 대화에도 새 대화용 컨텍스트 조절기가 표시됨 | 새 대화에만 표시. 이미 시작한 대화는 실제 컨텍스트 상태 사용 | RouteEditor.tsx |
| 은하수 연결 화면이 왼쪽 250px 패널에서 잘림 | 카드의 최소 너비 해제, 연결 버튼 줄바꿈, 입력·저장 버튼 자동 줄 배치, 체크리스트 버튼 열 수정 | galaxy-pane-layout.slow.test.mjs: 220/252/320/520px, 확대 75/100/150% |
| 맥 창 버튼과 제목이 겹침 | 네이티브 Window Controls Overlay 영역을 CSS 안전 여백으로 사용 | titlebar-mac.slow.test.mjs: 400/1040px, 확대 75/100/150% |
| 맥 편집 단축키와 작업 공간 단축키 충돌 | Cmd+Q 앱 종료·Cmd+방향키 텍스트 편집 보존, 단축키 도움말을 공통 레지스트리에서 생성 | app-workspace-shortcuts.test.mjs, composer-focus.slow.test.mjs |
| 옛 Tandem 데스크톱 API와 새 Galaxy 기능 중복 | 사용되지 않는 데스크톱 Tandem IPC·계약·서비스 제거, Git 실행기를 shared로 분리 | main 타입 검사, Galaxy·Tandem 런타임 테스트 |
| 컴퓨터 제어 실행 파일이 임시 no-op 파일인 경우에도 패키징 성공 | 아키텍처·버전 응답 검증, 바이너리 SHA-256을 런타임 입력 지문에 포함 | computer-native-validation.test.mjs |
| macOS 배포 스크립트가 옛 앱 이름·아키텍처를 사용 | COSMOS 번들/식별자, Intel x64·Apple Silicon arm64 분기, 해당 데몬만 재시작 | dev-update-mac.test.mjs, desktop-local.test.mjs |

## 개발 채팅과 모델 변경

모델 메뉴에서 공급자·모델 이름을 검색하고 자주 쓰는 모델을 고정한다. `Cmd/Ctrl+Shift+M`으로 메뉴를 열 수 있다. 모델별 컨텍스트 크기·이미지 입력 지원을 표시한다. 계정 인증은 기존 공급자 설정을 사용한다.

대화가 없는 탭에서는 선택한 모델로 새 대화를 시작한다. 대화가 있으면 원본을 바꾸지 않고 다른 모델의 대화로 이어받아 같은 탭을 교체한다. 입력 중인 내용과 첨부파일·사용 한도를 함께 넘긴다. 실행 중이거나 대기 메시지가 있으면 완료/중지 후 전환한다. 공급자 간 이력 변환과 기존 런타임의 컨텍스트 압축을 사용하며, 전환 메뉴 자체는 AI 요청을 하지 않는다.

연결된 세션은 `taskId`와 `previousSessionId`를 로컬 메타데이터에 기록한다. 기본 목록에는 현재 작업 대표 하나를 보여 주고, 선택했거나 실행 중인 세션은 숨기지 않는다. 모델 이력을 펼쳐 원본을 열 수 있다. 즐겨찾기와 보관은 연결된 작업 전체에 적용한다. 이전 세션 파일은 삭제하지 않는다.

## 입력 복구와 토큰 효율

초안은 200ms 지연 후 이 기기의 앱 프로필 IndexedDB에 저장하고 창을 떠날 때 한 번 더 저장을 요청한다. 텍스트·첨부파일을 작업 ID로 분리한다. 보내면 빈 초안으로 지워진다. 오래되거나 예산을 넘은 항목부터 제거한다. 저장 실패 시 입력창은 유지하고 오류를 알린다. 강제 종료 직전 아직 저장되지 않은 입력까지 보장하지는 않는다. 바이너리 첨부파일은 localStorage·환경 동기화·AI 호출에 자동 저장하지 않는다.

입력 추정은 로컬 계산으로 한다. 이미 열린 대화에서는 런타임의 컨텍스트 상태를 더한다. 입력 가치는 현재 가격표에 따른 캐시 할인 전 입력량의 USD 추정이며 출력 비용을 포함하지 않는다. 가격이 없으면 USD를 표시하지 않는다. PDF·이미지 등은 실제 처리 전 토큰 수를 확정하지 않는다.

요청 한도는 사용자가 보낸 한 응답과 그 도구 반복에 적용한다. 토큰은 입력·출력·캐시 토큰을 공급자의 합산 방식에 맞춰 계산한다. 한도에 도달하면 다음 모델 요청 전에 중단한다. 진행 중인 응답은 최종 사용량이 나올 때 한도를 넘을 수 있으므로 절대 결제 상한이 아니다. 별도 백그라운드 작업·하위 에이전트·공급자 SDK 내부 재시도는 별도 실행 경로이며 이 횟수 상한을 전체 계정 결제 제한으로 사용하지 않는다. 사용량이 누락되거나 USD 한도를 지정한 모델의 가격을 알 수 없으면 추가 진행을 차단한다. 빈 칸은 해당 제한을 사용하지 않는다.

모델 변경·메뉴 검색·초안 자동 저장·토큰 추정에는 AI 호출을 하지 않는다. 중복 추론 프리셋을 없애고 하나의 추론 강도 선택기를 사용한다. 본문·첨부파일을 불필요하게 모델에 다시 보내지 않고, 기존 캐시·컨텍스트 압축을 유지한다.

## macOS 및 호환성

Electron `titleBarOverlay`와 `env(titlebar-area-x)`로 네이티브 창 버튼의 실제 영역을 확보한다. 전체 화면·줌·좁은 창에서 DOM 제목이 창 버튼 위로 들어가지 않도록 한다. 시스템 앱 메뉴의 종료와 텍스트 편집 키 동작을 보존한다.

근거: [Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window), [Electron 단축키](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts), [네이티브 메뉴](https://www.electronjs.org/docs/latest/tutorial/application-menu).

기존 `mixdog` CLI·사용자 데이터·프로토콜 식별자는 호환성을 위해 유지한다. 내부 사이드바 ID `tandem`도 저장된 레이아웃과의 호환성을 위해 유지하되 화면에는 기기 동기화로 안내한다. 기존 Tandem CLI는 유지하며 Git 실행 코드는 `src/runtime/shared/git-process.mjs`가 소유한다. Galaxy에서 Tandem 서비스를 역으로 가져오지 않는다.

## 검증과 로컬 배포

```sh
npm run typecheck --prefix apps/desktop
npm run i18n:check --prefix apps/desktop
node scripts/test.mjs src/runtime/galaxy src/runtime/tandem
npm run deploy:local:plan
npm run deploy:local
```

데스크톱 대상 테스트는 `apps/desktop`에서 `node --import ./scripts/test-env.mjs --import tsx ../../scripts/test-direct.mjs <파일...>`로 실행한다. 실 브라우저 테스트에는 Chrome, 네이티브 창 테스트에는 macOS가 필요하다. CI는 공통 런타임·채팅 회귀 검사와 macOS 네이티브 창 검사를 패키징 전에 실행한다.

로컬 배포는 빌드·런타임 준비·현재 아키텍처 패키징 후 설치된 앱과 해당 세션 데몬을 종료하고 `/Applications/COSMOS.app`을 교체·재실행한다. 이전 번들은 휴지통에 보관하고 사용자 데이터를 유지한다. 로컬 서명 인증서가 없으면 ad-hoc 서명을 사용한다. 외부 배포용 Developer ID 서명·공증과 GitHub 공개 릴리스는 별도의 릴리스 절차다.


## 이번 로컬 배포 확인

- 환경: Intel x64 Mac, macOS 26.7.1, Electron 41.10.6. 설치 버전은 개발 빌드 1.0.12를 유지했다.
- 데스크톱 main·renderer 회귀 검사: 3,081개 통과, 플랫폼별 검사 55개 제외, 실패 0개.
- Galaxy·기존 Tandem·컨텍스트·요청 한도 런타임 검사: 61개 통과. 이후 요청 전 준비 단계에도 한도 확인을 추가하고 관련 12개 검사를 다시 통과했다.
- 실제 Chromium에서 첨부 초안의 재로드 복구·분리·만료와 한글 조합 입력을 검사했다. 네이티브 Mac 창에서는 두 창 너비와 세 확대율에서 제목줄 안전 영역을 확인했다.
- `/Applications/COSMOS.app`에서 별도 프로필을 실행해 초안 복구·삭제 후 재로드·한도 입력 UI를 확인했다. AI 요청은 보내지 않았다. 제목 왼쪽 83px, 네이티브 영역 경계 78px로 겹침이 없었다.
- 설치 앱과 빌드 산출물의 app.asar·runtime.asar SHA-256 일치. 로컬 ad-hoc 서명 검증 통과. 앱과 세션 데몬 새 프로세스 시작, 로컬 health HTTP 200 확인.
- 패키지 메모리 런타임의 추가·검색·삭제 검사 통과. Intel Mac의 ONNX 바인딩은 기존 지원 대상에서 제외돼 로컬 벡터 임베딩 검사는 건너뛰었다. 이 환경에서는 벡터 임베딩의 작동을 확인했다고 간주하지 않는다.

로컬 빌드용 Rust 1.95.0은 사용자 캐시에 설치했으며 셸 시작 파일은 변경하지 않았다. 네이티브 소스 변경으로 다시 컴파일해야 할 때의 이 Mac 명령:

```sh
env RUSTUP_HOME="$HOME/Library/Caches/COSMOS/toolchain/rustup" \
  CARGO_HOME="$HOME/Library/Caches/COSMOS/toolchain/cargo" \
  PATH="$HOME/Library/Caches/COSMOS/toolchain/cargo/bin:$PATH" npm run deploy:local
```


은하수 연결 화면의 왼쪽 패널 잘림도 설치 앱에서 재현·수정·재배포했다. 220/252/320/520px × 75/100/150%의 12가지 조합에서 카드와 컨트롤의 경계를 검사했다. 새 설치 패키지의 실제 왼쪽 패널에서 가로로 잘리는 요소 0개, 카드 밖 컨트롤 0개를 확인했고 아래쪽 준비 항목까지 세로 스크롤로 접근할 수 있었다.
