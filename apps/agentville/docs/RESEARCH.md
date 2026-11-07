# AgentVille 사전 조사 — 오픈소스 분석

조사일: 2026-11-07. 아래 저장소를 `git clone --depth 1`로 받아 핵심 코드를 직접 읽었습니다.
코드는 복사하지 않았고, 구조와 아이디어만 참고해 새로 구현했습니다.

## 1. 목표 서비스: Meta Muse Spark

| 항목 | 내용 | 출처 |
|---|---|---|
| 정체 | Meta Superintelligence Labs의 Muse 모델군 첫 모델(2026년 4월). meta.ai와 Meta AI 앱에서 동작 | 보도 자료·기사 |
| Contemplating 모드 | 여러 에이전트가 같은 문제를 **병렬로** 풀고 결과를 합침. 지연은 크게 늘리지 않고 사고 시간을 늘리는 방식 | Meta 발표 인용 |
| 역할 분담 예시 | 여행 계획: 일정 작성 에이전트, 목적지 비교 에이전트, 활동 추천 에이전트 | 기사 |
| 모드 | Instant(빠른 답) / Thinking(깊은 추론) | 기사 |
| 1.1 (2차 출처) | 병렬 하위 에이전트 위임, 메인 에이전트가 계획 후 전문 에이전트에 분배, 컴퓨터 사용 | 블로그(검증 필요) |

**AgentVille에 가져온 것:** 병렬 숙고(팀 모드), 메인 에이전트가 계획하고 분배하는 구조, 빠른/깊은 모드
→ 우리는 이것을 **캐릭터 레벨에 따른 사고 깊이**로 바꿔 게임 요소로 만들었습니다.

## 2. 오픈소스 분석

### 2.1 Stanford Generative Agents (`joonspk-research/generative_agents`, Apache-2.0)
- 위치: `reverie/backend_server/persona/cognitive_modules/{retrieve,reflect,plan,converse}.py`
- **기억 검색 점수**: `recency*0.5 + relevance*3 + importance*2` (각 항목 0~1 정규화).
  recency는 `0.99^순번`, relevance는 임베딩 코사인 유사도, importance는 LLM이 매긴 1~10점(poignancy).
- **성찰(reflection) 트리거**: 새 기억의 중요도 합이 `importance_trigger_max = 150`을 넘으면
  초점 질문 3개 생성 → 관련 기억 검색 → 통찰 5개와 근거 생성 → 통찰도 기억으로 저장.
- 한계: 업무 수행 능력 성장이 없음. 성격이 고정됨. 비용이 큼(모든 행동이 LLM 호출).

### 2.2 a16z AI Town (`a16z-infra/ai-town`, MIT)
- 위치: `convex/agent/memory.ts`, `convex/agent/conversation.ts`, `convex/constants.ts`
- **기억 점수**: 정규화한 relevance + importance + recency(`0.99^경과시간`) 합.
- **성찰 트리거**: 최근 기억 100개의 중요도 합이 500을 넘을 때.
- **대화 수명주기**: 시작 / 이어가기 / 떠나기 세 가지 프롬프트. 대화 거리, 쿨다운, 최대 메시지 수를 상수로 관리.
- **활동**: `{ description, emoji, duration }` 형태(독서 📖, 멍때리기 🤔, 정원 가꾸기 🥕).
- 한계: 활동이 무작위에 가깝고 욕구 체계가 없음.

### 2.3 Microsoft TinyTroupe (`microsoft/TinyTroupe`, MIT)
- 위치: `tinytroupe/agent/{tiny_person,memory,mental_faculty}.py`, `examples/agents/*.agent.json`
- **페르소나 명세**: name, age, occupation, style, personality{traits[], big_five{}}, preferences, skills, beliefs, behaviors, relationships…
- **정신 능력(faculty) 플러그인**: Recall, FilesAndWebGrounding, ToolUse.
- **기억**: EpisodicMemory + SemanticMemory, 그리고 정리(consolidation)·성찰 처리기.
- 가져온 것: Big Five를 자연어로 풀어 프롬프트에 넣는 방식, 능력을 플러그인처럼 켜고 끄는 구조.

### 2.4 MineDojo Voyager (`MineDojo/Voyager`, MIT)
- 위치: `voyager/agents/{skill,curriculum,critic}.py`
- **스킬 라이브러리**: 성공한 행동을 설명과 함께 저장하고 다음 과제에서 검색해 재사용.
- **자동 커리큘럼**: 완료·실패 과제를 기록해 다음 과제를 제안. **Critic**이 스스로 성공 여부를 검증.
- 가져온 것: "성장하면 실제로 일하는 방식이 바뀐다". 우리는 스킬 레벨에 따라 **작업 단계(계획·검토·채점 기준)가 풀리는 퍽(perk)** 으로 구현.

