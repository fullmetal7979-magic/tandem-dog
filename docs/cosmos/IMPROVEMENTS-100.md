# COSMOS 개선 100

코스모스 코드(은하수 런타임·명령줄·데스크톱 서비스·코스모스 화면·행성의 우주·▶ 실행·릴레이)를 다시 읽고 찾은 개선 100가지와 그 구현 기록이다. 범위는 코스모스 영역으로 한정했다. 작업 도구(workbench)·네이티브·`locales/ko.json`은 다른 작업이 진행 중이라 건드리지 않았다. 일반 목록인 `IMPLEMENTATION-300.json`과도 겹치지 않게 골랐다.

모든 항목은 ✅ 구현됨이다. 각 묶음 끝의 **검증**은 그 묶음을 지키는 테스트다.

## A. 비밀 보호 — `src/runtime/galaxy/secrets.mjs`

1. **camelCase 비밀 키**: `accessToken`·`githubToken`·`openaiApiKey`·`clientSecret` 같은 키가 은하수로 그대로 올라가던 유출 경로를 막았다. 키를 `_` 경계로 나눠 snake_case와 같은 규칙으로 본다.
2. **더 많은 비밀 키 이름**: `pass`·`passphrase`·`bearer`·`signingKey`·`encryptionKey`·`connectionString`·`dsn`.
3. **레지스트리·결제·메일 토큰**: npm(`npm_`), PyPI(`pypi-`), Stripe 운영 키(`sk_live_`·`rk_live_`), SendGrid(`SG.`).
4. **클라우드·모델 호스트 토큰**: Hugging Face(`hf_`), DigitalOcean(`dop_v1_` 등), Google OAuth 클라이언트 비밀(`GOCSPX-`).
5. **웹훅 URL·봇 토큰**: Slack·Discord 웹훅 주소, Telegram 봇 토큰. 이 값만 있으면 누구나 주인 이름으로 글을 올릴 수 있다.
6. **비밀 파일 이름**: `.git-credentials`·`.pgpass`·`.my.cnf`·`*.jks`·`*.keystore`·`*.ppk`·`*.kdbx`. 암호화한 채 커밋하는 sops `secrets.yaml`은 일부러 넣지 않았다.

검증: `secrets.test.mjs` (camelCase 키, 새 토큰 10종과 오탐 방지, 새 파일 이름과 비슷한 일반 파일)

## B. 파일과 기기 신원 — `fs-atomic.mjs`, `star.mjs`

7. **공용 원자적 쓰기** `fs-atomic.mjs`: 임시 파일 이름에 pid와 무작위 값을 넣는다. 그래서 같은 프로세스의 두 쓰기, 컨테이너 경계에서 pid가 겹친 두 프로세스가 서로의 임시 파일에 쓰지 않는다. 실패하면 임시 파일을 지운다.
8. 기기 기록 `star.json` 쓰기에 적용.
9. 이어받기 중단 표시(`pending-rescue`) 쓰기에 적용.
10. 은하수 작업 사본 쓰기(`writeGalaxyText`)에 적용.
11. 환경 동기화 상태와 동기화 파일 쓰기(`environment.mjs`)에 적용.
12. **손상된 `star.json` 복구**: 읽을 수 없는 내용은 `star.json.corrupt-<시각>`으로 보관한다. 그 안의 기기 id와 이름을 되살리므로, 이 기기가 조용히 새 기기가 되어 자기 조종석을 잃지 않는다.
13. 권한 문제처럼 **읽기 자체가 실패**하면 덮어쓰지 않고 오류를 낸다. 덮어쓰는 것은 파일이 없을 때(ENOENT)뿐이다.
14. **기기 이름을 글자 단위로 자르기**(grapheme): 이모지와 한글 음절이 반으로 잘리지 않는다. 공용 `clipText`.
15. **기기 id 엄격 검사**: UUID 형식만 받는다. 이전에는 `-` 36개도 통과했다.
16. **잘못된 색·종류로 바꾸기**: 이제 현재 값을 유지한다. 이전에는 기본값으로 초기화됐다.

