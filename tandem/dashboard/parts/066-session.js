
/* ================= 프로젝트 세션: 여러 계정·도구를 하나의 세션으로 ================= */
const TOOL_KO = { claude: "Claude", codex: "Codex", other: "기타" };
const agentName = id => S.agents.find(a => a.id === id)?.name || "알 수 없는 계정";
const activeAgent = () => S.agents.find(a => a.id === (S.desks[S.me]?.agentId || S.session?.activeAgent)) || null;
const fileId = p => "f-" + normPath(p).replace(/[^A-Za-z0-9_.-]/g, c => "~" + c.charCodeAt(0).toString(16)).slice(0, 180);
const safeRelPath = p => p && !p.startsWith("/") && !p.startsWith("~") && !/(^|\/)\.\.(\/|$)/.test(p) && !/[\r\n]/.test(p);
let packTool = null;

/* 세션 상태 저장 (입력 멈추면 저장) */
let sessTimer = null, sessPending = {};
function saveSession(fields, immediate) {
  Object.assign(sessPending, fields);
  S.session = { ...(S.session || {}), ...fields };
  clearTimeout(sessTimer);
  const flush = async () => {
    const pend = { ...sessPending, updatedAt: now(), by: S.me || null };
    sessPending = {};
    /* 바뀐 필드만 합쳐서 다른 PC가 동시에 고친 필드를 덮지 않게 */
    if (!(S.mode !== "live" || S.sessionLive ? await patch("meta", "session", pend) : await put("meta", "session", { ...(S.session || {}), ...pend }))) return;
    $("#sessSaved").textContent = "저장됨 · 모든 PC에 공유";
    setTimeout(() => ($("#sessSaved").textContent = ""), 2200);
  };
  immediate ? flush() : (sessTimer = setTimeout(flush, 800));
}
function addTurn(t) {
  put("turns", uid(), { at: now(), desk: S.me || null, agentId: activeAgent()?.id || null, ...t });
  bump("turns", "at", 120);
}

/* 계정 전환 */
async function switchAgent(id) {
  const to = S.agents.find(a => a.id === id); if (!to) return;
  const from = activeAgent();
  if (from?.id === id) return toast(`이미 ${to.name}을(를) 쓰는 중이에요.`, "info");
  saveSession({ activeAgent: id }, true);
  saveDesk({ agentId: id }, true);
  addTurn({ kind: "switch", agentId: id, summary: `${from ? from.name : "없음"} → ${to.name} 전환` });
  addLog("switch", `${to.name}(으)로 전환`);
  packTool = to.tool; renderPack();
  toast(`${to.name}(으)로 전환했어요. 세션 팩을 복사해 ${TOOL_KO[to.tool]}에 붙여넣으면 이어서 작업해요.`, "ok", { label: "팩 복사", fn: () => copyText(buildPack(to.tool)) });
}
function toggleLimit(a) {
  const limited = a.status !== "limited";
  patch("agents", a.id, { status: limited ? "limited" : "ok", limitedAt: limited ? now() : null });
  addLog("limit", limited ? `${a.name} 한도 도달 표시` : `${a.name} 다시 사용 가능`);
  if (limited && activeAgent()?.id === a.id) {
    const alt = S.agents.find(x => x.id !== a.id && x.status !== "limited");
    if (alt) toast(`${a.name}을(를) 한도 도달로 표시했어요. ${alt.name}(으)로 전환할까요?`, "warn", { label: "전환", fn: () => switchAgent(alt.id) });
  }
}

