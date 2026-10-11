
/* ================= 분할 도우미 ================= */
let splitCtl = null, lastPlan = null;
const splitSlots = () => (deskList().length >= 2 ? deskList() : ["A", "B"]);
function cleanPlan(p, slots = splitSlots()) {
  const arr = x => (Array.isArray(x) ? x : []).map(t => ({ title: String(t?.title || "").slice(0, 120), paths: (Array.isArray(t?.paths) ? t.paths : []).map(normPath).filter(Boolean).slice(0, 6), owner: slots.includes(t?.owner) ? t.owner : slots[0] })).filter(t => t.title);
  const src = p?.desks && typeof p.desks === "object" ? p.desks : p || {};
  const plan = { slots, desks: {}, shared: arr(p?.shared), order: String(p?.order || "").slice(0, 400), overlaps: [] };
  for (const s of slots) plan.desks[s] = arr(src[s]);
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
    for (const a of plan.desks[slots[i]]) for (const b of plan.desks[slots[j]]) for (const pa of a.paths) for (const pb of b.paths)
      if (overlaps(pa, pb)) plan.overlaps.push(`${slots[i]} ${pa} ↔ ${slots[j]} ${pb}`);
  return plan;
}
function showPlan(plan, note) {
  lastPlan = plan;
  const col = s => `<div class="card" style="background:var(--sunk)"><div class="card-t">${pill(s, "데스크 " + s)} ${esc(deskName(s))}</div>${plan.desks[s].map(t => `<div class="task ${s}" style="cursor:default"><div class="task-t">${esc(t.title)}</div>${t.paths.length ? `<div class="task-paths">${t.paths.map(p => `<code>${esc(p)}</code>`).join("")}</div>` : ""}</div>`).join("") || '<div class="empty small">없음</div>'}</div>`;
  $("#splitOut").innerHTML = `<div class="stack">
    ${note ? `<div class="tip info"><div class="tip-i">i</div><div class="tip-b">${esc(note)}</div></div>` : ""}
    ${plan.overlaps.length ? `<div class="tip bad"><div class="tip-i">!</div><div class="tip-b"><b>데스크끼리 경로가 겹쳐요:</b> ${plan.overlaps.slice(0, 3).map(esc).join(", ")}. 보드에 올리기 전에 경로를 고치세요.</div></div>` : plan.slots.filter(x => plan.desks[x].length).length >= 2 ? `<div class="tip ok"><div class="tip-i">✓</div><div class="tip-b">데스크별 파일 영역이 겹치지 않아요. 동시에 진행해도 안전해요.</div></div>` : ""}
    <div class="split-out">${plan.slots.map(col).join("")}</div>
    ${plan.shared.length ? `<div class="card"><div class="card-t">공유 파일 · 먼저 한쪽이 처리</div>${plan.shared.map(t => `<div class="li"><span class="stripe ${t.owner}"></span><div class="li-main"><div class="li-t">${esc(t.title)} ${pill(t.owner, "담당 " + t.owner)}</div><div class="li-s path">${t.paths.map(esc).join(", ")}</div></div></div>`).join("")}</div>` : ""}
    ${plan.order ? `<p class="small"><b>진행 순서</b> · ${esc(plan.order)}</p>` : ""}
    <div class="row"><button class="btn primary" data-act="splitAdd" data-mode="assign">데스크별로 바로 배정하고 잠그기</button><button class="btn" data-act="splitAdd" data-mode="queue">대기열에만 올리기</button></div></div>`;
}
async function addPlan(mode) {
  if (!lastPlan) return;
  if (!S.me) return askDesk();
  const all = [...lastPlan.shared.map(t => ({ ...t, slot: t.owner, shared: true })), ...lastPlan.slots.flatMap(s => lastPlan.desks[s].map(t => ({ ...t, slot: s })))];
  for (const t of all) {
    const id = uid(), assign = mode === "assign" && !!S.desks[t.slot];
    await put("tasks", id, { title: (t.shared ? "[공유] " : "") + t.title, paths: t.paths, status: assign ? "doing" : "todo", slot: assign ? t.slot : null, hint: t.slot, createdAt: now() });
    if (assign) for (const p of t.paths) { const r = await addClaim(p, t.title, 3, { taskId: id, slot: t.slot }); if (r.conflicts) toast(`${p} 는 이미 잠겨 있어 건너뛰었어요.`, "warn"); }
  }
  addLog("split", `분할 계획으로 작업 ${all.length}개 추가`);
  toast(mode === "assign" ? `작업 ${all.length}개를 배정하고 경로를 잠갔어요.` : `작업 ${all.length}개를 대기열에 올렸어요.`, "ok");
  $("#splitOut").innerHTML = ""; lastPlan = null;
}
function localSplit(desc) {
  const slots = splitSlots(), items = desc.split(/\n|,|·|;|\s및\s/).map(s => s.replace(/^[-*\d.)\s]+/, "").trim()).filter(s => s.length > 1);
  const plan = { desks: {}, shared: [], order: "" };
  for (const s of slots) plan.desks[s] = [];
  (items.length > 1 ? items : [desc]).forEach((t, i) => plan.desks[slots[i % slots.length]].push({ title: t.slice(0, 120), paths: [] }));
  showPlan(cleanPlan(plan, slots), "Claude 연결 없이 항목을 데스크마다 돌아가며 나눴어요. 각 작업의 경로는 보드에서 직접 채우거나, 잠금 화면에서 잠그세요.");
}
async function runSplit() {
  const desc = $("#splitIn").value.trim();
  if (!desc) { $("#splitIn").focus(); return showHint("만들 기능을 먼저 적어주세요. 쉼표나 줄바꿈으로 항목을 나누면 더 잘 나눠요.", true); }
  if (!sample) return localSplit(desc);
  splitCtl = new AbortController();
  $("#splitBtn").disabled = true; $("#splitStop").hidden = false; $("#splitStatus").textContent = "Claude가 파일 영역을 나누는 중… (보통 10~40초)";
  const locks = S.claims.filter(active).map(c => `${c.slot}: ${c.path}`).join("\n") || "(없음)";
  const slots = splitSlots();
  const ex = {}; slots.forEach((x, i) => (ex[x] = [{ title: ["결제 웹훅 핸들러", "결제 폼 UI", "결제 e2e 테스트", "영수증 이메일"][i % 4], paths: [["src/api/payments/**", "src/ui/checkout/**", "tests/e2e/pay/**", "src/email/receipt/**"][i % 4]] }]));
  const prompt = `${slots.length}대의 PC(데스크 ${slots.join(", ")})가 하나의 Claude 계정으로 같은 저장소를 동시에 개발한다.
아래 기능을 PC들이 동시에 진행할 수 있도록 데스크별 작업 묶음으로 나눠라.

규칙:
- 서로 다른 데스크의 paths는 절대 겹치면 안 된다 (저장소 기준 glob, 예: src/api/payments/**).
- 여러 데스크가 함께 건드려야 하는 파일(공통 타입, 설정, 라우터 등록 등)은 shared에 넣고 owner를 데스크 하나(${slots.join("/")})로 정한다.
- 작업 제목은 한국어로 짧고 구체적으로. 데스크마다 1~4개. 일이 적으면 일부 데스크는 빈 배열이어도 된다.
- 이미 잠긴 경로를 피하라.
- order에는 충돌을 줄이는 진행 순서를 한두 문장으로.

이미 잠긴 경로:
${locks}

기능 설명:
${desc.slice(0, 4000)}

JSON 하나로만 답하라. 형식:
${JSON.stringify({ desks: ex, shared: [{ title: "결제 타입 정의", paths: ["src/types/payment.ts"], owner: slots[0] }], order: `${slots[0]}가 공유 타입을 먼저 푸시한 뒤 나머지가 pull 하고 시작` })}`;
  try {
    const res = await sample.json(prompt, { signal: splitCtl.signal });
    showPlan(cleanPlan(res, slots));
    $("#splitStatus").textContent = "";
  } catch (e) {
    const msg = { cancelled: "", not_granted: "Claude 사용이 허용되지 않아 기본 방식으로 나눴어요.", sampling_disabled: "이 계정에서는 Claude 호출을 쓸 수 없어 기본 방식으로 나눴어요.", rate_limited: "요청이 많아요. 잠시 후 다시 눌러주세요.", invalid_json: "답을 해석하지 못했어요. 설명을 조금 줄여서 다시 시도하세요." }[e?.code];
    if (e?.code === "not_granted" || e?.code === "sampling_disabled") { sample = null; renderSampleMode(); localSplit(desc); }
    $("#splitStatus").textContent = msg ?? "나누지 못했어요. 다시 시도해 주세요.";
  } finally { $("#splitBtn").disabled = false; $("#splitStop").hidden = true; splitCtl = null; }
}

