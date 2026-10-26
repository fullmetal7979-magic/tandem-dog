import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionPath } from '../agent/orchestrator/session/store/paths-heartbeat.mjs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { saveWorkbenchPolicy, readWorkbenchPolicy, projectContextPlan, applyProjectContext } from './project-policy.mjs';
import { admitWorkbenchRequest, settleWorkbenchRequest, readWorkbenchUsage, closeWorkbenchMeters, acknowledgeWorkbenchUsage } from './usage-meter.mjs';
import { createWorkbenchSnapshot, restoreWorkbenchSnapshot, previewWorkbenchSnapshot, deleteWorkbenchSnapshot } from './snapshots.mjs';
const exec=promisify(execFile);
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'cosmos-workbench-'));const previous=process.env.MIXDOG_DATA_DIR;
  process.env.MIXDOG_DATA_DIR=join(root,'data');await mkdir(process.env.MIXDOG_DATA_DIR,{recursive:true});
  t.after(async()=>{closeWorkbenchMeters();if(previous===undefined)delete process.env.MIXDOG_DATA_DIR;else process.env.MIXDOG_DATA_DIR=previous;await rm(root,{recursive:true,force:true});});
  const project=join(root,'project');await mkdir(project);return {root,project};
}
const policy=(patch={})=>({dailyLimit:{},projectLimit:{},context:{include:[],exclude:[],instructions:''},...patch});

test('project context includes only bounded relative files, excludes secrets and escapes, and keeps a stable prefix',async t=>{
  const {root,project}=await fixture(t);await writeFile(join(project,'README.md'),'Project details');await writeFile(join(project,'.env'),'SECRET=hidden');await writeFile(join(root,'outside'),'private');await symlink(join(root,'outside'),join(project,'link.txt'));
  await saveWorkbenchPolicy(project,policy({context:{include:['README.md','.env','link.txt','missing.md'],exclude:[],instructions:'Run relevant tests'}}));
  const plan=await projectContextPlan(project);
  assert.deepEqual(plan.files.map(x=>x.status),['included','excluded','unavailable','unavailable']);
  assert.ok(plan.text.includes('Project details'));assert.ok(!plan.text.includes('hidden'));assert.ok(!plan.text.includes('private'));
  const state={cwd:project,iterations:0,messages:[{role:'user',content:'Fix it'}]};await applyProjectContext(state);await applyProjectContext(state);
  assert.equal(state.messages.length,2);assert.equal(state.messages.at(-1).content,'Fix it');
  await writeFile(join(project,'README.md'),'Changed project details');await applyProjectContext(state);assert.equal(state.messages.length,2);
  await saveWorkbenchPolicy(project,policy());await applyProjectContext(state);assert.deepEqual(state.messages,[{role:'user',content:'Fix it'}]);
  await assert.rejects(saveWorkbenchPolicy(project,policy({context:{include:['../outside'],exclude:[],instructions:''}})),/상대/);
  assert.equal(Object.keys(readWorkbenchPolicy().projects).length,1);
});
test('project and day limits reserve request slots and include different session owners',async t=>{
  const {project}=await fixture(t);await saveWorkbenchPolicy(project,policy({dailyLimit:{maxRequests:2},projectLimit:{maxTokens:100}}));
  const first=admitWorkbenchRequest({cwd:project,sessionId:'parent',provider:'mixdog-local',model:'local'});
  settleWorkbenchRequest(first,{inputTokens:40,outputTokens:10});
  const child=admitWorkbenchRequest({cwd:project,sessionId:'child',provider:'mixdog-local',model:'local'});
  settleWorkbenchRequest(child,{inputTokens:35,outputTokens:15});
  assert.throws(()=>admitWorkbenchRequest({cwd:project}),/한도/);
  const usage=readWorkbenchUsage(project);assert.equal(usage.daily.requests,2);assert.equal(usage.project.tokens,100);assert.equal(usage.project.costUsd,0);
});
test('unknown usage blocks measured limits until explicitly acknowledged; known amounts remain',async t=>{
  const {project}=await fixture(t);await saveWorkbenchPolicy(project,policy({projectLimit:{maxTokens:100}}));
  const first=admitWorkbenchRequest({cwd:project,provider:'mixdog-local',model:'local'});settleWorkbenchRequest(first,undefined);
  assert.throws(()=>admitWorkbenchRequest({cwd:project}),/확인되지/);
  acknowledgeWorkbenchUsage(project);const next=admitWorkbenchRequest({cwd:project,provider:'mixdog-local',model:'local'});settleWorkbenchRequest(next,{inputTokens:10,outputTokens:5});
  const usage=readWorkbenchUsage(project);assert.equal(usage.project.requests,2);assert.equal(usage.project.tokens,15);assert.equal(usage.project.unknown,0);
});
test('a snapshot preserves the real index, captures modified and untracked files, and restores to a separate worktree',async t=>{
  const {root,project}=await fixture(t);const git=(...args)=>exec('git',args,{cwd:project});
  await git('init','-q');await git('config','user.name','Test');await git('config','user.email','test@localhost');
  await writeFile(join(project,'tracked.txt'),'before\n');await git('add','.');await git('commit','-qm','initial');
  await writeFile(join(project,'tracked.txt'),'staged\n');await git('add','tracked.txt');await writeFile(join(project,'tracked.txt'),'checkpoint\n');
  await writeFile(join(project,'new.txt'),'untracked\n');await writeFile(join(project,'.env'),'SECRET=never-copy');
  await git('add','-N','-f','.env');
  const indexBefore=(await git('diff','--cached')).stdout;
  const conversation={id:'sess_checkpoint',cwd:project,provider:'mixdog-local',model:'local',cosmosTaskId:'original-task',messages:[{role:'user',content:'Frozen instruction'},{role:'assistant',content:'Frozen result'}]};
  await writeFile(sessionPath(conversation.id),JSON.stringify(conversation));
  const checkpoint=await createWorkbenchSnapshot(project,{label:'Before change',sessionId:conversation.id});
  conversation.messages[0].content='Changed after save';await writeFile(sessionPath(conversation.id),JSON.stringify(conversation));
  assert.equal((await git('diff','--cached')).stdout,indexBefore);
  assert.deepEqual(checkpoint.skipped,['.env']);
  await writeFile(join(project,'tracked.txt'),'after\n');
  const preview=await previewWorkbenchSnapshot(project,checkpoint.id);assert.ok(preview.files.includes('tracked.txt'));
  const restored=await restoreWorkbenchSnapshot(project,checkpoint.id);
  assert.equal(restored.conversation.messages[0].content,'Frozen instruction');
  assert.equal(restored.conversation.taskId,'original-task');
  assert.equal(checkpoint.messageCount,2);assert.equal(checkpoint.conversation,undefined);
  assert.equal(await readFile(join(restored.path,'tracked.txt'),'utf8'),'checkpoint\n');
  assert.equal(await readFile(join(restored.path,'new.txt'),'utf8'),'untracked\n');
  await assert.rejects(readFile(join(restored.path,'.env')),{code:'ENOENT'});
  assert.equal(await readFile(join(project,'tracked.txt'),'utf8'),'after\n');
  assert.equal((await git('diff','--cached')).stdout,indexBefore);
  await git('worktree','remove','--force',restored.path);
  await deleteWorkbenchSnapshot(project,checkpoint.id);
  await assert.rejects(restoreWorkbenchSnapshot(project,'../escape'),/ID/);
});

