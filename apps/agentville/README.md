# AgentVille — 함께 일하며 자라는 AI 동료들의 마을

AgentVille은 **AI 에이전트 작업 도구**와 **심즈 같은 캐릭터 생활 게임**을 하나로 합친 프로그램입니다.
업무를 맡기면 캐릭터가 Claude로 실제 결과물을 만들고, 일한 만큼 레벨·스킬·능력치가 오르고, 경험이 쌓이면 스스로 돌아보며 성격이 새로 생깁니다.
쉬는 시간에는 마을에서 밥을 먹고, 수다를 떨고, 낮잠을 자며 서로 친해집니다.

- 조사 결과와 참고한 오픈 소스: [docs/RESEARCH.md](docs/RESEARCH.md)
- 기획·설계 문서: [docs/DESIGN.md](docs/DESIGN.md)

## 바로 실행

```sh
cd apps/agentville
npm install
npm start            # http://127.0.0.1:4747
```

API 키 없이도 **시뮬레이션 두뇌**로 모든 기능(업무, 성장, 대화, 마을 생활)이 동작합니다. 실제 Claude로 일하게 하려면:

```sh
ANTHROPIC_API_KEY=... npm start
```

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (없음) | 있으면 Claude 두뇌 사용. `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_PROFILE`도 인식 |
| `AGENTVILLE_PROVIDER` | 자동 | `offline`(시뮬레이션 고정) 또는 `anthropic`(Claude 고정) |
| `AGENTVILLE_MODEL` | `claude-opus-5-5` | 사용할 Claude 모델 |
| `AGENTVILLE_DATA` | `apps/agentville/.data/world.json` | 마을 저장 파일 (`.data/`는 git에서 제외) |
| `AGENTVILLE_SIM_DELAY` | `18` | 시뮬레이션 두뇌의 글자 스트리밍 간격(ms) |
| `PORT` / `HOST` | `4747` / `127.0.0.1` | 서버 주소. 기본은 이 컴퓨터에서만 접속 가능 |

> **서버 측 폴백이 켜져 있습니다.** Claude 요청에는 `fallbacks: "default"`(베타 `server-side-fallback-2026-07-01`)가 붙어,
> 안전 정책으로 응답이 거절되면 서버가 다른 모델로 한 번 더 시도합니다. 계정이 이 옵션을 거부하면 자동으로 끄고 계속 동작합니다.
> 끄고 싶으면 [src/llm/anthropic.mjs](src/llm/anthropic.mjs)의 `useFallbacks`를 `false`로 두면 됩니다.

## 무엇을 할 수 있나

| 기능 | 내용 |
| --- | --- |
| 업무 맡기기 | 분야·난이도를 자동 판별하고 적임자를 추천합니다. 어려운 일은 **팀 숙고**(각자 다른 관점으로 병렬 초안 → 리더 종합)로 진행됩니다. 진행 단계가 실시간으로 스트리밍됩니다. |
| 성장 | 캐릭터 레벨(오를수록 Claude의 사고 깊이 `effort`가 low → medium → high → xhigh), 스킬 10종(Lv2 계획, Lv4 자기 검토, Lv6 기억 확장, Lv8 기준표, Lv10 장인 단계가 열림), 능력치 6종, 꿈(열망) 3단계 |
| 성격 | Big Five, 시작 특성 12종, 기록으로 얻는 특성 13종 + 분야별 베테랑. 성찰(Reflection)이 성격 메모와 특성 힌트를 남기고, 일과 피드백에 따라 Big Five가 하루 한도 안에서 조금씩 변합니다. |
| 기억 | 업무·대화·피드백·선호를 기억하고 최근성·관련성·중요도로 꺼내 씁니다. "앞으로는 표로 정리해 줘" 같은 말은 선호로 저장되어 다음 업무 지시에 들어갑니다. |
| 마을 생활 | 욕구 5종(에너지·포만감·사교·재미·집중), 무들렛, 유틸리티 AI로 고르는 활동(커피, 점심, 낮잠, 게임, 독서, 산책, 수다, 수면), 친구·단짝 관계 |
| 평가 | 결과에 별점과 한마디를 남기면 기분·호감도·보너스 경험치·기억에 반영됩니다. |
| 캐릭터 카드 | Character Card V2(JSON)로 내보내고 가져옵니다. AgentVille 카드는 성장 기록까지 그대로 옮겨집니다. |

## 구조

```
src/
  catalog/    스킬·특성·직업·꿈·마을 지도 같은 게임 데이터
  engine/     규칙(코드가 결정): 캐릭터, 욕구, 기억, 성격, 업무 배정, 보상, 작업 흐름, 마을 시뮬레이션
  llm/        두뇌: Claude(공식 @anthropic-ai/sdk, 스트리밍 + JSON 스키마 출력)와 오프라인 시뮬레이션
  server.mjs  REST API + SSE 실시간 스트림 + 정적 파일
public/       브라우저 UI (빌드 없는 ES 모듈, 캔버스 마을)
```

수치와 규칙은 코드가 정하고 LLM은 표현(결과물, 대사, 회고, 성찰)만 맡습니다. 그래서 같은 상황이면 성장 규칙이 항상 같게 적용되고, API 없이도 테스트할 수 있습니다.

## 테스트

```sh
npm test
```

엔진 단위 테스트(지도 연결성, 기억 검색, 업무 배정, 성장·특성·성격 변화), 오프라인 두뇌로 돌리는 마을 전체 흐름(혼자·팀 업무, 평가, 대화, 실패와 재시도, 하루 생활), 카드·저장, HTTP API·SSE까지 다룹니다.
