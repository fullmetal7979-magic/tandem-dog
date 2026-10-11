
/* ================= render ================= */
const codeBlock = (title, text, extra = "") => `<div class="code"${extra}>${title ? `<div class="code-h">${esc(title)}</div>` : ""}<button type="button" class="btn sm copy" data-copy>복사</button><pre>${esc(text)}</pre></div>`;
const pill = (s, txt) => `<span class="pill ${esc(s)}">${esc(txt ?? s)}</span>`;
const VIEW_KO = { overview: "관제실", versions: "작업 흐름", session: "프로젝트 세션", baton: "바통 터치", parallel: "병렬 작업", claims: "영역 잠금", relay: "릴레이", console: "개발 콘솔", usage: "사용량", setup: "셋업 키트", help: "도움말" };

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    dirty();
    const V = { overview: [renderMe, renderDuo, renderInbox, renderCoach, renderFeed], parallel: [renderBoard], claims: [renderClaims], baton: [renderBaton], relay: [renderRelay], usage: [renderUsage], help: [renderOnboard], session: [renderSession, renderKit], console: [renderConsole], versions: [refreshVirtualHashes, renderVersions, renderBranches] };
    for (const f of [renderTbar, renderConn, ...(V[S.view] || []), renderBadges, renderDock]) { try { f(); } catch (e) { console.error("render", f.name, e); } }
  });
}

