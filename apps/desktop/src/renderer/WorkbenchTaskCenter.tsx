import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Check, ClipboardCheck, FileText, Gauge, History, LifeBuoy, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { PaneDialogLayer, containDialogTab } from './sidebar-dialog';
import { ErrorNotice } from './ErrorNotice';
import type { WorkbenchRequest, WorkbenchResult } from '../shared/contract-workbench';
import type { ComposerAttachment } from './composer-support';
import { listComposerDrafts, deleteComposerDraft, readComposerDraft, type ComposerDraftSummary, type SavedComposerDraft } from './composer-draft-store';
import type { ContextInspection } from './ContextInspector';
const ContextInspector=lazy(()=>import('./ContextInspector').then(module=>({default:module.ContextInspector})));
import { draftTokenBudget } from './draft-token-budget';
import { useSessionLane } from './session-lane-store';
import { DEFAULT_ACTIVITY_RAIL_PINS } from '../shared/activity-rail-pins';
import { record } from './record-utils';
import { taskEvidence, buildHandoffCard } from './workbench-task-evidence';
import './desktop/workbench-task-center.css';

type Row = Record<string, unknown>;
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(record):[];
const number=(value:unknown)=>Math.max(0,Number(value)||0);
const tokens=(value:unknown)=>Math.round(number(value)).toLocaleString();
const money=(value:unknown)=>typeof value==='number'?new Intl.NumberFormat('ko-KR',{style:'currency',currency:'USD',maximumSignificantDigits:3}).format(value):'확인 불가';
const TABS=[['context','보내기 전',FileText],['recovery','복원',History],['usage','사용량',Gauge],['handoff','인계·검증',ClipboardCheck],['diagnostics','연결',LifeBuoy]] as const;
type Tab=typeof TABS[number][0];
type Policy=NonNullable<WorkbenchRequest['policy']>;
function limitPercent(usage:Row,limit:Row){return Math.min(100,Math.max(0,...(['maxTokens','maxCostUsd','maxRequests'] as const).map((key,index)=>number(limit[key])?number(usage[['tokens','costUsd','requests'][index]])/number(limit[key])*100:0)));}
const blankPolicy:Policy={dailyLimit:{},projectLimit:{},context:{include:[],exclude:[],instructions:''}};

