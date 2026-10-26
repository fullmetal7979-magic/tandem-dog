# COSMOS 감사 3차 (2026-10-27, Claude, HEAD 38862548)

1·2차(구현 완료, AUDIT-ROUND2.md) 제외. ✅=Claude 구현 중, 🔶=Codex 담당 파일(WorkbenchTaskCenter 등)이라 넘김.

## 보안·데이터
1. ✅ HIGH 자리 게이트: 폴더 없는 터미널·프로젝트 없는 작업·repo 아닌 cwd는 통과 → 폰이 `cd`로 남의 프로젝트 수정. 은하수 준비 시 "모든 등록 프로젝트" 규칙 또는 거부.
2. ✅ MED 내려놓기 push_failed: force 경로가 UI/폰/CLI에 없음, 권한 거부도 "behind"로 분류 → 자리 영구 고착. 분류 수정 + 확인 후 "그래도 내려놓기".
3. ✅ MED `galaxy-repo.mjs` 은하수 commit에 `--no-gpg-sign` 없음 → 서명 강제 사용자 전 동작 실패.
4. ✅ MED 업그레이드 회귀: galaxyId 없는 기존 base 폐기 → 첫 동기화 전부 충돌·덮어쓰기. 레거시 base 1회 수용 후 id 기록.
5. ✅ MED `saveAndPush` 미푸시 커밋·새 브랜치의 비밀값 미검사 → 범위 검사.
6. ✅ MED 2차 회귀: 폰 이동 시 A의 미커밋 작업 두고 B로 이동 → A가 살아 있으면 거부.
7. ✅ MED ▶ 실행 PTY 맵이 렌더러 메모리에만 → 리로드 후 고아 dev 서버. 서비스에서 재수용/정리.
8. ✅ LOW 자리 넘긴 뒤 ⏹ 비활성 → 로컬 중지는 항상 허용.
9. ✅ LOW git-process가 로컬 무거운 명령을 60s 후 SIGKILL → index.lock 잔존. 네트워크만 타임아웃.

## UX·성능
1. ✅ 시작 시 첫 overview가 git fetch를 기다려 입력창 최대 60s "확인 중" 잠금 → 로컬 먼저, fetch는 백그라운드.
2. ✅ 단축키: macOS Ctrl+W/P/N/B/J가 터미널 readline 가로챔, Windows Ctrl+화살표가 단어 이동 대신 탭 전환.
3. ✅ 요청 한도가 draft 범위에 저장돼 둘째 턴부터 사라짐.
4. ✅ 초안 저장소가 200ms마다 첨부 포함 전체 저장·전체 커서 순회, 메모리 캐시 과대.
5. ✅ 슬래시·큐·제출 알림 영어 노출, "Pushing" 번역 오류.
6. ✅ development-chat.css 고정 11px·폰 스케일 미적용·좁은 푸터 넘침.
7. 🔶 `WorkbenchTaskCenter` "시작 가이드 다시 보기"가 닫힌 사이드바에서 무반응 → 사이드바 열고 디스패치.
8. 🔶 `WorkbenchTaskCenter` "사이드바 간단히 정리"가 사용자 핀을 확인·되돌리기 없이 교체.
9. ✅ 모델 핸드오프 후 원래 탭 초안 재등장, `replaced:` 행이 초안 상한 잠식.
10. ✅ ⌘⇧K가 컴포저 버블 리스너라 터미널·에디터 포커스에서 무반응.
11. ✅ 폐기된 uiMode가 계약·IPC·은하수 동기화에 잔존.
12. ✅ 접근성·성능 자잘한 것: title만 있는 설명, 바깥 클릭 시 한도 입력 유실, 미리보기 첫 포커스가 ✕, hasMath AST 반복 순회.
