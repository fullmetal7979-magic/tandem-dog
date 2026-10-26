import { isAbsolute } from 'node:path';
import { runGit, repoRoot } from '../../../../src/runtime/shared/git-process.mjs';
import { updateJsonAtomic } from '../../../../src/runtime/shared/atomic-file.mjs';
// @ts-expect-error The shared runtime owns the plain ESM service.
import { readWorkbenchPolicy, saveWorkbenchPolicy, projectPolicy, projectContextPlan, normalizeRoot, policyPath } from '../../../../src/runtime/workbench/project-policy.mjs';
// @ts-expect-error The shared runtime owns durable provider accounting.
import { readWorkbenchUsage, acknowledgeWorkbenchUsage } from '../../../../src/runtime/workbench/usage-meter.mjs';
// @ts-expect-error The shared runtime owns Git checkpoint storage.
import { createWorkbenchSnapshot, listWorkbenchSnapshots, previewWorkbenchSnapshot, restoreWorkbenchSnapshot, deleteWorkbenchSnapshot } from '../../../../src/runtime/workbench/snapshots.mjs';
import type { WorkbenchRequest, WorkbenchResult } from '../shared/contract-workbench';

const ACTIONS = new Set(['read','usage','save-policy','create-snapshot','preview-snapshot','restore-snapshot','delete-snapshot','save-claim','release-claim','acknowledge-usage']);
export function requiredWorkbenchRequest(input: unknown): WorkbenchRequest {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new TypeError('작업 도구 요청이 올바르지 않습니다.');
  const value=input as Record<string,unknown>;
  const keys=new Set(['action','projectPath','sessionId','id','label','owner','paths','note','validation','policy']);
  for(const key of Object.keys(value))if(!keys.has(key))throw new TypeError(`알 수 없는 작업 도구 필드: ${key}`);
  if(!ACTIONS.has(String(value.action)))throw new TypeError('지원하지 않는 작업 도구 동작입니다.');
  for(const key of ['projectPath','sessionId','id','label','owner','note'])if(value[key]!==undefined && (typeof value[key]!=='string'||(value[key] as string).length>(key==='note'?2000:1000)))throw new TypeError(`${key} 값이 올바르지 않습니다.`);
  for(const key of ['paths','validation'])if(value[key]!==undefined && (!Array.isArray(value[key]) || (value[key] as unknown[]).length>100 || !(value[key] as unknown[]).every(x=>typeof x==='string'&&x.length<=500)))throw new TypeError(`${key} 목록이 올바르지 않습니다.`);
  if(value.action==='save-policy'&&(!value.policy||typeof value.policy!=='object'||Array.isArray(value.policy)))throw new TypeError('저장할 사용 한도·컨텍스트 규칙이 필요합니다.');
  if(value.policy && (typeof value.policy!=='object'||Array.isArray(value.policy)))throw new TypeError('사용 한도·컨텍스트 규칙이 올바르지 않습니다.');
  if(value.action==='save-policy') {
    const policy=value.policy as Record<string,unknown>;
    if(Object.keys(policy).some(key=>!['dailyLimit','projectLimit','context'].includes(key)) ||
      !['dailyLimit','projectLimit','context'].every(key=>Object.hasOwn(policy,key)&&policy[key]&&typeof policy[key]==='object'&&!Array.isArray(policy[key])))
      throw new TypeError('전체 사용 한도와 컨텍스트 규칙을 함께 저장해야 합니다.');
  }
  return value as unknown as WorkbenchRequest;
}
const overlap=(a:string,b:string)=>a===b||a.startsWith(`${b.replace(/\/$/,'')}/`)||b.startsWith(`${a.replace(/\/$/,'')}/`);
export async function workbenchOperation(raw: unknown): Promise<WorkbenchResult> {
  const request=requiredWorkbenchRequest(raw);
  let root=request.projectPath?normalizeRoot(request.projectPath):'';
  if(request.action==='usage')return {usage:readWorkbenchUsage(root)};
  let gitRoot='';if(root){try{gitRoot=await repoRoot(root);root=normalizeRoot(gitRoot);}catch{/* Non-Git folders still have rules and budgets. */}}
  if(request.action==='save-policy')await saveWorkbenchPolicy(root,request.policy);
  if(request.action==='acknowledge-usage')acknowledgeWorkbenchUsage(root);
  if(request.action==='save-claim'||request.action==='release-claim'){
    if(!root || !request.owner?.trim())throw new TypeError('프로젝트와 담당자 이름을 선택하세요.');
    const paths=(request.paths||[]).map(path=>path.trim().replace(/\\/g,'/')).filter(Boolean);
    if(paths.some(path=>isAbsolute(path)||path.split('/').includes('..')||path.includes('\0')))throw new TypeError('담당 파일은 프로젝트 안의 상대 경로로 입력하세요.');
    await updateJsonAtomic(policyPath(),(value: Record<string,unknown>|null)=>{
      const current=(value||{}) as {daily?:unknown;projects?:Record<string,Record<string,unknown>>};
      const project=current.projects?.[root]||{};
      const claims=Array.isArray(project.claims)?project.claims as Array<{owner:string;at:number}>:[];
      return {...current,projects:{...current.projects,[root]:{...project,claims:[...claims.filter(claim=>claim.owner!==request.owner&&Date.now()-claim.at<86400000),...(request.action==='save-claim'?[{owner:request.owner,paths,note:request.note||'',at:Date.now()}]:[])]}}};
    },{secret:true});
  }
  let extra:Record<string,unknown>={};
  if(request.action.includes('snapshot')){
    if(!gitRoot)throw new Error('코드 복원 지점은 Git 프로젝트에서 사용할 수 있습니다.');
    if(request.action==='create-snapshot')extra={created:await createWorkbenchSnapshot(root,request)};
    if(request.action==='preview-snapshot')extra={preview:await previewWorkbenchSnapshot(root,request.id)};
    if(request.action==='restore-snapshot')extra={restored:await restoreWorkbenchSnapshot(root,request.id)};
    if(request.action==='delete-snapshot')await deleteWorkbenchSnapshot(root,request.id);
  }
  const policy=readWorkbenchPolicy(), project=projectPolicy(policy,root);
  const plan=root?await projectContextPlan(root,project.context):{root,rules:{include:[],exclude:[],instructions:''},files:[],tokens:0};
  const claims=(project.claims||[]).filter((claim:{at:number})=>Date.now()-claim.at<86400000);
  const conflicts=claims.flatMap((claim:{owner:string;paths:string[]},index:number)=>claims.slice(index+1).flatMap((other:{owner:string;paths:string[]})=>claim.paths.filter(path=>other.paths.some(x=>overlap(x,path))).map(path=>({path,owners:[claim.owner,other.owner]}))));
  const status=gitRoot?await runGit(root,['status','--short','--untracked-files=normal']):null;
  return {root,git:Boolean(gitRoot),policy:{dailyLimit:policy.daily||{},projectLimit:project.limits||{},context:plan.rules},
    context:{...plan,text:undefined,files:plan.files.map((file:Record<string,unknown>)=>({...file,text:undefined}))},usage:readWorkbenchUsage(root),
    claims,conflicts,snapshots:gitRoot?await listWorkbenchSnapshots(root):[],changes:status?.stdout.slice(0,100000)||'',...extra};
}
