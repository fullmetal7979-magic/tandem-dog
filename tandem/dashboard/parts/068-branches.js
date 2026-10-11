
/* ================= 작업 흐름: 브랜치 단위로 PC·계정을 넘나드는 한 줄 ================= */
let vMode = LS.get("vMode", "branch"), bFilter = "active", vPanel = null, panelSig = "";
async function writeStream(branch, fields) {
  return streamOf(branch) ? patch("streams", sid(branch), { ...fields, updatedAt: now() })
    : put("streams", sid(branch), { branch, title: "", holder: null, next: "", ...fields, updatedAt: now() });
}
/* 떠나기·이어받기 직후 상태를 바로 반영(다음 스냅샷 전까지 '추정') */
async function assumeSnap(branch, mode) {
  const mine = snapOf(S.me), gh = snapOf("gh");
  if (mode === "pushed" && mine) {
    const mb = (mine.branches || []).find(x => x[0] === branch);
    if (mb) {
      await put("snaps", S.me, { ...mine, id: undefined, assumedAt: now(), branches: mine.branches.map(x => x[0] === branch ? [x[0], x[1], x[2] || "origin/" + branch, "", x[4], x[5]] : x) });
      if (gh) { const rest = (gh.branches || []).filter(x => x[0] !== branch); await put("snaps", "gh", { ...gh, id: undefined, assumedAt: now(), branches: [[branch, mb[1], mb[4], mb[5]], ...rest] }); }
    }
  }
  if (mode === "synced" && mine && gh) {
    const g = (gh.branches || []).find(x => x[0] === branch);
    if (g) { const rest = (mine.branches || []).filter(x => x[0] !== branch); await put("snaps", S.me, { ...mine, id: undefined, assumedAt: now(), branch, dirty: [], branches: [[branch, g[1], "origin/" + branch, "", g[2], g[3]], ...rest] }); }
  }
}
const sid = b => "b-" + b.replace(/[^A-Za-z0-9_.-]/g, c => "~" + c.charCodeAt(0).toString(16));
const streamOf = b => S.streams.find(x => x.branch === b);
const hopsOf = b => S.hops.filter(h => h.branch === b).sort((a, c) => a.at - c.at);
function parseTrack(t) { const a = /ahead (\d+)/.exec(t || ""), b = /behind (\d+)/.exec(t || ""); return { ahead: a ? +a[1] : 0, behind: b ? +b[1] : 0, gone: /gone/.test(t || "") }; }
const repoDir = () => ($("#vRepo")?.value.trim() || "~/code/my-app").replace(/\/+$/, "");