/* ================= 도움말 · Claude에게 묻기 ================= */
const FAQ = [
  ["PC를 더 추가하거나 빼려면?", "새 PC의 Claude 앱에서 이 링크를 열고 '새 데스크'를 고르면 추가돼요(최대 8대). 위쪽 바의 'PC 추가'나 관제실의 추가 카드로도 할 수 있어요. 빼려면 관제실의 데스크 카드에서 '빼기'를 누르세요. 그 데스크의 잠금은 풀리고 진행 중 작업은 대기열로 돌아가요.", "추가 빼기 제거 삭제 새 pc 늘리 대수 몇 대"],
  ["한 계정으로 여러 PC에 동시에 로그인해도 되나요?", "네, 괜찮아요. 다만 사용량 한도는 계정 단위라 모든 PC가 합쳐서 씁니다. '사용량' 화면에서 전체 PC 부하를 같이 보면서 무거운 작업을 한쪽에 몰아주세요.", "로그인 동시 접속 계정 두 대"],
  ["여러 PC에서 같은 브랜치를 써도 되나요?", "피하세요. 같은 브랜치에 여러 PC가 푸시하면 거절되거나 충돌이 나요. 데스크별 접두사(a/기능, b/기능, c/기능…)를 쓰고 main으로 합치세요. 관제실에 브랜치를 적으면 같은 브랜치일 때 코치가 바로 경고합니다.", "브랜치 branch 충돌 push 푸시 같은"],
  ["잠금이 실제로 파일을 막나요?", "아니요, PC들 사이의 약속이에요. 대신 '작업 경계 프롬프트'를 Claude에게 붙여넣어 금지 경로를 알려주고, pre-commit 훅으로 커밋 단계에서 한 번 더 막을 수 있어요.", "잠금 lock 막 파일 훅 hook"],
  ["다른 PC의 Claude 대화를 이어갈 수 있나요?", "로컬 Claude Code 세션 기록은 각 PC에 저장돼요. 자리를 옮기기 전에 '바통 터치'로 한 일과 다음 할 일을 남기면, 다른 PC에서 그대로 붙여넣을 이어하기 프롬프트가 만들어져요.", "대화 이어 세션 기록 옮기 바통 handoff"],
  ["잠금이 겹치면 어떻게 하나요?", "'영역 잠금'에서 겹친 항목이 빨갛게 표시돼요. 한쪽이 범위를 좁히거나 해제하세요. '해제 요청' 버튼을 누르면 상대 PC에 바로 알림이 갑니다.", "겹침 충돌 잠금 conflict 해제"],
  ["사용량을 아끼려면?", "무거운 작업(대규모 리팩터링, 여러 에이전트)은 한 PC에서만 돌리고, 다른 PC는 리뷰·테스트·문서처럼 가벼운 일을 맡기세요. 같은 파일을 여러 PC에서 다시 읽히지 말고 바통 요약만 넘기세요. 정확한 남은 한도는 claude.ai 설정의 사용량 화면에서 확인하세요.", "사용량 한도 limit 아끼 토큰 usage"],
  ["이 페이지의 데이터는 어디에 저장되나요?", "이 아티팩트의 공유 저장소에 저장돼서, 같은 계정으로 연 모든 PC에서 똑같이 보여요. 이 PC가 어느 데스크인지는 이 브라우저에만 저장됩니다.", "저장 데이터 어디 동기화 sync"],
  ["데스크를 잘못 골랐어요.", "상단의 ⇄ 버튼을 누르면 언제든 바꿀 수 있어요. 여러 PC가 같은 데스크를 고르면 서로를 구분할 수 없으니 PC마다 다른 데스크를 쓰세요.", "데스크 잘못 변경 바꾸"],
  ["다른 PC가 오프라인으로 보여요.", "그 PC가 이 페이지를 열어두고 있어야 '접속 중'으로 보여요. 페이지를 닫아도 그 PC가 남긴 상태, 잠금, 바통은 그대로 남아 있어요.", "오프라인 접속 안 보 연결"],
  ["비밀번호나 API 키를 릴레이로 보내도 되나요?", "보내지 마세요. 릴레이 내용은 이 아티팩트의 저장소에 남아요. 키처럼 보이는 문자열이 있으면 보내기 전에 경고합니다. .env 같은 파일은 각 PC에 따로 두세요.", "비밀 키 api password 릴레이 env"],
  ["Claude 계정이나 Codex로 바꿔서 이어가려면?", "프로젝트 세션에서 쓰는 계정을 등록하고 '이 계정으로 전환'을 누르세요. 세션 팩이 만들어지면 그 앱에서 해당 계정으로 로그인한 뒤 붙여넣으세요. Codex는 AGENTS.md, Claude Code는 CLAUDE.md를 저장소에 넣어두면 규칙을 자동으로 읽어요. 작업이 끝나면 결과를 '결과 가져오기'에 붙여넣어 세션을 이어가세요. 이 페이지는 계정에 직접 로그인하거나 비밀번호를 저장하지 않아요.", "계정 전환 codex 코덱스 claude 바꾸 이어 세션 팩"],
  ["어느 PC·어느 AI에서든 같은 세션으로 시작하려면?", "프로젝트 세션의 '가상 세션 키트' 설치 명령을 저장소에서 PC마다 한 번 실행하세요. 세션이 .tandem/SESSION.md로 저장소에 들어가고, Claude Code는 시작할 때마다 자동으로 pull하고 읽어요. Codex는 AGENTS.md에 따라 읽어요. 옮길 땐 'sh .tandem/tandem.sh leave \"한 일\" \"다음 할 일\"', 앉을 땐 'sh .tandem/tandem.sh resume <브랜치>' 한 줄이면 돼요.", "가상 세션 키트 자동 같은 세션 codex claude 훅 hook SESSION.md 자동화"],
  ["PC를 옮겨도 같은 환경에서 이어서 하려면?", "'작업 흐름' 화면에서 작업 브랜치를 시작하고, 자리를 옮길 때 '떠나기'로 메모를 남긴 뒤 커밋·푸시하세요. 새 PC에서 '이어받기'를 누르면 코드를 맞추는 명령과, 지난 자리의 메모·다음 할 일·이동 경로가 담긴 프롬프트를 줘요. Claude나 Codex에 붙여넣고 '이어받았어요'를 누르면 작업 줄에 이어집니다.", "이어 같은 환경 옮기 자리 이어하기 연속 브랜치 작업 흐름"],
  ["PC 폴더, 가상 세션, GitHub 파일이 같은지 보려면?", "'작업 흐름' 화면의 '파일 단위'에서 스냅샷 명령을 복사해 각 PC 저장소에서 실행하고, 결과를 붙여넣으세요. 이 PC 폴더와 GitHub 기준 브랜치의 파일별 git 해시가 지금 계정 이름으로 기록돼요. 가상 세션 파일은 자동으로 계산돼서 한 표에서 색으로 비교됩니다. 파일을 누르면 위치별 버전과 바뀐 이력이 나와요.", "버전 비교 github 깃허브 폴더 스냅샷 같은지 차이 diff"],
  ["~/.claude 설정은 어떻게 맞추나요?", "'셋업 키트' 6·7번 명령으로 settings.json, CLAUDE.md, commands, agents, skills를 비공개 git 저장소로 묶고 다른 PC에서 링크하세요. 로그인·MCP 인증이 든 ~/.claude.json은 동기화하지 마세요.", "설정 settings claude.md 동기화 mcp 에이전트"],
];
const NAV_HELP = {
  overview: "<b>관제실</b> · 모든 PC 상태와 코치의 다음 행동 제안",
  session: "<b>프로젝트 세션</b> · Claude·Codex 계정을 전환해도 하나의 세션으로 이어가기",
  console: "<b>개발 콘솔</b> · Claude가 공유 프로젝트 파일을 읽고 고치는 에이전트",
  versions: "<b>작업 흐름</b> · 작업(브랜치)이 PC·계정을 오가며 한 줄로 이어지게. 파일 단위 비교도 여기서",
  parallel: "<b>병렬 작업</b> · 기능을 데스크별로 겹치지 않게 나누고 보드로 관리",
  claims: "<b>영역 잠금</b> · 수정할 경로를 잠가 동시 편집 충돌 방지",
  baton: "<b>바통 터치</b> · PC를 옮길 때 Claude 맥락 넘기기",
  relay: "<b>릴레이</b> · PC들 사이 공유 클립보드",
  usage: "<b>사용량</b> · 같은 계정 한도를 모든 PC가 나눠 쓰는 현황",
  setup: "<b>셋업 키트</b> · 브랜치·루틴·설정 동기화 명령어",
  help: "<b>도움말</b> · 체크리스트, FAQ, Claude에게 묻기",
};
const EXPLAIN = {
  kit: ["가상 세션 키트는 무엇을 자동화하나요?", "설치 명령을 저장소에서 한 번 실행하면 .tandem/SESSION.md(목표·현재 상태·다음 단계·결정·작업 로그)와 도우미 스크립트가 생기고 git에 올라가요. Claude Code에는 시작 훅이 추가돼서 어느 PC에서 시작하든 자동으로 pull하고 세션을 읽어요. Codex는 AGENTS.md 지시대로 시작할 때 세션을 읽어요. AI는 작업을 마치면 SESSION.md를 갱신하고, 'resume'·'leave' 한 줄로 이어받기·떠나기(커밋·푸시·기록·스냅샷 복사)를 해요. 대시보드에는 스냅샷 한 번만 붙여넣으면 세션 내용과 떠나기·이어받기 기록이 모두 반영돼요."],
  lanes: ["작업 브랜치 줄은 무엇을 보여주나요?", "브랜치마다 GitHub와 각 PC(그 PC에서 쓰던 계정 포함)의 최신 커밋을 나란히 보여줘요. 같은 색은 같은 커밋이에요. 푸시 안 한 커밋(↑), 받아야 할 커밋(↓), 커밋 안 한 변경, GitHub에 없는 로컬 전용 브랜치가 표시되고, 한 줄 요약으로 어디를 맞춰야 하는지 알려줘요. 아래 동그라미 줄은 이 작업이 어느 PC·계정을 거쳐 왔는지 보여주는 이동 기록이에요. 상태는 각 PC가 스냅샷을 올린 시점 기준이에요."],
  snapshot: ["스냅샷은 어떻게 동작하나요?", "이 페이지는 PC 폴더나 GitHub에 직접 접속할 수 없어서, 각 PC에서 명령을 한 번 실행해 상태를 가져와요. 명령은 git fetch로 GitHub 최신 상태를 받은 뒤, 이 PC 폴더의 파일별 git 해시(git hash-object), 원격 기준 브랜치의 파일별 해시(git ls-tree), 현재 브랜치·커밋, 푸시 안 한 커밋 수와 받을 커밋 수, 커밋 안 한 파일 목록을 만들어 클립보드에 복사해요. 파일 내용은 보내지 않아요. 올리면 이 PC의 데스크와 지금 쓰는 계정 이름으로 기록되고, 이전 스냅샷과 비교해 추가·변경·삭제된 파일 이력이 남아요. 가상 세션 파일은 페이지가 git과 같은 방식으로 해시를 계산하므로, 내용이 같으면 같은 버전으로 표시돼요."],
  agents: ["계정 전환은 어떻게 동작하나요?", "이 페이지는 다른 계정에 로그인하지 않아요(아티팩트는 외부 서버에 접속할 수 없고, 비밀번호·키도 저장하지 않아요). 대신 계정을 이름표로 등록해 두고 '전환'을 누르면, 세션 타임라인에 전환이 기록되고 그 도구(Claude 또는 Codex)에 맞는 세션 팩이 만들어져요. 그 앱에서 해당 계정으로 로그인한 뒤 세션 팩을 붙여넣으면 이전 계정이 하던 작업을 그대로 이어받아요. 한도에 닿은 계정은 '한도 도달'로 표시하면 코치가 다른 계정으로 전환을 제안해요. 각 서비스의 이용 약관 안에서 쓰세요."],
  pack: ["세션 팩이란?", "목표, 현재 상태, 다음 단계, 결정 사항, 남은 작업, 최근 작업 기록, 다른 PC가 잠근 경로, 작업 브랜치를 하나로 묶은 이어하기 프롬프트예요. 어떤 계정·도구로 바꿔도 이걸 첫 메시지로 붙여넣으면 같은 세션을 이어가는 것처럼 동작해요. Claude Code용 CLAUDE.md, Codex용 AGENTS.md 내용도 함께 만들어 저장소에 넣어두면 도구가 자동으로 읽어요. 팩 마지막의 요약 형식대로 결과를 받아 '결과 가져오기'에 붙여넣으면 세션이 이어져요."],
  coach: ["코치는 무엇을 보나요?", "모든 데스크의 브랜치, 잠금 겹침, 받지 않은 바통, 잠기지 않은 진행 작업, 전체 PC의 부하, 세션 창 타이머를 계속 비교해서 지금 할 일을 위험한 순서대로 보여줘요. 버튼을 누르면 해당 화면으로 바로 이동합니다."],
  split: ["분할 도우미는 어떻게 나누나요?", "설명을 Claude에게 보내 연결된 데스크 수만큼, 서로 파일 영역이 겹치지 않게 작업을 나누도록 합니다. 둘 다 건드려야 하는 공통 파일은 '공유'로 따로 빼서 한쪽이 먼저 처리하게 해요. 결과에서 경로가 겹치면 빨간 경고가 뜹니다. Claude 사용이 허용되지 않으면 항목을 번갈아 나누는 기본 방식으로 동작해요."],
  boundary: ["작업 경계 프롬프트란?", "Claude는 다른 PC가 무엇을 하는지 모릅니다. 이 프롬프트를 세션 시작 때 붙여넣으면 상대 PC가 잠근 경로는 읽기만 하도록 지시할 수 있어요. 잠금이 바뀌면 내용도 자동으로 바뀌니 다시 복사하세요."],
  window: ["세션 창 타이머란?", "모든 PC가 같은 계정 한도를 쓰기 때문에, 한 PC에서 시작한 시간을 모든 PC가 같이 볼 수 있도록 만든 공용 타이머예요. 실제 한도와 리셋 시각은 claude.ai 설정의 사용량 화면이 기준이에요."],
};
function explain(k) { const [t, b] = EXPLAIN[k] || ["도움말", ""]; confirmBox(t, `<p>${esc(b)}</p>`, [{ label: "알겠어요", cls: "primary" }]); }
function renderFaq() { $("#faq").innerHTML = FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join(""); }
function renderKeys() {
  const K = [["⌘ K 또는 /", "모든 기능 검색"], ["1 ~ 9, 0", "화면 전환 (메뉴 순서)"], ["?", "튜토리얼"], ["⌘ Enter", "릴레이·바통 보내기"], ["Esc", "창 닫기"], ["← →", "튜토리얼 이동"], ["마우스 올리기 · 길게 누르기", "버튼 상세 설명"]];
  $("#keys").innerHTML = K.map(([k, d]) => `<div class="li"><div class="li-main">${esc(d)}</div><kbd>${esc(k)}</kbd></div>`).join("");
}
let hintTimer = null;
function showHint(html, sticky) { clearTimeout(hintTimer); $("#hintText").innerHTML = html || ""; $("#hintbar").hidden = !html; if (!sticky) return; hintTimer = setTimeout(hideHint, 6000); }
function hideHint() { $("#hintbar").hidden = true; }
function liveConflictHint(v, kind) {
  const p = normPath(v); if (!p) return hideHint();
  const hit = conflictsFor(p, S.me || "A")[0];
  if (hit) showHint(`<b style="color:var(--bad)">${esc(deskName(hit.slot))}가 잡은 ${esc(hit.path)} 와 겹쳐요.</b> 범위를 좁히거나 해제를 요청하세요.`);
  else showHint(kind === "claim" ? `<b>${esc(p)}</b> 는 비어 있어요. 잠가도 안전해요.` : `<b>${esc(p)}</b> 는 아직 아무도 잡지 않았어요.`);
}