검증: `cosmos.test.mjs`, `galaxy-safety.test.mjs`, `environment.test.mjs` (기존 흐름 회귀)

## C. 원격 주소와 git — `planet.mjs`, `galaxy-repo.mjs`, `git-batch.mjs`, `project-sync.mjs`

17. `file://` 주소의 깨진 `%` 인코딩이 예외로 터지지 않는다.
18. **원격 도우미 주소 거부**: 은하수 주소로 `ext::`·`fd::`처럼 명령을 실행할 수 있는 `<전송>::` 주소를 받지 않는다.
19. **허용 scheme만**: https·http·ssh·git+ssh·git·file. 그 밖의 `xxx://`는 거부한다.
20. 신호(beat) 게시 오류에서 자격 증명을 가린다.
21. **신호 일괄 읽기**: 기기 수만큼 실행하던 `git cat-file`을 `--batch` 한 번으로 바꿨다. 결과를 해석하지 못하면 하나씩 읽기로 돌아간다.
22. **기기 기록 일괄 읽기**: 개요(20초마다)가 기기마다 하던 `git show`를 `reader.jsonMany` 한 번으로 바꿨다.
23. 프로젝트 git 오류의 `detail`(fetch·merge·commit·push·보관)에서 자격 증명을 가린다.
24. 내려놓기에서 `git add -A` 실패를 확인한다. 이제 변경의 절반만 커밋되지 않는다.
25. **보관 브랜치 이름 충돌 방지**: 같은 분에 두 번 보관하면 `-2`, `-3`을 붙인다.

검증: `project-sync.test.mjs` (같은 분 두 번 보관), `push-safety.test.mjs`, `galaxy-safety.test.mjs`

## D. 조종석과 말 — `seat.mjs`, `words.mjs`, `cosmos.mjs`

26. 예약 유지 시간 상수 `HANDOFF_HOLD_MS`와 `reservedUntil(seat)`.
27. **예약 자리 거절 문구**: 누구를 위해 비웠는지, 몇 분 뒤에 누구나 앉을 수 있는지 말한다.
28. **교대 재요청**: 새 메모가 있으면 메모를 바꾼다. 대기 순서는 그대로 둔다.
29. **오래된 교대 요청 만료**: 12시간(`REQUEST_TTL_MS`)이 지나면 읽을 때 빠지고, 다음 쓰기에서 파일에서도 지워진다.
30. 조종석 기록의 깨진 항목(id 없음, 시각이 숫자가 아님)을 걸러 낸다.
31. **빈 자리에 요청이 쌓이지 않음**: 빈 자리는 줄을 설 곳이 아니라 앉을 곳이다.
32. **거절 문구를 하나로**(`seatRefusalText`): 명령줄·데스크톱·폰이 같은 문장을 쓴다.
33. **런타임 조사 도우미** `words.mjs`:
    - 처리하는 조사: 이/가·을/를·은/는·와/과·(으)로.
    - ㄹ 받침 + (으)로: "서울로"·"HTML로".
    - 영문 약어는 글자 이름으로 읽는다: "PC가"·"HTML이".
    - 영문 단어: "Mac이"·"server가".
    - 끝에 붙은 이모지는 건너뛴다: "집 맥북 💻이".
34. **상대 시간 단위 확장**: 주·개월·년 ("6주 전"·"3개월 전"·"1년 전").
35. 조종석·내려놓기 문구의 "이(가)"·"을(를)"을 없앴다.
36. 달 메모는 한 줄로 만들고 글자 단위 300자로 잘라 프로젝트 목록에 기록한다.
37. 개요에 `reservedUntil`을 싣는다. 화면이 남은 시간을 직접 계산하지 않는다.
38. 은하수의 프로젝트 목록을 **최근 작업 순**으로 정렬한다.

