
/* ================= UI 기본 동작 ================= */
function go(view, quiet) {
  if (!VIEW_KO[view]) view = "overview";
  S.view = view; LS.set("view", view);
  $$(".view").forEach(v => (v.hidden = v.id !== "v-" + view));
  $$(".nav-btn").forEach(b => b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  if (view === "relay") { relaySeenAt = now(); LS.set("relaySeen", relaySeenAt); }
  if (!quiet) window.scrollTo({ top: 0 });
  const main4 = ["overview", "versions", "parallel", "claims"];
  main4.includes(view) ? $("#navMore")?.removeAttribute("aria-current") : $("#navMore")?.setAttribute("aria-current", "page");
  presence(); render();
}
function toast(text, kind = "info", action) {
  const el = document.createElement("div"); el.className = "toast";
  const lab = { A: "A", B: "B", ok: "완료", warn: "주의", bad: "경고", info: "알림" }[kind] || "알림";
  if (!["A","B","C","D","E","F","G","H","ok","warn","bad","info"].includes(kind)) kind = "info";
  const cls = kind === "info" ? "neutral" : kind;
  el.innerHTML = `<span class="pill ${cls}">${lab}</span><span style="flex:1;min-width:0"></span>`;
  el.children[1].textContent = text;
  if (action) { const b = document.createElement("button"); b.className = "btn sm"; b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.append(b); }
  $("#toasts").append(el);
  setTimeout(() => el.remove(), action ? 8000 : 4200);
}
function confirmBox(title, bodyHtml, buttons) {
  const m = $("#confirmModal");
  $("#cfT").textContent = title; $("#cfB").innerHTML = bodyHtml;
  const A = $("#cfA"); A.innerHTML = "";
  for (const b of buttons) {
    const el = document.createElement("button"); el.type = "button"; el.className = "btn " + (b.cls || ""); el.textContent = b.label;
    el.onclick = () => { m.hidden = true; b.fn?.(); }; A.append(el);
  }
  m.hidden = false; A.lastChild?.focus();
  m.onkeydown = e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); A.lastChild?.click(); } };
}
function copyText(text, btn) {
  const done = () => { if (btn) { const o = btn.innerHTML; btn.textContent = "복사됨"; setTimeout(() => (btn.innerHTML = o), 1400); } else toast("복사했어요.", "ok"); };
  const fallback = () => {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0;left:0;top:0";
    document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); ok ? done() : toast("복사가 막혀 있어요. 텍스트를 직접 선택해 복사하세요.", "warn");
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch { fallback(); }
}
function applyTheme(t) { t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme"); }
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const nx = cur === "dark" ? "light" : "dark"; applyTheme(nx); LS.set("theme", nx);
}