function renderTbar() {
  const L = deskList();
  $("#desks").innerHTML = L.map(s => {
    const d = S.desks[s], on = S.online[s];
    const sub = on ? (S.peerView[s] && S.me !== s ? `접속 중 · ${VIEW_KO[S.peerView[s]] || ""}` : "접속 중") + (d.task ? " · " + d.task : "") : `오프라인 · ${ago(d.updatedAt)} 활동`;
    return `<div class="desk ${S.me === s ? "is-me" : ""}" data-slot="${s}"><span class="dot ${on ? "on" : ""}"></span><div class="desk-tag">${s}</div><div class="desk-meta"><div class="desk-name">${esc(deskName(s))}${S.me === s ? ' <span class="you">이 PC</span>' : ""}</div><div class="desk-sub">${esc(sub)}</div></div></div>`;
  }).join("") + (nextSlot() ? `<button class="desk add" type="button" data-act="addDesk" title="이 PC를 새 데스크로 추가"><span class="desk-tag">+</span><span class="desk-meta"><span class="desk-name">PC 추가</span></span></button>` : "");
  const n = L.filter(s => S.online[s]).length;
  $("#onlineN").textContent = L.length ? `${n}/${L.length}대 접속` : "";
}
function renderConn() {
  const el = $("#connState");
  const [cls, txt] = S.mode === "boot" ? ["", "연결 확인 중…"] : S.mode === "local" ? ["", "로컬 모드 · 이 브라우저에만 저장"] : S.roomOk ? ["on", "실시간 동기화 중"] : ["on", "동기화 중 (실시간 알림 대기)"];
  el.innerHTML = `<span class="dot ${cls}"></span><span>${txt}</span>`;
}
function renderMe() {
  const d = S.desks[S.me] || {};
  const p = $("#meSlotPill");
  p.className = "pill " + (S.me || "neutral"); p.textContent = S.me ? "데스크 " + S.me : "미지정";
  for (const [id, v] of [["#meTask", d.task], ["#meBranch", d.branch]]) { const el = $(id); if (document.activeElement !== el) el.value = v || ""; }
  $$("#meLoad button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.l === (d.load ?? 0))));
}
function renderDuo() {
  const L = deskList();
  const shared = s => { const b = S.desks[s]?.branch; return b && L.some(x => x !== s && S.desks[x]?.branch === b); };
  $("#duo").innerHTML = L.map(s => {
    const d = S.desks[s];
    const myClaims = S.claims.filter(c => c.slot === s && active(c)).length, doing = S.tasks.filter(t => t.slot === s && t.status === "doing").length;
    return `<div class="dcard" data-slot="${s}"><div class="dcard-top"><div class="dcard-letter">${s}</div><div style="min-width:0;flex:1"><div class="desk-name">${esc(d.name || "데스크 " + s)} ${S.me === s ? '<span class="you">이 PC</span>' : ""}</div>
      <div class="small muted row" style="gap:6px"><span class="dot ${S.online[s] ? "on" : ""}"></span>${S.online[s] ? "지금 접속 중" : "오프라인"}${S.online[s] && S.peerView[s] && S.me !== s ? " · " + VIEW_KO[S.peerView[s]] : ""}</div></div>
      <button class="btn sm ghost" data-act="removeDesk" data-slot="${s}" title="이 데스크 빼기">빼기</button></div>
      <dl class="dcard-body">
        <dt>하는 일</dt><dd>${esc(d.task || "—")}</dd>
        <dt>브랜치</dt><dd>${d.branch ? `<code>${esc(d.branch)}</code>` : "—"} ${shared(s) ? pill("bad", "같은 브랜치") : ""}</dd>
        <dt>부하</dt><dd><span class="load" data-l="${+d.load || 0}"><i></i><i></i><i></i></span> ${LOADS[d.load || 0]}</dd>
        <dt>현황</dt><dd>잠금 ${myClaims}개 · 진행 작업 ${doing}개</dd>
        <dt>업데이트</dt><dd>${ago(d.updatedAt)}</dd>
      </dl>
      ${S.me && S.me !== s ? `<div class="row" style="padding:0 18px 16px"><button class="btn sm" data-act="nudge" data-slot="${s}">콕 찌르기</button><button class="btn sm ghost" data-go="relay">릴레이 보내기</button></div>` : ""}</div>`;
  }).join("") + (nextSlot() ? `<div class="dcard add"><b>PC 추가하기</b><span class="small">새 PC의 Claude 앱에서 이 페이지를 열고<br>'새 데스크 ${nextSlot()}'를 고르면 여기에 나타나요.</span><button class="btn sm" data-act="addDesk">이 PC를 새 데스크로</button></div>` : "");
}
function renderInbox() {
  const mine = S.batons.filter(b => !b.ackAt && (b.to === S.me || (b.to === "*" && S.me && b.from !== S.me)));
  $("#inbox").innerHTML = mine.slice(0, 2).map(b => `<div class="baton new" data-slot="${b.from}">
    <div class="row" style="justify-content:space-between"><div class="row">${pill(b.from, deskName(b.from))}<b>바통이 도착했어요</b><span class="small muted">${ago(b.createdAt)}</span></div>
    <div class="row"><button class="btn sm primary" data-act="copyBaton" data-id="${b.id}"><svg><use href="#i-copy"/></svg>이어하기 프롬프트 복사</button><button class="btn sm" data-act="ack" data-id="${b.id}">받았어요</button></div></div>
    <div class="small"><b>다음 할 일</b> · ${esc((b.next || "").split("\n")[0])}${b.branch ? ` · <code>${esc(b.branch)}</code>` : ""}${b.pushed ? "" : " " + pill("warn", "푸시 안 됨")}</div></div>`).join("");
}

/* ---------- 코치: 상태를 보고 다음 행동을 제안 ---------- */
function tips() { return cached("tips", tips_); }
function tips_() {
  const T = [], me = S.me, L = deskList(), O = me ? others(me) : [], dm = S.desks[me] || {};
  if (!me) T.push({ l: "info", t: "<b>이 PC의 데스크를 지정하세요.</b> 모든 PC가 같은 계정이라 데스크로 구분해야 충돌을 감지할 수 있어요.", a: ["데스크 지정", () => askDesk()] });
  const cc = crossConflicts();
  if (cc.length) T.push({ l: "bad", t: `<b>잠금 ${cc.length}건이 겹쳐요.</b> 예: ${cc[0][0].slot} <code>${esc(cc[0][0].path)}</code> ↔ ${cc[0][1].slot} <code>${esc(cc[0][1].path)}</code>. 한쪽이 해제하거나 범위를 좁히세요.`, a: ["영역 잠금 열기", () => go("claims")] });
  const byBranch = {};
  for (const s of L) { const b = S.desks[s]?.branch; if (b) (byBranch[b] = byBranch[b] || []).push(s); }
  const dup = Object.entries(byBranch).find(([b, v]) => v.length > 1 && (!streamOf(b) || v.filter(x => S.online[x]).length > 1));
  if (dup) T.push({ l: "bad", t: `<b>데스크 ${dup[1].join(", ")}가 같은 브랜치 <code>${esc(dup[0])}</code>에서 작업 중이에요.</b> 푸시할 때 충돌이 납니다. 데스크마다 <code>${(me || "a").toLowerCase()}/…</code> 같은 자기 접두사 브랜치를 쓰세요.`, a: ["브랜치 고치기", () => { go("overview"); $("#meBranch").focus(); }] });
  if (me && /^(main|master|develop)$/.test(dm.branch || "")) T.push({ l: "warn", t: `<b>기본 브랜치(${esc(dm.branch)})에서 직접 작업 중이에요.</b> 데스크별 브랜치 <code>${me.toLowerCase()}/기능이름</code>을 쓰면 PC끼리 부딪히지 않아요.`, a: ["셋업 키트", () => go("setup")] });
  const inbox = S.batons.filter(b => !b.ackAt && (b.to === me || (b.to === "*" && me && b.from !== me)));
  if (inbox.length) T.push({ l: "warn", t: `<b>${esc(deskName(inbox[0].from))}에서 바통이 와 있어요.</b> 이어하기 프롬프트를 복사해 Claude에 붙여넣으세요.`, a: ["바통 보기", () => go("baton")] });
  const myDoing = S.tasks.filter(t => t.slot === me && t.status === "doing");
  const unlocked = myDoing.filter(t => (t.paths || []).length && !(t.paths || []).every(p => S.claims.some(c => c.slot === me && active(c) && overlaps(c.path, p))));
  if (unlocked.length) T.push({ l: "warn", t: `<b>진행 중인 '${esc(unlocked[0].title)}'의 경로가 잠겨 있지 않아요.</b> 다른 PC의 Claude가 같은 파일을 고칠 수 있어요.`, a: ["지금 잠그기", () => lockTask(unlocked[0])] });
  const expired = S.claims.filter(c => c.slot === me && !active(c));
  if (expired.length) T.push({ l: "info", t: `만료된 내 잠금 ${expired.length}개가 남아 있어요.`, a: ["정리하기", () => cleanExpired()] });
  const heavy = L.filter(s => (S.desks[s]?.load || 0) >= 3);
  const loadSum = L.reduce((n, s) => n + (S.desks[s]?.load || 0), 0);
  if (heavy.length >= 2) T.push({ l: "warn", t: `<b>데스크 ${heavy.join(", ")}가 모두 고부하예요.</b> 같은 계정 사용량이 그만큼 빠르게 줄어요. 고부하는 한 대만 두고 나머지는 리뷰·테스트 같은 가벼운 일로 바꾸세요.`, a: ["사용량 보기", () => go("usage")] });
  else if (L.length && loadSum / (L.length * 3) >= 0.75) T.push({ l: "info", t: "전체 PC의 부하가 높아요. 무거운 작업은 한 대에 몰아주세요.", a: ["사용량 보기", () => go("usage")] });
  const u = S.usage;
  if (u?.start) {
    const r = (now() - u.start) / (u.hours * 3600e3);
    if (r >= 1) T.push({ l: "info", t: "세션 창 타이머가 끝났어요. 새 작업을 시작할 때 다시 시작하세요.", a: ["새 창 시작", () => startWindow()] });
    else if (r >= 0.8) T.push({ l: "warn", t: `세션 창이 ${Math.round(r * 100)}% 지났어요. 큰 작업을 새로 시작하기 전에 남은 한도를 확인하세요.`, a: ["사용량 보기", () => go("usage")] });
  }
  const off = O.filter(o => !S.online[o]);
  if (me && O.length && off.length === O.length && myDoing.length && !S.batons.some(b => b.from === me && now() - b.createdAt < 6 * 3600e3)) T.push({ l: "info", t: "다른 PC들이 모두 꺼져 있어요. 자리를 옮길 계획이면 떠나기 전에 바통을 남겨두세요.", a: ["바통 남기기", () => go("baton")] });
  if (me && !O.length) T.push({ l: "info", t: `<b>다른 PC를 연결하세요.</b> 그 PC의 Claude 앱에서 이 페이지를 열고 '새 데스크 ${nextSlot() || ""}'를 고르면 서로의 상태가 보여요.` });
  const q = S.tasks.filter(t => t.status === "todo");
  if (me && q.length && !myDoing.length) T.push({ l: "info", t: `대기열에 작업 ${q.length}개가 있어요. ${q.some(t => t.hint === me) ? "이 데스크 추천 작업도 있어요." : ""}`, a: ["가져가기", () => go("parallel")] });
  if (me && !dm.branch) T.push({ l: "info", t: "작업 브랜치를 적어두면 PC 간 브랜치 충돌을 자동으로 잡아낼 수 있어요.", a: ["입력하기", () => { go("overview"); $("#meBranch").focus(); }] });
  const ghost = [...new Set(S.claims.filter(c => active(c) && !S.desks[c.slot]).map(c => c.slot))];
  if (ghost.length) T.push({ l: "info", t: `빠진 데스크 ${ghost.join(", ")}의 잠금이 남아 있어요.`, a: ["정리하기", () => cleanGhost()] });
  sessionTips(T); versionTips(T); branchTips(T);
  if (!T.length) T.push({ l: "ok", t: "<b>충돌 위험이 없어요.</b> 지금 흐름대로 계속 진행하세요." });
  const arriving = T.some(t => t.arrive);
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 };
  return T.filter(t => !(arriving && /바통을 남겨두세요/.test(t.t))).sort((a, b) => (b.arrive ? 1 : 0) - (a.arrive ? 1 : 0) || rank[a.l] - rank[b.l]);
}
let tipActs = [];
function renderCoach() {
  const T = tips(); tipActs = T.map(t => t.a?.[1]);
  const ico = { bad: "!", warn: "!", info: "i", ok: "✓" };
  $("#coach").innerHTML = T.slice(0, 6).map((t, i) => `<div class="tip ${t.l}"><div class="tip-i">${ico[t.l]}</div><div class="tip-b">${t.t}${t.a ? `<div><button class="btn sm" data-tip="${i}">${esc(t.a[0])}</button></div>` : ""}</div></div>`).join("");
  const n = T.filter(t => t.l === "bad" || t.l === "warn").length;
  $("#coachCount").textContent = n ? `주의 ${n}건` : "";
}
function renderFeed() {
  const L = S.log.slice(0, 12);
  $("#feed").innerHTML = L.length ? L.map(l => `<div class="li"><span class="stripe ${esc(l.slot)}"></span><div class="li-main"><div class="li-t" style="font-weight:500">${esc(l.text)}</div><div class="li-s">${esc(deskName(l.slot))} · ${ago(l.at)}</div></div></div>`).join("")
    : `<div class="empty"><b>아직 활동이 없어요.</b><br>잠금, 바통, 릴레이를 쓰면 모든 PC의 기록이 여기에 쌓여요.</div>`;
}