검증: `seat.test.mjs` (예약 문구·재요청·만료·깨진 기록), `words.test.mjs`

## E. 대화 전달 — `conversations.mjs`

39. **너무 큰 메시지**: 붙여 넣은 로그 하나가 상한을 넘으면, 메시지를 통째로 버리지 않고 가운데를 줄인다. 앞뒤는 남기고 "…[은하수로 옮기며 N자를 줄였어요]…"라고 표시한다.
40. **목록 색인 `index.json`**: 목록을 그릴 때 문서마다 최대 2MB인 대화를 파싱하지 않는다.
41. **색인 자동 복구**: 색인과 실제 문서가 다르면 전체 읽기로 돌아간다. 예전 버전이 색인 없이 문서를 쓴 경우가 여기에 해당한다.
42. 세션 id `index`를 예약해 포인터 파일과 이름이 겹치지 않게 했다.

검증: `conversations.test.mjs`

## F. 명령줄 — `cosmos-cli.mjs`, `universe.mjs`, `src/headless-command.mjs`

43. **모르는 명령**: 도움말을 stdout에 쏟지 않는다. stderr에 오류와 비슷한 명령을 낸다 ("혹시 `cosmos status`?").
44. **`cosmos 우주`**: 빛(커밋)·첫 빛·가장 새 빛·이름 붙은 빛(태그)·성운(커밋 전 변경)·매인 빛(푸시 전)·손길(커밋한 사람 수)과 오늘의 시구를 보여 준다.
45. **`cosmos 기록`**: 최근 작업 기록 12번. 기간, 남긴 메모, 응답이 없어 넘겨받았는지까지 보여 준다.
46. **`--json`**: 은하수·기록·우주를 스크립트가 읽기 좋은 JSON으로 낸다.
47. 은하수 상태에 지난 이어받기가 중간에 멈췄다는 표시(`pendingRescue`)와 다시 하는 방법.
48. 은하수 상태에 환경을 마지막으로 맞춘 시각.
49. 은하수 상태에 예약 자리의 남은 시간.
50. 은하수 상태에 받아올 커밋과 아직 올리지 않은 변경.
51. **요청 안내 구분**: 빈 자리("바로 이어받으세요"), 이미 내 자리, 메모만 바꿈을 따로 알린다.
52. 터미널에서는 기기 종류를 `pc|mac`만 받는다. 폰은 폰이 정한다.
53. **윈도 버그**: 다른 드라이브(`D:\…`)의 세션을 프로젝트 안 세션으로 잘못 고르던 문제를 고쳤다(`latestSessionFor`).
54. 명령 출력에 조사를 적용했다 ("app을 이어받았어요").
55. 도움말, 영어 별칭(`history`·`turns`·`universe`), CLI 라우팅에 새 명령을 추가했다.

검증: `cosmos-cli.test.mjs` (제안, 라우팅, 임시 저장소의 `우주`와 `--json`, `phone` 거부)

## G. 데스크톱 서비스 — `apps/desktop/src/main/cosmos-service.ts`

56. 폰 쓰기 거절 문구에 조사를 적용했다. main 프로세스도 런타임 `words.mjs`를 쓴다.
57. `handoffTo`는 기기 id 모양만 받는다.
58. `seat_other_host`(폰이 다른 PC로 내려놓기)를 오류가 아닌 사용자용 거절로 분류해, 상태로 보여 준다.

검증: `npm run test:desktop-main`, `npm run typecheck`

## H. 화면 규칙 — `apps/desktop/src/renderer/cosmos/cosmos-format.ts`

59. 조사 판단에서 끝에 붙은 이모지와 괄호를 건너뛴다.
60. 조사: 영문 약어와 단어 규칙, (으)로.
61. 상대 시간: 주·개월·년.
62. "~째": 일·주 단위 ("5일째"·"2주째").
63. **예약 자리 남은 시간**: "8분 뒤에도 이어받지 않으면 누구나 이어받을 수 있어요".
64. 예약 시간이 지나면 빈 자리로 보여 준다.
65. 프로세스를 건너며 겹친 오류 접두사("Error: TypeError: …")를 모두 지운다.
66. `clipName`: 글자 단위 말줄임 도우미.
67. **데스크톱과 터미널의 읽기 규칙이 같다는 테스트**: 이름 21개 × 조사 5종, 상대 시간 8구간을 비교한다.