const ASK_CHIPS = ["지금 상태에서 뭘 먼저 해야 해?", "Claude에서 Codex로 넘어가려면?", "PC를 하나 더 추가하려면?", "PC를 옮길 때 순서 알려줘", "여러 PC에서 같은 브랜치를 써도 돼?", "사용량을 아끼려면?", "잠금이 겹치면 어떻게 해?"];
function renderAskChips() { $("#askChips").innerHTML = ASK_CHIPS.map(c => `<button class="chip" type="button">${esc(c)}</button>`).join(""); }
function renderSampleMode() {
  const on = !!sample;
  renderConMode();
  for (const id of ["#splitMode", "#askMode"]) { const el = $(id); el.className = "pill " + (on ? "ok" : "neutral"); el.textContent = on ? "Claude 연결됨" : "기본 모드"; }
  $("#splitBtn").lastChild.textContent = on ? "데스크별로 나누기" : "항목별로 나누기";
}
function stateSummary() {
  const desks = {}, doing = {};
  for (const s of deskList()) { const d = S.desks[s]; desks[s] = { 이름: d.name, 브랜치: d.branch || "", 하는일: d.task || "", 부하: LOADS[d.load || 0], 접속: !!S.online[s] }; doing[s] = S.tasks.filter(t => t.status === "doing" && t.slot === s).map(t => t.title).slice(0, 5); }
  return JSON.stringify({
    이PC: S.me ? "데스크 " + S.me : "미지정", 데스크: desks,
    활성잠금: S.claims.filter(active).map(c => `${c.slot}:${c.path}`).slice(0, 24),
    잠금겹침: crossConflicts().map(([a, b]) => `${a.slot}:${a.path}↔${b.slot}:${b.path}`).slice(0, 5),
    작업: { 대기: S.tasks.filter(t => t.status === "todo").length, 진행: doing },
    받지않은바통: S.batons.filter(b => b.to === S.me && !b.ackAt).length,
    세션창: S.usage?.start ? `${Math.round((now() - S.usage.start) / 60000)}분 경과 / ${S.usage.hours}시간` : "꺼짐",
    코치경고: tips().filter(t => t.l === "bad" || t.l === "warn").map(t => t.t.replace(/<[^>]+>/g, "")).slice(0, 4),
  });
}
const RULES = () => `너는 'Tandem Desk' 안의 도우미다. 사용자는 하나의 Claude 계정으로 여러 PC(데스크 A~H, 원하는 만큼 추가·제거 가능)에 Claude 앱을 설치해 동시에 개발한다.
이 도구의 화면: 관제실(모든 PC 상태·코치·PC 추가/빼기), 병렬 작업(분할 도우미·작업 보드, 카드를 가져가면 경로 자동 잠금), 영역 잠금(경로 잠금·경로 검사기·작업 경계 프롬프트·pre-commit 훅), 바통 터치(받는 PC를 골라 이어하기 프롬프트 전달), 릴레이(모든 PC로 보내는 공유 클립보드), 사용량(세션 창 타이머·전체 PC 부하), 셋업 키트(데스크별 브랜치 a/·b/·c/…, 시작/종료 루틴, 워크트리, ~/.claude 설정 동기화), 도움말. 단축키 ⌘K.
사실: 로컬 Claude Code 세션 기록은 PC별로 저장된다. 사용량 한도는 계정 단위로 합산된다. ~/.claude 개인 설정과 MCP 인증은 PC별이다. 잠금은 협조용 약속이며 파일을 물리적으로 막지 않는다.
답변 규칙: 한국어, 8줄 이내, 구체적인 단계와 이 도구의 화면 이름을 써라. 요금제별 한도 수치처럼 모르는 것은 지어내지 말고 claude.ai 설정의 사용량 화면을 보라고 해라. 아래 현재 상태를 참고해라.
현재 상태: ${stateSummary()}`;
let chat = [], askCtl = null;
function addMsg(role, text) { const el = document.createElement("div"); el.className = "msg " + (role === "user" ? "me" : "ai"); el.textContent = text; $("#chat").append(el); $("#chat").scrollTop = 1e6; return el; }
function localAnswer(q) {
  if (/지금|상태|먼저|뭐부터|뭘/.test(q)) {
    const T = tips().slice(0, 4).map((t, i) => `${i + 1}. ${t.t.replace(/<[^>]+>/g, "")}`);
    return "지금 상태 기준으로 할 일이에요:\n" + T.join("\n");
  }
  if (/추가|늘리|빼|제거|대수|몇 대/.test(q)) return FAQ[0][1];
  if (/옮기|이동|자리|넘기/.test(q)) return "PC를 옮길 때 순서:\n1. 지금 PC에서 커밋 후 git push\n2. 바통 터치에서 한 일·다음 할 일 적고 넘기기\n3. 내 잠금 중 계속 쓸 것만 남기고 해제\n4. 다른 PC에서 git pull 후 바통의 이어하기 프롬프트를 Claude에 붙여넣기";
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let best = null, score = 0;
  for (const f of FAQ) { const hay = (f[0] + " " + f[2]).toLowerCase(); const s = words.reduce((n, w) => n + (hay.includes(w) || [...f[2].split(" ")].some(k => w.includes(k)) ? 1 : 0), 0); if (s > score) { score = s; best = f; } }
  return best ? best[1] : "정확히 맞는 답을 찾지 못했어요. 아래 자주 묻는 질문을 보거나, 튜토리얼(?)로 전체 흐름을 다시 확인해 보세요.";
}
async function ask(q) {
  q = q.trim(); if (!q) return;
  $("#askIn").value = ""; addMsg("user", q);
  if (!sample) { addMsg("ai", localAnswer(q)); return; }
  const bubble = addMsg("ai", "생각하는 중…");
  chat.push({ role: "user", content: q });
  askCtl = new AbortController(); $("#askStop").hidden = false;
  try {
    const { text } = await sample([{ role: "user", content: RULES() }, ...chat.slice(-8)], { cache: false, modelTier: "quick", signal: askCtl.signal, onText: ({ text }) => { bubble.textContent = text; $("#chat").scrollTop = 1e6; } });
    chat.push({ role: "assistant", content: text });
  } catch (e) {
    chat.pop();
    if (e?.code === "not_granted" || e?.code === "sampling_disabled") { sample = null; renderSampleMode(); bubble.textContent = localAnswer(q); }
    else if (e?.code === "cancelled") bubble.textContent = e.text || "중지했어요.";
    else bubble.textContent = (e?.text ? e.text + "\n\n" : "") + (e?.code === "rate_limited" ? "요청이 많아요. 잠시 후 다시 물어보세요." : "답을 받지 못했어요. 다시 시도해 주세요.");
  } finally { $("#askStop").hidden = true; askCtl = null; }
}

