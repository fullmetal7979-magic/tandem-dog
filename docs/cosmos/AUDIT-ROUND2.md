# COSMOS 감사 2차 (2026-10-26, Claude)

1차 결과(구현 완료)는 제외. 각 항목은 작업 트리 코드로 확인함. 아직 미구현 — 착수 전 담당 파일을 명시해 겹치지 않게 할 것.

## 보안·데이터 손실
1. HIGH `src/runtime/galaxy/project-sync.mjs` rescueDisplacedWork: switch/add/commit 실패를 확인하지 않고 `reset --hard` → gpgsign·타임아웃 시 미커밋 작업 소실. 각 단계 실패 시 중단, `--no-gpg-sign`, 구조 브랜치 확인 후에만 reset.
2. HIGH `environment.mjs` 동기화 base(`~/.mixdog/galaxy-state.json`)가 은하수 원격과 묶이지 않음 → 원격 연결/변경 시 로컬 스킬이 "은하수에서 삭제됨"으로 지워짐. base에 원격 URL/루트 커밋 저장, 다르면 폐기.
3. HIGH `environment.mjs` 심볼릭 링크 디렉터리(skills 등)는 `files/skills` 키만 skip → 하위 파일이 삭제로 전파. skip을 접두사로 비교, applyDown에서 조상 경로 symlink 거부(realpath가 dataDir 안).
4. MED `project-sync.mjs` 구조 커밋이 secretFindings 없이 `add -A`·push → `.env` 유출. 비밀 검사 또는 구조 브랜치 로컬 유지.
5. MED `apps/desktop/src/main/remote-seat-gate.ts` termEnsure가 폰이 준 cwd를 기록 → 기존 PC 터미널 id에 null cwd로 우회. `terminals.cwdOf(opened.id)` 기록, `cwdOf`는 모르는 id에 undefined.
6. MED `cosmos.mjs` 내려놓기가 push/behind/commit 실패에도 자리를 놓고 넘김 → 작업 분기. `project.ok` 아니면 자리 유지(또는 force).
7. MED `secrets.mjs` URL_SECRET_PARAM에 단어 경계 없음(`?keyword=` 등 오탐) → 파일 영구 보류·URL 손상. 정확한 파라미터 이름만 매칭.
8. MED `seat.mjs` sitTransition: 폰이 다른 PC 경유로 이어받으면 host가 안 바뀜 → B의 게이트가 거부. host 변경을 교대로 처리.
9. LOW `apps/desktop/src/renderer/cosmos/run-tasks.ts` ▶ 실행이 실행 중인 이전 PTY를 바로 종료. 확인 또는 작업별 PTY.

## UX·성능·크기
1. 남은 옛 용어(교대·우주 지도·행성·교신·앉지 않으면·내렸어요·다른 별): cosmos-format.ts, CosmosHome, SeatBadge, SeatLock, GalaxyPane, RunPane, StarMap, CosmosSettingsPanel, CosmosParts, OnboardingWizard, galaxy-repo/seat/cosmos.mjs, CLI(이어받기/내려놓기 별칭 추가).
2. 용어 충돌: "작업"=자리 vs "New task"=새 작업. 대화는 세션으로 통일.
3. GalaxyPane/RunPane/StarMap이 비활성 독에서도 폴링 → `useCosmos(active ? path : null)`.
4. 감시 키마다 동시 git fetch(main 쪽은 root별 중복제거만) → 은하수 fetch 단일 in-flight 공유, 숨은 StarterGuide는 '' 감시 중단.
5. 첫 overview 실패 시 "살펴보는 중…" 무한 표시 → 오류+다시 시도.
6. 오류에 IPC 접두사 노출, 폴링이 액션 오류를 덮음, role=alert 3중 → 접두사 제거, pollError/actionError 분리.
7. 자리 상태 미확인(view null) 동안 실행 버튼·입력창 열림 → "확인 중"으로 잠금.
8. 폴링마다 loading:true + 새 view로 전체 리렌더 → 강제 새로고침만 loading, 변경 없으면 set 생략, 미사용 comet 삭제.
9. VerdictHero 전체 aria-live + "47분째" → 매 분 낭독. 상태 단어만 live.
10. 잠금 중 "💬 새 세션" 버튼 무반응·분할창에서 다른 창 포커스.
11. 고급 전용 CSS(20/23/25/28 + KaTeX) 즉시 로드 → 지연 로드.
12. 아이콘 3개 때문에 codicon 전체 + TTF 148KB 즉시 로드 → lucide.
13. DraftTokenBudget의 ⌘⇧M 단축키 미바인딩.
14. `40-cosmos.css` `[data-ui-mode='simple']` → 실제는 `data-cosmos-mode`.
15. 자잘한 것: RunPane 조사 띄어쓰기, ↻ aria-label, "git 사용 가능" 하드코딩, 비활성 이어가기 이유, 받기 busy가 전체 공유.