검증: `cosmos-format.test.mjs`

## I. 상태 저장소 — `cosmos-store.ts`

68. 창이 포커스 없이 다시 보일 때(트레이나 다른 데스크톱에서 돌아올 때) 오래된 상태를 새로 읽는다.
69. **네트워크가 돌아오면**(`online`) 지켜보는 모든 프로젝트를 즉시 새로 읽는다. 조종석에 앉아 있으면 신호도 바로 보낸다.

검증: `cosmos-store.test.mjs`

## J. 은하수 화면 부품 — `SeatBadge`, `ConstellationTimeline`, `StarMap`, `GalaxyPane`, `CosmosSettingsPanel`

70. 상단 배지: 이름 없는 기기가 "undefined"로 나오지 않는다.
71. 작업 기록: 렌더할 때마다 그림 전체를 다시 계산하지 않는다(`useMemo` 의존성 안정화).
72. 작업 기록: 긴 기기 이름은 말줄임으로 줄이고, 전체 이름을 툴팁으로 보여 준다.
73. 작업 기록: 연결선 key가 겹치지 않는다.
74. 작업 기록: 응답이 없어 넘겨받은 턴은 경고색 점선 테두리로 그린다.
75. 작업 기록: "전체 N번 중 최근 14번".
76. **기기 지도 둘째 궤도**: 기기가 9대 이상이면 조금 더 넓고 엇갈린 궤도에 놓는다. 별끼리 겹치지 않는다.
77. 기기 지도: 긴 이름 말줄임.
78. 기기 지도: 별마다 툴팁으로 전체 이름과 상태를 보여 준다.
79. 은하수의 프로젝트 목록: 지금 연 프로젝트를 표시한다.
80. **릴레이 주소를 저장 전에 확인**: wss://만 받는다. ws://는 이 컴퓨터일 때만 받고, 아이디·비밀번호가 든 주소는 받지 않는다.
81. 릴레이 주소 오류는 `role="alert"`와 `aria-invalid`로 알린다. 입력하는 동안 힌트를 보여 준다.

검증: `cosmos-polish.test.mjs` (말줄임, 기기 12대 겹침 없음, 긴 기록, 이름 없는 배지, 릴레이 주소)

## K. 행성의 우주 — `CosmosUniverse.tsx`, `universe-model.ts`, `universe-canvas.ts`

82. **키보드로 빛 탐색**:
    - ←→↑↓: 한 빛씩 시간을 거슬러 가거나 돌아온다.
    - Home / End: 가장 새 빛 / 첫 빛.
    - PageUp / PageDown: 10개씩.
83. **커밋 해시 복사**: 엔터 키나 클릭으로 복사한다. 복사할 수 없는 화면에서는 복사했다고 말하지 않는다. 툴팁에 조작 안내가 있다.
84. Esc 키나 포커스 이동으로 탐색을 끝낸다.
85. 포커스 링과 접근 가능한 이름(`role="group"`).
86. **포커스 중에만 생기는 알림 영역**: 평소에는 홈의 알림 영역을 조종석 상태 하나로 유지하는 원칙을 지킨다.
87. 스크린리더 요약에 최근 빛 3개를 넣었다.
88. 칩 **첫 빛**(첫 커밋): 전체 기록이 다 들어왔을 때만 보여 준다.
89. 칩 **손길**(커밋한 사람 수).
90. 오늘의 시구: 앱을 밤새 열어 둬도 하루 경계에서 바뀐다.
91. 화면 밀도(DPR)가 다른 모니터로 옮기면 하늘을 다시 선명하게 그린다.
92. 고대비(`prefers-contrast: more`): 하늘 위 글자의 반투명을 없앤다.
93. 강제 색상(`forced-colors`): 그린 하늘 대신 시스템 색을 쓴다. 하늘이 보여 주던 숫자는 이미 글로 적혀 있다.