/* ================= 튜토리얼 ================= */
const TOUR = [
  { v: "overview", s: "#dock", t: "상황판 하나만 보세요", b: "오른쪽(휴대폰은 아래) 상황판이 항상 떠 있어요. 맨 위 한 줄이 지금 상태(정상·주의·막힘)이고, 그 아래 버튼이 지금 할 일이에요. 지도에서 ♛가 최신 버전이 있는 곳이고, 노드를 누르면 바로 할 수 있는 일이 나와요." },
  { v: "versions", s: '[data-tour="hero"]', t: "떠나기 → 이어받기", b: "PC를 옮길 때는 이 두 버튼만 쓰면 돼요. 떠나기는 메모를 남기고 커밋·푸시 명령을 주고, 이어받기는 코드를 맞추는 명령과 지난 메모가 담긴 프롬프트를 줘요. 어느 PC·계정을 거쳤는지 한 줄로 이어집니다." },
  { v: "parallel", s: '[data-tour="split"]', t: "동시에 나눠서", b: "한 기능을 여러 PC가 동시에 할 땐 여기서 파일이 겹치지 않게 나눠요. 카드를 가져가면 그 경로가 자동으로 잠겨요." },
  { v: "claims", s: '[data-tour="checker"]', t: "같은 파일은 한 PC만", b: "편집할 경로를 넣으면 누가 잡고 있는지 바로 알려줘요. Claude에게 붙여넣을 작업 경계 문구도 여기 있어요." },
  { v: "overview", t: "어디서든 ⌘K", b: "⌘K(윈도우 Ctrl+K)로 모든 기능을 검색해 바로 실행해요. 버튼에 마우스를 올리면 자세한 설명이 나오고, 도움말에서 Claude에게 직접 물어볼 수도 있어요." },
];
let tourI = -1;
function startTour() { closePal(); $("#deskModal").hidden = true; const f = LS.get("flags", {}); f.tourSeen = true; LS.set("flags", f); tourStep(0); }
function tourStep(i) {
  if (i < 0) return; if (i >= TOUR.length) return endTour(true);
  tourI = i; const st = TOUR[i];
  if (S.view !== st.v) go(st.v, true);
  const el = st.s && $(st.s);
  if (el) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
  const c = $("#tourCard");
  c.innerHTML = `<div class="tour-step">${i + 1} / ${TOUR.length}</div><h3>${esc(st.t)}</h3><p class="small" style="color:var(--ink-2)">${esc(st.b)}</p>
    <div class="row" style="justify-content:space-between"><div class="tour-dots">${TOUR.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div>
    <div class="row" style="gap:6px"><button class="btn sm ghost" data-t="skip">닫기</button>${i ? '<button class="btn sm ghost" data-t="prev">이전</button>' : ""}<button class="btn sm primary" data-t="next">${i === TOUR.length - 1 ? "시작하기" : "다음"}</button></div></div>`;
  c.hidden = false; $("#tourHole").hidden = false;
  c.onclick = e => { const b = e.target.closest("[data-t]"); if (!b) return; ({ prev: () => tourStep(tourI - 1), next: () => tourStep(tourI + 1), skip: () => endTour() })[b.dataset.t](); };
  placeTour(); setTimeout(placeTour, 380);
  $("[data-t=next]", c).focus({ preventScroll: true });
}
function placeTour() {
  if (tourI < 0) return;
  const st = TOUR[tourI], el = st.s && $(st.s), hole = $("#tourHole"), c = $("#tourCard"), W = innerWidth, H = innerHeight, pad = 8;
  const cw = c.offsetWidth, ch = c.offsetHeight;
  if (!el) { Object.assign(hole.style, { left: W / 2 + "px", top: H / 2 + "px", width: "0px", height: "0px" }); Object.assign(c.style, { left: (W - cw) / 2 + "px", top: Math.max(16, (H - ch) / 2) + "px" }); return; }
  const r = el.getBoundingClientRect();
  const top = Math.max(4, r.top - pad), bottom = Math.min(H - 4, r.bottom + pad);
  Object.assign(hole.style, { left: r.left - pad + "px", top: top + "px", width: r.width + pad * 2 + "px", height: Math.max(0, bottom - top) + "px" });
  let y = bottom + 12 + ch < H - 8 ? bottom + 12 : top - 12 - ch > 8 ? top - 12 - ch : H - ch - 16;
  const x = Math.min(Math.max(16, r.left), W - cw - 16);
  Object.assign(c.style, { left: x + "px", top: Math.max(8, y) + "px" });
}
function endTour(done) {
  tourI = -1; $("#tourCard").hidden = true; $("#tourHole").hidden = true;
  if (done) { const f = LS.get("flags", {}); f.tour = true; LS.set("flags", f); renderOnboard(); toast("튜토리얼을 마쳤어요. 도움말 화면에서 언제든 다시 볼 수 있어요.", "ok"); }
  if (!S.me && S.mode === "live") askDesk();
}