/* ================= 데스크 지정 ================= */
let pickSlot = null;
function askDesk(preferNew) {
  const ns = nextSlot();
  pickSlot = preferNew && ns ? ns : S.me;
  const L = deskList();
  $("#deskPick").innerHTML = L.map(s => `<button type="button" data-slot="${s}" aria-pressed="${s === pickSlot}"><span class="L">${s}</span><b>${esc(deskName(s))}</b><span class="small muted">${s === S.me ? "이 PC" : S.online[s] ? "다른 PC가 접속 중" : "오프라인 · " + ago(S.desks[s].updatedAt)}</span></button>`).join("")
    + (ns ? `<button type="button" class="new" data-slot="${ns}" data-new="1" aria-pressed="${ns === pickSlot}"><span class="L">+${ns}</span><b>새 데스크 ${ns}</b><span class="small muted">새 PC라면 이걸 고르세요</span></button>` : "");
  $("#deskName").value = pickSlot && S.desks[pickSlot] ? S.desks[pickSlot].name || "" : "";
  $("#deskSave").disabled = !pickSlot;
  $("#deskModal").hidden = false;
  if (pickSlot && !S.desks[pickSlot]) $("#deskName").focus();
}
async function saveDeskPick() {
  if (!pickSlot) return;
  if (!S.desks[pickSlot] && deskList().length >= SLOTS.length) return toast("데스크는 최대 8대까지예요. 쓰지 않는 데스크를 먼저 빼세요.", "warn");
  const name = oneLine($("#deskName").value).trim().slice(0, 40) || "PC " + (SLOTS.indexOf(pickSlot) + 1);
  if (db && !S.desks[pickSlot]) {
    /* 두 PC가 같은 새 데스크를 동시에 고르는 경우: 짧은 리스로 한쪽만 통과 */
    const r = await db.doc("desks/" + pickSlot).acquire({ holder: TAB, ttlMs: 5000 }).catch(() => ({ acquired: true }));
    const cur = r.acquired ? await db.doc("desks/" + pickSlot).get().catch(() => null) : null;
    if (!r.acquired || cur?.data()?.name) { toast(`방금 다른 PC가 데스크 ${pickSlot}를 가져갔어요. 다른 데스크를 고르세요.`, "warn"); return askDesk(true); }
  }
  const prev = S.me;
  S.me = pickSlot; LS.set("slot", pickSlot);
  $("#deskModal").hidden = true;
  saveDesk({ name, load: S.desks[pickSlot]?.load ?? 0 }, true);
  if (prev !== pickSlot) addLog("join", `${name}이(가) 데스크 ${pickSlot}로 연결`);
  toast(`이 PC는 이제 데스크 ${pickSlot}예요. 다른 PC에서는 각자 다른 데스크를 고르거나 새 데스크를 추가하세요.`, pickSlot);
}
function removeDesk(slot) {
  if (!S.desks[slot]) return;
  const nm = deskName(slot), mine = slot === S.me;
  const claims = S.claims.filter(c => c.slot === slot), doing = S.tasks.filter(t => t.slot === slot && t.status === "doing");
  confirmBox(`데스크 ${slot} 빼기`, `<p><b>${esc(nm)}</b>${mine ? " (이 PC)" : ""}를 목록에서 뺍니다.</p><p class="small" style="margin-top:8px">이 데스크의 잠금 ${claims.length}개를 풀고, 진행 중인 작업 ${doing.length}개는 대기열로 돌려놓아요. 바통·릴레이 기록은 남습니다.${S.online[slot] && !mine ? " 지금 접속 중인 PC는 데스크를 다시 고르라는 안내를 받아요." : ""}</p>`, [
    { label: "취소", cls: "ghost" },
    { label: "빼기", cls: "primary", fn: async () => {
      for (const c of claims) await del("claims", c.id);
      for (const t of doing) await patch("tasks", t.id, { status: "todo", slot: null });
      await del("desks", slot);
      addLog("leave", `데스크 ${slot}(${nm}) 뺌`);
      if (mine) { S.me = null; LS.set("slot", null); }
      toast(`데스크 ${slot}를 뺐어요.`, "ok");
      if (mine) askDesk();
    } },
  ]);
}
async function cleanGhost() {
  const g = S.claims.filter(c => !S.desks[c.slot]);
  for (const c of g) await del("claims", c.id);
  toast(`빠진 데스크의 잠금 ${g.length}개를 정리했어요.`, "ok");
  render();
}

