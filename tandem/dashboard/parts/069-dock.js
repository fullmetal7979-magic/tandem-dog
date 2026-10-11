
/* ================= 상황판: 항상 보이는 한눈 요약 + 반응하는 노드 ================= */
let dkSigAct = null, dkBranch = LS.get("dkBranch", ""), dkCollapsed = LS.get("dockCollapsed", innerWidth < 1280), dkSigs = {}, dkMenuActs = [];
function relOf(r, s) {
  const d = r.desks[s];
  if (!snapOf(s)) return { k: "none", b: "?", t: "이 PC의 스냅샷이 없어 상태를 몰라요" };
  if (!d) return { k: "none", b: "–", t: "이 PC에는 이 브랜치가 없어요" };
  if (!d.up) return { k: "ahead", b: "↑", t: "이 PC에만 있어요 · 푸시가 필요해요" };
  if (d.ahead && d.behind) return { k: "bad", b: `↑${d.ahead}↓${d.behind}`, t: `GitHub와 갈라졌어요 (앞 ${d.ahead} · 뒤 ${d.behind})` };
  if (d.ahead) return { k: "ahead", b: `↑${d.ahead}`, t: `GitHub보다 ${d.ahead}커밋 앞서요 · 푸시가 필요해요` };
  if (d.behind) return { k: "behind", b: `↓${d.behind}`, t: `${d.behind}커밋 뒤처졌어요 · pull이 필요해요` };
  if (r.gh && d.head !== r.gh.head) return { k: "warn", b: "≠", t: "GitHub와 커밋이 달라요 · 스냅샷을 다시 올려 확인하세요" };
  return { k: "ok", b: "=", t: "GitHub와 같은 커밋이에요" };
}
function dockModel() { return cached("dm", dockModel_); }
function dockModel_() {
  const rows = branchModel();
  const held = S.me ? rows.find(r => r.stream?.holder === S.me) : null;
  const recent = rows.filter(r => r.stream).sort((a, b) => (b.hops.at(-1)?.at || 0) - (a.hops.at(-1)?.at || 0))[0];
  const pick = (dkBranch && rows.find(r => r.branch === dkBranch)) ? dkBranch : held?.branch || recent?.branch || S.desks[S.me]?.branch || snapOf("gh")?.base || rows[0]?.branch || "";
  const r = rows.find(x => x.branch === pick) || { branch: pick, gh: null, desks: {}, hops: hopsOf(pick), stream: streamOf(pick), status: [] };
  const desks = [...new Set([...deskList(), ...Object.keys(r.desks)])];
  const rels = Object.fromEntries(desks.map(s => [s, relOf(r, s)]));
  /* 최신 버전 위치: 커밋 시각이 가장 늦은 곳(같은 커밋이면 모두) */
  const candsAll = [{ key: "gh", ts: r.gh?.ts || 0, head: r.gh?.head }, ...desks.map(s => ({ key: s, ts: r.desks[s]?.ts || 0, head: r.desks[s]?.head, push: (r.desks[s]?.ahead || 0) + (r.desks[s]?.up ? 0 : 1) }))].filter(c => c.head);
  /* 최신 판정: 푸시 안 한 커밋이 있는 PC > GitHub > (GitHub 기록 없을 때) 가장 늦은 커밋. 뒤처진 PC는 제외 */
  const localNew = candsAll.filter(c => c.key !== "gh" && c.push).sort((a, b) => b.ts - a.ts);
  const cands = localNew.length ? localNew : r.gh ? candsAll.filter(c => c.key === "gh") : candsAll.filter(c => !r.desks[c.key]?.behind).sort((a, b) => b.ts - a.ts);
  const latestHead = cands[0]?.head, latest = new Set(candsAll.filter(c => c.head === latestHead && !r.desks[c.key]?.behind).map(c => c.key));
  const localOnly = new Set(localNew.length ? [...latest].filter(k => k !== "gh") : []);
  /* 신호 */
  const issues = [], st = r.stream, holder = st?.holder;
  if (holder) {
    const hr = rels[holder];
    if (hr && (hr.k === "behind" || hr.k === "bad")) issues.push(["bad", `이어받은 데스크 ${holder}가 최신이 아니에요`, `${hr.t}. 그 PC에서 pull 후 이어가세요.`]);
    else if (latestHead && !latest.has(holder) && snapOf(holder)) issues.push(["warn", `작업 중인 ${holder}보다 새 커밋이 다른 곳에 있어요`, `최신은 ${[...latest].map(k => k === "gh" ? "GitHub" : "데스크 " + k).join(", ")}에 있어요.`]);
  }
  for (const s of desks) { const x = rels[s]; if (x.k === "behind" && s !== holder) issues.push(["warn", `데스크 ${s}가 ${x.b.slice(1)}커밋 뒤처짐`, "그 PC에서 작업하기 전에 pull이 필요해요."]); if (x.k === "bad" && s !== holder) issues.push(["bad", `데스크 ${s}가 GitHub와 갈라짐`, x.t]); if (x.k === "ahead") issues.push(["warn", `데스크 ${s}에 푸시 안 한 커밋`, "다른 PC·계정이 이어받으려면 푸시가 필요해요."]); }
  const cc = crossConflicts().length; if (cc) issues.push(["bad", `잠금 ${cc}건이 겹쳐요`, "같은 파일을 동시에 고칠 위험이 있어요."]);
  const inbox = S.batons.filter(b => !b.ackAt && (b.to === S.me || (b.to === "*" && S.me && b.from !== S.me))).length; if (inbox) issues.push(["warn", `받지 않은 바통 ${inbox}개`, "이어하기 프롬프트를 확인하세요."]);
  const mySnap = snapOf(S.me); if (S.me && mySnap && now() - mySnap.at > 6 * 3600e3) issues.push(["info", "이 PC 스냅샷이 오래됐어요", `${ago(mySnap.at)} 기록 · 다시 올리면 정확해져요.`]);
  if (S.me && !mySnap) issues.push(["info", "이 PC 상태가 아직 기록되지 않았어요", "스냅샷을 한 번 올리면 최신 위치를 정확히 보여줘요."]);
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 };
  issues.sort((a, b) => rank[a[0]] - rank[b[0]]);
  let sig;
  if (issues.length && issues[0][0] !== "info") sig = issues[0];
  else if (holder) sig = ["ok", `데스크 ${holder}에서 잘 이어가는 중`, st?.title ? `'${st.title}' · 최신 버전 위치와 맞아요` : "최신 버전 위치와 맞아요"];
  else if (st) sig = ["ok", "다음 자리를 기다리는 중", st.next ? "다음: " + st.next.split("\n")[0] : "어느 PC에서든 이어받을 수 있어요"];
  else sig = issues[0] || ["ok", "모두 최신이에요", "충돌 위험이 없어요"];
  const me = S.me, mr = me ? rels[me] : null, b = r.branch;
  let act = null;
  if (!me) act = ["데스크 지정", () => askDesk()];
  else if (b && st && !holder) act = ["이어받기", () => openPanel("in", b)];
  else if (b && mr && (mr.k === "behind" || mr.k === "bad")) act = ["pull 명령 복사", () => copyText(syncCmd(b))];
  else if (b && mr && mr.k === "ahead") act = ["푸시 명령 복사", () => copyText(leaveCmd(b, ""))];
  else if (b && holder === me) act = ["떠나기", () => openPanel("out", b)];
  else if (!snapOf(me)) act = ["상태 기록 명령 복사", () => copyText(snapCommand())];
  else if (b && holder && holder !== me) act = ["이어받기", () => openPanel("in", b)];
  const fresh = Math.max(0, ...S.snaps.map(x => Math.max(x.at || 0, x.assumedAt || 0)));
  return { rows, r, desks, rels, latest, localOnly, latestHead, sig, issues, act, fresh };
}
function nodeHtml(key, m) {
  const { r, rels, latest } = m, st = r.stream, holder = st?.holder;
  const isLatest = latest.has(key) && m.latestHead, lo = m.localOnly.has(key);
  const crown = isLatest ? (lo ? '<span class="dn-crown lo">♛ 최신·로컬만</span>' : '<span class="dn-crown">♛ 최신</span>') : "";
  if (key === "gh") {
    const sn = snapOf("gh");
    return `<button class="dnode gh ${isLatest ? "latest" : ""}" data-node="gh"><span class="dn-tag">GH</span><span class="dn-main"><b>GitHub</b><small>${r.gh ? esc(r.gh.head.slice(0, 7)) + " · " + ago(r.gh.ts * 1000) : sn ? "이 브랜치 없음" : "스냅샷 대기"}</small></span>${isLatest ? '<span class="dn-crown">♛ 최신</span>' : ""}</button>`;
  }
  if (key === "virtual") {
    const gh = new Map(snapOf("gh")?.files || []); let dif = 0;
    for (const [p, h] of Object.entries(vHashes)) if (gh.get(p) !== h) dif++;
    return `<button class="dnode vs" data-node="virtual"><span class="dn-tag">VS</span><span class="dn-main"><b>가상 세션</b><small>파일 ${S.files.length}개${gh.size ? ` · GitHub와 다른 파일 ${dif}` : ""}</small></span></button>`;
  }
  const d = r.desks[key], ag = S.agents.find(a => a.id === S.desks[key]?.agentId)?.name || (d ? S.agents.find(a => a.id === d.agentId)?.name || d.agentName : "");
  return `<button class="dnode ${isLatest ? "latest" : ""} ${holder === key ? "holder" : ""}" data-node="${key}" data-slot="${key}"><span class="dn-tag">${key}${S.online[key] ? '<span class="on"></span>' : ""}</span>
    <span class="dn-main"><b>${esc(deskName(key))}${key === S.me ? " · 이 PC" : ""}</b><small>${ag ? esc(ag) + " · " : ""}${d ? esc(d.head.slice(0, 7)) + (d.dirty ? ` · 미커밋 ${d.dirty}` : "") : rels[key].k === "none" ? esc(rels[key].t.replace(/이에요|어요/, "")) : ""}</small></span>${crown || (holder === key ? pill(key, "작업 중") : "")}</button>`;
}
function renderDock() {
  const el = $("#dock"); if (!el) return;
  if (document.activeElement?.id === "dkBranch") return;
  const m = dockModel(), { r, desks, rels, sig } = m, st = r.stream, holder = st?.holder;
  const opts = [...new Set([r.branch, ...m.rows.filter(x => x.active).map(x => x.branch)])].filter(Boolean).slice(0, 30);
  const hs = (r.hops || []).slice(-6);
  const rib = hs.map((h, i) => { const now_ = i === hs.length - 1 && h.kind === "in" && holder === h.desk; return `<span class="dhop ${h.kind === "out" ? "out" : ""} ${now_ ? "now" : ""}" data-slot="${h.desk}" data-hop="${h.id}" tabindex="0">${h.desk}</span>`; }).join('<span class="dhop-l"></span>')
    + (st && !holder ? `${hs.length ? '<span class="dhop-l"></span>' : ""}<span class="dhop wait" tabindex="0" data-hop="wait">?</span>` : "");
  const unread = S.relay.filter(x => x.from !== S.me && x.createdAt > relaySeenAt).length, u = S.usage, upct = u?.start ? Math.min(100, Math.round((now() - u.start) / (u.hours * 36e3))) : null;
  const chips = [["claims", "잠금 겹침", crossConflicts().length], ["baton", "받은 바통", S.batons.filter(b => !b.ackAt && (b.to === S.me || (b.to === "*" && S.me && b.from !== S.me))).length], ["relay", "새 릴레이", unread], ["usage", "세션 창", upct == null ? "–" : upct + "%"]];
  const nodeKeys = ["gh", ...desks, "virtual"];
  const mini = nodeKeys.filter(k => k !== "virtual").map(k => k === "gh" ? `<span class="pill neutral">GH${m.latest.has("gh") ? " ♛" : ""}</span>` : `<span class="pill ${rels[k].k === "ok" ? k : rels[k].k === "none" ? "neutral" : rels[k].k === "ahead" || rels[k].k === "warn" ? "warn" : "bad"}">${k} ${rels[k].b}${m.latest.has(k) ? " ♛" : ""}</span>`).join("");
  el.classList.toggle("collapsed", !!dkCollapsed);
  dkSigAct = m.act?.[1] || null;
  el.innerHTML = `<div class="dk-sig ${sig[0]}" role="status"><span class="dk-light"></span><div style="min-width:0;flex:1"><b>${esc(sig[1])}</b><span class="s">${esc(sig[2] || "")}${m.fresh ? ` · 확인 ${ago(m.fresh)}` : ""}</span>${m.act && !(dkCollapsed && innerWidth < 1280) ? `<button class="btn sm primary" id="dkAct" style="margin-top:7px">${esc(m.act[0])}</button>` : ""}</div><button class="icon-btn dk-toggle" id="dkToggle" aria-label="${dkCollapsed ? "상황판 펼치기" : "상황판 접기"}">${dkCollapsed ? "▴" : "▾"}</button></div>
    <div class="dk-mini">${mini}</div>
    <div class="dk-body">
      <section class="dk-sec"><div class="dk-h">지금 작업 ${opts.length ? `<select class="in" id="dkBranch" aria-label="상황판 브랜치">${opts.map(b => `<option value="${esc(b)}"${b === r.branch ? " selected" : ""}>${esc(b)}</option>`).join("")}</select>` : ""}</div>
        ${r.branch ? `<div class="dk-work ${holder ? "held" : ""}" ${holder ? `data-slot="${holder}"` : ""}><div class="dk-title">${esc(st?.title || r.branch)}</div>
          <div class="row" style="gap:5px">${holder ? pill(holder, S.me && holder === S.me ? "이 PC에서 작업 중" : `데스크 ${holder} 작업 중`) : st ? pill("neutral", "다음 자리 대기") : pill("neutral", "기록 없음")}${st?.holderAgent ? pill("neutral", agentName(st.holderAgent)) : ""}</div>
          ${rib ? `<div class="dk-rib">${rib}</div>` : ""}
          ${st?.next ? `<div class="small"><b>다음</b> · ${esc(st.next.split("\n")[0])}</div>` : ""}
          <div class="row" style="gap:5px">${S.me && holder === S.me ? `<button class="btn sm primary" data-act="bOut" data-b="${esc(r.branch)}">떠나기</button>` : `<button class="btn sm primary" data-act="bIn" data-b="${esc(r.branch)}">이어받기</button>`}<button class="btn sm ghost" data-go="versions">작업 흐름</button></div></div>`
        : `<div class="empty small">작업 흐름에서 작업을 시작하면 여기에 항상 표시돼요. <button class="btn sm" data-go="versions">시작하기</button></div>`}
      </section>
      <section class="dk-sec"><div class="dk-h">최신 버전은 어디에?</div>
        <div class="dmap">${nodeHtml("gh", m)}<div class="dtrunk">${desks.map(s => `<div class="drow"><span class="dlink ${rels[s].k}" data-rel="${s}">${esc(rels[s].b)}</span>${nodeHtml(s, m)}</div>`).join("")}
          <div class="drow"><span class="dlink none">VS</span>${nodeHtml("virtual", m)}</div></div></div>
        <div class="small muted">= GitHub와 같음 · ↑ 푸시 필요 · ↓ 받을 것 · ↑↓ 갈라짐 · ? 기록 없음 · ♛ 최신 위치</div>
      </section>
      <section class="dk-sec"><div class="dk-h">바로 확인</div><div class="dk-chips">${chips.map(([v, l, n]) => `<button class="dk-chip ${typeof n === "number" && n > 0 && v !== "usage" ? "hot" : ""}" data-go="${v}"><span>${l}</span><b>${n}</b></button>`).join("")}</div></section>
      <section class="dk-sec"><div class="dk-h">방금 일어난 일</div><div class="dk-feed">${S.log.slice(0, 4).map(l => `<div data-slot="${l.slot}"><i></i><span>${esc(l.text)}</span><small class="muted">${ago(l.at)}</small></div>`).join("") || '<span class="muted">아직 활동이 없어요</span>'}</div></section>
    </div>`;
  /* 상태가 바뀐 노드는 잠깐 반짝임 */
  for (const k of nodeKeys) {
    const n = el.querySelector(`[data-node="${k}"]`); if (!n) continue;
    const sg = n.textContent + "|" + n.className;
    if (dkSigs[k] !== undefined && dkSigs[k] !== sg) { n.classList.add("pulse"); setTimeout(() => n.classList.remove("pulse"), 1300); }
    dkSigs[k] = sg;
  }
}
function nodeActions(key) {
  const m = dockModel(), b = m.r.branch, rel = m.rels[key], st = m.r.stream, A = [];
  if (key === "gh") { A.push(["작업 흐름 열기", () => go("versions")], ["스냅샷 명령 복사", () => copyText(snapCommand())], ["파일 단위로 비교", () => { vMode = "file"; LS.set("vMode", "file"); go("versions"); }]); return ["GitHub", A]; }
  if (key === "virtual") { A.push(["개발 콘솔 열기", () => go("console")], ["로컬 적용 스크립트 만들기", () => { go("console"); exportScript(); }], ["파일 단위로 GitHub와 비교", () => { vMode = "file"; LS.set("vMode", "file"); go("versions"); }]); return ["가상 세션", A]; }
  if (S.me && key === S.me) {
    if (b) A.push(st?.holder === S.me ? ["떠나기", () => { go("versions"); openPanel("out", b); }] : ["이어받기", () => { go("versions"); openPanel("in", b); }]);
    if (b && (rel?.k === "behind" || rel?.k === "bad" || rel?.k === "none" || rel?.k === "warn")) A.push(["코드 맞추기 명령 복사", () => copyText(syncCmd(b))]);
    if (b && rel?.k === "ahead") A.push(["커밋·푸시 명령 복사", () => copyText(leaveCmd(b, ""))]);
    A.push(["스냅샷 명령 복사 (상태 갱신)", () => copyText(snapCommand())]);
    return [`데스크 ${key} · 이 PC`, A];
  }
  A.push(["콕 찌르기", () => nudge("상황판 확인 부탁해요", key)]);
  if (b && rel?.k === "behind") A.push(["pull 해달라고 요청", () => nudge(`'${b}'가 ${rel.b.slice(1)}커밋 뒤처져 있어요. git pull 해주세요.`, key)]);
  if (b && rel?.k === "ahead") A.push(["푸시해달라고 요청", () => nudge(`'${b}'에 푸시 안 한 커밋이 있어요. git push 해주세요.`, key)]);
  if (rel?.k === "none") A.push(["스냅샷 올려달라고 요청", () => nudge("작업 흐름에서 스냅샷 명령을 실행해 올려주세요.", key)]);
  A.push(["바통 보내기", () => { go("baton"); const s = $("#bTo"); if (s) s.value = key; $("#bNext").focus(); }]);
  return [`데스크 ${key} · ${deskName(key)}`, A];
}
function openDockMenu(node) {
  const [title, acts] = nodeActions(node.dataset.node);
  dkMenuActs = acts.map(a => a[1]);
  const mn = $("#dmenu");
  mn.innerHTML = `<div class="mh">${esc(title)}</div>` + acts.map((a, i) => `<button type="button" role="menuitem" data-mi="${i}">${esc(a[0])}</button>`).join("");
  mn.hidden = false;
  const r = node.getBoundingClientRect(), w = mn.offsetWidth, h = mn.offsetHeight;
  let x = r.left - w - 8; if (x < 8) x = Math.min(innerWidth - w - 8, r.left);
  let y = x === r.left ? r.bottom + 6 : r.top; if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
  mn.style.left = x + "px"; mn.style.top = y + "px";
  mn.querySelector("button")?.focus();
}
function closeDockMenu() { $("#dmenu").hidden = true; }
function dockTip(el) {
  if (el.classList.contains("dnode")) {
    const k = el.dataset.node, m = dockModel(), r = m.r;
    if (k === "gh") return ["GitHub", `${r.branch} 브랜치 · ${r.gh ? `커밋 ${r.gh.head.slice(0, 7)} "${r.gh.subj || ""}" (${ago(r.gh.ts * 1000)})` : "이 브랜치 기록 없음"}. ${m.latest.has("gh") ? "여기가 최신 버전이에요. " : ""}클릭하면 바로 할 수 있는 일이 나와요.`];
    if (k === "virtual") return ["가상 세션", `개발 콘솔의 공유 파일 ${S.files.length}개. 클릭하면 콘솔 열기, 로컬 적용 스크립트, GitHub와 파일 비교를 할 수 있어요.`];
    const d = r.desks[k], rel = m.rels[k];
    return [`데스크 ${k} · ${deskName(k)}`, `${S.online[k] ? "지금 접속 중. " : "오프라인. "}${r.branch}: ${rel.t}.${d ? ` 커밋 ${d.head.slice(0, 7)}${d.cur ? " (체크아웃 중)" : ""}${d.dirty ? `, 커밋 안 한 변경 ${d.dirty}개` : ""}.` : ""}${m.latest.has(k) ? " 여기가 최신 버전이에요." : ""}${r.stream?.holder === k ? " 지금 이 작업을 잡고 있어요." : ""} 클릭하면 ${k === S.me ? "이어하기·떠나기·명령 복사" : "콕 찌르기·pull/푸시 요청·바통 보내기"}를 할 수 있어요.`];
  }
  if (el.classList.contains("dhop")) {
    if (el.dataset.hop === "wait") return ["다음 자리", "아직 아무도 이어받지 않았어요. 어느 PC에서든 '이어받기'를 누르면 이 줄에 이어져요."];
    const h = S.hops.find(x => x.id === el.dataset.hop); if (!h) return null;
    return [`${h.kind === "out" ? "떠남" : "이어받음"} · 데스크 ${h.desk}${h.agentId ? " · " + agentName(h.agentId) : ""}`, `${new Date(h.at).toLocaleString("ko-KR")}${h.note ? ` · 메모: ${h.note.replace(/\n/g, " ")}` : ""}${h.next ? ` · 다음: ${h.next.split("\n")[0]}` : ""}`];
  }
  if (el.dataset.rel) { const m = dockModel(); return [`데스크 ${el.dataset.rel} ↔ GitHub`, m.rels[el.dataset.rel].t]; }
  if (el.id === "dkAct") { const m = dockModel(); return [m.act?.[0] || "지금 할 일", "상황판이 지금 상태를 보고 고른 다음 행동이에요. 누르면 해당 패널을 열거나 필요한 명령을 복사해요."]; }
  if (el.id === "dkToggle") return [dkCollapsed ? "상황판 펼치기" : "상황판 접기", "접어도 신호등과 PC별 요약은 계속 보여요."];
  if (el.classList.contains("dk-chip")) return ["바로 가기", `${el.firstChild.textContent} 화면으로 이동해요.`];
  return null;
}
function wireDock() {
  const el = $("#dock");
  el.addEventListener("click", e => {
    if (e.target.closest("#dkAct")) { const f = dkSigAct; return f?.(); }
    if (e.target.closest("#dkToggle")) { dkCollapsed = !dkCollapsed; LS.set("dockCollapsed", dkCollapsed); return renderDock(); }
    if (dkCollapsed && e.target.closest(".dk-sig, .dk-mini")) { dkCollapsed = false; LS.set("dockCollapsed", false); return renderDock(); }
    const n = e.target.closest(".dnode"); if (n) { e.stopPropagation(); return openDockMenu(n); }
  });
  el.addEventListener("change", e => { if (e.target.id === "dkBranch") { dkBranch = e.target.value; LS.set("dkBranch", dkBranch); e.target.blur(); dirty(); renderDock(); } });
  $("#dmenu").addEventListener("click", e => { const b = e.target.closest("[data-mi]"); if (!b) return; const f = dkMenuActs[+b.dataset.mi]; closeDockMenu(); f?.(); });
  document.addEventListener("click", e => { if (!e.target.closest("#dmenu") && !e.target.closest(".dnode")) closeDockMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDockMenu(); });
  addEventListener("scroll", closeDockMenu, true);
}