export default function WorkbenchTaskCenter({anchor,projectPath,sessionId,scope,draft,attachments,provider,model,turnBusy,onClose,onRestoreDraft,onRemoveAttachment,onResumeSession,onOpenProjects,onOpenSettings}: {
  anchor:RefObject<HTMLElement|null>;projectPath:string;sessionId:string;scope:string;draft:string;attachments:ComposerAttachment[];provider:string;model:string;turnBusy:boolean;
  onClose():void;onRestoreDraft(value:SavedComposerDraft):Promise<void>;onRemoveAttachment(id:number):void;onResumeSession(id:string):void;onOpenProjects():void;onOpenSettings(section?:'providers'|'connection'|'cosmos'|'git'):void;
}) {
  const [tab,setTab]=useState<Tab>('context'),[data,setData]=useState<WorkbenchResult|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [policy,setPolicy]=useState<Policy>(blankPolicy),[drafts,setDrafts]=useState<ComposerDraftSummary[]>([]),[inspection,setInspection]=useState<ContextInspection|null>(null),[inspectOpen,setInspectOpen]=useState(false);
  const [snapshotLabel,setSnapshotLabel]=useState(''),[preview,setPreview]=useState<Row|null>(null),[claimOwner,setClaimOwner]=useState('Codex'),[claimPaths,setClaimPaths]=useState(''),[claimNote,setClaimNote]=useState('');
  const [goal,setGoal]=useState(''),[note,setNote]=useState(''),[diagnostics,setDiagnostics]=useState<Array<{label:string;status:string;ok:boolean}>>([]);
  const [connectionSteps,setConnectionSteps]=useState<boolean[]>([]);
  const [effects,setEffects]=useState(()=>localStorage.getItem('cosmos.effects.v1')!=='off');
  const dialog=useRef<HTMLElement>(null),alive=useRef(true),titleId=useId(),panelId=useId(),requestId=useRef(0);
  const snapshot=useSessionLane(sessionId),items=snapshot?.items||[];
  const evidence=taskEvidence(items);
  const draftBudget=draftTokenBudget(draft,attachments);
  const api=window.mixdogDesktop;
  useEffect(()=>{alive.current=true;const previous=document.activeElement as HTMLElement|null;dialog.current?.querySelector<HTMLElement>('[role=tab]')?.focus();return()=>{alive.current=false;if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus();};},[]);
  const run=useCallback(async(request:Omit<WorkbenchRequest,'projectPath'>,success='')=>{
    if(!api.workbench){setError('작업 도구를 사용할 수 있는 데스크톱 연결이 필요합니다.');return null;}
    const id=++requestId.current;setBusy(request.action);setError('');setNotice('');
    try {const result=await api.workbench({...request,projectPath:projectPath||undefined});
      if(!alive.current||id!==requestId.current)return null;
      setData(result);if(success)setNotice(success);return result;
    }catch(error){if(alive.current&&id===requestId.current)setError(error instanceof Error?error.message:String(error));return null;}
    finally{if(alive.current&&id===requestId.current)setBusy('');}
  },[api,projectPath]);
  useEffect(()=>{void run({action:'read'}).then(result=>{if(result&&alive.current)setPolicy(result.policy as Policy);});},[run]);
  useEffect(()=>{if(tab!=='recovery')return;let live=true;void listComposerDrafts().then(value=>{if(live)setDrafts(value);},error=>{if(live)setError(error.message);});return()=>{live=false;};},[tab]);
  useEffect(()=>{if(tab!=='context'||!sessionId||!inspectOpen)return;let live=true;void api.invokeCapability({capability:'contextStatus',args:[{inspect:true}],sessionId})
    .then(result=>{if(live)setInspection((record(result.value).inspection as ContextInspection)||null);}).catch(()=>{});return()=>{live=false;};},[api,tab,sessionId,inspectOpen]);
  useEffect(()=>{
    if(tab!=='usage'||!api.workbench)return;
    let live=true;
    const refresh=()=>{if(document.visibilityState==='hidden')return;void api.workbench!({action:'usage',projectPath:projectPath||undefined}).then(result=>{if(live)setData(current=>current?{...current,usage:result.usage}:result);}).catch(()=>{});};
    refresh();const timer=window.setInterval(refresh,5000);
    return()=>{live=false;window.clearInterval(timer);};
  },[api,tab,projectPath,turnBusy]);
  const limitsValid=[policy.dailyLimit,policy.projectLimit].every(limit=>Object.entries(limit).every(([key,value])=>value==null||(Number.isFinite(value)&&value>0&&(key==='maxCostUsd'||Number.isSafeInteger(value)))));
  const savePolicy=()=>void run({action:'save-policy',policy},'설정을 저장했습니다. 다음 요청부터 적용합니다.');
  const contextRules=(patch:Partial<Policy['context']>)=>setPolicy(current=>({...current,context:{...current.context,...patch}}));
  const usage=record(data?.usage),daily=record(usage.daily),projectUsage=record(usage.project),context=record(data?.context);
  const handoff=buildHandoffCard({goal,note,changes:String(data?.changes||''),evidence,provider,model,project:projectPath});
  const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);setNotice('클립보드에 복사했습니다.');}catch{setError('복사하지 못했습니다. 미리보기에서 텍스트를 선택해 복사해 주세요.');}};
  const diagnose=async()=>{
    setBusy('diagnostics');setError('');const result:Array<{label:string;status:string;ok:boolean}>=[];
    const timed=<T,>(value:Promise<T>|undefined)=>Promise.race([value,new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error('상태 확인 시간 초과')),6000))]);
    const probes=await Promise.allSettled([timed(api.gitCliStatus?.()),timed(api.githubCliStatus?.()),timed(api.invokeCapability({capability:'getProviderSetup'})),timed(api.cosmosOverview?.(projectPath||null,{fetch:false})),timed(api.getRemoteAccessInfo?.())]);
    const git=probes[0].status==='fulfilled'?record(probes[0].value):{},gh=probes[1].status==='fulfilled'?record(probes[1].value):{};
    const setup=probes[2].status==='fulfilled'?record(record(probes[2].value).value):{};
    const connected=[...rows(setup.api),...rows(setup.oauth),...rows(setup.local)].filter(row=>row.authenticated===true||row.usable===true||(row.enabled===true&&row.detected===true));
    const galaxy=probes[3].status==='fulfilled'?record(probes[3].value):{},remote=probes[4].status==='fulfilled'?record(probes[4].value):{};
    result.push({label:'Git',ok:git.available===true||!!git.version,status:git.available===true||git.version?'사용 가능':'설치·경로 확인 필요'},
      {label:'GitHub',ok:gh.authenticated===true,status:gh.authenticated===true?'로그인됨':'로그인이 필요합니다'},
      {label:'AI 계정',ok:connected.length>0,status:connected.length?`${connected.length}개 연결됨`:'사용 가능한 계정을 연결해 주세요'},
      {label:'은하수 동기화',ok:galaxy.ready===true&&!galaxy.offline,status:galaxy.offline?'연결 확인 필요':galaxy.ready===true?'연결됨':'저장소 연결 전'},
      {label:'폰·릴레이',ok:remote.enabled===true||remote.connected===true,status:Object.keys(remote).length?'연결 설정 사용 가능':'연결 설정에서 확인하세요'});
    if(alive.current){setDiagnostics(result);setConnectionSteps([gh.authenticated===true,galaxy.ready===true,number(galaxy.syncedAt)>0&&!galaxy.offline,Array.isArray(galaxy.stars)&&galaxy.stars.length>1]);setBusy('');setNotice('로그인·연결 상태만 확인했습니다. AI 요청은 보내지 않았습니다.');}
  };
  const blocking=!!busy&&!['read','usage','diagnostics','preview-snapshot'].includes(busy);
  const changeTab=(next:Tab)=>{setTab(next);setError('');setNotice('');};
  return <PaneDialogLayer anchor={anchor} onClose={()=>{if(!blocking)onClose();}}>
    <section ref={dialog} className="workbench-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={containDialogTab}>
      <header className="workbench-heading"><div><span className="workbench-eyebrow">COSMOS</span><h2 id={titleId}>작업 도구</h2><p>{projectPath?projectPath.split(/[\\/]/).at(-1):'폴더 없는 작업'} · {model||'모델 선택 전'}</p></div>
        <div className="workbench-heading-actions"><button type="button" disabled={!!busy} aria-label="작업 도구 새로고침" onClick={()=>void run({action:'read'})}><RefreshCw size={16}/></button><button type="button" disabled={blocking} aria-label="작업 도구 닫기" onClick={onClose}><X size={18}/></button></div></header>
      <nav className="workbench-tabs" role="tablist" aria-label="작업 도구 메뉴" onKeyDown={event=>{
        const index=TABS.findIndex(row=>row[0]===tab);let next=index;
        if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(index+1)%TABS.length;
        else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(index+TABS.length-1)%TABS.length;
        else if(event.key==='Home')next=0;else if(event.key==='End')next=TABS.length-1;else return;
        event.preventDefault();changeTab(TABS[next][0]);event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next].focus();
      }}>{TABS.map(([key,label,Icon])=><button key={key} id={`${panelId}-${key}`} type="button" role="tab" aria-selected={tab===key} aria-controls={`${panelId}-body`} tabIndex={tab===key?0:-1} onClick={()=>changeTab(key)}><Icon size={16}/>{label}</button>)}</nav>
      <div className="workbench-panel" id={`${panelId}-body`} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} aria-busy={!!busy}>
        {error&&<ErrorNotice error={error}/>} {notice&&<output className="workbench-notice" role="status"><Check size={15}/>{notice}</output>}
        {!data&&<div className="workbench-loading" role="status"><LoaderCircle size={20}/>작업 상태를 불러오는 중…</div>}
        {tab==='context'&&<>
          <section className="workbench-card workbench-card--hero"><h3>다음 요청에 보낼 내용</h3><p>초안 약 <b>{tokens(draftBudget.tokens)}토큰</b> · 자동 참조 약 <b>{tokens(context.tokens)}토큰</b></p><small>저장된 대화·도구는 아래 검사에서 확인합니다. 이미지·문서 토큰과 공급자의 동적 처리량은 전송 후 달라질 수 있습니다.</small></section>
          <details className="workbench-card"><summary>현재 메시지 미리보기</summary><pre>{draft||'아직 입력한 메시지가 없습니다.'}</pre></details>
          {attachments.length>0&&<section className="workbench-card"><h3>현재 초안의 첨부파일</h3>{attachments.map(file=><div key={file.id} className="workbench-list-row"><div><b>{file.name}</b><small>{file.kind==='text'?`${tokens(file.data.length)}자`:'처리 후 토큰 계산'}</small></div><button type="button" disabled={turnBusy} onClick={()=>onRemoveAttachment(file.id)}>초안에서 제외</button></div>)}</section>}
          <details className="workbench-card"><summary>프로젝트 자동 참조 규칙</summary><p>이 기기의 프로젝트에 적용합니다. 제외 규칙은 자동 참조에 적용되며 기존 대화나 사용자가 요청한 도구 접근 권한을 바꾸지 않습니다.</p>
            <label>항상 포함할 파일 <small>상대 경로, 한 줄에 하나·최대 12개</small><textarea rows={3} value={policy.context.include.join('\n')} onChange={e=>contextRules({include:e.target.value.split('\n')})} placeholder={'AGENTS.md\ndocs/architecture.md'}/></label>
            <label>자동 참조에서 제외할 경로<textarea rows={2} value={policy.context.exclude.join('\n')} onChange={e=>contextRules({exclude:e.target.value.split('\n')})} placeholder={'logs/**\ndist/**'}/></label>
            <label>프로젝트 지침<textarea rows={4} maxLength={12000} value={policy.context.instructions} onChange={e=>contextRules({instructions:e.target.value})} placeholder="예: 변경 후 관련 테스트를 실행하고 결과를 남겨 주세요."/></label>
            <button type="button" className="is-primary" disabled={!!busy||!data||!limitsValid||!projectPath} onClick={savePolicy}>규칙 저장</button>
            {rows(context.files).map(file=><p key={String(file.path)}><code>{String(file.path)}</code> · {file.status==='included'?`${tokens(file.tokens)}토큰`:file.status==='excluded'?'제외됨':file.status==='too-large'?'크기 제한':file.status==='binary'?'바이너리 자동 참조 제외':file.status==='secret'?'비밀값 자동 참조 제외':'파일 확인 필요'}</p>)}
          </details>
          {sessionId&&<details className="workbench-card" onToggle={event=>setInspectOpen(event.currentTarget.open)}><summary>저장된 대화·지침·도구 검사</summary>{inspectOpen&&(inspection?<Suspense fallback={<p>검사 화면을 준비하는 중…</p>}><ContextInspector inspection={inspection} windowTokens={number(record(snapshot).contextWindow)} request={async(capability,args)=>(await api.invokeCapability({capability,args,sessionId})).value}/></Suspense>:<p>대화·도구 구성을 확인하는 중…</p>)}</details>}
        </>}
        {tab==='recovery'&&<>
          <section className="workbench-card"><h3>입력 초안 복구</h3><p>최근 20개·7일 동안 이 기기에 보관합니다. 다른 초안으로 바꾸면 현재 입력도 복구 목록에 보관합니다.</p>
            {drafts.length===0?<p className="workbench-empty">복구할 초안이 없습니다.</p>:drafts.map(saved=><div key={saved.scope} className="workbench-list-row"><div><b>{saved.preview||'첨부파일 초안'}</b><small>{new Date(saved.updatedAt).toLocaleString('ko-KR')} · 첨부 {saved.attachmentCount}개 · 약 {tokens(saved.chars*2)}바이트{saved.scope===scope?' · 현재 초안':''}</small></div><div className="workbench-row-actions"><button type="button" disabled={turnBusy||!!busy} onClick={()=>{void readComposerDraft(saved.scope).then(async value=>{if(value){await onRestoreDraft(value);setDrafts(await listComposerDrafts());setNotice('초안을 복원했습니다. 메시지는 전송하지 않았습니다.');}}).catch(error=>setError(error.message));}}>초안 복원</button><button type="button" disabled={saved.scope===scope} onClick={()=>{void deleteComposerDraft(saved.scope).then(()=>listComposerDrafts()).then(setDrafts).catch(error=>setError(error.message));}}>삭제</button></div></div>)}
          </section>
          <section className="workbench-card"><h3>코드·대화 복원 지점</h3><p>변경 코드와 현재 대화를 로컬에 보관합니다. 복원할 때 원본을 유지하고 별도 작업 폴더를 만듭니다. 비밀 파일과 큰 파일은 포함하지 않습니다.</p>
            <div className="workbench-inline"><input aria-label="복원 지점 이름" value={snapshotLabel} maxLength={120} onChange={e=>setSnapshotLabel(e.target.value)} placeholder="예: 로그인 수정 전"/><button type="button" className="is-primary" disabled={!!busy||turnBusy||!data?.git} onClick={()=>void run({action:'create-snapshot',sessionId:sessionId||undefined,label:snapshotLabel,validation:evidence.filter(e=>e.status==='passed').map(e=>e.label)},'코드와 대화의 복원 지점을 저장했습니다.')}>복원 지점 만들기</button></div>
            {!data?.git&&<small>Git 프로젝트를 선택하면 사용할 수 있습니다.</small>}{turnBusy&&<small>실행을 마친 뒤 일관된 코드·대화 상태를 저장할 수 있습니다.</small>}
            {rows(data?.snapshots).map(saved=><div key={String(saved.id)} className="workbench-list-row"><div><b>{String(saved.label)}</b><small>{new Date(number(saved.at)).toLocaleString('ko-KR')} · 변경 {rows(saved.paths).length||Number((saved.paths as unknown[])?.length||0)}개 · 대화 {tokens(saved.messageCount)}개</small></div><div className="workbench-row-actions"><button type="button" disabled={!!busy} onClick={()=>{void run({action:'preview-snapshot',id:String(saved.id)}).then(result=>{if(result)setPreview(record(result.preview));});}}>복원 미리보기</button><button type="button" disabled={!!busy} onClick={()=>void run({action:'delete-snapshot',id:String(saved.id)},'복원 지점을 삭제했습니다.')}>삭제</button></div></div>)}
          </section>
          {preview&&<section className="workbench-card workbench-card--hero"><h3>{String(record(preview.snapshot).label)} 복원</h3><p>현재 코드와 원본 대화를 변경하지 않습니다. 저장했던 상태의 새 작업 폴더를 만들고 대화를 이어갑니다.</p><pre>{String(preview.diff||preview.files||'현재 코드와 차이가 없습니다.')}</pre><button type="button" className="is-primary" disabled={!!busy||turnBusy} onClick={()=>{void run({action:'restore-snapshot',id:String(record(preview.snapshot).id)},'별도 작업 폴더에 복원했습니다.').then(result=>{if(result?.restored?.warning){setError(`${result.restored.warning} 복원 폴더: ${result.restored.path}`);return;}if(result?.restored?.sessionId){onResumeSession(result.restored.sessionId);onClose();}else if(result?.restored){onOpenProjects();onClose();}});}}>새 작업 폴더에서 복원</button></section>}
        </>}
        {tab==='usage'&&<>
          <section className="workbench-card workbench-card--hero"><h3>오늘 전체 사용량</h3><div className="workbench-metrics"><span><b>{tokens(daily.tokens)}</b>토큰</span><span><b>{money(daily.costUsd)}</b>예상 가치</span><span><b>{tokens(daily.requests)}</b>모델 요청</span></div>{Object.keys(record(record(data?.policy).dailyLimit)).length>0&&<div className="workbench-budget-track"><span>오늘 한도 사용률</span><progress max={100} value={limitPercent(daily,record(record(data?.policy).dailyLimit))} aria-label="오늘 한도 사용률"/><b>{Math.round(limitPercent(daily,record(record(data?.policy).dailyLimit)))}%</b></div>}<small>새 집계 기능을 사용한 COSMOS 요청 기준입니다. 하위 에이전트·대화 압축을 포함하며 외부 Claude 앱 등의 사용량은 포함하지 않습니다.</small></section>
          <section className="workbench-card"><h3>{projectPath?'프로젝트 누적 사용량':'전체 누적 사용량'}</h3><div className="workbench-metrics"><span><b>{tokens(projectUsage.tokens)}</b>토큰</span><span><b>{money(projectUsage.costUsd)}</b>예상 가치</span></div><small>입력 {tokens(projectUsage.input)} · 출력 {tokens(projectUsage.output)} · 캐시 읽기 {tokens(projectUsage.cached)}{projectUsage.since?` · 집계 시작 ${new Date(number(projectUsage.since)).toLocaleDateString('ko-KR')}`:''}</small></section>
          <section className="workbench-card"><h3>누적 사용 한도</h3><p>한도에 도달하면 다음 모델 요청을 중지합니다. 동시에 진행 중인 요청은 최종 사용량이 한도를 넘을 수 있습니다. 빈 칸은 제한 없음입니다.</p>
            {(['dailyLimit','projectLimit'] as const).map(key=><fieldset key={key} disabled={!!busy||(key==='projectLimit'&&!projectPath)}><legend>{key==='dailyLimit'?'오늘 전체 한도':'이 프로젝트 누적 한도'}</legend><div className="workbench-limit-fields">{([['maxTokens','총 토큰'],['maxCostUsd','예상 USD'],['maxRequests','모델 요청 횟수']] as const).map(([field,label])=><label key={field}>{label}<input type="number" min={field==='maxCostUsd'?'0.000001':'1'} step={field==='maxCostUsd'?'any':'1'} value={policy[key][field]??''} placeholder="제한 없음" onChange={e=>setPolicy(current=>({...current,[key]:{...current[key],[field]:e.target.value?Number(e.target.value):undefined}}))}/></label>)}</div></fieldset>)}
            {!limitsValid&&<p role="alert">한도는 0보다 큰 숫자로 입력하세요. 토큰과 요청 횟수는 정수여야 합니다.</p>}
            <button type="button" className="is-primary" disabled={!!busy||!data||!limitsValid} onClick={savePolicy}>한도 저장</button>
            {(number(daily.unknown)>0||number(projectUsage.unknown)>0||usage.meterWarning===true)&&<div className="workbench-callout"><p>사용량이 확인되지 않은 요청이 있습니다. 금액·토큰 한도가 있으면 추가 요청을 멈춥니다. 실제 사용량을 확인한 뒤 계속할 수 있습니다.</p><button type="button" disabled={!!busy} onClick={()=>void run({action:'acknowledge-usage'},'불명확한 요청을 확인 처리했습니다. 이미 집계된 수치와 요청 횟수는 유지합니다.')}>사용량을 확인했어요</button></div>}
          </section>
        </>}
        {tab==='handoff'&&<>
          <section className="workbench-card"><h3>작업 완료 검증</h3>{evidence.length?evidence.map(row=><div key={row.id} className="workbench-evidence" data-state={row.status}><span>{row.status==='passed'?'✓ 통과':row.status==='failed'?'! 실패':'? 확인 필요'}</span><code>{row.label}</code></div>):<p>실행 결과가 확인된 테스트가 없습니다. 실제 명령의 종료 코드가 있어야 통과로 표시합니다.</p>}<details><summary>변경 파일 확인</summary><pre>{String(data?.changes||'확인된 변경 없음')}</pre></details><small>배포 여부는 별도로 확인해야 합니다. 테스트 통과만으로 배포 완료를 표시하지 않습니다.</small></section>
          <section className="workbench-card"><h3>인계 카드</h3><p>목표·변경 파일·검증·남은 작업을 로컬 기록으로 정리합니다. AI 호출 없이 모델·기기 간 인계에 사용할 수 있습니다.</p><label>작업 목표<input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="무엇을 완성하고 있나요?"/></label><label>남은 작업·주의사항<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label><details><summary>인계 내용 미리보기</summary><pre>{handoff}</pre></details><button type="button" onClick={()=>void copy(handoff)}>인계 카드 복사</button></section>
          <section className="workbench-card"><h3>담당 파일 표시</h3><p>Claude·Codex가 맡은 파일을 직접 표시합니다. 다른 담당자의 경로와 겹치면 알려 줍니다. 강제 파일 잠금은 아니며 표시는 24시간 유지합니다.</p><div className="workbench-inline"><label>담당자<select value={claimOwner} onChange={e=>setClaimOwner(e.target.value)}><option>Codex</option><option>Claude</option><option>직접 작업</option></select></label></div><label>파일 또는 폴더 경로<textarea rows={3} value={claimPaths} onChange={e=>setClaimPaths(e.target.value)} placeholder={'src/chat/\nsrc/model.ts'}/></label><label>작업 메모<input value={claimNote} maxLength={2000} onChange={e=>setClaimNote(e.target.value)}/></label><div className="workbench-row-actions"><button type="button" disabled={!!busy||!projectPath||!claimPaths.trim()} onClick={()=>void run({action:'save-claim',owner:claimOwner,paths:claimPaths.split('\n'),note:claimNote},'담당 파일을 표시했습니다.')}>담당 표시</button><button type="button" disabled={!!busy||!projectPath} onClick={()=>void run({action:'release-claim',owner:claimOwner},'담당 표시를 해제했습니다.')}>해제</button></div>
            {rows(data?.claims).map(claim=><p key={String(claim.owner)}><b>{String(claim.owner)}</b> · {(claim.paths as string[]).join(', ')}<small>{String(claim.note||'')}</small></p>)}{rows(data?.conflicts).map((conflict,index)=><p role="status" className="workbench-callout" key={index}>겹치는 경로: <code>{String(conflict.path)}</code> · {(conflict.owners as string[]).join(' / ')}</p>)}
          </section>
        </>}
        {tab==='diagnostics'&&<>
          <section className="workbench-card workbench-card--hero"><h3>연결 상태 확인</h3><p>AI 계정·GitHub·동기화·폰 연결의 준비 상태를 한곳에서 확인합니다.</p><button type="button" className="is-primary" disabled={!!busy} onClick={()=>void diagnose()}>지금 확인</button>{diagnostics.map(item=><div className="workbench-diagnostic" key={item.label} data-ok={item.ok}><span>{item.ok?'✓':'○'}</span><b>{item.label}</b><small>{item.status}</small></div>)}</section>
          {connectionSteps.length>0&&<section className="workbench-card"><h3>기기 연결 순서</h3><ol className="workbench-journey">{['GitHub 로그인','동기화 저장소 연결','이 기기 동기화 확인','다른 기기에서 연결'].map((label,index)=><li key={label} data-done={connectionSteps[index]}><span aria-hidden="true">{connectionSteps[index]?'✓':index+1}</span><div><b>{label}</b><small>{connectionSteps[index]?'완료':index===3?'다른 기기에서도 같은 은하수에 연결하세요.':'설정에서 이 단계를 완료해 주세요.'}</small></div>{!connectionSteps[index]&&index<3&&<button type="button" onClick={()=>{onOpenSettings(index===0?'git':'cosmos');onClose();}}>설정 열기</button>}</li>)}</ol></section>}
          <section className="workbench-card"><h3>필요한 설정으로 이동</h3><div className="workbench-row-actions"><button type="button" onClick={()=>{onOpenSettings('providers');onClose();}}>AI 계정 연결</button><button type="button" onClick={()=>{onOpenSettings('cosmos');onClose();}}>동기화 설정</button><button type="button" onClick={()=>{onOpenSettings('connection');onClose();}}>폰 연결 설정</button></div></section>
          <section className="workbench-card"><h3>화면 효과</h3><label className="workbench-switch"><input type="checkbox" checked={effects} onChange={e=>{const enabled=e.target.checked;setEffects(enabled);localStorage.setItem('cosmos.effects.v1',enabled?'subtle':'off');document.documentElement.dataset.workbenchEffects=enabled?'subtle':'off';}}/>선택·진행·완료를 알려 주는 부드러운 효과</label><small>운영체제의 동작 줄이기 설정을 우선합니다. 장식용 반복 애니메이션은 기본으로 사용하지 않습니다.</small><button type="button" onClick={()=>{window.dispatchEvent(new CustomEvent('cosmos:open-guide'));onClose();}}>시작 가이드 다시 보기</button><button type="button" onClick={()=>{void api.updateActivityRailPins?.(DEFAULT_ACTIVITY_RAIL_PINS).then(()=>setNotice('대화·프로젝트·변경·실행을 사이드바에 고정했습니다. 다른 기능은 더 보기에서 열 수 있습니다.')).catch(error=>setError(error.message));}}>사이드바 간단히 정리</button></section>
        </>}
      </div>
      <footer className="workbench-footer"><span>{busy?<><LoaderCircle size={13} className="workbench-spinner"/>처리 중…</>:'이 화면을 여는 것만으로 AI 요청이 발생하지 않습니다.'}</span><button type="button" disabled={blocking} onClick={onClose}>완료</button></footer>
    </section>
  </PaneDialogLayer>;
}