function branchModel() { return cached("bm", branchModel_); }
function branchModel_() {
  const gh = snapOf("gh"), map = new Map();
  const get = b => { if (!map.has(b)) map.set(b, { branch: b, gh: null, desks: {} }); return map.get(b); };
  for (const [name, head, ts, subj] of gh?.branches || []) get(String(name)).gh = { head: String(head || ""), ts: +ts || 0, subj };
  for (const sn of S.snaps.filter(x => x.id !== "gh")) for (const [name, head, up, track, ts, subj] of sn.branches || []) {
    const cur = sn.branch === name;
    get(String(name)).desks[sn.id] = { head: String(head || ""), up, ...parseTrack(track), ts, subj, cur, dirty: cur ? (sn.dirty || []).length : 0, at: sn.at, agentId: sn.agentId, agentName: sn.agentName };
  }
  for (const st of S.streams) get(st.branch);
  for (const s of deskList()) { const b = S.desks[s]?.branch; if (b) get(b); }
  const rows = [...map.values()];
  for (const r of rows) {
    r.stream = streamOf(r.branch);
    r.last = Math.max(r.gh?.ts || 0, ...Object.values(r.desks).map(d => d.ts || 0)) * 1000;
    r.hops = hopsOf(r.branch);
    r.touched = Math.max(r.last, r.hops.at(-1)?.at || 0, r.stream?.updatedAt || 0);
    r.status = laneStatus(r);
    r.active = !!r.stream || Object.values(r.desks).some(d => d.cur || d.ahead || d.behind || !d.up) || deskList().some(s => S.desks[s]?.branch === r.branch);
  }
  return rows.sort((a, b) => (b.stream?.holder === S.me) - (a.stream?.holder === S.me) || !!b.stream - !!a.stream || b.touched - a.touched);
}
function laneStatus(r) {
  const out = [], D = Object.entries(r.desks);
  const heads = new Set([r.gh?.head, ...D.map(([, d]) => d.head)].filter(Boolean));
  for (const [s, d] of D) {
    if (!d.up) out.push(["warn", `${s}에만 있어요 · 아직 GitHub에 없음`]);
    else if (d.gone) out.push(["warn", `${s}: GitHub 브랜치가 지워졌어요`]);
    if (d.ahead) out.push(["warn", `${s}에 푸시 안 한 커밋 ${d.ahead}개`]);
    if (d.behind) out.push(["bad", `${s}가 ${d.behind}커밋 뒤처짐 · pull 필요`]);
    if (d.dirty) out.push(["info", `${s}에 커밋 안 한 변경 ${d.dirty}개`]);
  }
  if (!out.length && heads.size === 1) out.push(["ok", "기록된 모든 위치가 같은 커밋이에요"]);
  else if (!out.length && heads.size > 1) out.push(["warn", "위치마다 커밋이 달라요 · 스냅샷을 다시 올려 확인하세요"]);
  else if (!heads.size) out.push(["neutral", "아직 스냅샷 기록이 없어요"]);
  return out;
}
function hopLabel(h) { return `${h.desk}${h.agentId ? " · " + agentName(h.agentId) : ""}`; }
function ribbon(r, withNow) {
  const hs = r.hops.slice(-8), st = r.stream;
  if (!hs.length) return "";
  const items = hs.map((h, i) => {
    const isNow = withNow && i === hs.length - 1 && h.kind === "in" && st?.holder === h.desk;
    return `<div class="hop ${h.kind === "out" ? "out" : ""} ${isNow ? "now" : ""}" data-slot="${h.desk}"><span class="d">${h.desk}</span><b>${esc(h.agentId ? agentName(h.agentId) : deskName(h.desk))}</b><span>${h.kind === "out" ? "떠남" : isNow ? "지금 여기" : "이어받음"} · ${ago(h.at)}</span></div>`;
  });
  if (withNow && st && !st.holder) items.push(`<div class="hop wait"><span class="d">?</span><b>다음 자리</b><span>이어받을 PC를 기다리는 중</span></div>`);
  return `<div class="ribbon">${items.join('<span class="hop-line"></span>')}</div>`;
}
function locCell(key, r) {
  const base = r.gh?.head, order = [...new Set([base, ...Object.values(r.desks).map(d => d.head)].filter(Boolean))];
  const chip = h => { const i = order.indexOf(h); return `<span class="vcell v${Math.min(i, 5)}">${esc(h.slice(0, 7))}</span>`; };
  if (key === "gh") return r.gh ? `<div class="loc"><div class="lt">${pill("neutral", "GH")}<span>GitHub</span></div>${chip(r.gh.head)}<div class="lm">${esc(r.gh.subj || "")} · ${ago(r.gh.ts * 1000)}</div></div>`
    : `<div class="loc none"><div class="lt">${pill("neutral", "GH")}<span>GitHub</span></div><div class="lm">${snapOf("gh") ? "이 브랜치 없음 (푸시 전)" : "스냅샷을 올리면 표시돼요"}</div></div>`;
  const d = r.desks[key], sn = snapOf(key);
  const agn = d ? (S.agents.find(a => a.id === d.agentId)?.name || d.agentName || "") : "";
  if (!d) return `<div class="loc none" data-slot="${key}"><div class="lt">${pill(key, key)}<span>${esc(deskName(key))}</span></div><div class="lm">${sn ? "이 PC에는 이 브랜치가 없어요" : "이 PC의 스냅샷이 없어요"}</div></div>`;
  const flags = [d.cur ? pill("ok", "체크아웃") : "", d.ahead ? pill("warn", "↑" + d.ahead + " 푸시 전") : "", d.behind ? pill("bad", "↓" + d.behind + " 받을 것") : "", d.dirty ? pill("info", "미커밋 " + d.dirty) : "", !d.up ? pill("warn", "로컬 전용") : ""].join("");
  return `<div class="loc" data-slot="${key}"><div class="lt">${pill(key, key)}<span>${esc(deskName(key))}</span></div>${agn ? `<div class="lm">계정: ${esc(agn)}</div>` : ""}${chip(d.head)}${flags ? `<div class="flags">${flags}</div>` : ""}<div class="lm">기록 ${ago(d.at)}</div></div>`;
}
function laneHtml(r) {
  const st = r.stream, held = st?.holder, desks = [...new Set([...deskList(), ...Object.keys(r.desks)])];
  return `<div class="lane ${held ? "held" : ""}" ${held ? `data-slot="${held}"` : ""}>
    <div class="lane-h"><div style="min-width:0"><div class="row" style="gap:8px">${st?.title ? `<b>${esc(st.title)}</b>` : ""}<span class="lane-name">${esc(r.branch)}</span>
      ${held ? pill(held, `${S.me && held === S.me ? "이 PC" : "데스크 " + held}에서 작업 중${st.holderAgent ? " · " + agentName(st.holderAgent) : ""}`) : st ? pill("neutral", "다음 자리 대기") : ""}</div>
      ${st?.next ? `<div class="small" style="margin-top:4px"><b>다음</b> · ${esc(st.next.split("\n")[0])}</div>` : ""}</div>
      <div class="row" style="gap:4px">${S.me && held === S.me ? `<button class="btn sm primary" data-act="bOut" data-b="${esc(r.branch)}">떠나기</button>` : `<button class="btn sm primary" data-act="bIn" data-b="${esc(r.branch)}">여기서 이어받기</button>`}
        <button class="btn sm ghost" data-act="bName" data-b="${esc(r.branch)}">${st?.title ? "이름 바꾸기" : "작업 이름 붙이기"}</button></div></div>
    <div class="locs">${locCell("gh", r)}${desks.map(k => locCell(k, r)).join("")}</div>
    <div class="flags">${r.status.map(([l, t]) => pill(l, t)).join("")}</div>
    ${ribbon(r, false)}</div>`;
}
function renderHero(rows) {
  const mine = S.me ? rows.find(r => r.stream?.holder === S.me) : null;
  const recent = mine || rows.filter(r => r.stream).sort((a, b) => (b.hops.at(-1)?.at || 0) - (a.hops.at(-1)?.at || 0))[0];
  if (!recent) {
    $("#vHero").innerHTML = `<div class="eyebrow">지금 이어지는 작업</div><div class="hero-title">아직 이어가는 작업이 없어요</div>
      <p class="small muted">작업할 브랜치를 적고 시작하면, 어느 PC·어느 계정에서 이어받든 이 자리에 한 줄로 이어져요.</p>
      <form class="row" id="heroStart"><input class="in mono" id="hsBranch" placeholder="브랜치 예) feat/payments" style="flex:1 1 180px" value="${esc(S.desks[S.me]?.branch || "")}"><input class="in" id="hsTitle" placeholder="작업 이름 예) 결제 기능" style="flex:1 1 160px"><button class="btn primary" type="submit">이 PC에서 시작</button></form>`;
    return;
  }
  const st = recent.stream, held = st.holder, last = recent.hops.filter(h => h.kind === "out").at(-1);
  $("#vHero").innerHTML = `<div class="card-h"><div class="eyebrow">지금 이어지는 작업</div>${held ? pill(held, S.me && held === S.me ? "이 PC에서 작업 중" : `데스크 ${held}에서 작업 중`) : pill("neutral", "다음 자리 대기 중")}</div>
    <div><div class="hero-title">${esc(st.title || recent.branch)}</div><div class="lane-name small muted">${esc(recent.branch)}</div></div>
    ${ribbon(recent, true) || `<p class="small muted">아직 이동 기록이 없어요.</p>`}
    <div class="grid g2">
      <div class="stack"><div class="eyebrow">다음 할 일</div><div>${esc(st.next || "—").replace(/\n/g, "<br>")}</div></div>
      <div class="stack"><div class="eyebrow">지난 자리에서 남긴 메모</div><div class="small">${last ? `${esc(last.note || "—").replace(/\n/g, "<br>")}<div class="muted">${esc(hopLabel(last))} · ${ago(last.at)}</div>` : "—"}</div></div>
    </div>
    <div class="flags">${recent.status.map(([l, t]) => pill(l, t)).join("")}</div>
    <div class="row">${S.me && held === S.me ? `<button class="btn primary" data-act="bOut" data-b="${esc(recent.branch)}">떠나기</button><button class="btn" data-act="bIn" data-b="${esc(recent.branch)}">이어받기 프롬프트 다시 보기</button>` : `<button class="btn primary" data-act="bIn" data-b="${esc(recent.branch)}">이 PC에서 이어받기</button>`}</div>`;
}

