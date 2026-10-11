
/* ================= 파일 버전: PC 폴더 · 가상 세션 · GitHub 비교 ================= */
const HLEN = 12, SNAP_MAX = 2400;
let vFilter = "diff", vSel = null, vLimit = 300, vHashes = {}, vHashSig = "";
const snapOf = id => S.snaps.find(x => x.id === id);

/* git과 같은 방식의 blob 해시 (sha1("blob <bytes>\0" + 내용)) */
async function gitBlobHash(text) {
  const body = new TextEncoder().encode(text), head = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length); buf.set(head); buf.set(body, head.length);
  const d = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function refreshVirtualHashes() {
  const sig = S.files.map(f => f.id + ":" + f.updatedAt).join("|");
  if (sig === vHashSig) return;
  vHashSig = sig;
  const out = {};
  try { for (const f of S.files) out[normPath(f.path)] = (await gitBlobHash(f.content || "")).slice(0, HLEN); }
  catch { for (const f of S.files) out[normPath(f.path)] = "len" + (f.content || "").length; }
  vHashes = out; renderVersions();
}

/* 스냅샷 명령 */
function snapCommand() {
  const repo = ($("#vRepo").value.trim() || "~/code/my-app").replace(/\/+$/, ""), base = $("#vBase").value.trim() || "main";
  const scope = $("#vScope").value.trim().split(/\s+/).filter(Boolean).map(p => `'${p.replace(/'/g, "")}'`).join(" ");
  const ps = scope ? " -- " + scope : "";
  return `cd ${repo} && git fetch origin --quiet && T=$(mktemp) && P=$(mktemp) && {
  echo "#TANDEM-SNAPSHOT 1"
  printf 'branch\\t%s\\n' "$(git rev-parse --abbrev-ref HEAD)"
  printf 'head\\t%s\\n' "$(git rev-parse HEAD)"
  printf 'base\\t%s\\t%s\\n' "${base}" "$(git rev-parse origin/${base})"
  printf 'ab\\t%s\\n' "$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null)"
  echo "#BRANCHES"
  git for-each-ref --sort=-committerdate --count=200 --format='%(refname:short)%09%(objectname:short=10)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)%09%(subject)' refs/heads
  echo "#ORIGIN"
  git for-each-ref --sort=-committerdate --count=200 --format='%(refname:short)%09%(objectname:short=10)%09%(committerdate:unix)%09%(subject)' refs/remotes/origin
  echo "#DIRTY"
  git -c core.quotePath=false status --porcelain${ps} | head -n 200
  echo "#LOCAL"
  git -c core.quotePath=false ls-files -co --exclude-standard${ps} | while IFS= read -r f; do [ -f "$f" ] && printf '%s\\n' "$f"; done > "$P"
  git hash-object --stdin-paths < "$P" | paste - "$P"
  echo "#REMOTE"
  git -c core.quotePath=false ls-tree -r origin/${base}${ps} | awk -F'\\t' '{split($1,a," "); print a[3]"\\t"$2}'
} > "$T" && cp "$T" "\${TMPDIR:-/tmp}/tandem-snapshot.txt" && (pbcopy < "$T" 2>/dev/null || clip < "$T" 2>/dev/null || xclip -selection clipboard < "$T" 2>/dev/null; true) && rm -f "$P" && echo "Tandem: 스냅샷을 클립보드에 복사했어요 ($(grep -c . "$T")줄). 파일: \${TMPDIR:-/tmp}/tandem-snapshot.txt"`;
}
function renderSnapCmd() {
  $("#vCmd").innerHTML = `<p class="small muted" style="margin-bottom:6px">저장소가 있는 PC의 터미널(맥·리눅스·윈도우 Git Bash)에 붙여넣으세요. 파일 내용은 보내지 않고, 파일 경로와 git 해시만 기록해요.</p>` + codeBlock("스냅샷 명령", snapCommand());
}