### 2.5 OpenBMB ChatDev (`OpenBMB/ChatDev`, Apache-2.0)
- 1.0: CEO·CTO·프로그래머 같은 역할이 단계별 회의(chat chain)로 소프트웨어를 만드는 가상 회사.
- 2.0: YAML로 에이전트와 워크플로를 정의하는 무코드 멀티 에이전트 플랫폼(`yaml_instance/`).
- 가져온 것: 역할(직업) 프리셋, 팀 업무에서 리더가 결과를 종합하는 단계.

### 2.6 CrewAI (`crewAIInc/crewAI`, MIT)
- 에이전트 = `role / goal / backstory` + `allow_delegation`, `max_iter`, `reasoning`.
- 가져온 것: 직업·목표·배경 이야기로 캐릭터를 정의하는 단순한 틀.

### 2.7 Letta(MemGPT) (`letta-ai/letta`, Apache-2.0)
- "시간이 지나며 배우고 나아지는 상태 있는(stateful) 에이전트". 핵심 기억 블록과 보관 기억을 나눔.
- 받은 공개 저장소는 현재 문서 위주라 구조 개념만 참고.
- 가져온 것: **사용자 선호 기억**을 일반 기억과 분리해 항상 프롬프트에 넣음.

### 2.8 Google DeepMind Concordia (`google-deepmind/concordia`, Apache-2.0)
- 컴포넌트 기반 에이전트: `SelfPerception`, `SituationPerception`, `PersonBySituation`(최근 기억에 질문을 던져 자기 인식 생성).
- 게임 마스터 컴포넌트가 사건을 판정.
- 가져온 것: 시뮬레이션 규칙(욕구·관계·보상)은 코드가 결정하고, LLM은 표현과 결과물을 맡는 분리.

### 2.9 Character Card V2 (`malfoyslastname/character-card-spec-v2`)
- 필드: name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt,
  post_history_instructions, alternate_greetings, tags, creator, character_version, **extensions**.
- 가져온 것: 캐릭터 내보내기·가져오기 형식. AgentVille 고유 데이터는 `extensions.agentville`에 넣어 왕복 보존.

### 2.10 라이프 시뮬레이션 장르 공통 메커니즘
- 욕구(배고픔·에너지·사교·재미)가 시간에 따라 줄고, 사물이 "이 활동을 하면 어떤 욕구가 얼마나 찬다"를 광고하면
  캐릭터가 가장 이득이 큰 행동을 고르는 **유틸리티 AI**.
- 짧은 감정 효과(무들렛)가 쌓여 기분이 되고, 기분이 행동 효율에 영향을 줌.
- 장기 목표(열망)와 특성(trait)이 캐릭터의 개성을 만든다.
- AgentVille은 이 장르 문법을 따르되, 고유 이름·그림·자산은 모두 새로 만들었습니다.

## 3. 비교와 차별점

| 기능 | Gen. Agents | AI Town | TinyTroupe | Voyager | CrewAI | Muse Spark | **AgentVille** |
|---|---|---|---|---|---|---|---|
| 기억 검색(최근성·관련성·중요도) | ✅ | ✅ | ✅ | – | 부분 | ? | ✅ (한국어 바이그램) |
| 성찰 | ✅ | ✅ | ✅ | – | – | ? | ✅ + **특성·성격 메모 생성** |
| 실제 업무 수행 | – | – | 부분 | 게임 내 | ✅ | ✅ | ✅ |
| 병렬 멀티 에이전트 | – | – | – | – | ✅ | ✅ | ✅ 팀 숙고 모드 |
| 능력치·레벨·스킬 | – | – | – | 스킬 목록 | – | – | ✅ 6능력치·10스킬·퍽 |
| **성장 → 작업 방식 변화** | – | – | – | ✅ | – | – | ✅ 사고 깊이·단계·기억량 |
| 성격 변화(Big Five 표류·특성 획득) | – | – | – | – | – | – | ✅ |
| 욕구·기분·유틸리티 AI | – | 부분 | – | – | – | – | ✅ |
| 관계(캐릭터끼리·사용자와) | 부분 | 부분 | 부분 | – | – | – | ✅ |
| API 키 없이 동작 | – | – | – | – | – | – | ✅ 시뮬레이션 두뇌 |

## 4. 결론

1. 기억·성찰은 Generative Agents와 AI Town의 검증된 점수식을 쓰고, 임베딩 대신 **한국어 문자 바이그램**으로 의존성을 없앤다.
2. "성장"이 숫자 놀음이 되지 않도록 Voyager의 교훈을 따라 **레벨이 실제 작업 파이프라인과 사고 깊이를 바꾸게** 한다.
3. Muse Spark의 병렬 숙고는 **팀 모드**로 구현하되, 참여자마다 성격과 전문성이 다른 관점을 낸다.
4. 시뮬레이션 규칙은 코드가, 결과물과 대사는 LLM이 맡는다(Concordia식 분리). 그래서 비용을 통제하고 오프라인에서도 게임이 돈다.