/* ================= 작업 ================= */
const findTask = id => S.tasks.find(t => t.id === id);
async function lockTask(t, slot = S.me) {
  const bad = [];
  for (const p of t.paths || []) { const r = await addClaim(p, t.title, 3, { taskId: t.id, slot }); if (r.conflicts) bad.push(p); }
  if (bad.length) toast(`${bad.join(", ")} 는 상대 PC가 잠그고 있어 잠그지 못했어요.`, "bad", { label: "보기", fn: () => go("claims") });
  else if ((t.paths || []).length) toast(`'${t.title}' 경로를 잠갔어요.`, "ok");
}
async function takeTask(t, slot = S.me) {
  if (!S.me) return askDesk();
  if (db) { const cur = await db.collection("tasks").doc(t.id).get().catch(() => null); const c = cur?.data(); if (c && c.status === "doing" && c.slot && c.slot !== slot) return toast(`방금 데스크 ${SLOTS.includes(c.slot) ? c.slot : "?"}가 이 작업을 가져갔어요.`, "warn"); }
  const hits = (t.paths || []).flatMap(p => conflictsFor(p, slot));
  const doTake = async lock => {
    await patch("tasks", t.id, { status: "doing", slot, takenAt: now() });
    addLog("take", slot === S.me ? `'${t.title}' 가져감` : `'${t.title}'을(를) 데스크 ${slot}에 배정`);
    if (lock) await lockTask(t, slot);
  };
  if (hits.length) {
    confirmBox("겹치는 잠금이 있어요", `<p>${esc(deskName(hits[0].slot))}가 <code>${esc(hits[0].path)}</code> 를 잡고 있어요. 이대로 가져가면 같은 파일을 동시에 고칠 수 있어요.</p>`, [
      { label: "취소", cls: "ghost" },
      { label: "해제 요청 보내기", fn: () => nudge(`'${t.title}' 작업을 하려는데 ${hits[0].path} 잠금을 풀어줄 수 있을까요?`, hits[0].slot) },
      { label: "잠금 없이 가져가기", cls: "primary", fn: () => doTake(false) },
    ]);
    return;
  }
  doTake(true);
}
async function releaseTaskClaims(t) { for (const c of S.claims.filter(c => c.taskId === t.id)) await del("claims", c.id); }
async function untake(t) { await patch("tasks", t.id, { status: "todo", slot: null }); await releaseTaskClaims(t); addLog("untake", `'${t.title}' 대기열로`); }
async function completeTask(t) { await patch("tasks", t.id, { status: "done", doneAt: now() }); await releaseTaskClaims(t); addLog("done", `'${t.title}' 완료`); toast(`'${t.title}' 완료. 관련 잠금도 풀었어요.`, "ok"); }
function moveTask(id, col) {
  const t = findTask(id); if (!t) return;
  if (col === "todo") untake(t);
  else if (col === "done") completeTask(t);
  else if (SLOTS.includes(col) && S.desks[col]) { if (t.status === "doing" && t.slot === col) return; takeTask(t, col); }
}
async function addTask(title, paths, extra = {}) {
  await put("tasks", uid(), { title, paths, status: "todo", slot: null, createdAt: now(), ...extra });
}
async function cleanExpired() {
  const ex = S.claims.filter(c => !active(c));
  for (const c of ex) await del("claims", c.id);
  toast(`만료된 잠금 ${ex.length}개를 정리했어요.`, "ok");
}
async function clearExamples() {
  let n = 0;
  for (const s of deskList().filter(s => S.desks[s]?.example)) { await del("desks", s); n++; }
  if (S.me && !S.desks[S.me]) { S.me = null; LS.set("slot", null); }
  for (const coll of ARR) for (const d of S[coll].filter(x => x.example)) { await del(coll, d.id); n++; }
  toast(n ? `예시 ${n}개를 지웠어요.` : "지울 예시가 없어요.", "ok");
}

/* ================= 사용량 ================= */
function startWindow() { if (!S.me) return askDesk(); put("meta", "usage", { start: now(), hours: +$("#winHours").value || 5, by: S.me }); addLog("window", "세션 창 타이머 시작"); toast("세션 창 타이머를 시작했어요. 모든 PC가 같은 시계를 봅니다.", "ok"); }