/* ================= 명령 팔레트 ================= */
let palSel = 0, palItems = [];
const PAL = () => [
  ...Object.entries(VIEW_KO).map(([k, v], i) => ({ l: v + " 열기", k: i < 9 ? String(i + 1) : i === 9 ? "0" : "", w: k, f: () => go(k) })),
  { l: "새 영역 잠그기", w: "lock claim 잠금", f: () => { go("claims"); $("#claimPath").focus(); } },
  { l: "경로가 잠겼는지 검사", w: "check path 검사", f: () => { go("claims"); $("#checkIn").focus(); } },
  { l: "PC(데스크) 추가", w: "add desk 추가 새 pc", f: () => askDesk(true) },
  { l: "작업 흐름 보기", w: "workstream branch 브랜치 작업 흐름 이어하기", f: () => go("versions") },
  { l: "이 PC에서 작업 이어받기", w: "resume check in 이어하기 이어받기", f: () => { go("versions"); const w = S.streams.find(s => !s.holder) || S.streams[0]; if (w) openPanel("in", w.branch); } },
  { l: "떠나기", w: "leave check out 떠나기", f: () => { go("versions"); const m = S.streams.find(s => s.holder === S.me); m ? openPanel("out", m.branch) : toast("이 PC가 잡고 있는 작업이 없어요.", "info"); } },
  { l: "파일 버전 비교", w: "version diff 버전 비교 github 깃허브 스냅샷 파일", f: () => { vMode = "file"; LS.set("vMode", "file"); go("versions"); } },
  { l: "스냅샷 명령 복사", w: "snapshot 스냅샷 명령", f: () => copyText(snapCommand()) },
  { l: "계정 전환 (Claude·Codex)", w: "account switch 계정 전환 codex claude", f: () => go("session") },
  { l: "세션 팩 복사", w: "pack session 세션 팩 이어하기", f: () => copyText(buildPack(packTool || activeAgent()?.tool || "claude")) },
  { l: "결과 가져오기", w: "import result 결과 가져오기 기록", f: () => { go("session"); $("#impIn").focus(); } },
  { l: "개발 콘솔에서 Claude에게 시키기", w: "console agent 콘솔 에이전트 코딩", f: () => { go("console"); $("#conIn").focus(); } },
  { l: "로컬 적용 스크립트 만들기", w: "export script 파일 내보내기 적용", f: () => { go("console"); exportScript(); } },
  { l: "데스크 빼기", w: "remove desk 제거 삭제 빼기", f: () => { go("overview"); toast("관제실의 데스크 카드에서 '빼기'를 누르세요.", "info"); } },
  { l: "기능을 데스크별로 나누기", w: "split 분할 병렬", f: () => { go("parallel"); $("#splitIn").focus(); } },
  { l: "작업 추가", w: "task 할일", f: () => { go("parallel"); $("#taskTitle").focus(); } },
  { l: "바통 넘기기", w: "baton handoff 인수인계", f: () => { go("baton"); $("#bNext").focus(); } },
  { l: "릴레이 보내기", w: "relay clipboard 클립보드", f: () => { go("relay"); $("#relayIn").focus(); } },
  { l: "다른 PC 콕 찌르기", w: "nudge ping 알림", f: () => nudge("관제실 확인 부탁해요") },
  { l: "세션 창 타이머 시작", w: "usage timer 사용량", f: startWindow },
  { l: "만료된 잠금 정리", w: "clean expired", f: cleanExpired },
  { l: "작업 경계 프롬프트 복사", w: "boundary prompt claude", f: () => { go("claims"); $('[data-tour="boundary"]').scrollIntoView({ block: "center" }); } },
  { l: "이 PC의 데스크 바꾸기", w: "desk switch 데스크", f: askDesk },
  { l: "테마 전환", w: "theme dark light 다크", f: toggleTheme },
  { l: "튜토리얼 시작", k: "?", w: "tour tutorial 안내", f: () => startTour() },
  { l: "Claude에게 묻기", w: "ask help 질문", f: () => { go("help"); $("#askIn").focus(); } },
  { l: "예시 데이터 지우기", w: "example clear 예시", f: clearExamples },
];
function openPal() { $("#pal").hidden = false; $("#palIn").value = ""; palSel = 0; drawPal(); $("#palIn").focus(); }
function closePal() { $("#pal").hidden = true; }
function drawPal() {
  const q = $("#palIn").value.trim().toLowerCase();
  palItems = PAL().filter(it => !q || (it.l + " " + it.w).toLowerCase().includes(q));
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  $("#palList").innerHTML = palItems.map((it, i) => `<button class="pal-item" role="option" aria-selected="${i === palSel}" data-i="${i}"><span>${esc(it.l)}</span>${it.k ? `<kbd class="k">${esc(it.k)}</kbd>` : ""}</button>`).join("") || `<div class="empty" style="margin:8px">'${esc(q)}'에 맞는 기능이 없어요.</div>`;
}
function runPal(i) { const it = palItems[i]; if (!it) return; closePal(); it.f(); }

