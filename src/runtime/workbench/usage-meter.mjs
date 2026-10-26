import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { workbenchRoot, normalizeRoot, readWorkbenchPolicy, projectPolicy } from './project-policy.mjs';
import { measuredBudgetTokens } from '../shared/execution-budget.mjs';
import { isInclusiveProvider, priceUsage } from '../shared/llm/cost.mjs';

const databases = new Map();
const meterFailures=new WeakSet();
function database() {
  const root=workbenchRoot(); let db=databases.get(root);
  if(db) return db;
  mkdirSync(root,{recursive:true,mode:0o700});
  db=new DatabaseSync(join(root,'usage.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2500;
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,at INTEGER NOT NULL,root TEXT NOT NULL,session TEXT NOT NULL,provider TEXT,model TEXT,status TEXT NOT NULL,tokens REAL DEFAULT 0,cost REAL,input REAL DEFAULT 0,output REAL DEFAULT 0,cached REAL DEFAULT 0,measured INTEGER DEFAULT 0,ownerPid INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS calls_time ON calls(at); CREATE INDEX IF NOT EXISTS calls_project ON calls(root,at); CREATE INDEX IF NOT EXISTS calls_session ON calls(session,at);`);
  if(!db.prepare('PRAGMA table_info(calls)').all().some(row=>row.name==='measured'))db.exec('ALTER TABLE calls ADD COLUMN measured INTEGER DEFAULT 0');
  if(!db.prepare('PRAGMA table_info(calls)').all().some(row=>row.name==='ownerPid'))db.exec('ALTER TABLE calls ADD COLUMN ownerPid INTEGER DEFAULT 0');
  databases.set(root,db);return db;
}
function reconcileAbandoned(db) {
  const pending=db.prepare("SELECT id,ownerPid FROM calls WHERE status='pending'").all();
  const dead=new Set();
  for(const row of pending){if(dead.has(row.ownerPid))continue;try{if(row.ownerPid>0)process.kill(row.ownerPid,0);else dead.add(row.ownerPid);}catch(error){if(error.code==='ESRCH')dead.add(row.ownerPid);}}
  for(const pid of dead)db.prepare("UPDATE calls SET status='unknown' WHERE status='pending' AND ownerPid=?").run(pid);
}
const dayStart=(at=Date.now())=>{const d=new Date(at);d.setHours(0,0,0,0);return d.getTime();};
function totals(db,root='',from=0) {
  const rows=db.prepare(`SELECT COUNT(*) AS requests,COALESCE(SUM(tokens),0) AS tokens,COALESCE(SUM(cost),0) AS costUsd,
    COALESCE(SUM(input),0) AS input,COALESCE(SUM(output),0) AS output,COALESCE(SUM(cached),0) AS cached,
    COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='unknown'),0) AS unknown,
    COALESCE(SUM(status='unknown' AND measured=0),0) AS unmeasured,COALESCE(SUM(status='unknown' AND cost IS NULL),0) AS unpriced,MIN(at) AS since FROM calls
    WHERE at>=? AND (?='' OR root=? OR substr(root,1,length(?)+1)=?||'/')`).get(from,root,root,root,root);
  return {...rows,costUsd:Number(rows.costUsd),tokens:Number(rows.tokens),requests:Number(rows.requests)};
}
function check(limit,usage,label,route) {
  if(!limit || !Object.keys(limit).length)return;
  if(limit.maxRequests && usage.requests>=limit.maxRequests)throw new Error(`${label}: 모델 요청 횟수 한도에 도달했습니다. 작업 도구 → 사용량에서 조정하세요.`);
  if(limit.maxTokens && usage.tokens>=limit.maxTokens)throw new Error(`${label}: 토큰 한도에 도달했습니다. 작업 도구 → 사용량에서 조정하세요.`);
  if(limit.maxCostUsd && usage.costUsd>=limit.maxCostUsd)throw new Error(`${label}: 예상 비용 한도에 도달했습니다. 작업 도구 → 사용량에서 조정하세요.`);
  if((limit.maxTokens && usage.unmeasured>0) || (limit.maxCostUsd && (usage.unpriced>0||usage.unmeasured>0)))throw new Error(`${label}: 사용량이 확인되지 않은 요청이 있어 추가 요청을 멈췄습니다. 작업 도구 → 사용량을 확인하세요.`);
  if(limit.maxCostUsd && route.provider!=='mixdog-local' && priceUsage({...route,inputTokens:1,outputTokens:1}).costUsd==null)throw new Error(`${label}: 이 모델의 가격을 알 수 없어 USD 한도가 있는 요청을 시작하지 않습니다.`);
}
/** The transaction reserves request slots across CLI, desktop and child agents.
 * Tokens/USD settle after each call; concurrent in-flight calls may overshoot. */
export function admitWorkbenchRequest({cwd='',sessionId='',ownerSessionId='',provider='',model='',fast=false,modelParameters={}}) {
  const policy=readWorkbenchPolicy(),db=database();reconcileAbandoned(db);
  const owner=ownerSessionId?db.prepare('SELECT root FROM calls WHERE session=? ORDER BY at DESC LIMIT 1').get(String(ownerSessionId)):null;
  const accountedRoot=owner?.root||normalizeRoot(cwd),project=projectPolicy(policy,accountedRoot);
  if(meterFailures.has(db)&&(Object.keys(policy.daily||{}).length||Object.keys(project.limits||{}).length))throw new Error('사용량 기록을 완료하지 못해 추가 요청을 멈췄습니다. 작업 도구 → 사용량을 확인하세요.');
  const route={provider,model,requestServiceTier:fast?(provider.startsWith('anthropic')?'fast':modelParameters.serviceTier||'priority'):''};
  db.exec('BEGIN IMMEDIATE');
  try {
    check(policy.daily,totals(db,'',dayStart()),'오늘 전체 한도',route);
    check(project.limits,totals(db,project.root),'프로젝트 한도',route);
    const id=randomUUID();
    db.prepare('INSERT INTO calls(id,at,root,session,provider,model,status,ownerPid) VALUES(?,?,?,?,?,?,?,?)').run(id,Date.now(),accountedRoot,String(sessionId||''),provider,model,'pending',process.pid);
    db.exec('COMMIT');return {id,db,route};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function settleWorkbenchRequest(ticket,usage,{failed=false,exposed=false}={}) {
  if(!ticket)return;
  const u=usage||{};
  const measured=['inputTokens','promptTokens','outputTokens','cachedTokens','cacheWriteTokens'].some(key=>typeof u[key]==='number'&&Number.isFinite(u[key])&&u[key]>=0);
  const tokens=measuredBudgetTokens(usage,isInclusiveProvider(ticket.route.provider))||0;
  const priced=priceUsage({...ticket.route,inputTokens:u.inputTokens||u.promptTokens||0,outputTokens:u.outputTokens||0,
    cacheReadTokens:u.cachedTokens||0,cacheWriteTokens:u.cacheWriteTokens||0,cacheWrite1hTokens:u.cacheWrite1hTokens||0});
  const reported=typeof u.costUsd==='number'&&Number.isFinite(u.costUsd)?u.costUsd:null;
  const cost=ticket.route.provider==='mixdog-local'?0:reported??priced.costUsd;
  const unknown=(!measured || cost==null) && (!failed||exposed||!!usage);
  try { ticket.db.prepare('UPDATE calls SET status=?,tokens=?,cost=?,input=?,output=?,cached=?,measured=? WHERE id=?').run(
    unknown?'unknown':failed?'failed':'complete',tokens,cost,Number(u.inputTokens??u.promptTokens)||0,Number(u.outputTokens)||0,Number(u.cachedTokens)||0,measured?1:0,ticket.id);return true;
  }catch(error){meterFailures.add(ticket.db);console.warn('COSMOS 사용량 기록을 완료하지 못했습니다. 다음 한도 검사에서 중지합니다.');return false;}
}
export function readWorkbenchUsage(cwd='') {
  const db=database();reconcileAbandoned(db);const root=normalizeRoot(cwd);
  return {daily:totals(db,'',dayStart()),project:totals(db,root),scope:root,meterWarning:meterFailures.has(db),
    recent:db.prepare('SELECT at,provider,model,status,tokens,cost FROM calls WHERE (?=\'\' OR root=? OR substr(root,1,length(?)+1)=?||\'/\') ORDER BY at DESC LIMIT 30').all(root,root,root,root)};
}
export function closeWorkbenchMeters(){for(const db of databases.values())db.close();databases.clear();}

/** Explicit acknowledgement only changes unknown records, preserving measured
 * amounts and request counts. It never silently zeroes known spend. */
export function acknowledgeWorkbenchUsage(cwd='') {
  const db=database(),root=normalizeRoot(cwd);meterFailures.delete(db);
  return db.prepare("UPDATE calls SET status='acknowledged' WHERE status='unknown' AND (?='' OR root=? OR substr(root,1,length(?)+1)=?||'/')").run(root,root,root,root).changes;
}