/* 붙여넣은 결과 해석 */
function parseSnapshot(txt) {
  if (!/#TANDEM-SNAPSHOT/.test(txt)) throw new Error("Tandem 스냅샷 형식이 아니에요. 위 명령의 출력을 그대로 붙여넣어 주세요.");
  const r = { branch: "", head: "", base: "", baseHead: "", ahead: null, behind: null, dirty: [], local: [], remote: [], branches: [], origin: [], session: [], desk: "", tool: "" };
  let sec = "";
  for (const raw of txt.split(/\r?\n/)) {
    if (sec === "SESSION") { r.session.push(raw); continue; }
    const line = raw.replace(/\s+$/, ""); if (!line) continue;
    if (line.startsWith("#")) { sec = line.slice(1).trim(); continue; }
    const t = line.split("\t");
    if (sec.startsWith("TANDEM")) {
      if (t[0] === "branch") r.branch = t[1] || "";
      else if (t[0] === "head") r.head = (t[1] || "").slice(0, 10);
      else if (t[0] === "base") { r.base = t[1] || ""; r.baseHead = (t[2] || "").slice(0, 10); }
      else if (t[0] === "ab" && t[1] !== undefined && t[1] !== "") { r.ahead = +t[1]; r.behind = +(t[2] ?? 0); }
      else if (t[0] === "desk") { r.desk = SLOTS.includes(t[1]) ? t[1] : ""; r.tool = oneLine(t[2] || "").slice(0, 40); }
    } else if (sec === "BRANCHES" && t.length >= 2) r.branches.push([t[0], t[1], t[2] || "", t[3] || "", +(t[4] || 0), (t.slice(5).join(" ") || "").slice(0, 120)]);
    else if (sec === "ORIGIN" && t.length >= 2 && t[0].startsWith("origin/") && t[0] !== "origin/HEAD") r.origin.push([t[0].slice(7), t[1], +(t[2] || 0), (t.slice(3).join(" ") || "").slice(0, 120)]);
    else if (sec === "DIRTY") r.dirty.push(line.replace(/\s+$/, ""));
    else if (sec === "LOCAL" && t.length >= 2 && /^[0-9a-f]{40}$/.test(t[0])) r.local.push([normPath(t.slice(1).join("\t")), t[0].slice(0, HLEN)]);
    else if (sec === "REMOTE" && t.length >= 2 && /^[0-9a-f]{40}$/.test(t[0])) r.remote.push([normPath(t.slice(1).join("\t")), t[0].slice(0, HLEN)]);
  }
  if (!r.local.length && !r.remote.length && !r.branches.length) throw new Error("파일 목록을 찾지 못했어요. 명령이 저장소 폴더에서 끝까지 실행됐는지 확인하세요.");
  return r;
}
async function recordSnapshot(txt) {
  if (!S.me) return askDesk();
  let r; try { r = parseSnapshot(txt); } catch (e) { $("#snapStatus").textContent = e.message; return toast(e.message, "warn"); }
  const cut = a => (a.length > SNAP_MAX ? a.slice(0, SNAP_MAX) : a);
  const truncated = r.local.length > SNAP_MAX || r.remote.length > SNAP_MAX;
  const prev = snapOf(S.me), ag = activeAgent();
  const doc = { desk: S.me, agentId: ag?.id || null, agentName: ag?.name || "", at: now(), branch: r.branch, head: r.head, base: r.base, baseHead: r.baseHead,
    ahead: r.ahead, behind: r.behind, dirty: r.dirty.slice(0, 200), files: cut(r.local), count: r.local.length, truncated, branches: r.branches.slice(0, 200) };
  /* 문서 크기(약 250KB) 안에 들도록 파일 목록을 줄임 */
  const fit = d => { while (bytesOf(d) > 235000 && d.files.length) { d.files = d.files.slice(0, Math.floor(d.files.length * 0.8)); d.truncated = true; } return d; };
  if (!(await put("snaps", S.me, fit(doc)))) return;
  if (r.remote.length || r.origin.length) await put("snaps", "gh", fit({ at: now(), by: S.me, agentId: ag?.id || null, base: r.base, baseHead: r.baseHead, files: cut(r.remote), count: r.remote.length, truncated, branches: r.origin.slice(0, 200) }));
  /* 이전 스냅샷과 비교해 바뀐 파일 이력 남기기 */
  const before = new Map(prev?.files || []), after = new Map(doc.files), added = [], changed = [], removed = [];
  for (const [p, h] of after) { if (!before.has(p)) added.push(p); else if (before.get(p) !== h) changed.push(p); }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p);
  await put("snaplog", uid(), { desk: S.me, agentId: ag?.id || null, at: now(), branch: r.branch, head: r.head, first: !prev, added: added.slice(0, 80), changed: changed.slice(0, 80), removed: removed.slice(0, 80), n: { a: added.length, c: changed.length, r: removed.length } });
  bump("snaplog", "at", 80);
  addLog("snapshot", `${deskName(S.me)} 스냅샷 기록 (${r.local.length}개 파일)`);
  if (r.desk && r.desk !== S.me) toast(`이 스냅샷은 저장소에서 데스크 ${r.desk}로 설정된 PC 것이에요. 이 PC(데스크 ${S.me})로 기록했어요. 다르면 'sh .tandem/tandem.sh desk ${S.me}'로 맞추세요.`, "warn");
  if (r.session.length) { const n = await importSessionMd(r.session.join("\n"), S.me); if (n) toast(`저장소의 세션(SESSION.md)에서 ${n}건을 대시보드에 반영했어요.`, "ok"); }
  $("#snapIn").value = ""; $("#snapStatus").textContent = "";
  toast(prev ? `스냅샷 기록: 추가 ${added.length} · 변경 ${changed.length} · 삭제 ${removed.length}` : `첫 스냅샷을 기록했어요 (파일 ${r.local.length}개).`, "ok");
  if (truncated || doc.truncated) toast(`파일이 많아 앞 ${SNAP_MAX}개만 저장했어요. '추적할 경로'로 범위를 좁히세요.`, "warn");
}

