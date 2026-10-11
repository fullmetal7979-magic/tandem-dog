<script>
(() => {
"use strict";
/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + now().toString(36)).replace(/[^a-zA-Z0-9-]/g, "");
const TAB = uid().slice(0, 8);
const LS = {
  get(k, d) { try { const v = localStorage.getItem("tandem." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("tandem." + k, JSON.stringify(v)); } catch {} },
};
function ago(t) {
  if (!t) return "-";
  const s = Math.max(0, Math.round((now() - t) / 1000));
  if (s < 45) return "방금";
  if (s < 3600) return Math.round(s / 60) + "분 전";
  if (s < 86400) return Math.round(s / 3600) + "시간 전";
  return Math.round(s / 86400) + "일 전";
}
function dur(ms) {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return h ? `${h}시간 ${m}분` : `${m}분`;
}
const deskName = s => S.desks[s]?.name || "데스크 " + s;
const LOADS = ["쉬는 중", "가벼움", "보통", "고부하"];
const SLOTS = "ABCDEFGH".split("");
const deskList = () => SLOTS.filter(s => S.desks[s]);
const others = s => deskList().filter(x => x !== s);
const nextSlot = () => SLOTS.find(s => !S.desks[s]) || null;
/* 안전 도우미: 셸 인용, 비밀 탐지, 바이트 크기, 브랜치 이름 검사 */
const shq = v => "'" + String(v).replace(/'/g, "'\\''") + "'";
const SECRET_RE = /(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
const hasSecret = t => SECRET_RE.test(String(t || ""));
const bytesOf = v => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v)).length;
const validBranch = b => /^[\p{L}\p{N}._\/-]+$/u.test(b) && !/(^[/.-]|\/\/|\.\.|@\{|\.lock$|\/$|\.$)/.test(b) && b.length <= 120;
/* 공유 저장소에서 들어온 문서 정리: 데스크 값은 A~H만, 숫자·문자열 타입 고정 */
const SLOT_KEYS = ["slot", "from", "to", "desk", "holder", "hint", "by", "lastDesk", "owner", "ackBy"];
const oneLine = v => String(v ?? "").replace(/[\r\n]+/g, " ");
function clean(coll, d) {
  if (!d || typeof d !== "object") return d;
  const o = { ...d };
  for (const k of SLOT_KEYS) if (k in o && o[k] != null && !SLOTS.includes(o[k]) && !(k === "to" && o[k] === "*")) o[k] = null;
  for (const k of ["at", "createdAt", "expiresAt", "updatedAt", "since", "ackAt", "doneAt", "takenAt", "limitedAt"]) if (k in o && o[k] != null) o[k] = +o[k] || 0;
  if ("load" in o) o.load = Math.max(0, Math.min(3, Math.round(+o.load || 0)));
  if ("tool" in o && !["claude", "codex", "other"].includes(o.tool)) o.tool = "other";
  for (const k of ["path", "title", "name", "branch", "head", "kind", "status", "role", "agentName", "base", "baseHead"]) if (k in o && o[k] != null) o[k] = oneLine(o[k]).slice(0, 400);
  for (const k of ["text", "note", "summary", "content", "prev", "done", "warn", "last", "goal", "state"]) if (k in o && o[k] != null && typeof o[k] !== "string") o[k] = String(o[k]);
  if ("next" in o && o.next != null && typeof o.next !== "string" && !Array.isArray(o.next)) o.next = String(o.next);
  for (const k of ["paths", "files", "dirty", "branches", "added", "changed", "removed"]) if (k in o && !Array.isArray(o[k])) o[k] = [];
  if (Array.isArray(o.paths)) o.paths = o.paths.map(oneLine);
  if (coll === "turns" && Array.isArray(o.next)) o.next = o.next.map(oneLine);
  if (coll === "snaplog") o.n = { a: +o.n?.a || 0, c: +o.n?.c || 0, r: +o.n?.r || 0 };
  if (coll === "snaps") {
    if (Array.isArray(o.files)) o.files = o.files.filter(x => Array.isArray(x) && x.length >= 2).map(x => [oneLine(x[0]), String(x[1])]);
    if (Array.isArray(o.branches)) o.branches = o.branches.filter(Array.isArray).map(x => x.map((v, i) => (typeof v === "number" ? v : i === 4 && o.id !== "gh" ? +v || 0 : oneLine(v))));
  }
  return o;
}
/* 렌더 한 번 동안 같은 계산을 다시 하지 않도록 */
let tick = 0;
const memo = new Map();
function cached(k, f) { const m = memo.get(k); if (m && m.t === tick) return m.v; const v = f(); memo.set(k, { t: tick, v }); return v; }
const dirty = () => { tick++; };

/* ================= state ================= */
const S = {
  me: LS.get("slot", null),
  desks: {},
  claims: [], batons: [], relay: [], tasks: [], log: [],
  agents: [], turns: [], decisions: [], files: [], console: [], session: null, snaps: [], snaplog: [], streams: [], hops: [],
  usage: null,
  online: {}, peerView: {},
  mode: "boot",           // boot | live | local
  roomOk: false,
  view: LS.get("view", "overview"),
  boot: now(),
};
let db = null, room = null, sample = null;

/* ================= store (db 우선, 없으면 이 브라우저 로컬) ================= */
const ARR = ["claims", "batons", "relay", "tasks", "log", "agents", "turns", "decisions", "files", "console", "snaps", "snaplog", "streams", "hops"];
function sortAll() {
  S.batons.sort((a, b) => b.createdAt - a.createdAt);
  S.relay.sort((a, b) => b.createdAt - a.createdAt);
  S.log.sort((a, b) => b.at - a.at);
  S.tasks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  S.agents.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  S.turns.sort((a, b) => b.at - a.at);
  S.decisions.sort((a, b) => (a.at || 0) - (b.at || 0));
  S.console.sort((a, b) => b.at - a.at);
  S.snaplog.sort((a, b) => b.at - a.at);
  S.hops.sort((a, b) => b.at - a.at);
}
function saveLocal() {
  if (S.mode !== "local") return;
  LS.set("local", { desks: S.desks, claims: S.claims, batons: S.batons, relay: S.relay, tasks: S.tasks, log: S.log.slice(0, 60), usage: S.usage, agents: S.agents, turns: S.turns.slice(0, 120), decisions: S.decisions, files: S.files, console: S.console.slice(0, 100), session: S.session, snaps: S.snaps, snaplog: S.snaplog.slice(0, 80), streams: S.streams, hops: S.hops.slice(0, 150) });
}
function localApply(coll, id, data, merge) {
  if (coll === "desks") { if (data == null) delete S.desks[id]; else S.desks[id] = { ...(merge ? S.desks[id] : {}), ...data, id }; }
  else if (coll === "meta") { if (id === "usage") S.usage = data == null ? null : { ...(merge ? S.usage : {}), ...data }; if (id === "session") S.session = data == null ? null : { ...(merge ? S.session : {}), ...data }; }
  else {
    const arr = S[coll], i = arr.findIndex(x => x.id === id);
    if (data == null) { if (i >= 0) arr.splice(i, 1); }
    else { const obj = { ...(merge && i >= 0 ? arr[i] : {}), ...data, id }; i >= 0 ? (arr[i] = obj) : arr.push(obj); }
  }
  sortAll(); saveLocal(); dirty(); render();
  return true;
}
function dbErr(e) {
  const code = e?.code;
  if (code === "quota_exceeded") toast("저장 공간이 가득 찼어요. 오래된 릴레이·기록을 지운 뒤 다시 시도하세요.", "bad");
  else if (code === "resource_exhausted") toast("요청이 너무 잦아요. 잠시 후 다시 시도하세요.", "warn");
  else if (code === "invalid_argument") toast("이 화면에서는 쓰기 권한이 없어요. 소유 계정으로 열었는지 확인하세요.", "bad");
  else if (code && code !== "revoked") toast("저장하지 못했어요. 네트워크를 확인한 뒤 다시 시도하세요.", "bad");
}
/* 쓰기는 성공 여부(true/false)를 돌려준다. 실패하면 호출한 쪽이 입력을 지우지 않는다 */
async function put(coll, id, data) {
  if (bytesOf(data) > 250000) { toast("내용이 너무 커서 저장하지 못했어요 (문서 하나에 약 250KB까지). 나눠서 저장하세요.", "bad"); return false; }
  if (!db) return localApply(coll, id, data, false);
  try { await db.collection(coll).doc(id).set(data); return true; }
  catch (e) {
    if (e?.code === "unavailable") { await sleep(400 + Math.random() * 600); try { await db.collection(coll).doc(id).set(data); return true; } catch (e2) { dbErr(e2); return false; } }
    dbErr(e); return false;
  }
}
async function patch(coll, id, data) {
  if (!db) return localApply(coll, id, data, true);
  try { await db.collection(coll).doc(id).update(data); return true; } catch (e) { dbErr(e); return false; }
}
async function del(coll, id) {
  if (!db) return localApply(coll, id, null);
  try { await db.collection(coll).doc(id).delete(); return true; } catch (e) { dbErr(e); return false; }
}

/* 기록: 컬렉션이 끝없이 커지지 않게 쓰기 10번마다(첫 쓰기 포함) 오래된 문서를 잘라냄 */
let logCount = 0;
const pruneCnt = {};
function bump(coll, field, keep) { pruneCnt[coll] = (pruneCnt[coll] || 0) + 1; if (pruneCnt[coll] % 10 === 1) prune(coll, field, keep); }
async function prune(coll, field, keep) {
  if (!db) { if (S[coll].length > keep) S[coll].length = keep; return saveLocal(); }
  try {
    const snap = await db.collection(coll).orderBy(field, "desc").get();
    for (const d of snap.docs.slice(keep)) await db.collection(coll).doc(d.id).delete();
  } catch {}
}
function addLog(type, text) {
  if (!S.me) return;
  put("log", uid(), { slot: S.me, type, text, at: now() });
  bump("log", "at", 60);
}

/* ================= 경로 겹침 판정 ================= */
const normPath = p => String(p || "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
const globBase = p => { const i = p.search(/[*?[{]/); return (i < 0 ? p : p.slice(0, i)).replace(/\/+$/, ""); };
const under = (x, y) => x === y || x.startsWith(y + "/");
function overlaps(p, q) {
  const a = globBase(normPath(p)), b = globBase(normPath(q));
  if (!a || !b) return true;                     // "**" 같은 전체 패턴
  return under(a, b) || under(b, a);
}
const active = c => (c.expiresAt || 0) > now();
const conflictsFor = (path, slot) => S.claims.filter(c => c.slot !== slot && active(c) && overlaps(c.path, path));
function crossConflicts() { return cached("cc", crossConflicts_); }
function crossConflicts_() {
  const L = S.claims.filter(active), out = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (L[i].slot !== L[j].slot && overlaps(L[i].path, L[j].path)) out.push([L[i], L[j]]);
  return out;
}

/* 잠금 추가: 짧은 리스(acquire)로 여러 PC가 같은 순간에 잠가도 한쪽만 통과 */
async function addClaim(path, note = "", ttlH = 3, opt = {}) {
  path = normPath(path);
  if (!path) return { error: "empty" };
  if (!S.me) { askDesk(); return { error: "nodesk" }; }
  const slot = opt.slot || S.me;
  const commit = async () => {
    const hit = conflictsFor(path, slot);
    if (hit.length && !opt.force) return { conflicts: hit };
    const mine = S.claims.find(c => c.slot === slot && active(c) && normPath(c.path) === path);
    if (mine) return { ok: true, dup: true };
    await put("claims", uid(), { path, slot, note: note || "", taskId: opt.taskId || null, createdAt: now(), expiresAt: now() + ttlH * 3600e3 });
    addLog("claim", slot === S.me ? `${path} 잠금` : `${path} 잠금 (데스크 ${slot} 몫)`);
    return { ok: true };
  };
  if (!db) return commit();
  const gate = db.doc("meta/claimgate");
  const grab = () => gate.acquire({ holder: S.me + "-" + TAB, ttlMs: 4000 }).catch(e => ({ acquired: ["capability_removed", "capability_disabled", "not_granted"].includes(e?.code) }));
  let r = await grab();
  if (!r.acquired) { await sleep(1200); r = await grab(); }
  if (!r.acquired) { toast("상대 PC가 지금 잠금을 처리하고 있어요. 몇 초 뒤 다시 시도하세요.", "warn"); return { busy: true }; }
  try { const snap = await db.collection("claims").get(); S.claims = snap.docs.map(d => clean("claims", { id: d.id, ...d.data() })); dirty(); } catch {}
  return commit();
}
async function releaseClaim(c) { await del("claims", c.id); addLog("release", `${c.path} 잠금 해제`); }

/* ================= 데스크 ================= */
let deskTimer = null, deskPending = {};
function saveDesk(fields, immediate) {
  if (!S.me) return;
  Object.assign(deskPending, fields);
  S.desks[S.me] = { ...(S.desks[S.me] || {}), ...fields, id: S.me };
  dirty(); render();
  clearTimeout(deskTimer);
  const flush = async () => {
    const data = { ...(S.desks[S.me] || {}), ...deskPending, updatedAt: now() };
    delete data.id; deskPending = {};
    const ok = await put("desks", S.me, data);
    if (ok) { $("#meSaved").textContent = "저장됨 · 다른 PC에 표시돼요"; setTimeout(() => ($("#meSaved").textContent = ""), 2400); }
    presence();
  };
  immediate ? flush() : (deskTimer = setTimeout(flush, 700));
}
function presence() {
  if (!room || !S.me) return;
  const d = S.desks[S.me] || {};
  room.presence({ slot: S.me, view: S.view, load: d.load ?? 0 }).catch(() => {});
}

/* ================= 실시간 연결 ================= */
let relaySeenAt = LS.get("relaySeen", 0);
function watchAdds(coll, snap) {
  if (snap.metadata?.fromCache) return;
  for (const ch of snap.docChanges()) {
    if (ch.type !== "added") continue;
    const d = ch.doc.data(); if (!d) continue;
    const t = d.createdAt || d.at || 0;
    if (t < S.boot || !S.me) continue;
    if (coll === "relay" && d.from !== S.me) toast(`${deskName(d.from)}에서 릴레이 도착: ${String(d.text).slice(0, 60)}`, d.from, { label: "보기", fn: () => go("relay") });
    if (coll === "batons" && (d.to === S.me || (d.to === "*" && d.from !== S.me))) toast(`${deskName(d.from)}에서 바통이 왔어요. 이어서 할 일을 확인하세요.`, d.from, { label: "열기", fn: () => go("baton") });
    if (coll === "claims" && d.slot !== S.me) {
      const hit = S.claims.filter(c => c.slot === S.me && active(c) && overlaps(c.path, d.path));
      if (hit.length) toast(`${deskName(d.slot)}가 내 잠금과 겹치는 ${d.path} 를 잠갔어요.`, "bad", { label: "확인", fn: () => go("claims") });
    }
  }
}
function subscribe() {
  const on = (coll, q, assign) => q.onSnapshot(snap => {
    assign(snap.docs.map(d => clean(coll, { id: d.id, ...d.data() })));
    sortAll(); dirty(); watchAdds(coll, snap); render();
  }, e => { if (e?.code !== "revoked") console.warn(coll, e); });
  let desksSeen = false;
  db.collection("desks").onSnapshot(snap => {
    S.desks = {};
    for (const d of snap.docs) if (SLOTS.includes(d.id)) S.desks[d.id] = clean("desks", { id: d.id, ...d.data() });
    dirty();
    const sure = !snap.metadata?.fromCache && !snap.metadata?.hasPendingWrites;
    if (sure && desksSeen && S.me && !S.desks[S.me]) lostDesk();
    if (sure) desksSeen = true;
    render();
  }, () => {});
  on("claims", db.collection("claims"), docs => (S.claims = docs));
  on("batons", db.collection("batons").orderBy("createdAt", "desc").limit(30), docs => (S.batons = docs));
  on("relay", db.collection("relay").orderBy("createdAt", "desc").limit(40), docs => (S.relay = docs));
  on("tasks", db.collection("tasks"), docs => (S.tasks = docs));
  on("log", db.collection("log").orderBy("at", "desc").limit(40), docs => (S.log = docs));
  db.doc("meta/usage").onSnapshot(s => { S.usage = s.exists ? clean("meta", s.data()) : null; dirty(); render(); }, () => {});
  on("agents", db.collection("agents"), docs => (S.agents = docs));
  on("turns", db.collection("turns").orderBy("at", "desc").limit(60), docs => (S.turns = docs));
  on("decisions", db.collection("decisions"), docs => (S.decisions = docs));
  on("files", db.collection("files"), docs => (S.files = docs));
  on("console", db.collection("console").orderBy("at", "desc").limit(60), docs => (S.console = docs));
  on("snaps", db.collection("snaps"), docs => (S.snaps = docs.filter(d => d.id === "gh" || SLOTS.includes(d.id))));
  on("streams", db.collection("streams"), docs => (S.streams = docs));
  on("hops", db.collection("hops").orderBy("at", "desc").limit(120), docs => (S.hops = docs));
  on("snaplog", db.collection("snaplog").orderBy("at", "desc").limit(50), docs => (S.snaplog = docs));
  db.doc("meta/session").onSnapshot(s => { S.session = s.exists ? clean("meta", s.data()) : null; S.sessionLive = s.exists; dirty(); render(); }, () => {});
}
function lostDesk() {
  if (S.mode !== "live") return;
  S.me = null; LS.set("slot", null);
  toast("이 PC의 데스크가 다른 PC에서 제거됐어요. 데스크를 다시 고르세요.", "warn");
  askDesk();
}
function connectRoom() {
  room.onPeers(ch => {
    const on = {}, pv = {};
    for (const p of ch.peers) {
      const s = p.presence?.slot;
      if (SLOTS.includes(s)) { on[s] = true; pv[s] = p.presence.view || null; }
    }
    if (S.me) on[S.me] = true;
    const was = S.online;
    S.online = on; S.peerView = pv;
    if (S.me && S.mode === "live" && now() - S.boot > 4000) for (const o of others(S.me)) if (!!was[o] !== !!on[o]) toast(on[o] ? `${deskName(o)}가 접속했어요.` : `${deskName(o)} 화면이 닫혔어요.`, o);
    renderTbar(); renderCoach(); renderDuo();
  }, () => {});
  room.onConnection(c => { S.roomOk = c; renderConn(); }, () => {});
  room.on("nudge", m => {
    const d = m.data || {};
    if ((d.to === S.me || d.to === "*") && d.from !== S.me && !m.sameTab) toast(`${deskName(d.from)}: ${String(d.text || "확인 부탁해요").slice(0, 80)}`, d.from);
  }, () => {});
  presence();
}
async function nudge(text, to = "*") {
  if (!S.me) return askDesk();
  if (!room) return toast("실시간 연결이 없어 콕 찌르기를 보낼 수 없어요. 릴레이를 이용하세요.", "warn");
  try { await room.emit("nudge", { from: S.me, to, text }); toast(to === "*" ? "모든 PC에 알림을 보냈어요." : `${deskName(to)}에 알림을 보냈어요.`, "ok"); }
  catch { toast("알림을 보내지 못했어요. 상대 PC가 이 페이지를 열어두었는지 확인하세요.", "warn"); }
}

/* ================= 로컬(미리보기/오프라인) 예시 ================= */
function loadLocal() {
  const d = LS.get("local", null);
  if (d) { Object.assign(S, { desks: Object.fromEntries(Object.entries(d.desks || {}).filter(([k, v]) => v && SLOTS.includes(k))), claims: d.claims || [], batons: d.batons || [], relay: d.relay || [], tasks: d.tasks || [], log: d.log || [], usage: d.usage || null, agents: d.agents || [], turns: d.turns || [], decisions: d.decisions || [], files: d.files || [], console: d.console || [], session: d.session || null, snaps: d.snaps || [], snaplog: d.snaplog || [], streams: d.streams || [], hops: d.hops || [] }); return; }
  const t = now(), H = 3600e3;
  S.desks = {
    A: { id: "A", name: "작업실 iMac (예시)", task: "결제 API 연동", branch: "a/payments-api", load: 3, agentId: "ag2", updatedAt: t - 4 * 60e3, example: true },
    B: { id: "B", name: "거실 맥북 (예시)", task: "결제 폼 UI", branch: "b/payments-ui", load: 1, agentId: "ag3", updatedAt: t - 9 * 60e3, example: true },
  };
  S.claims = [
    { id: "c1", path: "src/api/payments/**", slot: "A", note: "Stripe 웹훅", createdAt: t - H, expiresAt: t + 2 * H, example: true },
    { id: "c2", path: "src/ui/checkout/**", slot: "B", note: "결제 폼", createdAt: t - 0.5 * H, expiresAt: t + 2.5 * H, example: true },
  ];
  S.tasks = [
    { id: "t1", title: "결제 웹훅 핸들러 (예시)", paths: ["src/api/payments/**"], slot: "A", status: "doing", createdAt: t - 3 * H, example: true },
    { id: "t2", title: "결제 폼 유효성 검사 (예시)", paths: ["src/ui/checkout/**"], slot: "B", status: "doing", createdAt: t - 2 * H, example: true },
    { id: "t3", title: "영수증 이메일 템플릿 (예시)", paths: ["src/email/receipt/**"], slot: null, hint: "B", status: "todo", createdAt: t - H, example: true },
    { id: "t4", title: "결제 e2e 테스트 (예시)", paths: ["tests/e2e/pay/**"], slot: null, hint: "A", status: "todo", createdAt: t - H, example: true },
  ];
  S.relay = [{ id: "r1", from: "B", kind: "cmd", text: "npm run test -- checkout", createdAt: t - 20 * 60e3, example: true }];
  S.log = [
    { id: "l1", slot: "B", type: "claim", text: "src/ui/checkout/** 잠금 (예시)", at: t - 30 * 60e3 },
    { id: "l2", slot: "A", type: "claim", text: "src/api/payments/** 잠금 (예시)", at: t - 60 * 60e3 },
  ];
  S.usage = { start: t - 2.2 * H, hours: 5 };
  S.agents = [
    { id: "ag1", name: "Claude 개인 (예시)", tool: "claude", note: "Max", status: "limited", limitedAt: t - 40 * 60e3, createdAt: t - 5 * H, example: true },
    { id: "ag2", name: "Claude 회사 (예시)", tool: "claude", note: "Team", status: "ok", createdAt: t - 4 * H, example: true },
    { id: "ag3", name: "Codex (예시)", tool: "codex", note: "", status: "ok", createdAt: t - 3 * H, example: true },
  ];
  S.session = { goal: "결제 기능이 있는 쇼핑몰 MVP 배포 (예시)", state: "결제 API 연동 완료, 결제 폼 UI 진행 중", next: "결제 실패 재시도, e2e 테스트", activeAgent: "ag2" };
  S.decisions = [{ id: "d1", text: "결제 금액은 항상 정수 원 단위로 저장 (예시)", at: t - 3 * H, example: true }];
  S.turns = [
    { id: "u2", kind: "switch", summary: "Claude 개인 (예시) → Claude 회사 (예시) 전환", desk: "A", agentId: "ag2", at: t - 40 * 60e3 },
    { id: "u1", kind: "turn", summary: "Stripe 웹훅 핸들러와 서명 검증 추가 (예시)", files: ["src/api/payments/webhook.ts"], next: ["결제 실패 재시도"], desk: "A", agentId: "ag1", at: t - 70 * 60e3 },
  ];
  const W = "src/api/payments/webhook.ts", F = "src/ui/checkout/Form.tsx", Rd = "README.md", Rt = "src/api/payments/retry.ts";
  S.snaps = [
    { id: "gh", at: t - 50 * 60e3, by: "A", base: "main", baseHead: "a1b2c3d4e5", files: [[Rd, "9f8e7d6c5b4a"], [W, "1111aaaa2222"], [F, "3333bbbb4444"]], count: 3, example: true },
    { id: "A", desk: "A", agentId: "ag2", agentName: "Claude 회사 (예시)", at: t - 50 * 60e3, branch: "a/payments-api", head: "c0ffee1234", ahead: 2, behind: 0, dirty: [" M " + Rt], files: [[Rd, "9f8e7d6c5b4a"], [W, "5555cccc6666"], [F, "3333bbbb4444"], [Rt, "7777dddd8888"]], count: 4, example: true },
    { id: "B", desk: "B", agentId: "ag3", agentName: "Codex (예시)", at: t - 3 * H, branch: "b/payments-ui", head: "beef567890", ahead: 0, behind: 3, dirty: [], files: [[Rd, "9f8e7d6c5b4a"], [W, "1111aaaa2222"], [F, "9999eeee0000"]], count: 3, example: true },
  ];
  const ts = x => Math.round((t - x) / 1000);
  S.snaps[0].branches = [["main", "a1b2c3d4e5", ts(5 * H), "Merge pull request #12"], ["a/payments-api", "c0ffee0000", ts(2 * H), "feat: 웹훅 서명 검증"], ["b/payments-ui", "beef567890", ts(3.2 * H), "feat: 결제 폼 레이아웃"]];
  S.snaps[1].branches = [["a/payments-api", "c0ffee1234", "origin/a/payments-api", "[ahead 2]", ts(50 * 60e3), "feat: 결제 재시도"], ["main", "a1b2c3d4e5", "origin/main", "", ts(5 * H), "Merge pull request #12"]];
  S.snaps[2].branches = [["b/payments-ui", "beef567890", "origin/b/payments-ui", "", ts(3.2 * H), "feat: 결제 폼 레이아웃"], ["a/payments-api", "c0ffee0000", "origin/a/payments-api", "[behind 3]", ts(2 * H), "feat: 웹훅 서명 검증"], ["main", "9e9e9e9e9e", "origin/main", "[behind 1]", ts(9 * H), "chore: 초기 설정"]];
  S.streams = [
    { id: "b-a~2fpayments-api", branch: "a/payments-api", title: "결제 API (예시)", holder: "A", holderAgent: "ag2", since: t - 50 * 60e3, next: "결제 실패 재시도 테스트 작성", updatedAt: t - 50 * 60e3, example: true },
    { id: "b-b~2fpayments-ui", branch: "b/payments-ui", title: "결제 화면 (예시)", holder: null, next: "카드 번호 입력 마스킹", lastDesk: "B", updatedAt: t - 3 * H, example: true },
  ];
  S.hops = [
    { id: "h4", branch: "a/payments-api", desk: "A", agentId: "ag2", at: t - 50 * 60e3, kind: "in" },
    { id: "h3", branch: "a/payments-api", desk: "B", agentId: "ag3", at: t - 60 * 60e3, kind: "out", note: "웹훅 서명 검증 추가, 테스트 통과", next: "결제 실패 재시도 테스트 작성", pushed: true },
    { id: "h2", branch: "a/payments-api", desk: "B", agentId: "ag3", at: t - 2.5 * H, kind: "in" },
    { id: "h1", branch: "a/payments-api", desk: "A", agentId: "ag1", at: t - 2.8 * H, kind: "out", note: "웹훅 핸들러 뼈대 작성", next: "서명 검증", pushed: true },
    { id: "h0", branch: "a/payments-api", desk: "A", agentId: "ag1", at: t - 5 * H, kind: "in" },
    { id: "h5", branch: "b/payments-ui", desk: "B", agentId: "ag3", at: t - 3 * H, kind: "out", note: "결제 폼 레이아웃 완료", next: "카드 번호 입력 마스킹", pushed: true },
  ];
  S.snaplog = [
    { id: "sl2", desk: "A", agentId: "ag2", at: t - 50 * 60e3, branch: "a/payments-api", head: "c0ffee1234", added: [Rt], changed: [W], removed: [], n: { a: 1, c: 1, r: 0 } },
    { id: "sl1", desk: "B", agentId: "ag3", at: t - 3 * H, branch: "b/payments-ui", head: "beef567890", added: [], changed: [F], removed: [], n: { a: 0, c: 1, r: 0 } },
  ];
  S.files = [{ id: "f1", path: "src/api/payments/webhook.ts", content: "// 예시 파일\nexport async function handleWebhook(req) {\n  // TODO: 서명 검증\n}\n", updatedAt: t - 70 * 60e3, by: "A", example: true }];
}