/* ---------- 보드 ---------- */
function renderBoard() {
  const cols = [["todo", "대기열", t => t.status === "todo"], ...deskList().map(s => [s, deskName(s), t => t.status === "doing" && t.slot === s]), ["done", "완료", t => t.status === "done"]];
  const orphan = S.tasks.filter(t => t.status === "doing" && !S.desks[t.slot]);
  if (orphan.length) cols.splice(cols.length - 1, 0, ["orphan", "빠진 데스크", t => t.status === "doing" && !S.desks[t.slot]]);
  $("#board").innerHTML = cols.map(([k, name, f]) => {
    const items = S.tasks.filter(f);
    return `<div class="col" data-col="${k}"><div class="col-h"><span class="row" style="gap:6px">${SLOTS.includes(k) ? pill(k, k) : ""}${esc(name)}</span><span class="n">${items.length}</span></div>
      ${items.map(taskCard).join("") || `<div class="empty small">${k === "todo" ? "작업을 추가하거나 분할 도우미를 쓰세요" : k === "done" ? "완료한 작업이 여기 모여요" : "카드를 끌어다 놓으세요"}</div>`}</div>`;
  }).join("");
}
function taskCard(t) {
  const me = S.me, paths = (t.paths || []).map(p => `<code>${esc(p)}</code>`).join("");
  let acts = "";
  if (t.status === "todo") acts = me ? `<button class="btn sm ${me}" data-act="take" data-id="${t.id}">내가 가져가기</button>` : "";
  else if (t.status === "doing" && t.slot === me) acts = `<button class="btn sm" data-act="done" data-id="${t.id}">완료</button><button class="btn sm ghost" data-act="untake" data-id="${t.id}">대기열로</button>`;
  else if (t.status === "done") acts = `<button class="btn sm ghost danger" data-act="delTask" data-id="${t.id}">삭제</button>`;
  const hit = t.status === "todo" && me ? (t.paths || []).some(p => conflictsFor(p, me).length) : false;
  return `<div class="task ${t.status === "doing" ? t.slot : ""}" draggable="true" data-task="${t.id}"><div class="task-t">${esc(t.title)}</div>
    ${paths ? `<div class="task-paths">${paths}</div>` : ""}
    <div class="row" style="gap:4px">${t.hint && t.status === "todo" ? pill(t.hint, "추천 " + t.hint) : ""}${hit ? pill("bad", "잠금 겹침") : ""}${t.example ? pill("neutral", "예시") : ""}</div>
    ${acts ? `<div class="task-acts">${acts}</div>` : ""}</div>`;
}