test('a child working outside the project is charged to the parent and request reservations survive overlap',async t=>{
 const {root,project}=await fixture(t);await saveWorkbenchPolicy(project,policy({projectLimit:{maxRequests:2}}));
 const parent=admitWorkbenchRequest({cwd:project,sessionId:'parent',provider:'mixdog-local',model:'local'});
 const child=admitWorkbenchRequest({cwd:root,sessionId:'child',ownerSessionId:'parent',provider:'mixdog-local',model:'local'});
 assert.equal(readWorkbenchUsage(project).project.pending,2);
 assert.throws(()=>admitWorkbenchRequest({cwd:root,sessionId:'grandchild',ownerSessionId:'child'}),/한도/);
 settleWorkbenchRequest(child,{inputTokens:10,outputTokens:5});settleWorkbenchRequest(parent,{inputTokens:20,outputTokens:5});
 assert.equal(readWorkbenchUsage(project).project.tokens,40);
});

test('an abandoned request becomes unknown and a meter write failure never retries a paid response',async t=>{
 const {project}=await fixture(t);await saveWorkbenchPolicy(project,policy({projectLimit:{maxTokens:100}}));
 const ticket=admitWorkbenchRequest({cwd:project,provider:'mixdog-local'});
 ticket.db.prepare('UPDATE calls SET ownerPid=? WHERE id=?').run(2147483647,ticket.id);
 assert.equal(readWorkbenchUsage(project).project.unknown,1);
 assert.throws(()=>admitWorkbenchRequest({cwd:project}),/확인되지/);acknowledgeWorkbenchUsage(project);
 const next=admitWorkbenchRequest({cwd:project,provider:'mixdog-local'});
 next.db.exec('PRAGMA query_only=ON');assert.equal(settleWorkbenchRequest(next,{inputTokens:10}),false);
 assert.throws(()=>admitWorkbenchRequest({cwd:project}),/기록/);next.db.exec('PRAGMA query_only=OFF');
});
