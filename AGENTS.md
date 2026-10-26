# COSMOS 공동 개발 지침

## 프로젝트
- COSMOS(코스모스)는 Mixdog 기반 AI 개발 도구다. 기존 mixdog 이름과 호환성을 임의로 제거하지 않는다.
- 시작할 때 README.md, package.json, 변경 대상 하위 package.json과 관련 테스트를 읽는다.
- CLI: src/cli.mjs 및 src/runtime/. 코스모스 동기화·조종석: src/runtime/galaxy/.
- Electron main: apps/desktop/src/main/. React UI: apps/desktop/src/renderer/, 코스모스 UI: cosmos/.
- 릴레이: apps/relay/. 관련 문서: docs/cosmos/RELAY.md.
- 개발 채팅·모델 전환·입력 복구·사용 한도·macOS 호환성 설계와 검증: docs/cosmos/DESIGN.md.

## Claude와 Codex 협업
- 작업 시작 시 git status --short, git branch --show-current, git diff --stat를 확인한다.
- 기존 수정·삭제·미추적 파일은 진행 중인 다른 작업으로 취급한다. 되돌리거나 일괄 정리하지 않는다.
- 같은 체크아웃에서는 동시에 같은 파일을 편집하지 않는다. 변경 대상과 담당 범위를 먼저 명시하고 겹치면 교대로 작업한다.
- 독립적인 동시 구현은 별도 브랜치와 git worktree를 사용한다. 새 worktree에는 미커밋 변경이 포함되지 않으므로, 현재 작업이 필요한 경우 담당자가 완료한 기준 커밋에서 분기한다.
- 작업 중인 원본 체크아웃의 브랜치를 바꾸거나 stash/reset/clean을 수행하지 않는다.
- git add . 대신 자신의 변경 파일만 선택한다. 다른 작업자의 변경을 대신 커밋하지 않는다.
- 종료 시 변경 파일, 의도, 검증 결과, 남은 문제, 다음 담당자에게 필요한 정보를 전달한다.
- 대화 기록은 자동 공유되지 않는다. 필요한 맥락은 저장소의 문서와 명시적인 인계 내용으로 전달한다.

## 환경과 검증
- Node 요구 버전: ^22.19.0 또는 >=24.0.0. 의존성 설치는 루트와 apps/desktop에서 각각 관리한다.
- CLI 실행: npm start. 데스크톱 개발: npm run dev --prefix apps/desktop.
- 런타임 대상 테스트: node scripts/test-direct.mjs <테스트 파일 경로>.
- 데스크톱 main 테스트: npm run test:desktop-main --prefix apps/desktop.
- 데스크톱 타입 검사: npm run typecheck --prefix apps/desktop.
- 전체 기본 테스트: npm test. 변경 범위에 맞는 검증부터 수행하고 결과를 기록한다.
- 패키징·배포·릴리스 스크립트는 일반 검증으로 실행하지 않는다. deploy:local은 macOS/Windows의 설치 앱 업데이트를 자동 선택한다. deploy:local:plan은 설치나 종료 없이 계획만 확인한다.
- 의존성이나 lockfile은 기능상 필요한 경우에만 변경한다. 비밀 값, 계정 정보, .env 내용을 문서나 로그에 복사하지 않는다.

## Codex에서 열기
Codex 앱의 프로젝트 추가에서 이 저장소 폴더를 선택한다: /Users/indi/code/tandem-dog.
앱 등록 후 이 프로젝트에서 작업을 시작한다. CLI에서는 다음으로 시작할 수 있다.

```sh
cd /Users/indi/code/tandem-dog
codex
```

첫 요청 예시: “AGENTS.md와 현재 변경사항을 확인하고, Claude가 작업 중인 파일을 보존하면서 내가 지정하는 범위만 개발해 줘.”