/* ---------- 잠금 ---------- */
function claimLi(c) {
  const mine = c.slot === S.me, act = active(c);
  const hit = act && S.claims.some(x => x.slot !== c.slot && active(x) && overlaps(x.path, c.path));
  return `<div class="li"><span class="stripe ${hit ? "bad" : c.slot}"></span><div class="li-main"><div class="path">${esc(c.path)}</div>
    <div class="li-s">${c.note ? esc(c.note) + " · " : ""}${act ? dur(c.expiresAt - now()) + " 남음" : "만료됨"} ${hit ? pill("bad", "겹침") : ""}${c.example ? pill("neutral", "예시") : ""}</div></div>
    <div class="row" style="gap:4px">${mine ? (act ? `<button class="btn sm ghost" data-act="extend" data-id="${c.id}">+1시간</button>` : "") + `<button class="btn sm" data-act="release" data-id="${c.id}">해제</button>`
      : act ? `<button class="btn sm ghost" data-act="askRelease" data-id="${c.id}">해제 요청</button>` : `<button class="btn sm" data-act="release" data-id="${c.id}">정리</button>`}</div></div>`;
}
function renderClaims() {
  const set = [...new Set([...(S.me ? [S.me] : []), ...deskList(), ...S.claims.map(c => c.slot)])];
  const order = set.filter(x => SLOTS.includes(x));
  $("#claimLists").innerHTML = order.map(s => {
    const list = S.claims.filter(c => c.slot === s).sort((a, b) => b.createdAt - a.createdAt);
    return `<div class="card"><div class="card-h"><div class="card-t">${pill(s, s)} ${s === S.me ? "내 잠금" : esc(deskName(s)) + "의 잠금" + (S.desks[s] ? "" : " (빠진 데스크)")}</div><span class="small muted">${list.filter(active).length}개 활성</span></div>
      <div class="list">${list.map(claimLi).join("") || `<div class="empty">${s === S.me ? "<b>잠근 영역이 없어요.</b><br>Claude에게 맡기기 전에 수정할 폴더를 잠가두세요." : "이 PC가 잠근 영역이 없어요."}</div>`}</div></div>`;
  }).join("");
  checkPath();
  const me = S.me || "A", d = S.desks[me] || {};
  const mine = S.claims.filter(c => c.slot === me && active(c)).map(c => "- " + c.path);
  const theirs = S.claims.filter(c => c.slot !== me && active(c)).map(c => `- ${c.path}  [데스크 ${c.slot}]` + (c.note ? ` ${c.note}` : ""));
  const prompt = `[작업 경계 · Tandem]
이 저장소는 여러 PC(${deskList().join(", ") || "A, B"})에서 동시에 작업 중입니다. 나는 데스크 ${me}(${deskName(me)})입니다.

내 작업 범위 (수정 가능):
${mine.join("\n") || "- (잠근 경로 없음: 작업 시작 전에 범위를 정해 주세요)"}

다른 PC가 작업 중이라 수정하면 안 되는 경로:
${theirs.join("\n") || "- (없음)"}

위 금지 경로의 파일은 읽기만 하고 수정·삭제·이동하지 마세요.
꼭 바꿔야 한다면 작업을 멈추고 먼저 저에게 알려주세요.${d.branch ? `\n작업 브랜치: ${d.branch} (다른 브랜치로 전환하거나 force push 하지 마세요)` : ""}`;
  $("#boundaryCode").innerHTML = codeBlock("이 PC의 Claude에게 붙여넣기", prompt);
  const bases = [...new Set(S.claims.filter(c => c.slot !== me && active(c)).map(c => globBase(normPath(c.path))).filter(Boolean))];
  const hook = `#!/bin/sh
# .git/hooks/pre-commit · Tandem 잠금 스냅샷 (${new Date().toLocaleString("ko-KR")})
# 데스크 ${me}에서 다른 데스크가 잠근 경로를 커밋하려 하면 막습니다. 잠금이 바뀌면 다시 복사하세요.
set -f
LOCKED=$(cat <<'TANDEM_LOCKS'
${bases.filter(b => b !== "TANDEM_LOCKS").join("\n")}
TANDEM_LOCKS
)
IFS='
'

git diff --cached --name-only | {
  bad=0
  while IFS= read -r f; do
    for p in $LOCKED; do
      case "$f" in "$p"|"$p"/*) echo "Tandem: $f 는 다른 데스크가 잠근 영역($p)입니다"; bad=1;; esac
    done
  done
  exit $bad
} || { echo "커밋을 중단했어요. 꼭 필요하면 git commit --no-verify"; exit 1; }`;
  $("#hookCode").innerHTML = `<p class="small muted" style="margin:6px 0">한 단계 더: 커밋 단계에서 막는 pre-commit 훅. 저장 후 <code>chmod +x .git/hooks/pre-commit</code> 을 실행하세요.</p>` + codeBlock(".git/hooks/pre-commit", hook);
}
function checkPath() {
  const v = normPath($("#checkIn").value), out = $("#checkOut");
  if (!v) { out.className = "small muted"; out.textContent = "경로를 입력하면 누가 잡고 있는지 보여줍니다."; return; }
  const hits = S.claims.filter(c => active(c) && overlaps(c.path, v));
  const theirs = hits.filter(c => c.slot !== S.me), mine = hits.filter(c => c.slot === S.me);
  out.className = "small";
  out.innerHTML = theirs.length ? `<div class="tip bad"><div class="tip-i">!</div><div class="tip-b"><b>${esc(deskName(theirs[0].slot))}가 잡고 있어요.</b> <code>${esc(theirs[0].path)}</code>${theirs[0].note ? " · " + esc(theirs[0].note) : ""}<br>수정하지 말거나 해제를 요청하세요.</div></div>`
    : mine.length ? `<div class="tip ok"><div class="tip-i">✓</div><div class="tip-b"><b>내 잠금 안에 있어요.</b> <code>${esc(mine[0].path)}</code> · 마음껏 수정하세요.</div></div>`
    : `<div class="tip warn"><div class="tip-i">i</div><div class="tip-b"><b>아무도 잠그지 않았어요.</b> 수정할 거라면 먼저 잠그세요. <button class="btn sm" data-act="quickClaim">이 경로 잠그기</button></div></div>`;
}
