
/* ---------- 바통 ---------- */
function batonPrompt(b) {
  const from = b.from, lines = [
    `이전 PC(데스크 ${from} · ${deskName(from)})에서 하던 작업을 이어받습니다.`, "",
    b.branch ? `브랜치: ${b.branch}` : "브랜치: (미기재)",
    b.last ? `마지막 커밋: ${b.last}` : null,
    b.pushed ? "푸시 상태: 원격에 푸시됨" : "푸시 상태: 푸시 안 됨. 최신 변경이 원래 PC에만 있을 수 있으니 먼저 확인해 주세요.", "",
    b.done ? "한 일:\n" + b.done : null,
    "다음 할 일:\n" + (b.next || "-"),
    b.warn ? "\n주의:\n" + b.warn : null, "",
    "시작하기 전에:",
    `1. git fetch && git switch ${b.branch ? shq(b.branch) : "<브랜치>"} && git pull --rebase`,
    "2. git log --oneline -5 로 최근 변경을 확인",
    "3. '다음 할 일'부터 진행하되, 시작 전에 계획을 3줄 이내로 먼저 알려주세요.",
  ];
  return lines.filter(l => l !== null).join("\n");
}
function batonDraft() {
  return { from: S.me || "A", to: $("#bTo").value || "", branch: $("#bBranch").value.trim(), last: $("#bLast").value.trim(), done: $("#bDone").value.trim(), next: $("#bNext").value.trim(), warn: $("#bWarn").value.trim(), pushed: $("#bPushed").checked };
}
function renderBaton() {
  const O = S.me ? others(S.me) : [], sel = $("#bTo"), keep = sel.value;
  const pref = O.includes(keep) ? keep : O.find(o => S.online[o]) || O[0] || "";
  const html = O.length ? O.map(o => `<option value="${o}"${o === pref ? " selected" : ""}>${esc(o + " · " + deskName(o))}${S.online[o] ? " (접속 중)" : ""}</option>`).join("") : `<option value="">다른 데스크 없음</option>`;
  if (document.activeElement !== sel && sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  if (!$("#bBranch").value && S.desks[S.me]?.branch && document.activeElement !== $("#bBranch")) $("#bBranch").placeholder = S.desks[S.me].branch;
  renderBatonPreview();
  $("#batonList").innerHTML = S.batons.length ? S.batons.map(b => `<div class="baton"><div class="row" style="justify-content:space-between"><div class="row">${pill(b.from, b.from)}<span class="muted">→</span>${b.to === "*" ? pill("neutral", "누구든") : pill(b.to, b.to)}<span class="small muted">${ago(b.createdAt)}</span>${b.ackAt ? pill("ok", b.ackBy ? b.ackBy + "가 받음" : "받음") : (b.to === S.me || (b.to === "*" && b.from !== S.me)) ? pill("warn", "새 바통") : pill("neutral", "대기 중")}${b.pushed ? "" : pill("warn", "푸시 안 됨")}</div>
    <div class="row" style="gap:4px"><button class="btn sm" data-act="copyBaton" data-id="${b.id}"><svg><use href="#i-copy"/></svg>프롬프트 복사</button>${!b.ackAt && (b.to === S.me || (b.to === "*" && b.from !== S.me)) ? `<button class="btn sm primary" data-act="ack" data-id="${b.id}">받았어요</button>` : ""}${b.from === S.me ? `<button class="btn sm ghost danger" data-act="delBaton" data-id="${b.id}">삭제</button>` : ""}</div></div>
    <div class="small">${b.branch ? `<code>${esc(b.branch)}</code> · ` : ""}<b>다음</b> ${esc((b.next || "").replace(/\n/g, " / "))}</div></div>`).join("")
    : `<div class="empty"><b>아직 주고받은 바통이 없어요.</b><br>자리를 옮기기 전에 위 양식을 채워 넘기면, 다른 PC에 알림이 가고 기록이 남아요.</div>`;
}
function renderBatonPreview() {
  const d = batonDraft();
  if (!d.branch) d.branch = S.desks[S.me]?.branch || "";
  $("#batonPreview").innerHTML = codeBlock("", batonPrompt(d));
  $("#batonWarn").innerHTML = d.pushed ? "" : `<span style="color:var(--warn)">푸시하지 않으면 다른 PC에서 최신 코드를 받을 수 없어요.</span>`;
}

/* ---------- 릴레이 ---------- */
const KIND = { text: "텍스트", prompt: "프롬프트", cmd: "명령어", log: "로그" };
function renderRelay() {
  $("#relayList").innerHTML = S.relay.length ? S.relay.map(r => {
    const fresh = r.from !== S.me && r.createdAt > relaySeenAt;
    return `<div class="bubble ${r.from}"><div class="row" style="justify-content:space-between;margin-bottom:6px"><div class="row">${pill(r.from, deskName(r.from))}${pill("neutral", KIND[r.kind] || "텍스트")}<span class="small muted">${ago(r.createdAt)}</span>${fresh ? pill("bad", "새로 옴") : ""}${r.example ? pill("neutral", "예시") : ""}</div>
      <div class="row" style="gap:4px"><button class="btn sm" data-act="copyRelay" data-id="${r.id}"><svg><use href="#i-copy"/></svg>복사</button><button class="btn sm ghost danger" data-act="delRelay" data-id="${r.id}">삭제</button></div></div><pre>${esc(r.text)}</pre></div>`;
  }).join("") : `<div class="empty"><b>릴레이가 비어 있어요.</b><br>여기 보낸 내용은 다른 PC에서 즉시 보이고 복사할 수 있어요.</div>`;
}

/* ---------- 사용량 ---------- */
function renderUsage() {
  const u = S.usage, svg = $("#winRing"), R = 60, C = 2 * Math.PI * R;
  let r = 0, col = "var(--ok)", main = "—", sub = "시작 안 함";
  if (u?.start) {
    r = Math.min(1, (now() - u.start) / (u.hours * 3600e3));
    col = r < 0.6 ? "var(--ok)" : r < 0.85 ? "var(--warn)" : "var(--bad)";
    main = Math.round(r * 100) + "%"; sub = r >= 1 ? "창 종료" : "경과";
  }
  svg.innerHTML = `<circle class="g-track" cx="75" cy="75" r="${R}" stroke-width="14"/><circle class="g-val" cx="75" cy="75" r="${R}" stroke-width="14" stroke="${col}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r)}" transform="rotate(-90 75 75)"/>
    <text class="g-num" x="75" y="78" text-anchor="middle" font-size="30">${main}</text><text class="g-lab" x="75" y="98" text-anchor="middle">${sub}</text>`;
  if (document.activeElement !== $("#winHours") && u?.hours) $("#winHours").value = String(u.hours);
  $("#winText").innerHTML = u?.start ? `<div><div class="eyebrow">경과</div><div style="font-weight:700;font-size:18px">${dur(now() - u.start)}</div></div>
    <div><div class="eyebrow">남은 시간</div><div style="font-weight:700;font-size:18px">${r >= 1 ? "끝남" : dur(u.start + u.hours * 3600e3 - now())}</div></div>
    <div class="small muted">리셋 예정 ${new Date(u.start + u.hours * 3600e3).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} ${u.by ? " · " + esc(deskName(u.by)) + "에서 시작" : ""}</div>`
    : `<div class="empty" style="text-align:left"><b>타이머가 꺼져 있어요.</b><br>아무 PC에서나 오늘 첫 Claude 요청을 보낼 때 시작하면, 모든 PC가 같은 시계를 봅니다.</div>`;
  const L = deskList(), sum = L.reduce((n, s) => n + (S.desks[s]?.load || 0), 0), max = Math.max(1, L.length * 3), heavy = L.filter(s => (S.desks[s]?.load || 0) >= 3).length, ratio = sum / max;
  const verdict = heavy >= 2 || ratio >= 0.75 ? ["bad", "과열", "여러 PC가 함께 사용량을 빠르게 쓰고 있어요. 고부하는 한 대만 두세요."] : ratio >= 0.45 || heavy === 1 ? ["warn", "보통", "고부하 작업은 한 PC에만 두세요."] : ["ok", "여유", "모든 PC가 가볍게 쓰고 있어요."];
  $("#loadView").innerHTML = L.length ? `<div class="stack">${L.map(s => { const l = S.desks[s]?.load || 0; return `<div class="row" style="gap:10px" data-slot="${s}">${pill(s, s)}<div class="bar" style="flex:1"><i style="width:${(l / 3) * 100}%;background:var(--dc)"></i></div><span class="small" style="width:52px;text-align:right">${LOADS[l]}</span></div>`; }).join("")}
    <div class="tip ${verdict[0]}" style="margin-top:6px"><div class="tip-i">${verdict[0] === "ok" ? "✓" : "!"}</div><div class="tip-b"><b>합산 부하 ${sum}/${max} · ${verdict[1]}</b><br>${verdict[2]}</div></div>
    <p class="small muted">부하는 각 PC의 관제실에서 직접 고릅니다. 무거운 작업을 시작할 때 '고부하'로 바꾸면 다른 PC들이 알 수 있어요.</p></div>`
    : `<div class="empty">연결된 데스크가 없어요.</div>`;
}
/* ---------- 셋업 키트 ---------- */
function renderSetup() {
  const repo = $("#sRepo").value.trim() || "~/code/my-app", main = $("#sMain").value.trim() || "main", feat = ($("#sFeat").value.trim() || "feature").replace(/\s+/g, "-");
  const dir = repo.replace(/\/+$/, ""), name = dir.split("/").pop();
  const blocks = [
    ["1 · 데스크별 브랜치 만들기 (각 PC에서 한 번)", (deskList().length >= 2 ? deskList() : ["A", "B"]).map(L => `# 데스크 ${L}${S.desks[L]?.name ? " · " + oneLine(S.desks[L].name) : ""}
# (따로 병렬 작업할 땐 데스크별 브랜치, 한 작업을 PC 사이로 넘길 땐 같은 브랜치를 떠나기·이어받기로 이어가세요)
cd ${dir}
git fetch origin
git switch -c ${L.toLowerCase()}/${feat} origin/${main}
git push -u origin ${L.toLowerCase()}/${feat}`).join("\n\n")],
    ["2 · 자리에 앉을 때 (시작 루틴)", `cd ${dir}
git fetch --all --prune
git status -sb
git pull --rebase --autostash
git log --oneline -5 origin/${main}`],
    ["3 · 자리를 뜰 때 (종료 루틴)", `cd ${dir}
git add -A
git commit -m "wip: 작업 중간 저장"
git push
# 그다음 Tandem에서 바통 넘기기`],
    ["4 · 상대 PC 작업을 내 브랜치에 반영", `git fetch origin
# 상대가 main에 합친 뒤라면
git rebase origin/${main}
# 아직 상대 브랜치에만 있다면 먼저 확인
git log --oneline HEAD..origin/<다른데스크>/${feat}   # 예: b/${feat}`],
    ["5 · 한 PC 안에서도 병렬로 (워크트리)", `cd ${dir}
git worktree add ../${name}-api -b ${(S.me || "a").toLowerCase()}/${feat}-api
git worktree add ../${name}-ui  -b ${(S.me || "a").toLowerCase()}/${feat}-ui
git worktree list
# 폴더마다 Claude 세션을 따로 열면 서로의 파일을 덮어쓰지 않아요`],
    ["6 · ~/.claude 개인 설정 올리기 (처음 PC에서 한 번)", `mkdir -p ~/claude-config && cd ~/claude-config
for f in settings.json CLAUDE.md commands agents skills; do
  [ -e ~/.claude/$f ] && cp -R ~/.claude/$f .
done
git init && git add -A && git commit -m "claude config"
# 비공개 원격 저장소를 만들고 push 하세요
# ~/.claude.json(로그인·MCP 인증 정보)은 넣지 마세요`],
    ["7 · ~/.claude 개인 설정 받기 (새로 추가한 PC마다 한 번)", `git clone <비공개-저장소-주소> ~/claude-config
for f in settings.json CLAUDE.md commands agents skills; do
  [ -e ~/claude-config/$f ] || continue
  [ -e ~/.claude/$f ] && [ ! -L ~/.claude/$f ] && mv ~/.claude/$f ~/.claude/$f.bak
  ln -sfn ~/claude-config/$f ~/.claude/$f
done
# 이후 설정을 바꾸면: cd ~/claude-config && git pull / git push`],
  ];
  $("#setupBlocks").innerHTML = blocks.map(([t, c]) => codeBlock(t, c)).join("");
}
const CHECK = [
  "같은 계정으로 여러 PC에 동시에 로그인해도 괜찮아요. 다만 사용량 한도는 모든 PC가 합쳐서 씁니다.",
  "로컬 Claude Code 세션의 대화 기록은 그 PC에만 남아요. PC를 옮길 때는 바통으로 맥락을 넘기세요.",
  "~/.claude 개인 설정, MCP 연결, 로그인 상태는 PC마다 따로예요. 셋업 키트 6·7번으로 맞추세요.",
  "같은 브랜치를 두 PC에서 동시에 고치지 마세요. 병렬 작업은 데스크별 브랜치(a/, b/…), 한 작업을 넘길 땐 같은 브랜치를 떠나기 → 이어받기로 한 PC씩 잡으세요.",
  "force push는 다른 PC의 커밋을 지울 수 있어요. 공유 브랜치에서는 쓰지 마세요.",
  ".env 같은 비밀 파일은 git에 올리지 말고 각 PC에 따로 두세요. 릴레이로도 보내지 마세요.",
  "앉을 때 pull, 일어날 때 push. 이 두 가지만 지켜도 충돌의 대부분이 사라져요.",
];
function renderChecklist() { $("#checklist").innerHTML = CHECK.map(c => `<div class="step"><div>${esc(c)}</div></div>`).join(""); }

/* ---------- 시작 체크리스트 ---------- */
function onboardSteps() {
  const me = S.me, f = LS.get("flags", {});
  return [
    ["이 PC의 데스크 지정", !!me, () => askDesk()],
    ["다른 PC에서 이 페이지 열고 새 데스크 추가", deskList().length >= 2, () => toast("다른 PC의 Claude 앱에서 이 아티팩트를 열고 '새 데스크 " + (nextSlot() || "") + "'를 고르세요.", "info")],
    ["작업 브랜치 입력", !!S.desks[me]?.branch, () => { go("overview"); $("#meBranch").focus(); }],
    ["첫 영역 잠그기", S.claims.some(c => c.slot === me && !c.example), () => { go("claims"); $("#claimPath").focus(); }],
    ["작업 보드에서 작업 가져가기", S.tasks.some(t => t.slot === me && !t.example), () => go("parallel")],
    ["릴레이로 다른 PC에 무언가 보내기", S.relay.some(r => r.from === me && !r.example), () => { go("relay"); $("#relayIn").focus(); }],
    ["바통 넘겨보기", S.batons.some(b => b.from === me), () => go("baton")],
    ["튜토리얼 끝까지 보기", !!f.tour, () => startTour()],
  ];
}
let obActs = [];
function renderOnboard() {
  const st = onboardSteps(); obActs = st.map(s => s[2]);
  const n = st.filter(s => s[1]).length;
  $("#obCount").textContent = `${n}/${st.length}`;
  $("#obBar").style.width = (n / st.length) * 100 + "%";
  $("#onboard").innerHTML = st.map(([t, done], i) => `<div class="step ${done ? "done" : ""}"><div class="row" style="justify-content:space-between;flex:1"><span style="${done ? "color:var(--ink-3);text-decoration:line-through" : ""}">${esc(t)}</span>${done ? "" : `<button class="btn sm ghost" data-ob="${i}">하러 가기</button>`}</div></div>`).join("");
}

/* ---------- 배지 ---------- */
function renderBadges() {
  const set = (k, n) => { const b = $(`[data-badge="${k}"]`); if (!b) return; b.hidden = !n; b.textContent = n > 9 ? "9+" : n; };
  set("overview", tips().filter(t => t.l === "bad").length);
  set("baton", S.batons.filter(b => !b.ackAt && (b.to === S.me || (b.to === "*" && S.me && b.from !== S.me))).length);
  const act = activeAgent(); set("session", act && act.status === "limited" ? 1 : 0);
  set("versions", S.snaps.some(x => x.id === S.me && x.behind > 0) ? 1 : 0);
  $$(".nav-badge").forEach(b => { if (!b.hidden) b.setAttribute("aria-label", `${VIEW_KO[b.dataset.badge] || ""} 확인할 것 ${b.textContent}개`); });
  set("relay", S.view === "relay" ? 0 : S.relay.filter(r => r.from !== S.me && r.createdAt > relaySeenAt).length);
  set("claims", crossConflicts().length);
  set("parallel", S.tasks.filter(t => t.status === "todo" && t.hint === S.me).length);
  const u = S.usage; set("usage", u?.start && (now() - u.start) / (u.hours * 3600e3) >= 0.85 && (now() - u.start) < u.hours * 3600e3 ? 1 : 0);
}
