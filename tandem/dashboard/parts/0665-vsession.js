
/* ================= 가상 세션 키트: 세션 원본을 저장소(.tandem/SESSION.md)에 두고 자동화 ================= */
const fmtTime = t => { const d = new Date(t); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
function sessionMd() {
  const ss = S.session || {};
  const log = S.turns.slice(0, 15).reverse().map(t => `- ${fmtTime(t.at)} · 데스크 ${t.desk || "?"} · ${oneLine(agentName(t.agentId))} · ${oneLine(t.summary).slice(0, 200)}`);
  return ["# Tandem 가상 세션",
    "> 모든 PC·모든 AI(Claude, Codex)가 함께 쓰는 하나의 작업 세션입니다. 시작할 때 읽고, 작업을 끝내면 '현재 상태'·'다음 단계'를 고치고 '작업 로그'에 한 줄을 더하세요.",
    "", "## 목표", oneLine(ss.goal || "(미정)"), "", "## 현재 상태", ss.state || "(기록 없음)", "", "## 다음 단계", ss.next || "(미정)",
    "", "## 결정 사항", ...S.decisions.map(d => "- " + oneLine(d.text)), "", "## 작업 로그", ...log, ""].join("\n").split("\n").filter(l => !/^TANDEM_(MD|SH|CFG)$/.test(l)).join("\n");
}
function parseSessionMd(md) {
  const sec = {}; let cur = null;
  for (const line of String(md).split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { cur = h[1]; sec[cur] = []; continue; }
    if (cur) sec[cur].push(line);
  }
  const txt = k => (sec[k] || []).join("\n").trim();
  const items = k => (sec[k] || []).map(l => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  if (!Object.keys(sec).length) return null;
  return { goal: txt("목표"), state: txt("현재 상태"), next: txt("다음 단계"), decisions: items("결정 사항"), log: (sec["작업 로그"] || []).filter(l => /^\s*-\s/.test(l)).map(l => l.trim()) };
}
/* 스냅샷에 실려 온 SESSION.md를 대시보드에 반영 (세션 상태·결정·로그, 그리고 CLI의 떠남/이어받음 기록) */
async function importSessionMd(md, desk) {
  const p = parseSessionMd(md); if (!p) return 0;
  let n = 0;
  const blank = v => !v || /^\((미정|기록 없음)\)$/.test(v);
  const upd = {};
  for (const k of ["goal", "state", "next"]) if (!blank(p[k]) && p[k] !== (S.session?.[k] || "")) upd[k] = p[k].slice(0, 1000);
  if (Object.keys(upd).length) { saveSession(upd, true); n++; }
  const have = new Set(S.decisions.map(d => d.text));
  for (const t of p.decisions) if (!have.has(t) && !hasSecret(t)) { await put("decisions", uid(), { text: oneLine(t).slice(0, 300), at: now(), agentId: null }); n++; }
  const seen = new Set(S.turns.map(t => t.src).filter(Boolean));
  for (const line of p.log.slice(-20)) {
    const key = line.slice(0, 200);
    if (seen.has(key) || S.turns.some(t => t.summary && line.includes(oneLine(t.summary).slice(0, 60))) || hasSecret(line)) continue;
    const dm = /데스크 ([A-H])/.exec(line), d = dm ? dm[1] : desk;
    const hop = /(떠남|이어받음) \(([^)\s]+)\)/.exec(line);
    await put("turns", uid(), { at: now(), desk: d, agentId: null, kind: hop ? "switch" : "turn", summary: line.replace(/^-\s*/, "").slice(0, 400), src: key });
    if (hop && validBranch(hop[2])) {
      const br = hop[2];
      if (hop[1] === "이어받음") { await put("hops", uid(), { branch: br, desk: d, agentId: S.desks[d]?.agentId || null, at: now(), kind: "in" }); await writeStream(br, { holder: d, holderAgent: S.desks[d]?.agentId || null, since: now() }); }
      else { await put("hops", uid(), { branch: br, desk: d, agentId: S.desks[d]?.agentId || null, at: now(), kind: "out", note: line.split(": ").slice(1).join(": ").slice(0, 300), pushed: true }); const st = streamOf(br); if (!st || !st.holder || st.holder === d) await writeStream(br, { holder: null, holderAgent: null, lastDesk: d }); }
    }
    n++;
  }
  if (n) bump("turns", "at", 120);
  return n;
}

/* PC에 설치하는 도우미 스크립트 (sh, 맥·리눅스·윈도우 Git Bash) */
function tandemScript(base) {
  return `#!/bin/sh
# Tandem 가상 세션 도우미 - 어느 PC, 어느 AI(Claude/Codex)에서든 같은 세션을 이어가게 합니다.
# 사용법: sh .tandem/tandem.sh [context | resume <브랜치> | leave "한 일" "다음 할 일" | snap | desk <A-H> "<계정 이름>"]
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Tandem: git 저장소 안에서 실행하세요."; exit 1; }
cd "$ROOT" || exit 1
T=.tandem; S=$T/SESSION.md
DESK=$(cat $T/desk 2>/dev/null || echo "?"); TOOL=$(cat $T/tool 2>/dev/null || echo "?"); BASE=$(cat $T/base 2>/dev/null || echo ${base})
stamp() { date '+%Y-%m-%d %H:%M'; }
copy() { pbcopy 2>/dev/null || clip 2>/dev/null || xclip -selection clipboard 2>/dev/null || cat >/dev/null; }
logline() { printf -- '- %s · 데스크 %s · %s · %s\\n' "$(stamp)" "$DESK" "$TOOL" "$1" >> "$S"; }
setsec() { SEC="## $1" BODY="$2" awk 'BEGIN{h=ENVIRON["SEC"];b=ENVIRON["BODY"];s=0} $0==h{print;print b;print "";s=1;next} /^## /{s=0} !s{print}' "$S" > "$S.tmp" && mv "$S.tmp" "$S"; }
snap() {
  git fetch origin --quiet 2>/dev/null
  P=$(mktemp)
  echo "#TANDEM-SNAPSHOT 1"
  printf 'branch\\t%s\\n' "$(git rev-parse --abbrev-ref HEAD)"
  printf 'head\\t%s\\n' "$(git rev-parse HEAD)"
  printf 'base\\t%s\\t%s\\n' "$BASE" "$(git rev-parse origin/$BASE 2>/dev/null)"
  printf 'ab\\t%s\\n' "$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null)"
  printf 'desk\\t%s\\t%s\\n' "$DESK" "$TOOL"
  echo "#BRANCHES"
  git for-each-ref --sort=-committerdate --count=200 --format='%(refname:short)%09%(objectname:short=10)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)%09%(subject)' refs/heads
  echo "#ORIGIN"
  git for-each-ref --sort=-committerdate --count=200 --format='%(refname:short)%09%(objectname:short=10)%09%(committerdate:unix)%09%(subject)' refs/remotes/origin
  echo "#DIRTY"
  git -c core.quotePath=false status --porcelain | head -n 200
  echo "#LOCAL"
  git -c core.quotePath=false ls-files -co --exclude-standard | while IFS= read -r f; do [ -f "$f" ] && printf '%s\\n' "$f"; done > "$P"
  git hash-object --stdin-paths < "$P" | paste - "$P"
  echo "#REMOTE"
  git -c core.quotePath=false ls-tree -r "origin/$BASE" 2>/dev/null | awk -F'\\t' '{split($1,a," "); print a[3]"\\t"$2}'
  echo "#SESSION"
  cat "$S" 2>/dev/null
  rm -f "$P"
}
case "$1" in
  desk) echo "$2" > $T/desk; [ -n "$3" ] && echo "$3" > $T/tool; echo "Tandem: 이 PC = 데스크 $2 ($3)";;
  context)
    git fetch origin --quiet 2>/dev/null
    git pull --ff-only --quiet 2>/dev/null || echo "(Tandem: 자동 pull을 못 했어요. 충돌이나 커밋 안 한 변경을 확인하세요.)"
    echo "[Tandem 가상 세션 · 지금 데스크 $DESK · $TOOL]"
    echo "아래는 모든 PC·AI가 이어 쓰는 같은 세션입니다. 이전 대화처럼 여기고 '다음 단계'부터 이어가세요. 작업을 마치면 .tandem/SESSION.md 의 현재 상태·다음 단계·작업 로그를 갱신하세요."
    cat "$S" 2>/dev/null
    echo; echo "브랜치: $(git rev-parse --abbrev-ref HEAD) · 최근 커밋:"; git log --oneline -5;;
  resume)
    git fetch origin --prune --quiet
    if [ -n "$2" ]; then git switch "$2" 2>/dev/null || git switch -c "$2" --track "origin/$2" || exit 1; fi
    git pull --rebase --autostash --quiet || echo "(Tandem: pull 중 충돌 - 해결 후 다시 실행하세요.)"
    BR=$(git rev-parse --abbrev-ref HEAD); logline "이어받음 ($BR)"
    { echo "[같은 작업 이어하기 · Tandem]"; echo "아래 세션 기록을 이전 대화처럼 여기고 '다음 단계'부터 이어가세요."; cat "$S"; echo; git log --oneline -5; } | copy
    echo "Tandem: $BR 를 최신으로 맞추고 이어받기를 기록했어요. 이어받기 프롬프트를 복사했어요 (Claude Code는 자동으로 읽으니 붙여넣지 않아도 돼요).";;
  leave)
    BR=$(git rev-parse --abbrev-ref HEAD)
    logline "떠남 ($BR): $2"
    [ -n "$3" ] && setsec "다음 단계" "$3"
    git add -A && git commit -qm "tandem: $2" || true
    git push -q -u origin HEAD && echo "Tandem: 커밋·푸시했어요." || echo "(Tandem: 푸시 실패 - 네트워크나 권한을 확인하세요.)"
    snap | copy; echo "Tandem: 스냅샷(세션 포함)을 복사했어요. 대시보드 '스냅샷 기록'에 붙여넣으면 모든 PC에 반영돼요.";;
  snap|"") snap | copy; echo "Tandem: 스냅샷(세션 포함)을 복사했어요. 대시보드 '스냅샷 기록'에 붙여넣으세요.";;
  *) echo "사용법: sh .tandem/tandem.sh [context | resume <브랜치> | leave \\"한 일\\" \\"다음 할 일\\" | snap | desk <A-H> \\"<계정 이름>\\"]";;
esac
`;
}
function kitDesk() { return $("#kitDesk")?.value || S.me || "A"; }
function kitTool() { return oneLine($("#kitTool")?.value || activeAgent()?.name || "Claude").replace(/["'`$\\]/g, "").slice(0, 40); }
function installCmd() {
  const base = ($("#vBase")?.value || "main").replace(/[^A-Za-z0-9._\/-]/g, "") || "main";
  const md = sessionMd(), sh = tandemScript(base);
  return `# 저장소 루트에서 한 번 실행 (PC마다 한 번, 두 번째 PC부터는 SESSION.md를 덮지 않아요)
mkdir -p .tandem .claude
cat > .tandem/tandem.sh <<'TANDEM_SH'
${sh}TANDEM_SH
chmod +x .tandem/tandem.sh
[ -f .tandem/SESSION.md ] || cat > .tandem/SESSION.md <<'TANDEM_MD'
${md}
TANDEM_MD
echo ${base} > .tandem/base
grep -qs '^.tandem/desk$' .gitignore || printf '.tandem/desk\\n.tandem/tool\\n.tandem/*.tmp\\n' >> .gitignore
grep -qs 'tandem.sh context' CLAUDE.md || cat >> CLAUDE.md <<'TANDEM_MD'

## Tandem 가상 세션
- 이 저장소는 여러 PC와 여러 AI(Claude, Codex)가 하나의 세션으로 이어서 작업합니다.
- 세션 시작 때 훅이 \`sh .tandem/tandem.sh context\` 출력(최신 pull + .tandem/SESSION.md)을 넣어줍니다. 없으면 직접 실행해서 읽으세요.
- 작업을 마치면 .tandem/SESSION.md 의 '현재 상태'·'다음 단계'를 고치고 '작업 로그'에 한 줄을 더하세요.
- 사용자가 PC를 옮긴다고 하면 \`sh .tandem/tandem.sh leave "한 일" "다음 할 일"\` 을 실행하세요.
TANDEM_MD
grep -qs 'tandem.sh context' AGENTS.md || cat >> AGENTS.md <<'TANDEM_MD'

## Tandem 가상 세션
- 작업을 시작하기 전에 \`sh .tandem/tandem.sh context\` 를 실행해 출력된 세션(목표, 현재 상태, 다음 단계, 결정 사항, 작업 로그)을 이전 대화처럼 여기고 이어서 작업하세요.
- 결정 사항은 반드시 지키세요.
- 작업을 마치면 .tandem/SESSION.md 의 '현재 상태'·'다음 단계'를 고치고 '작업 로그'에 한 줄을 더하세요.
- 사용자가 PC를 옮긴다고 하면 \`sh .tandem/tandem.sh leave "한 일" "다음 할 일"\` 을 실행하세요.
TANDEM_MD
if [ ! -f .claude/settings.json ]; then cat > .claude/settings.json <<'TANDEM_CFG'
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "sh \\"$CLAUDE_PROJECT_DIR/.tandem/tandem.sh\\" context" } ] }
    ]
  }
}
TANDEM_CFG
else echo "Tandem: .claude/settings.json 이 이미 있어요. hooks.SessionStart 에 'sh \\"\\$CLAUDE_PROJECT_DIR/.tandem/tandem.sh\\" context' 명령을 직접 추가하세요."; fi
sh .tandem/tandem.sh desk ${kitDesk()} "${kitTool()}"
git add .tandem/tandem.sh .tandem/SESSION.md .tandem/base .gitignore CLAUDE.md AGENTS.md .claude/settings.json 2>/dev/null
git commit -qm "chore: Tandem 가상 세션 키트" && git push -q || true
echo "Tandem: 설치 완료. 이제 Claude Code는 시작할 때마다 같은 세션을 자동으로 읽어요."`;
}
function renderKit() {
  const out = $("#kitOut"); if (!out) return;
  const sel = $("#kitDesk");
  const opts = (deskList().length ? deskList() : ["A", "B"]).map(s => `<option value="${s}"${s === (sel?.value || S.me) ? " selected" : ""}>${s} · ${esc(deskName(s))}</option>`).join("");
  if (sel && document.activeElement !== sel && sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  const tool = $("#kitTool"); if (tool && document.activeElement !== tool && !tool.value) tool.value = activeAgent()?.name || "";
  if (document.activeElement?.closest?.("#kitOut")) return;
  out.innerHTML = codeBlock("1 · 설치 (저장소 루트에서, PC마다 한 번)", installCmd())
    + `<div class="grid g2" style="margin-top:10px">
      ${codeBlock("자리에 앉을 때 (이어받기)", "sh .tandem/tandem.sh resume <브랜치>")}
      ${codeBlock("자리를 뜰 때 (떠나기)", 'sh .tandem/tandem.sh leave "한 일" "다음 할 일"')}
      ${codeBlock("대시보드 동기화 (스냅샷 + 세션)", "sh .tandem/tandem.sh snap")}
      ${codeBlock("AI 없이 세션만 보기", "sh .tandem/tandem.sh context")}</div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="kitMd">현재 세션을 SESSION.md로 복사</button><span class="small muted">대시보드에서 고친 목표·결정을 저장소에 반영할 때 .tandem/SESSION.md 에 덮어쓰세요.</span></div>`;
}
function wireKit() {
  document.addEventListener("click", e => { const a = e.target.closest('[data-act="kitMd"]'); if (a) copyText(sessionMd(), a); });
  ["#kitDesk", "#kitTool"].forEach(s => $(s)?.addEventListener("input", () => { $("#kitOut").innerHTML = ""; renderKit(); }));
}