/* 이어하기 / 떠나기 패널 */
function resumePrompt(branch) {
  const st = streamOf(branch) || {}, hs = hopsOf(branch), last = hs.filter(h => h.kind === "out").at(-1), ag = activeAgent();
  const path = hs.filter(h => h.kind === "in").slice(-6).map(hopLabel);
  const ss = S.session || {};
  return `[같은 작업 이어하기 · Tandem]
나는 여러 PC와 여러 AI 계정을 오가며 한 작업을 이어서 하고 있어요. 지금 이 대화가 같은 작업의 다음 장면이라고 생각하고 그대로 이어가 주세요.

작업: ${st.title || branch}
브랜치: ${branch}
이 작업이 지나온 자리: ${[...path, `지금 ${S.me ? "데스크 " + S.me : "이 PC"}${ag ? " · " + ag.name : ""}`].join(" → ")}
${last ? `지난 자리(${hopLabel(last)}, ${new Date(last.at).toLocaleString("ko-KR")})에서 남긴 메모:\n${last.note || "-"}\n` : ""}
다음 할 일:
${st.next || "-"}

프로젝트 목표: ${ss.goal || "-"}
지켜야 할 결정:
${S.decisions.map(d => "- " + d.text).join("\n") || "- (없음)"}

먼저 git log --oneline -8 과 git status 로 지난 자리의 변경을 확인하고, 다음 할 일부터 이어서 진행하세요. 시작 전에 지금 상황을 3줄로 정리해 주세요.`;
}
function syncCmd(branch) {
  const b = shq(branch), ob = shq("origin/" + branch);
  return `cd ${repoDir()}
git fetch origin --prune
git switch ${b} 2>/dev/null || git switch -c ${b} --track ${ob}
git pull --rebase --autostash
git log --oneline -5`;
}
function leaveCmd(branch, msg) {
  const m = msg || `wip: ${branch} 작업 중간 저장`, b = shq(branch);
  return `cd ${repoDir()}
git switch ${b}
git add -A
git commit -m ${shq(m)} || echo "커밋할 변경 없음"
git push -u origin ${b}`;
}
function openPanel(type, branch) { vPanel = { type, branch }; panelSig = ""; if (vMode !== "branch") { vMode = "branch"; LS.set("vMode", "branch"); } if (S.view !== "versions") go("versions", true); renderPanel(); $("#vPanel").scrollIntoView({ block: "start", behavior: "smooth" }); }
function renderPanel() {
  const P = $("#vPanel");
  if (!vPanel) { P.hidden = true; P.innerHTML = ""; return; }
  P.hidden = false;
  const b = vPanel.branch, st = streamOf(b), r = branchModel().find(x => x.branch === b) || { desks: {} }, d = r.desks?.[S.me], ag = activeAgent();
  if (vPanel.type === "in") {
    const other = st?.holder && st.holder !== S.me ? st.holder : null;
    const state = !snapOf(S.me) ? "이 PC 스냅샷이 없어서 상태를 모르는 채로 진행해요. 아래 명령이 알아서 맞춰줍니다."
      : !d ? "이 PC에는 아직 이 브랜치가 없어요. 아래 명령이 GitHub에서 받아옵니다."
      : d.behind ? `이 PC가 ${d.behind}커밋 뒤처져 있어요. 아래 명령으로 받아오세요.` : d.dirty ? `이 PC에 커밋 안 한 변경이 ${d.dirty}개 있어요. 명령이 잠시 치워뒀다가 다시 적용해요(autostash).` : "이 PC는 기록상 최신이에요. 그래도 한 번 맞추고 시작하세요.";
    if (!S.me) { P.innerHTML = `<div class="card-h"><div class="card-t">먼저 이 PC의 데스크를 정해 주세요</div><button class="btn sm ghost" data-act="bClose">닫기</button></div><p class="small muted">어느 PC에서 이어받는지 알아야 작업 줄에 기록할 수 있어요.</p><div class="row"><button class="btn primary" data-act="addDesk">데스크 지정</button></div>`; return; }
    P.innerHTML = `<div class="card-h"><div class="card-t">${pill(S.me, "데스크 " + S.me)} 에서 '${esc(st?.title || b)}' 이어하기</div><button class="btn sm ghost" data-act="bClose">닫기</button></div>
      ${other ? `<div class="tip warn"><div class="tip-i">!</div><div class="tip-b"><b>데스크 ${other}가 아직 이 작업을 잡고 있어요.</b> 그 PC에서 '떠나기'를 안 했다면 푸시 안 된 변경이 있을 수 있어요. 그래도 이어받으면 이 PC로 넘어옵니다.</div></div>` : ""}
      <div class="small">${esc(state)}</div>
      <div class="steps small">
        <div class="step"><div style="flex:1;min-width:0"><b>코드를 같은 상태로 맞추기</b> <span class="muted">가상 세션 키트를 설치했다면 이 한 줄이면 돼요: <code>sh .tandem/tandem.sh resume ${esc(b)}</code></span>${codeBlock("", syncCmd(b))}</div></div>
        <div class="step"><div style="flex:1;min-width:0"><b>${ag ? esc(ag.name) + "에" : "Claude나 Codex에"} 붙여넣기</b> <span class="muted">계정이 다르면 <button class="btn sm ghost" data-go="session">프로젝트 세션</button>에서 바꾸세요</span>${codeBlock("", resumePrompt(b))}</div></div>
        <div class="step"><div style="flex:1"><b>이어받았다고 기록</b><div class="row" style="margin-top:6px"><button class="btn primary" data-act="bInDone" data-b="${esc(b)}">이어받았어요</button><span class="small muted">작업 줄에 이 PC·계정이 추가되고, 다른 PC에 알림이 가요.</span></div></div></div>
      </div>`;
  } else {
    P.innerHTML = `<div class="card-h"><div class="card-t">'${esc(st?.title || b)}' 떠나기</div><button class="btn sm ghost" data-act="bClose">닫기</button></div>
      <div class="grid g2">
        <div class="field"><label for="boNote">여기서 한 일 (다음 자리에 보여줄 메모)</label><textarea class="in" id="boNote" rows="3" placeholder="- 결제 실패 재시도 로직 추가&#10;- 테스트 2개 실패 중 (원인: 타임아웃)"></textarea></div>
        <div class="field"><label for="boNext">다음 할 일</label><textarea class="in" id="boNext" rows="3" placeholder="- 타임아웃 테스트 고치기">${esc(st?.next || "")}</textarea></div>
      </div>
      <div class="field"><label for="boMsg">커밋 메시지</label><input class="in mono" id="boMsg" placeholder="wip: 결제 재시도 중간 저장"></div>
      <p class="small muted">가상 세션 키트를 설치했다면 커밋·푸시·세션 기록·스냅샷 복사를 한 줄로: <code>sh .tandem/tandem.sh leave "한 일" "다음 할 일"</code></p>
      <div id="boCmd">${codeBlock("커밋하고 푸시하기", leaveCmd(b, ""))}</div>
      <label class="row small"><input type="checkbox" id="boPushed"> 위 명령으로 푸시까지 했어요</label>
      <div class="row"><button class="btn primary" data-act="bOutDone" data-b="${esc(b)}">떠났어요</button><span class="small muted">작업이 '다음 자리 대기'가 되고, 어느 PC에서든 이어받을 수 있어요.</span></div>`;
    $("#boMsg").addEventListener("input", e => ($("#boCmd").innerHTML = codeBlock("커밋하고 푸시하기", leaveCmd(b, e.target.value.trim()))));
  }
}
async function checkIn(branch) {
  if (!S.me) return askDesk();
  const st = streamOf(branch), ag = activeAgent(), prev = st?.holder;
  const d = branchModel().find(x => x.branch === branch)?.desks?.[S.me];
  const ok = await put("hops", uid(), { branch, desk: S.me, agentId: ag?.id || null, at: now(), kind: "in", head: d?.head || null });
  if (!ok) return;
  await writeStream(branch, { holder: S.me, holderAgent: ag?.id || null, since: now() });
  for (const b of S.batons.filter(b => !b.ackAt && b.branch === branch && b.from !== S.me && (b.to === S.me || b.to === "*"))) await patch("batons", b.id, { ackAt: now(), ackBy: S.me });
  await assumeSnap(branch, "synced");
  saveDesk({ branch }, true);
  addLog("hop", `'${st?.title || branch}' 이어받음${ag ? " · " + ag.name : ""}`);
  if (prev && prev !== S.me) nudge(`'${st?.title || branch}' 작업을 데스크 ${S.me}에서 이어받았어요.`, prev);
  bump("hops", "at", 150);
  vPanel = null; renderPanel();
  toast(`'${st?.title || branch}'을(를) 이 PC에서 이어받았어요. 작업 줄에 기록했어요.`, "ok");
}
async function recordLeave(branch, note, next, pushed) {
  const st = streamOf(branch), ag = activeAgent();
  const ok = await put("hops", uid(), { branch, desk: S.me, agentId: ag?.id || null, at: now(), kind: "out", note, next, pushed });
  if (!ok) return false;
  await writeStream(branch, { holder: null, holderAgent: null, next: next || st?.next || "", lastDesk: S.me });
  if (pushed) await assumeSnap(branch, "pushed");
  addLog("hop", `'${st?.title || branch}' 떠남`);
  bump("hops", "at", 150);
  return true;
}
async function checkOut(branch) {
  if (!S.me) return askDesk();
  const note = $("#boNote").value.trim(), next = $("#boNext").value.trim(), pushed = $("#boPushed").checked;
  if (hasSecret(note + next)) return toast("메모에 비밀 키처럼 보이는 값이 있어요. 지우고 다시 저장하세요.", "bad");
  const fire = async () => {
    if (!(await recordLeave(branch, note, next, pushed))) return;
    /* 바통 기록에도 남겨 바통 터치 화면·알림과 하나로 이어지게 */
    await put("batons", uid(), { from: S.me, to: "*", branch, last: $("#boMsg")?.value.trim() || "", done: note, next, warn: "", pushed, createdAt: now(), ackAt: null });
    bump("batons", "createdAt", 30);
    vPanel = null; renderPanel();
    toast("떠나기를 기록했어요. 다른 PC에서 '이어받기'를 누르면 이 메모부터 이어져요.", "ok");
  };
  if (!pushed) return confirmBox("아직 푸시 전이에요", "<p>푸시하지 않으면 다른 PC에서 이 작업의 최신 코드를 받을 수 없어요. 위 명령을 먼저 실행하길 권해요.</p>", [{ label: "돌아가기", cls: "ghost" }, { label: "그래도 기록", cls: "primary", fn: fire }]);
  fire();
}
function nameStream(branch) {
  const st = streamOf(branch);
  confirmBox("작업 이름", `<div class="field"><label for="nsIn">'${esc(branch)}' 작업을 뭐라고 부를까요?</label><input class="in" id="nsIn" value="${esc(st?.title || "")}" placeholder="예) 결제 기능"></div>`, [
    { label: "취소", cls: "ghost" },
    { label: "저장", cls: "primary", fn: () => { const t = oneLine($("#nsIn")?.value || "").trim().slice(0, 60); writeStream(branch, { title: t }); } },
  ]);
  setTimeout(() => $("#nsIn")?.focus(), 30);
}
function renderBranches() {
  if (!$("#vLanes")) return;
  $$("#vMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === vMode)));
  $("#vBranchWrap").hidden = vMode !== "branch"; $("#vFileWrap").hidden = vMode !== "file";
  const rows = branchModel();
  if (document.activeElement?.closest?.("#vHero") == null) {
    const keep = [$("#hsBranch")?.value, $("#hsTitle")?.value];
    renderHero(rows);
    if (keep[0] != null && $("#hsBranch")) { $("#hsBranch").value = keep[0]; $("#hsTitle").value = keep[1] || ""; }
  }
  const list = bFilter === "all" ? rows : rows.filter(r => r.active);
  const hidden = rows.length - list.length;
  $("#vLanes").innerHTML = list.length ? list.slice(0, 40).map(laneHtml).join("") + (hidden ? `<button class="btn sm ghost" data-act="bAll">조용한 브랜치 ${hidden}개 더 보기</button>` : "")
    : `<div class="empty"><b>아직 기록된 브랜치가 없어요.</b><br>아래 스냅샷 명령을 PC 저장소에서 실행해 올리면, 그 PC와 GitHub의 브랜치가 여기에 줄로 나타나요. 또는 위에서 작업을 바로 시작하세요.</div>`;
  if (vPanel?.type === "in" && document.activeElement?.closest?.("#vPanel") == null) {
    const sg = JSON.stringify([rows.find(x => x.branch === vPanel.branch)?.desks?.[S.me], streamOf(vPanel.branch), S.me, activeAgent()?.id]);
    if (sg !== panelSig) { panelSig = sg; renderPanel(); }
  }
}
function branchTips(T) {
  if (!S.me) return;
  const mine = S.me ? S.streams.find(s => s.holder === S.me) : null;
  const waiting = S.streams.filter(s => !s.holder && s.next);
  if (!mine && waiting.length) T.push({ l: "warn", arrive: true, t: `<b>이어받을 작업이 있어요:</b> ${esc(waiting[0].title || waiting[0].branch)}. 다음 할 일: ${esc((waiting[0].next || "").split("\n")[0])}`, a: ["이어하기", () => { go("versions"); openPanel("in", waiting[0].branch); }] });
  const stale = S.streams.find(s => s.holder && s.holder !== S.me && !S.online[s.holder] && now() - (s.since || 0) > 8 * 3600e3);
  if (stale) T.push({ l: "info", t: `데스크 ${stale.holder}가 '${esc(stale.title || stale.branch)}'를 8시간 넘게 잡고 있어요. 떠나기를 잊었는지 확인하세요.`, a: ["작업 흐름", () => go("versions")] });
}
function wireBranches() {
  $("#vMode").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; vMode = b.dataset.m; LS.set("vMode", vMode); renderBranches(); renderVersions(); });
  $("#bFilter").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; bFilter = b.dataset.f; $$("#bFilter button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderBranches(); });
  document.addEventListener("submit", e => {
    if (e.target.id !== "heroStart") return; e.preventDefault();
    const br = $("#hsBranch").value.trim().replace(/\s+/g, "-"); if (!br) return $("#hsBranch").focus();
    if (!validBranch(br)) return toast("브랜치 이름에 쓸 수 없는 문자가 있어요. 영문·숫자·한글과 / - _ . 만 쓰세요.", "warn");
    const t = oneLine($("#hsTitle").value).trim().slice(0, 60);
    if (streamOf(br)) return openPanel("in", br);
    writeStream(br, { title: t }).then(ok => ok && openPanel("in", br));
  });
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-act]"); if (!a) return;
    const b = a.dataset.b;
    switch (a.dataset.act) {
      case "bIn": return openPanel("in", b);
      case "bOut": return openPanel("out", b);
      case "bClose": vPanel = null; return renderPanel();
      case "bInDone": return checkIn(b);
      case "bOutDone": return checkOut(b);
      case "bName": return nameStream(b);
      case "bAll": bFilter = "all"; $$("#bFilter button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.f === "all"))); return renderBranches();
    }
  });
}
