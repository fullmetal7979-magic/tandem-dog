import { readFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { containsSecret } from '../galaxy/secrets.mjs';
import { runGit, repoRoot } from '../shared/git-process.mjs';
import { writeJsonAtomicAsync } from '../shared/atomic-file.mjs';
import { resolvePluginData } from '../shared/plugin-paths.mjs';
import { workbenchRoot, normalizeRoot } from './project-policy.mjs';

const idOf=value=>{if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))throw new TypeError('복원 지점 ID가 올바르지 않습니다.');return value;};
const rootKey=root=>createHash('sha256').update(normalizeRoot(root)).digest('hex').slice(0,24);
const directory=root=>join(workbenchRoot(),'snapshots',rootKey(root));
const secretPath=path=>/(^|\/)(\.git|node_modules|\.env(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx))($|\/)/i.test(path);
async function git(root,args,opts){const result=await runGit(root,args,opts);if(result.code)throw new Error(result.stderr.trim()||`Git ${args[0]} 실패`);return result.stdout;}
function summary(doc){const {conversation,...rest}=doc;return {...rest,hasConversation:doc.hasConversation??Boolean(conversation?.messages?.length),messageCount:doc.messageCount??conversation?.messages?.length??0};}
export async function readWorkbenchSnapshot(root,id,{withConversation=false}={}){
  const doc=JSON.parse(await readFile(join(directory(root),`${idOf(id)}.json`),'utf8'));
  if(normalizeRoot(doc.root)!==normalizeRoot(root)||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(doc.commit))throw new Error('복원 지점이 이 프로젝트와 일치하지 않습니다.');
  if(withConversation&&doc.hasConversation)doc.conversation=JSON.parse(await readFile(join(directory(root),`${idOf(id)}.conversation.json`),'utf8'));
  return doc;
}
export async function listWorkbenchSnapshots(root){
  const {readdir}=await import('node:fs/promises');
  let names;try{names=await readdir(directory(root));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const docs=await Promise.all(names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(async name=>{try{return summary(await readWorkbenchSnapshot(root,name.slice(0,-5)));}catch{return null;}}));
  return docs.filter(Boolean).sort((a,b)=>b.at-a.at);
}
export async function createWorkbenchSnapshot(cwd,{label='',sessionId='',validation=[]}={}){
  const root=await repoRoot(cwd), id=randomUUID(),folder=directory(root);
  if((await listWorkbenchSnapshots(root)).length>=20)throw new Error('복원 지점은 프로젝트당 20개까지 보관합니다. 사용하지 않는 지점을 삭제하세요.');
  await mkdir(folder,{recursive:true,mode:0o700});
  const index=join(folder,`${id}.index`), env={GIT_INDEX_FILE:index};
  const head=await runGit(root,['rev-parse','--verify','HEAD']);const base=head.code?null:head.stdout.trim();
  try{
    await git(root,base?['read-tree',base]:['read-tree','--empty'],{env});
    const changed=base?await git(root,['diff','--name-only','-z',base,'--']):await git(root,['ls-files','-c','-z']);
    const untracked=await git(root,['ls-files','--others','--exclude-standard','-z']);
    const candidates=[...new Set((changed+untracked).split('\0').filter(Boolean))];
    if(candidates.length>1000)throw new Error('변경 파일이 1,000개를 넘습니다. 생성 파일을 .gitignore에 추가한 뒤 다시 시도하세요.');
    const paths=[],skipped=[];let bytes=0;
    for(const path of candidates){
      if(secretPath(path)){skipped.push(path);continue;}
      try{const size=(await stat(join(root,path))).size;bytes+=size;if(size>20_000_000||bytes>100_000_000)throw new Error('복원 지점의 변경 파일은 개별 20MB·합계 100MB 이내여야 합니다.');}catch(error){if(error.code!=='ENOENT')throw error;}
      try{const bytes=await readFile(join(root,path));if(!bytes.includes(0)&&containsSecret(bytes.toString('utf8'))){skipped.push(path);continue;}}catch(error){if(error.code!=='ENOENT')throw error;}
      paths.push(path);
    }
    if(paths.length)await git(root,['--literal-pathspecs','add','-A','--pathspec-from-file=-','--pathspec-file-nul'],{env,input:paths.join('\0')+'\0'});
    const tree=(await git(root,['write-tree'],{env})).trim();
    const commit=(await git(root,['commit-tree',tree,...(base?['-p',base]:[])],{input:`COSMOS local recovery: ${String(label).slice(0,100)}\n`,env:{GIT_AUTHOR_NAME:'COSMOS',GIT_AUTHOR_EMAIL:'snapshot@localhost',GIT_COMMITTER_NAME:'COSMOS',GIT_COMMITTER_EMAIL:'snapshot@localhost'}})).trim();
    const reference=`refs/cosmos/checkpoints/${id}`;await git(root,['update-ref',reference,commit]);
    let conversation=null;
    if(sessionId){
      if(!/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))throw new TypeError('세션 ID가 올바르지 않습니다.');
      // The canonical store is <data>/sessions/<id>.json. Keep this reader
      // independent of the session writer and provider/keychain configuration.
      const file=join(resolvePluginData(),'sessions',`${sessionId}.json`);if((await stat(file)).size>32_000_000)throw new Error('대화가 32MB를 넘습니다. 새 작업에서 복원 지점을 만들어 주세요.');
      const session=JSON.parse(await readFile(file,'utf8'));
      if(session.cwd && normalizeRoot(session.cwd)!==normalizeRoot(root) && !normalizeRoot(session.cwd).startsWith(normalizeRoot(root)+'/'))throw new Error('다른 프로젝트의 대화는 이 복원 지점에 넣을 수 없습니다.');
      conversation={v:1,id:session.id,taskId:session.cosmosTaskId||session.inheritedFromSessionId||session.id,provider:session.provider,model:session.model,title:session.title||label,messages:(session.messages||[]).filter(m=>m.role!=='system'),exportedAt:Date.now()};
    }
    const doc={version:1,id,root,at:Date.now(),label:String(label||'작업 복원 지점').slice(0,120),base,tree,commit,reference,paths,skipped,validation,hasConversation:Boolean(conversation?.messages?.length),messageCount:conversation?.messages?.length||0};
    if(doc.hasConversation)await writeJsonAtomicAsync(join(folder,`${id}.conversation.json`),conversation,{secret:true});
    try{await writeJsonAtomicAsync(join(folder,`${id}.json`),doc,{secret:true});}catch(error){await runGit(root,['update-ref','-d',reference]);throw error;}
    return summary(doc);
  }catch(error){await runGit(root,['update-ref','-d',`refs/cosmos/checkpoints/${id}`]);await rm(join(folder,`${id}.conversation.json`),{force:true});throw error;}finally{await rm(index,{force:true});await rm(`${index}.lock`,{force:true});}
}
export async function previewWorkbenchSnapshot(root,id){
  const doc=await readWorkbenchSnapshot(root,id);
  const revision=(await git(root,['rev-parse','HEAD'])).trim();
  const files=await git(root,['diff','--name-status',doc.commit,'--']);
  const diff=await git(root,['diff','--no-ext-diff','--no-color','--stat',doc.commit,'--']);
  return {snapshot:summary(doc),currentRevision:revision,files:files.slice(0,100000),diff:diff.slice(0,100000),strategy:'new-worktree'};
}
export async function restoreWorkbenchSnapshot(root,id){
  const doc=await readWorkbenchSnapshot(root,id,{withConversation:true});
  const restoredPath=join(workbenchRoot(),'recovered',`${rootKey(root)}-${id.slice(0,8)}-${Date.now()}`);
  await mkdir(resolve(restoredPath,'..'),{recursive:true,mode:0o700});
  await git(root,['worktree','add','--detach',restoredPath,doc.commit]);
  return {path:restoredPath,snapshot:summary(doc),conversation:doc.conversation};
}
export async function deleteWorkbenchSnapshot(root,id){
  const doc=await readWorkbenchSnapshot(root,id);
  await git(root,['update-ref','-d',doc.reference]);
  await rm(join(directory(root),`${idOf(id)}.conversation.json`),{force:true});
  await rm(join(directory(root),`${idOf(id)}.json`));return true;
}