/* 세션 팩: 어떤 도구에도 붙여넣을 수 있는 이어하기 묶음 */
function packData() {
  const ss = S.session || {}, me = S.me, d = S.desks[me] || {};
  const open = S.tasks.filter(t => t.status !== "done").map(t => `- [${t.status === "doing" ? (t.slot || "?") + " 진행" : "대기"}] ${t.title}${(t.paths || []).length ? " (" + t.paths.join(", ") + ")" : ""}`);
  const recent = S.turns.filter(t => t.kind !== "switch").slice(0, 6).map(t => `- ${new Date(t.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${t.desk ? "데스크 " + t.desk : ""} · ${agentName(t.agentId)}: ${(t.summary || "").replace(/\n/g, " ").slice(0, 200)}`);
  const locked = S.claims.filter(c => active(c) && c.slot !== me).map(c => `- ${c.path} [데스크 ${c.slot}]`);
  return { ss, d, open, recent, locked, decisions: S.decisions.map(x => "- " + x.text) };
}
function buildPack(tool) {
  const { ss, d, open, recent, locked, decisions } = packData(), ag = activeAgent();
  const who = tool === "codex" ? "Codex" : tool === "claude" ? "Claude" : "AI 도구";
  return `[프로젝트 세션 이어하기 · Tandem]
이 프로젝트는 여러 PC와 여러 AI 계정(Claude, Codex)이 하나의 세션처럼 이어서 작업합니다. 지금부터 ${who}${ag ? ` (${ag.name})` : ""}가 이어받습니다. 아래 기록을 이전 대화처럼 여기고 그대로 계속하세요.

목표: ${ss.goal || "(미정)"}
현재 상태: ${ss.state || "(기록 없음)"}
다음 단계: ${ss.next || "(미정)"}

결정 사항 (반드시 따를 것):
${decisions.join("\n") || "- (없음)"}

남은 작업:
${open.join("\n") || "- (없음)"}

최근 작업 기록:
${recent.join("\n") || "- (처음 시작)"}

수정 금지 경로 (다른 PC가 작업 중):
${locked.join("\n") || "- (없음)"}
${d.branch ? `작업 브랜치: ${d.branch}\n` : ""}
시작 전에 git pull 후 git log --oneline -5 로 최근 변경을 확인하세요.
작업을 마치면 아래 형식으로만 요약해 주세요 (Tandem에 붙여넣어 세션에 기록합니다):
## 요약
## 바꾼 파일
## 결정
## 다음 단계`;
}
function buildMemoFile(tool) {
  const { ss, decisions } = packData();
  const name = tool === "codex" ? "AGENTS.md" : "CLAUDE.md";
  return [name, `# 프로젝트 공통 규칙 (Tandem 세션에서 생성)

## 목표
${ss.goal || "(미정)"}

## 결정 사항
${decisions.join("\n") || "- (없음)"}

## 협업 방식
- 이 저장소는 여러 PC와 여러 AI 계정이 번갈아 작업합니다.
- 데스크별 브랜치(a/, b/, c/…)를 쓰고 공유 브랜치에 force push 하지 마세요.
- 작업이 끝나면 '요약 / 바꾼 파일 / 결정 / 다음 단계' 형식으로 정리하세요.`];
}
function renderPack() {
  const tool = packTool || activeAgent()?.tool || "claude";
  $$("#packTool button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === tool)));
  const [fname, memo] = buildMemoFile(tool);
  $("#packOut").innerHTML = codeBlock(`${TOOL_KO[tool]}에 붙여넣을 세션 팩`, buildPack(tool))
    + (tool === "other" ? "" : `<p class="small muted" style="margin:8px 0 6px">${tool === "codex" ? "Codex는 저장소 루트의 AGENTS.md를 자동으로 읽어요." : "Claude Code는 저장소 루트의 CLAUDE.md를 자동으로 읽어요."} 결정 사항이 바뀌면 다시 복사해 덮어쓰세요.</p>` + codeBlock(fname, memo));
}

/* 결과 가져오기 */
function parseSections(t) {
  const out = { summary: "", files: [], decisions: [], next: [] }, map = { "요약": "summary", "바꾼 파일": "files", "변경 파일": "files", "결정": "decisions", "다음 단계": "next", "다음": "next" };
  let cur = "summary";
  for (const line of t.split("\n")) {
    const h = line.match(/^#{1,4}\s*(.+?)\s*$/);
    if (h && map[h[1].trim()]) { cur = map[h[1].trim()]; continue; }
    const v = line.replace(/^\s*[-*•]\s*/, "").trim(); if (!v) continue;
    cur === "summary" ? (out.summary += (out.summary ? " " : "") + v) : out[cur].push(v);
  }
  return out;
}
async function importResult() {
  const raw = $("#impIn").value.trim(); if (!raw) return $("#impIn").focus();
  if (hasSecret(raw)) return toast("붙여넣은 결과에 비밀 키처럼 보이는 값이 있어요. 지우고 다시 기록하세요.", "bad");
  const agentId = $("#impAgent").value || S.session?.activeAgent || null;
  $("#impBtn").disabled = true; $("#impStatus").textContent = sample ? "Claude가 정리하는 중…" : "";
  let r = null;
  if (sample) {
    try {
      r = await sample.json(`아래는 다른 AI 코딩 도구가 작업을 마치고 남긴 결과다. 프로젝트 세션 기록용으로 정리하라.
현재 세션 상태: ${S.session?.state || "(없음)"}
현재 다음 단계: ${S.session?.next || "(없음)"}

결과:
${raw.slice(0, 12000)}

JSON 하나로만 답하라: {"summary":"한두 문장 요약","files":["바꾼 파일 경로"],"decisions":["새로 정한 규칙"],"next":["다음 할 일"],"state":"이 결과를 반영한 새 '현재 상태' 한두 문장"}`, { modelTier: "quick" });
    } catch (e) { if (e?.code === "not_granted" || e?.code === "sampling_disabled") { sample = null; renderSampleMode(); } }
  }
  if (!r || typeof r !== "object") r = parseSections(raw);
  const arr = x => (Array.isArray(x) ? x : []).map(v => String(v).slice(0, 300)).filter(Boolean).slice(0, 20);
  const files = arr(r.files), decisions = arr(r.decisions), next = arr(r.next), summary = String(r.summary || raw.split("\n")[0]).slice(0, 600);
  addTurn({ kind: "turn", agentId, summary, files, next, raw: raw.slice(0, 8000) });
  for (const dtext of decisions) await put("decisions", uid(), { text: dtext, at: now(), agentId });
  const upd = {};
  if (r.state) upd.state = String(r.state).slice(0, 1000);
  if (next.length) upd.next = next.join("\n");
  if (Object.keys(upd).length) { saveSession(upd, true); $("#sState").value = upd.state ?? $("#sState").value; $("#sNext").value = upd.next ?? $("#sNext").value; }
  addLog("import", `${agentName(agentId)} 결과 기록`);
  $("#impIn").value = ""; $("#impBtn").disabled = false; $("#impStatus").textContent = "";
  toast(`세션에 기록했어요. 결정 ${decisions.length}개, 다음 단계 ${next.length}개를 반영했어요.`, "ok");
}

/* 렌더 */
function renderSession() {
  const act = activeAgent();
  $("#agentNow").textContent = act ? `지금: ${act.name} · ${TOOL_KO[act.tool]}` : "아직 고른 계정이 없어요";
  $("#agentList").innerHTML = S.agents.length ? S.agents.map(a => {
    const on = act?.id === a.id, lim = a.status === "limited";
    return `<div class="agent ${on ? "on" : ""}"><div class="agent-h"><span class="agent-ico ${a.tool}">${a.tool === "codex" ? "Cx" : a.tool === "claude" ? "C" : "AI"}</span><div style="min-width:0;flex:1"><div class="agent-n">${esc(a.name)}</div><div class="small muted">${TOOL_KO[a.tool]}${a.note ? " · " + esc(a.note) : ""}</div></div></div>
      <div class="row" style="gap:4px">${on ? pill("ok", "사용 중") : ""}${lim ? pill("warn", "한도 도달 " + ago(a.limitedAt)) : pill("neutral", "사용 가능")}${a.example ? pill("neutral", "예시") : ""}</div>
      <div class="row" style="gap:4px">${on ? "" : `<button class="btn sm primary" data-act="agSwitch" data-id="${a.id}">이 계정으로 전환</button>`}<button class="btn sm" data-act="agLimit" data-id="${a.id}">${lim ? "다시 사용 가능" : "한도 도달"}</button><button class="btn sm ghost danger" data-act="agDel" data-id="${a.id}">삭제</button></div></div>`;
  }).join("") : `<div class="empty"><b>등록된 계정이 없어요.</b><br>아래에 'Claude 개인', 'Codex 회사'처럼 이름만 적어 추가하세요.</div>`;
  const ss = S.session || {};
  for (const [id, v] of [["#sGoal", ss.goal], ["#sState", ss.state], ["#sNext", ss.next]]) { const el = $(id); if (document.activeElement !== el) el.value = v || ""; }
  $("#decList").innerHTML = S.decisions.length ? S.decisions.map(x => `<div class="li"><div class="li-main"><div class="li-t" style="font-weight:500">${esc(x.text)}</div><div class="li-s">${x.agentId ? esc(agentName(x.agentId)) + " · " : ""}${ago(x.at)}</div></div><button class="btn sm ghost danger" data-act="decDel" data-id="${x.id}">삭제</button></div>`).join("") : `<div class="empty small">아직 결정 사항이 없어요.</div>`;
  if (document.activeElement?.closest?.("#packOut") == null) renderPack();
  const sel = $("#impAgent"), keep = sel.value || ss.activeAgent || "";
  const html = S.agents.map(a => `<option value="${a.id}"${a.id === keep ? " selected" : ""}>${esc(a.name)}</option>`).join("") || `<option value="">계정 없음</option>`;
  if (document.activeElement !== sel && sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  $("#turnCount").textContent = S.turns.length ? `${S.turns.length}개 기록` : "";
  $("#turnList").innerHTML = S.turns.length ? S.turns.slice(0, 40).map(t => {
    const ag = S.agents.find(a => a.id === t.agentId);
    return `<div class="li"><span class="stripe ${esc(t.desk || "")}"></span><div class="li-main"><div class="li-t">${t.kind === "switch" ? "⇄ " : ""}${esc(t.summary || "")}</div>
      ${(t.files || []).length ? `<div class="task-paths" style="margin-top:4px">${t.files.slice(0, 6).map(f => `<code>${esc(f)}</code>`).join("")}</div>` : ""}
      ${(t.next || []).length ? `<div class="li-s">다음: ${esc(t.next.join(" / "))}</div>` : ""}
      <div class="li-s">${t.desk ? "데스크 " + t.desk + " · " : ""}${ag ? esc(ag.name) + " · " : ""}${ago(t.at)}</div></div></div>`;
  }).join("") : `<div class="empty"><b>세션 기록이 비어 있어요.</b><br>계정을 전환하거나 결과를 가져오면, 어느 PC·어느 계정이 무엇을 했는지 여기에 이어서 쌓여요.</div>`;
  $("#impMode").className = "pill " + (sample ? "ok" : "neutral"); $("#impMode").textContent = sample ? "Claude가 정리" : "형식대로 정리";

}
function sessionTips(T) {
  const act = activeAgent();
  if (act?.status === "limited") {
    const alt = S.agents.find(x => x.id !== act.id && x.status !== "limited");
    T.push({ l: "warn", t: `<b>지금 쓰는 ${esc(act.name)}이(가) 한도에 도달했어요.</b> ${alt ? esc(alt.name) + "(으)로 전환하면 세션 팩으로 바로 이어갈 수 있어요." : "사용 가능한 다른 계정이 없어요."}`, a: alt ? ["전환하기", () => switchAgent(alt.id)] : ["세션 보기", () => go("session")] });
  }
  if (!S.agents.length) T.push({ l: "info", t: "쓰는 Claude·Codex 계정을 이름표로 등록하면, 계정을 바꿔도 하나의 세션처럼 이어갈 수 있어요.", a: ["계정 등록", () => { go("session"); $("#agName").focus(); }] });
}

/* ================= 개발 콘솔 ================= */
const fileByPath = p => S.files.find(f => f.path === normPath(p));
let conCtl = null, editId = null, editStamp = 0, sampleTools = false;
async function writeFile(path, content, reason, by = "user") {
  path = normPath(path); if (!path) throw new Error("경로가 비어 있어요");
  if (bytesOf(content) > 200000) throw new Error("파일이 너무 커요 (200KB 이하)");
  if (hasSecret(content)) throw new Error("비밀 키처럼 보이는 값이 있어 저장하지 않았음");
  const f = fileByPath(path), id = f?.id || fileId(path);
  if (!(await put("files", id, { path, content, updatedAt: now(), by: S.me || null }))) throw new Error("저장 실패");
  const prev = f ? f.content : null;
  return { id, prev: prev != null && bytesOf(prev) > 60000 ? undefined : prev, created: !f };
}
function conDoc(role, text, extra = {}) {
  put("console", uid(), { role, text: String(text).slice(0, 30000), desk: S.me || null, agentId: S.session?.activeAgent || null, at: now(), ...extra });
  bump("console", "at", 100);
}
const CON_RULES = () => `너는 'Tandem 개발 콘솔'의 코딩 에이전트다. Claude Code처럼 일한다: 먼저 필요한 파일을 읽고, 작은 단위로 수정하고, 무엇을 바꿨는지 짧게 보고한다.
- 프로젝트 파일은 이 페이지 안의 공유 작업공간에 있고, 도구(list_files, read_file, search_files, write_file)로만 다룬다. 사용자는 나중에 '로컬 적용 스크립트'로 실제 저장소에 반영한다.
- write_file은 파일 전체 내용을 쓴다. 기존 파일을 고칠 때는 먼저 read_file로 읽고 전체를 다시 써라.
- 다른 데스크가 잠근 경로는 수정하지 마라. 세션의 결정 사항을 따른다.
- 새로 정한 규칙은 add_decision, 세션 상태가 바뀌면 update_session으로 기록한다.
- 한국어로 답하고, 마지막에 바꾼 파일 목록과 다음 단계를 적는다.
세션: ${JSON.stringify({ 목표: S.session?.goal || "", 상태: S.session?.state || "", 다음: S.session?.next || "", 결정: S.decisions.map(d => d.text).slice(0, 20), 이PC: S.me, 잠긴경로: S.claims.filter(c => active(c) && c.slot !== S.me).map(c => c.path) })}`;
const CON_TOOLS = () => [
  { name: "list_files", description: "작업공간의 모든 파일 경로와 크기(바이트)를 돌려준다.", execute: () => S.files.map(f => ({ path: f.path, bytes: (f.content || "").length })) },
  { name: "read_file", description: "파일 전체 내용을 돌려준다. 없으면 오류.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    execute: i => { const f = fileByPath(String(i.path)); if (!f) throw new Error("파일 없음: " + i.path); return f.content.slice(0, 30000); } },
  { name: "search_files", description: "모든 파일에서 문자열을 찾아 경로와 줄 번호, 그 줄을 최대 40개 돌려준다.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: i => { const q = String(i.query || ""); const out = []; for (const f of S.files) (f.content || "").split("\n").forEach((l, n) => { if (q && l.includes(q) && out.length < 40) out.push(`${f.path}:${n + 1}: ${l.slice(0, 160)}`); }); return out.length ? out : "일치 없음"; } },
  { name: "write_file", description: "파일을 만들거나 전체 내용을 바꾼다. reason에 바꾼 이유를 한 줄로 쓴다. 다른 데스크가 잠근 경로면 오류.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, reason: { type: "string" } }, required: ["path", "content"] },
    execute: async i => {
      const path = normPath(String(i.path)), hit = conflictsFor(path, S.me || "A")[0];
      if (hit) throw new Error(`데스크 ${hit.slot}가 잠근 경로(${hit.path})라 수정할 수 없음`);
      const r = await writeFile(path, String(i.content ?? ""), i.reason);
      conDoc("tool", `${r.created ? "＋ 만듦" : "✎ 수정"} ${path}${i.reason ? " · " + oneLine(i.reason).slice(0, 120) : ""}${r.prev === undefined ? " (파일이 커서 되돌리기 불가)" : ""}`, r.prev === undefined ? { path } : { fileId: r.id, path, prev: r.prev });
      return r.created ? "생성됨" : "수정됨";
    } },
  { name: "add_decision", description: "세션의 결정 사항(앞으로 지킬 규칙)을 하나 기록한다.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    execute: async i => { await put("decisions", uid(), { text: String(i.text).slice(0, 300), at: now(), agentId: S.session?.activeAgent || null }); return "기록됨"; } },
  { name: "update_session", description: "세션의 현재 상태와 다음 단계를 갱신한다.", inputSchema: { type: "object", properties: { state: { type: "string" }, next: { type: "string" } } },
    execute: i => { const u = {}; if (i.state) u.state = String(i.state).slice(0, 1000); if (i.next) u.next = String(i.next).slice(0, 1000); saveSession(u, true); return "갱신됨"; } },
];
async function conSend() {
  const q = $("#conIn").value.trim(); if (!q) return $("#conIn").focus();
  if (hasSecret(q)) return toast("요청에 비밀 키처럼 보이는 값이 있어요. 지우고 다시 보내세요.", "bad");
  if (!sample) return toast("개발 콘솔은 Claude 사용을 허용해야 동작해요. 세션 팩으로 외부 Claude·Codex에서 작업할 수 있어요.", "warn", { label: "세션 팩", fn: () => go("session") });
  $("#conIn").value = "";
  const hist = S.console.slice().reverse().filter(m => m.role !== "tool").slice(-12).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
  conDoc("user", q);
  hist.push({ role: "user", content: q });
  const turns = [{ role: "user", content: CON_RULES() }, ...hist];
  const live = addConMsg({ role: "assistant", text: "생각하는 중…", desk: S.me }); live.dataset.live = "1";
  conCtl = new AbortController(); $("#conStop").hidden = false; $("#conStatus").textContent = sampleTools ? "파일을 읽고 고치는 중… (보통 30초~2분)" : "";
  try {
    const opts = { signal: conCtl.signal, onText: ({ text }) => { live.lastChild.textContent = text; $("#conChat").scrollTop = 1e6; } };
    if (sampleTools) opts.tools = CON_TOOLS(); else opts.cache = false;
    if (!sampleTools) turns[0].content += `\n(도구 없이 동작 중: 파일을 바꿀 땐 경로와 전체 코드를 코드 블록으로 보여줘라)\n파일 목록: ${S.files.map(f => f.path).join(", ")}`;
    const { text } = await sample(turns, opts);
    conDoc("assistant", text);
  } catch (e) {
    if (e?.code === "tools_unavailable") { sampleTools = false; renderConMode(); }
    if (e?.code === "not_granted" || e?.code === "sampling_disabled") { sample = null; renderSampleMode(); }
    const msg = e?.code === "cancelled" ? "중지했어요." : e?.code === "rate_limited" ? "요청이 많거나 이 계정의 한도에 닿았어요. 잠시 후 다시 하거나, 세션 팩으로 다른 계정에서 이어가세요." : "답을 받지 못했어요. 다시 시도해 주세요.";
    conDoc("assistant", (e?.text ? e.text + "\n\n" : "") + msg);
  } finally { live.remove(); $("#conStop").hidden = true; $("#conStatus").textContent = ""; conCtl = null; }
}
function addConMsg(m) {
  const el = document.createElement("div");
  el.className = "msg " + (m.role === "user" ? "me" : m.role === "tool" ? "tool" : "ai");
  if (m.role === "tool") {
    el.innerHTML = `<span style="min-width:0;overflow-wrap:anywhere"></span>${m.fileId ? `<button class="btn sm ghost" data-act="conUndo" data-id="${m.id || ""}">되돌리기</button>` : ""}`;
    el.firstChild.textContent = m.text;
  } else {
    const who = document.createElement("span"); who.className = "who";
    who.textContent = (m.role === "user" ? (m.desk ? "데스크 " + m.desk : "나") : "Claude") + (m.at ? " · " + ago(m.at) : "");
    el.append(who, document.createTextNode(m.text));
  }
  $("#conChat").append(el); $("#conChat").scrollTop = 1e6;
  return el;
}
let conRendered = "";
function renderConsole() {
  const list = S.console.slice().reverse();
  const sig = list.map(m => m.id).join(",");
  if (sig !== conRendered) {
    conRendered = sig;
    const keep = [...$("#conChat").children].filter(x => x.dataset.live);
    $("#conChat").innerHTML = "";
    if (!list.length) $("#conChat").innerHTML = `<div class="msg ai">무엇을 만들까요? 파일을 만들거나 고치라고 하면 직접 작업하고, 바꾼 파일은 여기 표시돼요. 이 대화는 모든 PC가 함께 보는 하나의 세션이에요.</div>`;
    list.forEach(addConMsg); keep.forEach(k => $("#conChat").append(k));
  }
  $("#fList").innerHTML = S.files.length ? S.files.slice().sort((a, b) => String(a.path).localeCompare(String(b.path))).map(f => {
    const hit = S.claims.find(c => active(c) && c.slot !== S.me && overlaps(c.path, f.path));
    return `<div class="fitem"><button class="fopen" data-act="fOpen" data-id="${f.id}">${esc(f.path)}</button><span class="row small muted" style="gap:4px;flex:none">${hit ? pill("bad", hit.slot + " 잠금") : ""}${((f.content || "").length / 1024).toFixed(1)}KB · ${ago(f.updatedAt)}</span></div>`;
  }).join("") : `<div class="empty small"><b>파일이 없어요.</b><br>'새 파일'로 만들거나 콘솔에서 Claude에게 만들어 달라고 하세요.</div>`;
}
function renderConMode() { const el = $("#conMode"); el.className = "pill " + (sample ? "ok" : "neutral"); el.textContent = !sample ? "Claude 미연결" : sampleTools ? "파일 도구 사용" : "대화 모드"; }
function openFile(f) {
  editId = f ? f.id : null; editStamp = f ? f.updatedAt || now() : 0;
  $("#fEditor").hidden = false; $("#fPath").value = f ? f.path : ""; $("#fBody").value = f ? f.content : "";
  $("#fInfo").textContent = f ? `${f.by ? "데스크 " + f.by + " · " : ""}${ago(f.updatedAt)} 수정` : "새 파일";
  (f ? $("#fBody") : $("#fPath")).focus();
}
function exportScript() {
  if (!S.files.length) return toast("내보낼 파일이 없어요.", "info");
  const sh = ["#!/bin/sh", "# Tandem 개발 콘솔 파일을 현재 폴더(저장소 루트)에 씁니다. 같은 경로의 파일은 덮어써요.", "set -e"];
  const skipped = S.files.filter(f => !safeRelPath(f.path));
  if (skipped.length) toast(`안전하지 않은 경로 ${skipped.length}개(.. 또는 / 로 시작)는 스크립트에서 뺐어요.`, "warn");
  for (const f of S.files.filter(f => safeRelPath(f.path)).sort((a, b) => String(a.path).localeCompare(String(b.path)))) {
    let tag = "TANDEM_EOF"; while ((f.content || "").includes(tag)) tag += "_X";
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    if (dir) sh.push(`mkdir -p '${dir.replace(/'/g, "'\\''")}'`);
    sh.push(`cat > '${f.path.replace(/'/g, "'\\''")}' <<'${tag}'`, (f.content || "").replace(/\n$/, ""), tag);
  }
  sh.push('echo "Tandem: 파일 ' + S.files.length + '개를 썼어요. git diff 로 확인하세요."');
  $("#fScript").innerHTML = `<p class="small muted" style="margin:8px 0 6px">저장소 루트에서 터미널에 붙여넣어 실행하세요. 실행 후 <code>git diff</code>로 꼭 확인하세요.</p>` + codeBlock("로컬 적용 스크립트", sh.join("\n"));
}

function wireSession() {
  $("#agentForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#agName").value.trim(); if (!name) return $("#agName").focus();
    if (/@|password|비밀번호|sk-|api[_ -]?key/i.test(name + " " + $("#agNote").value)) return confirmBox("계정 정보는 적지 마세요", "<p>이메일, 비밀번호, API 키는 이 페이지에 저장하지 않아요. 알아볼 수 있는 이름만 적어주세요. 로그인은 각 앱에서 직접 하세요.</p>", [{ label: "고치기", cls: "primary" }]);
    const id = uid();
    await put("agents", id, { name: name.slice(0, 60), tool: $("#agTool").value, note: $("#agNote").value.trim().slice(0, 80), status: "ok", createdAt: now() });
    $("#agName").value = ""; $("#agNote").value = "";
    if (!S.session?.activeAgent) saveSession({ activeAgent: id }, true);
    toast(`${name}을(를) 추가했어요.`, "ok");
  });
  ["#sGoal", "#sState", "#sNext"].forEach((sel, i) => $(sel).addEventListener("input", e => saveSession({ [["goal", "state", "next"][i]]: e.target.value.trim() })));
  $("#decForm").addEventListener("submit", async e => { e.preventDefault(); const t = $("#decIn").value.trim(); if (!t) return; await put("decisions", uid(), { text: t.slice(0, 300), at: now(), agentId: S.session?.activeAgent || null }); $("#decIn").value = ""; addLog("decision", "결정 추가: " + t.slice(0, 40)); });
  $("#packTool").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; packTool = b.dataset.t; renderPack(); });
  $("#impBtn").onclick = importResult;
  $("#conForm").addEventListener("submit", e => { e.preventDefault(); conSend(); });
  $("#conIn").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); conSend(); } });
  $("#conStop").onclick = () => conCtl?.abort();
  $("#conClear").onclick = () => confirmBox("대화 비우기", "<p>모든 PC에서 개발 콘솔 대화가 지워져요. 파일과 세션 기록은 남습니다.</p>", [{ label: "취소", cls: "ghost" }, { label: "비우기", cls: "primary", fn: async () => { const all = db ? (await db.collection("console").get().catch(() => null))?.docs.map(d => ({ id: d.id })) || S.console : S.console.slice(); for (const m of all) await del("console", m.id); } }]);
  $("#fNew").onclick = () => openFile(null);
  $("#fClose").onclick = () => { $("#fEditor").hidden = true; editId = null; };
  $("#fExport").onclick = exportScript;
  $("#fSave").onclick = async () => {
    const path = normPath($("#fPath").value); if (!path) return $("#fPath").focus();
    const other = fileByPath(path); if (other && other.id !== editId) return toast("같은 경로의 파일이 이미 있어요.", "warn");
    const body = $("#fBody").value;
    if (bytesOf(body) > 200000) return toast("파일이 너무 커요 (200KB 이하).", "warn");
    if (hasSecret(body)) return toast("비밀 키처럼 보이는 값이 있어요. 지우고 저장하세요.", "bad");
    const cur = S.files.find(x => x.id === editId);
    const save = async () => {
      const id = editId || fileId(path);
      if (!(await put("files", id, { path, content: body, updatedAt: now(), by: S.me || null }))) return;
      editId = id; editStamp = now(); $("#fInfo").textContent = "저장됨 · 모든 PC에 공유"; addLog("file", path + " 저장");
    };
    if (cur && editStamp && cur.updatedAt > editStamp) return confirmBox("다른 곳에서 먼저 고쳤어요", `<p>연 뒤에 ${cur.by ? "데스크 " + esc(cur.by) : "다른 PC"}가 이 파일을 저장했어요. 덮어쓰면 그 변경이 사라져요.</p>`, [{ label: "취소", cls: "ghost" }, { label: "덮어쓰기", cls: "primary", fn: save }]);
    save();
  };
  $("#fDel").onclick = () => { if (!editId) return ($("#fEditor").hidden = true); const f = S.files.find(x => x.id === editId); confirmBox("파일 삭제", `<p><code>${esc(f?.path || "")}</code> 를 모든 PC에서 지웁니다.</p>`, [{ label: "취소", cls: "ghost" }, { label: "삭제", cls: "primary", fn: async () => { await del("files", editId); $("#fEditor").hidden = true; editId = null; } }]); };
  document.addEventListener("click", async e => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    const id = a.dataset.id, ag = S.agents.find(x => x.id === id);
    switch (a.dataset.act) {
      case "agSwitch": return ag && switchAgent(id);
      case "agLimit": return ag && toggleLimit(ag);
      case "agDel": return ag && confirmBox("계정 삭제", `<p>${esc(ag.name)}을(를) 목록에서 지워요. 세션 기록은 남습니다.</p>`, [{ label: "취소", cls: "ghost" }, { label: "삭제", cls: "primary", fn: () => { del("agents", id); if (S.session?.activeAgent === id) saveSession({ activeAgent: null }, true); } }]);
      case "decDel": return confirmBox("결정 삭제", "<p>이 결정 사항을 지울까요? 세션 팩과 CLAUDE.md·AGENTS.md에서도 빠져요.</p>", [{ label: "취소", cls: "ghost" }, { label: "삭제", cls: "primary", fn: () => del("decisions", id) }]);
      case "fOpen": return openFile(S.files.find(f => f.id === id));
      case "conUndo": {
        const m = S.console.find(x => x.id === id); if (!m) return;
        if (m.prev == null) await del("files", m.fileId); else await put("files", m.fileId, { path: m.path, content: m.prev, updatedAt: now(), by: S.me || null });
        conDoc("tool", `↶ 되돌림 ${m.path}`); return;
      }
    }
  });
}