/* ================= 이벤트 연결 ================= */
let relayKindManual = false;
function relayKind() { return $("#relayKind [aria-pressed=true]")?.dataset.k || "text"; }
function setRelayKind(k) { $$("#relayKind button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === k))); }
function guessKind(t) {
  if (/(Error|Exception|Traceback|ERR!|FAILED|\bat .+:\d+:\d+)/.test(t)) return "log";
  if (/^\s*(\$ |git |npm |pnpm |yarn |npx |cd |claude |brew |python3? |make )/m.test(t) && t.split("\n").length < 12) return "cmd";
  return null;
}
async function sendRelay() {
  const text = $("#relayIn").value.trim(); if (!text) return $("#relayIn").focus();
  if (!S.me) return askDesk();
  if (/(sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(text)) {
    return confirmBox("비밀 값처럼 보여요", "<p>API 키나 비밀 키로 보이는 문자열이 있어요. 릴레이 내용은 이 아티팩트의 저장소에 남습니다. 키는 지우고 보내세요.</p>", [{ label: "돌아가서 고치기", cls: "primary" }]);
  }
  const kind = relayKind();
  if (!(await put("relay", uid(), { from: S.me, kind, text: text.slice(0, 20000), createdAt: now() }))) return;
  bump("relay", "createdAt", 40);
  $("#relayIn").value = ""; relayKindManual = false; setRelayKind("text"); $("#relayHint").textContent = "";
  addLog("relay", `릴레이 보냄 (${KIND[kind] || "텍스트"})`);
  toast(others(S.me).length ? "모든 PC로 보냈어요." : "보냈어요. 다른 PC가 연결되면 거기서도 보여요.", "ok");
}
async function sendBaton() {
  if (!S.me) return askDesk();
  const d = batonDraft();
  if (!d.to) return toast("받을 데스크가 없어요. 다른 PC를 먼저 연결하세요.", "warn");
  if (hasSecret(Object.values(d).join(" "))) return toast("비밀 키처럼 보이는 값이 있어요. 지우고 다시 보내세요.", "bad");
  if (!d.next) { $("#bNext").focus(); return toast("'다음 할 일'은 꼭 적어주세요. 받는 쪽 Claude가 여기서 시작해요.", "warn"); }
  if (!d.branch) d.branch = S.desks[S.me]?.branch || "";
  const fire = async () => {
    if (!(await put("batons", uid(), { ...d, createdAt: now(), ackAt: null }))) return;
    bump("batons", "createdAt", 30);
    if (d.branch && streamOf(d.branch)?.holder === S.me) await recordLeave(d.branch, d.done, d.next, d.pushed);
    addLog("baton", `${deskName(d.to)}에 바통 넘김`);
    ["#bLast", "#bDone", "#bNext", "#bWarn"].forEach(s => ($(s).value = "")); $("#bPushed").checked = false;
    renderBatonPreview();
    toast(`바통을 넘겼어요. ${deskName(d.to)}에서 알림과 함께 확인할 수 있어요.`, "ok");
  };
  if (!d.pushed) confirmBox("아직 푸시 전이에요", "<p>푸시하지 않으면 다른 PC는 최신 코드를 받을 수 없어요. 먼저 <code>git push</code> 하길 권해요.</p>", [{ label: "돌아가기", cls: "ghost" }, { label: "그래도 넘기기", cls: "primary", fn: fire }]);
  else fire();
}

function wire() {
  $("#nav").addEventListener("click", e => { const b = e.target.closest(".nav-btn"); if (b) go(b.dataset.view); });
  $("#themeBtn").onclick = toggleTheme;
  $("#deskBtn").onclick = () => askDesk();
  $("#palBtn").onclick = openPal;
  ["#tourBtn", "#tourBtn2", "#tourBtn3"].forEach(s => ($(s).onclick = () => startTour()));
  $("#deskPick").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    pickSlot = b.dataset.slot;
    $$("#deskPick button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (S.online[pickSlot] && pickSlot !== S.me) toast(`데스크 ${pickSlot}는 다른 PC가 지금 쓰고 있어요. 같은 데스크를 고르면 두 PC를 구분할 수 없어요.`, "warn");
    $("#deskName").value = S.desks[pickSlot]?.name || "";
    $("#deskSave").disabled = false; $("#deskName").focus();
  });
  $("#deskSave").onclick = saveDeskPick;
  $("#deskName").addEventListener("keydown", e => { if (e.key === "Enter") saveDeskPick(); });

  $("#meTask").addEventListener("input", e => saveDesk({ task: e.target.value.trim() }));
  $("#meBranch").addEventListener("input", e => saveDesk({ branch: e.target.value.trim() }));
  $("#meLoad").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; if (!S.me) return askDesk(); saveDesk({ load: +b.dataset.l }, true); });

  $("#taskForm").addEventListener("submit", async e => {
    e.preventDefault();
    const title = $("#taskTitle").value.trim(); if (!title) return $("#taskTitle").focus();
    const paths = $("#taskPaths").value.split(",").map(normPath).filter(Boolean);
    await addTask(title, paths); addLog("task", `'${title}' 대기열에 추가`);
    $("#taskTitle").value = ""; $("#taskPaths").value = ""; $("#taskTitle").focus();
  });
  $("#claimForm").addEventListener("submit", async e => {
    e.preventDefault();
    const path = $("#claimPath").value, note = $("#claimNote").value.trim(), ttl = +$("#claimTtl").value;
    const r = await addClaim(path, note, ttl);
    if (r.conflicts) {
      const c = r.conflicts[0];
      confirmBox("이미 잡힌 영역과 겹쳐요", `<p>${esc(deskName(c.slot))}가 <code>${esc(c.path)}</code> 를 ${dur(c.expiresAt - now())} 동안 잡고 있어요.</p><p class="small" style="margin-top:8px">범위를 좁히거나 해제를 요청하세요.</p>`, [
        { label: "취소", cls: "ghost" },
        { label: "해제 요청", fn: () => nudge(`${c.path} 잠금을 풀어줄 수 있을까요? (${normPath(path)} 작업 예정)`, c.slot) },
        { label: "그래도 잠그기", cls: "primary", fn: async () => { await addClaim(path, note, ttl, { force: true }); toast("겹친 채로 잠갔어요. 상대 PC와 꼭 조율하세요.", "warn"); } },
      ]);
    } else if (r.ok) { toast(r.dup ? "이미 잠근 경로예요." : `${normPath(path)} 를 ${ttl}시간 동안 잠갔어요.`, "ok"); $("#claimPath").value = ""; $("#claimNote").value = ""; hideHint(); }
  });
  $("#checkIn").addEventListener("input", checkPath);
  $("#relayForm").addEventListener("submit", e => { e.preventDefault(); sendRelay(); });
  $("#relayKind").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; relayKindManual = true; setRelayKind(b.dataset.k); });
  $("#relayIn").addEventListener("input", e => { if (relayKindManual) return; const k = guessKind(e.target.value); setRelayKind(k || "text"); $("#relayHint").textContent = k ? `내용을 보고 '${KIND[k]}'로 분류했어요.` : ""; });
  $("#relayIn").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendRelay(); } });
  $("#batonForm").addEventListener("submit", e => { e.preventDefault(); sendBaton(); });
  $("#batonForm").addEventListener("input", renderBatonPreview);
  $("#batonForm").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendBaton(); } });
  $("#winStart").onclick = startWindow;
  $("#winClear").onclick = () => { del("meta", "usage"); toast("세션 창 타이머를 껐어요.", "ok"); };
  $("#winHours").addEventListener("change", e => { if (S.usage) patch("meta", "usage", { hours: +e.target.value }); });
  ["#sRepo", "#sMain", "#sFeat"].forEach(s => $(s).addEventListener("input", renderSetup));

  /* 위임 클릭 */
  document.addEventListener("click", e => {
    const t = e.target;
    const cp = t.closest("[data-copy]"); if (cp) return copyText($("pre", cp.closest(".code")).textContent, cp);
    const g = t.closest("[data-go]"); if (g) return go(g.dataset.go);
    const tip = t.closest("[data-tip]"); if (tip) return tipActs[+tip.dataset.tip]?.();
    const ob = t.closest("[data-ob]"); if (ob) return obActs[+ob.dataset.ob]?.();
    const ex = t.closest("[data-explain]"); if (ex) return explain(ex.dataset.explain);
    const a = t.closest("[data-act]"); if (!a) return;
    const id = a.dataset.id, act = a.dataset.act;
    const task = id && findTask(id), claim = id && S.claims.find(c => c.id === id), baton = id && S.batons.find(b => b.id === id), relay = id && S.relay.find(r => r.id === id);
    switch (act) {
      case "nudge": return nudge("관제실 확인 부탁해요", a.dataset.slot || "*");
      case "addDesk": return askDesk(true);
      case "removeDesk": return removeDesk(a.dataset.slot);
      case "take": return task && takeTask(task);
      case "untake": return task && untake(task);
      case "done": return task && completeTask(task);
      case "delTask": return task && del("tasks", task.id);
      case "release": return claim && releaseClaim(claim);
      case "extend": return claim && patch("claims", claim.id, { expiresAt: Math.max(now(), claim.expiresAt) + 3600e3 });
      case "askRelease": return claim && nudge(`${claim.path} 잠금을 풀어줄 수 있을까요?`, claim.slot);
      case "quickClaim": $("#claimPath").value = $("#checkIn").value; return $("#claimForm").requestSubmit();
      case "copyBaton": return baton && copyText(batonPrompt(baton), a);
      case "ack": if (baton) { patch("batons", baton.id, { ackAt: now() }); addLog("ack", `${deskName(baton.from)}의 바통 받음`); } return;
      case "delBaton": return baton && del("batons", baton.id);
      case "copyRelay": return relay && copyText(relay.text, a);
      case "delRelay": return relay && del("relay", relay.id);
      case "splitAdd": return addPlan(a.dataset.mode);
    }
  });

  /* 드래그 앤 드롭 */
  const board = $("#board");
  board.addEventListener("dragstart", e => { const c = e.target.closest("[data-task]"); if (c) { e.dataTransfer.setData("text/plain", c.dataset.task); e.dataTransfer.effectAllowed = "move"; } });
  board.addEventListener("dragover", e => { const col = e.target.closest(".col"); if (!col) return; e.preventDefault(); $$(".col.drop", board).forEach(x => x !== col && x.classList.remove("drop")); col.classList.add("drop"); });
  board.addEventListener("dragleave", e => { const col = e.target.closest(".col"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("drop"); });
  board.addEventListener("drop", e => { const col = e.target.closest(".col"); if (!col) return; e.preventDefault(); col.classList.remove("drop"); moveTask(e.dataTransfer.getData("text/plain"), col.dataset.col); });

  /* 반응형 힌트 바 */
  document.addEventListener("focusin", e => { const h = e.target.closest?.("[data-help]"); if (h) showHint(h.dataset.help); });
  document.addEventListener("focusout", e => { if (e.target.closest?.("[data-help]")) hideHint(); });
  $("#claimPath").addEventListener("input", e => liveConflictHint(e.target.value, "claim"));
  $("#taskPaths").addEventListener("input", e => e.target.value.split(",").some(p => p.trim()) ? liveConflictHint(e.target.value.split(",").pop(), "task") : null);
  $("#meBranch").addEventListener("input", e => {
    const v = e.target.value.trim(), o = S.me ? others(S.me).find(x => v && S.desks[x]?.branch === v) : null;
    if (o) showHint(`<b style="color:var(--bad)">${esc(deskName(o))}도 ${esc(v)} 에서 작업 중이에요.</b> 다른 브랜치를 쓰세요.`, true);
    else if (/^(main|master)$/.test(v)) showHint(`기본 브랜치는 피하세요. <code>${(S.me || "a").toLowerCase()}/기능이름</code> 형태를 추천해요.`, true);
    else showHint($("#meBranch").dataset.help);
  });
  $$(".nav-btn").forEach(b => {
    b.addEventListener("mouseenter", () => { if (matchMedia("(hover:hover)").matches && !document.activeElement?.closest?.("[data-help]")) showHint(NAV_HELP[b.dataset.view]); });
    b.addEventListener("mouseleave", () => { if (!document.activeElement?.closest?.("[data-help]")) hideHint(); });
  });

  /* 단축키 */
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return $("#pal").hidden ? openPal() : closePal(); }
    if (e.key === "Escape") { if (!$("#pal").hidden) return closePal(); if (tourI >= 0) return endTour(); $("#confirmModal").hidden = true; if (S.me) $("#deskModal").hidden = true; return; }
    if (tourI >= 0) { if (e.key === "ArrowRight") tourStep(tourI + 1); if (e.key === "ArrowLeft") tourStep(tourI - 1); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || !$("#pal").hidden || !$("#deskModal").hidden;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const views = Object.keys(VIEW_KO);
    if (/^[0-9]$/.test(e.key)) go(views[e.key === "0" ? 9 : +e.key - 1]);
    else if (e.key === "?") startTour();
    else if (e.key === "/") { e.preventDefault(); openPal(); }
  });
  addEventListener("resize", () => tourI >= 0 && placeTour());
}
