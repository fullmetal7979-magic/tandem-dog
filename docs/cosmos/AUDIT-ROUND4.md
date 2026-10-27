# COSMOS 감사 4차 (2026-10-27, Claude, HEAD 8e681ba4)

1~3차 제외. 전부 Claude가 구현 중(Codex 워크벤치 파일·main/ipc.ts·ComposerFooter.tsx는 건드리지 않음).

## 보안·데이터
1. HIGH 등록 프로젝트 안의 폴더는 그 프로젝트 자리만 봄 + repo 아니면 null → `~`를 프로젝트로 등록하면 하위의 남의 프로젝트에 쓰기. "planet 아님"이면 모든 프로젝트 규칙 추가 적용, `addProject` 원격 차단.
2. HIGH `resolveToolApprovalForSession`·`inheritSession`·`invokeCapability`(revertTurnReview, addMcpServer, addPlugin, installBuiltinFeature) 무게이트 → 세션 cwd/모든 프로젝트 규칙으로 게이트, MCP·플러그인 추가는 원격 차단.
3. HIGH 3차 회귀: 폰의 `force:true`가 `refuseUnlessHeld`까지 건너뜀 → 자리 없는 폰이 남의 작업 커밋·푸시. force는 push_failed만, 보유 확인은 항상.
4. MED `hostAlive`가 `holder.since` 포함, 'mine'에서 force 무시 → 덮개 닫힌 A 때문에 30분 고착. 게스트 moon은 holder.host 일치 요구, hostAlive는 beat만, host가 stale이면 force 허용.
5. MED 이어받기에서 자리 push 후 commitLocal/rescue/bringUpToDate 사이 크래시 → 재시도 시 구조 생략. 로컬 pending-rescue 표식.
6. LOW 은하수 작업 중 크래시로 남은 `index.lock` → 잠금 보유 중 오래된 lock 제거.
7. LOW 대화 정리가 PC 시계 기준 → 방금 쓴 문서 삭제 가능. 방금 쓴 건 보존.
8. LOW 기기 해제해도 공용 pairingSecret 유지 → 데스크톱이 해제된 clientId 거부(또는 클라이언트별 비밀).
9. LOW 게스트 id를 클라이언트가 지정 → 인증된 clientId에서 도출.

## UX
1. 3차 회귀: WorkspaceEmptyState 단축키가 macOS에서도 Ctrl 표기.
2. 명령 팔레트·저장 툴팁·탐색기 메뉴·DraftTokenBudget의 Ctrl 고정 표기 → shortcutLabel.
3. "↺ 이전 실행": 작업과 재연결 안 됨(▶ 시 중복 서버), 끝난 셸도 "돌고 있어요", 탭 닫기 없음.
4. 대화 스크롤러 `aria-live` → 과거 기록 로드 시 낭독. off + 별도 상태 영역.
5. 목록 행 키보드 포커스 1px 30% 테두리(1.8:1) → 키보드 모드에서 2px.
6. "이 PC" vs "이 기기" 혼용, "되찾기" → 기기·이어받기로 통일.
7. whats-new·changelog 대화상자 Tab 갇힘·배경 inert 없음.

## 처리 결과 (2026-10-27)
H·I·J 서브에이전트가 세션 한도로 멈춘 뒤 다른 세션이 이어받아 16개 모두 처리. Codex 워크벤치·native·ipc.ts·ComposerFooter.tsx와 ko.json의 Codex 문자열은 건드리지 않음.

### 보안·데이터
1. ✅ 프로젝트 안 폴더라도 행성이 아니면(`~` 등) 모든 프로젝트 규칙을 추가로 적용(`SeatVerdict`, `cosmosRemoteWriteVerdict`). 폰의 `addProject`는 거부.
2. ✅ `resolveToolApprovalForSession`(승인만, 거부·중단은 항상 허용)·`inheritSession`·`revertTurnReview(File)`은 세션 폴더로, `runScheduleNow`는 모든 프로젝트 규칙으로 게이트. `addMcpServer`·`addPlugin`·`updatePlugin`·`enablePluginMcp`·`installBuiltinFeature`·`installLocalProviderModel`·`setSystemShell`은 폰에서 "폰에서는 설치할 수 없어요. PC에서 해 주세요."
3. ✅ `moon`의 `force` → `forcePush`(push_failed만 무시). 보유 확인은 항상 적용, 폰은 앉은 기기를 통해서만 내려놓기(`seat_other_host`). 비보유자의 forcePush가 아무것도 커밋·푸시하지 않는 회귀 테스트 추가.
4. ✅ `hostAlive`는 beat만. 호스트가 살아 있으면 force로도 이동 불가(`seat_host_active`), 멈췄으면 force로만 이동(`seat_stale`, canForce).
5. ✅ 이어받기 전 로컬 표식(`~/.mixdog/galaxy-pending-rescue.json`), 따라잡기 성공 후 해제. 남아 있으면 overview가 `pendingRescue`를 알리고 다음 이어받기가 구조를 마저 함.
6. ✅ cosmos.lock을 쥔 채 2분 넘은 `.git/index.lock` 제거(`clearStaleIndexLock`).
7. ✅ 방금 쓴 대화는 정리 대상에서 제외, 같은 시각은 파일 이름으로 순서 고정.
8. ✅ 데스크톱이 해제한 clientId 목록을 보관(`remote-revoked-clients.json`), open·hello 두 곳에서 거부. 사용자가 새 페어링을 승인하면 해제.
9. ✅ 게스트(폰) id는 릴레이가 인증한 clientId에서 도출(호출 컨텍스트). 요청에 담긴 id는 무시.

### UX
1·2. ✅ `shortcut-display.ts` 한 표로 플랫폼별 표기(빈 화면·명령 팔레트·저장 툴팁·탐색기 메뉴·모델 단축키).
3. ✅ 작업 태그가 든 터미널 id로 재연결, ▶는 재시작. 탭마다 ✕(PTY·저장된 보기 정리). 서비스가 `busy`/`exited`를 알려 "아직 돌고 있어요"는 실제로 돌 때만.
4. ✅ 대화 스크롤러 `aria-live="off"`, 별도 상태 줄이 답이 끝날 때만 한 번 알림(`use-turn-announcement.ts`).
5. ✅ 키보드 모드에서 목록 포커스 링 2px `--mx-text-muted`.
6. ✅ 작업 자리 문구는 "이 기기"·"이어받기"로 통일, `seat-wording.test.mjs`가 "이/그/연결된/다른 PC"·"되찾"을 막음.
7. ✅ 단독으로 열린 새 소식·변경 기록 대화상자는 배경 inert + Tab 가둠(`use-standalone-dialog.ts`), 설정 안에서 열리면 설정이 처리.