/* 비교표 */
function vColumns() {
  const cols = [];
  const gh = snapOf("gh");
  cols.push({ key: "gh", label: `GitHub · ${gh?.base || "기준 브랜치"}`, map: new Map(gh?.files || []), meta: gh ? `${gh.baseHead || ""} · ${ago(gh.at)} 데스크 ${gh.by}에서 가져옴` : "아직 없음: 스냅샷을 한 번 올리면 채워져요", empty: !gh, cls: "neutral" });
  cols.push({ key: "virtual", label: "가상 세션", map: new Map(Object.entries(vHashes)), meta: `개발 콘솔 파일 ${S.files.length}개 · 실시간`, empty: false, cls: "neutral" });
  for (const s of [...new Set([...deskList(), ...S.snaps.filter(x => x.id !== "gh").map(x => x.id)])]) {
    const sn = snapOf(s);
    const agn = sn ? (S.agents.find(a => a.id === sn.agentId)?.name || sn.agentName || "") : "";
    cols.push({ key: s, slot: s, label: `${s} · ${deskName(s)}`, sub: agn, map: new Map(sn?.files || []), snap: sn, empty: !sn,
      meta: sn ? `${sn.branch || "?"} @ ${sn.head || "?"} · ${ago(sn.at)}${sn.ahead ? ` · 푸시 안 함 ${sn.ahead}` : ""}${sn.behind ? ` · 받을 커밋 ${sn.behind}` : ""}${(sn.dirty || []).length ? ` · 미커밋 ${sn.dirty.length}` : ""}` : "스냅샷 없음" });
  }
  return cols;
}
function vRows(cols) {
  const paths = new Set();
  for (const c of cols) for (const p of c.map.keys()) paths.add(p);
  const q = $("#vSearch").value.trim().toLowerCase(), live = cols.filter(c => !c.empty);
  const rows = [];
  for (const p of [...paths].sort()) {
    if (q && !p.toLowerCase().includes(q)) continue;
    const hs = live.map(c => c.map.get(p) || null);
    const vers = [...new Set(hs.filter(Boolean))];
    const missing = hs.some(h => !h), diff = vers.length > 1 || (missing && vers.length > 0);
    rows.push({ p, vers, missing, diff });
  }
  return rows;
}
function renderVersions() {
  if (!$("#vTable")) return;
  const cols = vColumns(), rows = vRows(cols), live = cols.filter(c => !c.empty);
  const gh = cols[0];
  $("#snapWho").textContent = S.me ? `데스크 ${S.me}${activeAgent() ? " · " + activeAgent().name : ""}로 기록` : "데스크 미지정";
  /* 열 요약: GitHub 기준과 같음/다름/없음 */
  $("#vCols").innerHTML = cols.map(c => {
    let same = 0, dif = 0, only = 0;
    if (!c.empty && c.key !== "gh" && !gh.empty) for (const [p, h] of c.map) { const g = gh.map.get(p); if (!g) only++; else if (g === h) same++; else dif++; }
    const tot = same + dif + only || 1;
    return `<div class="vcol" ${c.slot ? `data-slot="${c.slot}"` : ""}><div class="t">${c.slot ? pill(c.slot, c.slot) : pill("neutral", c.key === "gh" ? "GH" : "VS")}<span>${esc(c.label)}</span></div>
      ${c.sub ? `<div class="small">계정: ${esc(c.sub)}</div>` : ""}<div class="meta">${esc(c.meta)}</div>
      ${!c.empty && c.key !== "gh" && !gh.empty ? `<div class="vbar" title="GitHub 기준"><i style="width:${same / tot * 100}%;background:var(--ok)"></i><i style="width:${dif / tot * 100}%;background:var(--warn)"></i><i style="width:${only / tot * 100}%;background:var(--ink-3)"></i></div><div class="meta">같음 ${same} · 다름 ${dif} · 여기만 ${only}</div>` : c.key === "gh" && !c.empty ? `<div class="meta">파일 ${c.map.size}개${snapOf("gh")?.truncated ? " (일부)" : ""}</div>` : ""}</div>`;
  }).join("");
  $("#vLegend").innerHTML = `같은 색 = 같은 내용 · <span class="vcell v0">v1</span> GitHub와 같은 버전 · <span class="vcell v1">v2</span> <span class="vcell v2">v3</span> 다른 버전 · <span class="vcell none">없음</span> 그 위치에 파일 없음`;
  const f = rows.filter(r => vFilter === "all" ? true : vFilter === "missing" ? r.missing : r.diff);
  const nDiff = rows.filter(r => r.diff).length;
  if (!live.length || (live.length === 1 && live[0].key === "virtual" && !S.files.length)) {
    $("#vTable").innerHTML = `<tbody><tr><td><div class="empty"><b>비교할 스냅샷이 아직 없어요.</b><br>위 명령을 이 PC 저장소에서 실행하고 결과를 올리면 GitHub와 이 PC의 파일이 채워져요. 다른 PC에서도 똑같이 올리면 PC끼리 비교돼요.</div></td></tr></tbody>`;
    $("#vMore").innerHTML = ""; renderVLog(); return;
  }
  const head = `<thead><tr><th>파일 (${f.length}/${rows.length} · 차이 ${nDiff})</th>${live.map(c => `<th>${c.slot ? `<span class="pill ${c.slot}">${c.slot}</span> ` : ""}${esc(c.key === "gh" ? "GitHub" : c.key === "virtual" ? "가상 세션" : deskName(c.slot))}${c.sub ? `<div class="muted" style="font-weight:400">${esc(c.sub)}</div>` : ""}</th>`).join("")}</tr></thead>`;
  const body = f.slice(0, vLimit).map(r => {
    const base = gh.empty ? null : gh.map.get(r.p);
    const order = [...new Set([base, ...live.map(c => c.map.get(r.p))].filter(Boolean))];
    return `<tr data-vpath="${esc(r.p)}" class="${vSel === r.p ? "sel" : ""}"><td class="p" title="${esc(r.p)}">${esc(r.p)}</td>${live.map(c => {
      const h = c.map.get(r.p); if (!h) return `<td><span class="vcell none">없음</span></td>`;
      const i = order.indexOf(h);
      return `<td><span class="vcell v${Math.min(i, 5)}">v${i + 1} ${esc(h.slice(0, 7))}</span></td>`;
    }).join("")}</tr>`;
  }).join("");
  $("#vTable").innerHTML = head + `<tbody>${body || `<tr><td colspan="${live.length + 1}"><div class="empty">${vFilter === "diff" ? "<b>모든 위치의 파일이 같아요.</b> 버전 차이가 없어요." : "조건에 맞는 파일이 없어요."}</div></td></tr>`}</tbody>`;
  $("#vMore").innerHTML = f.length > vLimit ? `<button class="btn sm" data-act="vMore">${f.length - vLimit}개 더 보기</button>` : "";

  renderVLog(); if (vSel) renderVDetail(vSel);
}
function renderVLog() {
  $("#vLogN").textContent = S.snaplog.length ? `${S.snaplog.length}개` : "";
  $("#vLog").innerHTML = S.snaplog.length ? S.snaplog.slice(0, 30).map(e => `<div class="li"><span class="stripe ${esc(e.desk)}"></span><div class="li-main"><div class="li-t" style="font-weight:500">${esc(deskName(e.desk))}${e.agentId ? " · " + esc(agentName(e.agentId)) : ""} ${e.first ? pill("neutral", "첫 기록") : `${pill("ok", "+" + e.n.a)} ${pill("warn", "~" + e.n.c)} ${pill("bad", "−" + e.n.r)}`}</div>
    <div class="li-s">${esc(e.branch || "")} @ ${esc(e.head || "")} · ${ago(e.at)}</div></div></div>`).join("")
    : `<div class="empty small">스냅샷을 올릴 때마다 무엇이 바뀌었는지 여기에 쌓여요.</div>`;
}
function renderVDetail(p) {
  const cols = vColumns().filter(c => !c.empty), gh = cols.find(c => c.key === "gh");
  const order = [...new Set([gh?.map.get(p), ...cols.map(c => c.map.get(p))].filter(Boolean))];
  const hist = S.snaplog.filter(e => (e.added || []).includes(p) || (e.changed || []).includes(p) || (e.removed || []).includes(p));
  const vf = S.files.find(x => normPath(x.path) === p);
  $("#vDetail").innerHTML = `<div class="card-h"><div class="card-t">파일 이력</div>${vf ? `<button class="btn sm" data-act="fOpen" data-id="${vf.id}">가상 세션에서 열기</button>` : ""}</div>
    <div class="path">${esc(p)}</div>
    <div class="list">${cols.map(c => { const h = c.map.get(p), i = order.indexOf(h); const dirty = c.snap && (c.snap.dirty || []).some(l => { const q = l.slice(3).replace(/^"|"$/g, ""); return q === p || q.endsWith("-> " + p) || q.split(" -> ").pop().replace(/^"|"$/g, "") === p; });
      return `<div class="li"><div class="li-main"><div class="li-t">${c.slot ? pill(c.slot, c.slot) + " " : ""}${esc(c.key === "gh" ? "GitHub" : c.key === "virtual" ? "가상 세션" : deskName(c.slot))}${c.sub ? ` <span class="muted small">${esc(c.sub)}</span>` : ""}</div><div class="li-s">${esc(c.meta)}</div></div>
      ${h ? `<span class="vcell v${Math.min(i, 5)}">v${i + 1} ${esc(h.slice(0, 7))}</span>` : `<span class="vcell none">없음</span>`}${dirty ? " " + pill("warn", "미커밋") : ""}</div>`; }).join("")}</div>
    <div class="card-t" style="font-size:13px;margin-top:6px">바뀐 기록</div>
    <div class="list">${hist.length ? hist.map(e => { const k = (e.added || []).includes(p) ? ["ok", "추가"] : (e.removed || []).includes(p) ? ["bad", "삭제"] : ["warn", "변경"];
      return `<div class="li"><span class="stripe ${esc(e.desk)}"></span><div class="li-main"><div class="li-t" style="font-weight:500">${pill(k[0], k[1])} ${esc(deskName(e.desk))}${e.agentId ? " · " + esc(agentName(e.agentId)) : ""}</div><div class="li-s">${esc(e.branch || "")} @ ${esc(e.head || "")} · ${ago(e.at)}</div></div></div>`; }).join("")
      : `<div class="empty small">아직 이 파일이 바뀐 기록이 없어요. 스냅샷을 다시 올리면 변화가 쌓여요.</div>`}</div>`;
}
function versionTips(T) {
  const sn = snapOf(S.me);
  if (!S.me) return;
  if (sn?.behind > 0) T.push({ l: "warn", t: `<b>이 PC 브랜치가 원격보다 커밋 ${sn.behind}개 뒤처져 있어요.</b> git pull 후 스냅샷을 다시 올리세요.`, a: ["파일 버전", () => go("versions")] });
  if (sn?.ahead > 0) T.push({ l: "info", t: `이 PC에 푸시하지 않은 커밋이 ${sn.ahead}개 있어요. 다른 PC·계정이 볼 수 있게 푸시하세요.`, a: ["파일 버전", () => go("versions")] });
  if (sn && now() - sn.at > 24 * 3600e3) T.push({ l: "info", t: "이 PC의 파일 스냅샷이 하루 넘게 지났어요. 다시 올리면 비교가 정확해져요.", a: ["스냅샷", () => go("versions")] });
}
function wireVersions() {
  ["#vRepo", "#vBase", "#vScope"].forEach(s => $(s).addEventListener("input", renderSnapCmd));
  $("#snapForm").addEventListener("submit", e => { e.preventDefault(); const t = $("#snapIn").value; if (!t.trim()) return $("#snapIn").focus(); recordSnapshot(t); });
  const readFile = file => { if (!file) return; const fr = new FileReader(); fr.onload = () => { $("#snapIn").value = String(fr.result || ""); $("#snapStatus").textContent = `${file.name} 불러옴 · '스냅샷 기록'을 누르세요`; }; fr.readAsText(file); };
  $("#snapFile").addEventListener("change", e => readFile(e.target.files[0]));
  $("#snapIn").addEventListener("dragover", e => e.preventDefault());
  $("#snapIn").addEventListener("drop", e => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });
  $("#vFilter").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; vFilter = b.dataset.f; vLimit = 300; $$("#vFilter button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderVersions(); });
  $("#vSearch").addEventListener("input", () => { vLimit = 300; renderVersions(); });
  $("#vTable").addEventListener("click", e => { const tr = e.target.closest("tr[data-vpath]"); if (!tr) return; vSel = tr.dataset.vpath; $$("#vTable tr.sel").forEach(x => x.classList.remove("sel")); tr.classList.add("sel"); renderVDetail(vSel); if (innerWidth < 1080) $("#vDetail").scrollIntoView({ block: "start", behavior: "smooth" }); });
  document.addEventListener("click", e => { const a = e.target.closest('[data-act="vMore"]'); if (a) { vLimit += 300; renderVersions(); } });
  renderSnapCmd();
}