/* ================= 휴대폰: 더보기 시트 ================= */
const MORE_DESC = { overview: "모든 PC 상태와 코치", versions: "떠나기·이어받기, 브랜치 상태", session: "Claude·Codex 계정, 세션 팩", baton: "넘긴 기록과 메모", parallel: "작업 나누기와 보드", claims: "같은 파일 동시 편집 막기", relay: "PC 사이 공유 클립보드", console: "Claude 에이전트와 공유 파일", usage: "공유 한도와 세션 창", setup: "브랜치·설정 명령어", help: "체크리스트, FAQ, 묻기" };
function initMoreSheet() {
  const sheet = $("#moreSheet"), close = () => (sheet.hidden = true);
  $("#navMore").onclick = () => {
    $("#moreList").innerHTML = Object.entries(VIEW_KO).map(([k, v]) => { const ic = $(`.nav-btn[data-view="${k}"] svg`)?.outerHTML || ""; return `<button type="button" data-more="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${ic}<span><b>${esc(v)}</b><small>${esc(MORE_DESC[k] || "")}</small></span></button>`; }).join("");
    sheet.hidden = false;
  };
  $("#moreList").addEventListener("click", e => { const b = e.target.closest("[data-more]"); if (b) { close(); go(b.dataset.more); } });
  $("#moreClose").onclick = close;
  sheet.addEventListener("click", e => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

/* ================= 시작 ================= */
function boot() {
  applyTheme(LS.get("theme", null));
  initMoreSheet();
  wire(); wireSession(); wireVersions(); wireBranches(); wireDock(); wireKit(); initTooltips();
  $("#splitBtn").onclick = runSplit;
  $("#splitStop").onclick = () => splitCtl?.abort();
  $("#askForm").addEventListener("submit", e => { e.preventDefault(); ask($("#askIn").value); });
  $("#askStop").onclick = () => askCtl?.abort();
  $("#askChips").addEventListener("click", e => { const c = e.target.closest(".chip"); if (c) ask(c.textContent); });
  $("#palIn").addEventListener("input", () => { palSel = 0; drawPal(); });
  $("#palIn").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); drawPal(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); drawPal(); }
    else if (e.key === "Enter") { e.preventDefault(); runPal(palSel); }
  });
  $("#palList").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) runPal(+b.dataset.i); });
  $("#pal").addEventListener("click", e => { if (e.target.id === "pal") closePal(); });
  renderSetup(); renderChecklist(); renderFaq(); renderKeys(); renderAskChips(); renderSampleMode();
  go(S.view, true);
  addMsg("ai", "안녕하세요. 여러 PC로 개발하면서 막히는 게 있으면 물어보세요. 지금 모든 데스크 상태를 보고 답할게요.");

  const after = () => {
    render();
    if (S.mode !== "live") return;
    const f = LS.get("flags", {});
    if (!f.tourSeen) setTimeout(() => startTour(), 700);
    else if (!S.me) setTimeout(askDesk, 300);
  };
  setInterval(render, 30000);
  if (!window.claude?.use) { S.mode = "local"; loadLocal(); return after(); }
  claude.use("db").then(d => { if (d) { db = d; S.mode = "live"; subscribe(); } else { S.mode = "local"; loadLocal(); } after(); }).catch(() => { S.mode = "local"; loadLocal(); after(); });
  claude.use("room").then(r => { if (r) { room = r; connectRoom(); } });
  claude.use("sample").then(async s => { sample = s; if (s) { try { sampleTools = !!(await s.limits()).tools; } catch { sampleTools = false; } } renderSampleMode(); render(); });
}
boot();
})();
</script>