검증: `cosmos-universe.test.mjs` (키 이동 규칙, 첫 빛·손길, 키보드 탐색·복사·Esc DOM 테스트)

## L. ▶ 실행 — `run-tasks.ts`, `RunPane.tsx`

94. **`packageManager` 필드 우선**: package.json의 Corepack 필드가 남은 lockfile보다 우선한다.
95. **justfile 레시피**: `[private]`, `_`로 시작하는 것, 별칭·설정, 인자가 꼭 필요한 레시피는 제외한다.
96. **deno.json / deno.jsonc 태스크**: 주석과 후행 쉼표를 허용하고, `{ command }` 형태도 읽는다.
97. **Rust**: `cargo run·build·test·check·clippy`. 패키지 없이 작업 공간만 있으면 `run`은 뺀다.
98. **Go**: `go build·test·vet ./...`.

검증: `run-tasks.test.mjs`

## M. 릴레이 — `apps/relay/server.mjs`

99. **SIGTERM/SIGINT 정상 종료**: `docker stop`·systemd·Ctrl+C를 받으면 연결을 닫고, 미뤄 둔 기기 등록을 저장한 뒤 끝낸다. 두 번째 신호를 받거나 8초가 넘으면 바로 끝낸다.
100. **PORT 검증**: 숫자가 아니거나 범위를 벗어난 `PORT`는 시작 전에 알리고 멈춘다.

검증: `apps/relay/lib/relay-lifecycle.test.mjs`

## 문서

README의 명령줄 표, 헌장(`COSMOS-CODE.md`)의 기능 지도와 다음 담당자 메모, `RELAY.md`의 관리 절도 함께 고쳤다.

## 검증 기록 (2026-10-31)

| 범위 | 명령 | 결과 |
|---|---|---|
| 은하수 런타임 | `node scripts/test-direct.mjs src/runtime/galaxy/*.test.mjs` | 75/75 |
| 데스크톱 렌더러 | `npm run test --prefix apps/desktop -- src/renderer` (test.mjs + tsx) | 1752개 중 1751 통과, 0 실패 |
| 데스크톱 main | `npm run test:desktop-main --prefix apps/desktop` | 1464개 중 1410 통과, 0 실패(나머지 건너뜀) |
| 타입 | `npm run typecheck --prefix apps/desktop` | 오류 0 |
| 번역 | `npm run i18n:check --prefix apps/desktop` | OK |
| 릴레이 | `node ../../scripts/test.mjs` (apps/relay) | 111개 중 110 통과. `scripts/deploy-plan.test.mjs`는 apps/relay에 `typescript`가 설치되지 않아 모듈을 찾지 못하는 기존 환경 문제(이번 변경과 무관) |

## 다음 담당자에게

- 런타임 `words.mjs`와 화면 `cosmos-format.ts`는 같은 읽기 규칙을 따로 갖는다. 렌더러 Vite 개발 서버는 `src/runtime`을 서빙하지 않아 렌더러에서 직접 가져올 수 없다. 규칙을 바꾸면 두 곳을 함께 고친다. `cosmos-format.test.mjs`의 일치 테스트가 어긋남을 잡는다.
- 교대 요청 만료(12시간)는 `normalizeSeat(..., { now })`로 읽을 때 적용된다. 시각 없이 부르는 순수 전이 테스트에는 영향이 없다.
- 대화 색인 `index.json`은 이 버전부터 쓴다. 예전 버전과 섞여 있어도 색인과 문서가 다르면 전체 읽기로 돌아가므로 안전하다.
- `cosmos 우주`의 시구는 화면과 같은 7개 목록에서 고른다. 고르는 기준은 프로젝트 폴더 이름이다.
