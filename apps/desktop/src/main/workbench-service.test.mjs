import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requiredWorkbenchRequest,workbenchOperation } from './workbench-service.ts';
import { closeWorkbenchMeters } from '../../../../src/runtime/workbench/usage-meter.mjs';
import { DesktopSettingsStore } from './settings-store.ts';
import { DEFAULT_ACTIVITY_RAIL_PINS,LEGACY_ACTIVITY_RAIL_PINS } from '../shared/activity-rail-pins.ts';

test('an incomplete policy cannot clear existing caps and unknown IPC fields are rejected',()=>{
 for(const request of [{action:'execute'},{action:'read',shell:'rm'},{action:'save-policy',policy:{}},{action:'save-policy',policy:{dailyLimit:{},projectLimit:{},context:null}},{action:'save-claim',paths:[1]}])assert.throws(()=>requiredWorkbenchRequest(request),TypeError);
 assert.equal(requiredWorkbenchRequest({action:'save-policy',policy:{dailyLimit:{maxTokens:100},projectLimit:{},context:{include:[],exclude:[],instructions:''}}}).policy.dailyLimit.maxTokens,100);
});
test('file owners retain caps, expose overlapping directories, and release independently',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cosmos-claims-')),project=join(root,'project'),previous=process.env.MIXDOG_DATA_DIR;
 process.env.MIXDOG_DATA_DIR=join(root,'data');await mkdir(project);
 t.after(async()=>{closeWorkbenchMeters();if(previous===undefined)delete process.env.MIXDOG_DATA_DIR;else process.env.MIXDOG_DATA_DIR=previous;await rm(root,{recursive:true,force:true});});
 const run=request=>workbenchOperation({...request,projectPath:project});
 await run({action:'save-policy',policy:{dailyLimit:{maxRequests:20},projectLimit:{maxTokens:1000},context:{include:[],exclude:[],instructions:''}}});
 await run({action:'save-claim',owner:'Claude',paths:['src/chat']});
 const both=await run({action:'save-claim',owner:'Codex',paths:['src/chat/composer.ts']});
 assert.equal(both.conflicts.length,1);assert.deepEqual(both.conflicts[0].owners,['Claude','Codex']);
 assert.equal(both.policy.projectLimit.maxTokens,1000);
 const released=await run({action:'release-claim',owner:'Claude'});assert.equal(released.conflicts.length,0);assert.equal(released.claims[0].owner,'Codex');
 await assert.rejects(run({action:'save-claim',owner:'Codex',paths:['../outside']}),/상대 경로/);
});
test('only the untouched legacy rail preset migrates; customized pins survive',async()=>{
 for(const [revision,pins,expected] of [[1,LEGACY_ACTIVITY_RAIL_PINS,DEFAULT_ACTIVITY_RAIL_PINS],[2,LEGACY_ACTIVITY_RAIL_PINS,LEGACY_ACTIVITY_RAIL_PINS],[1,['projects','sessions'],['projects','sessions']]]){
  let config={desktop:{activityRailPins:{revision,pins},keepAwake:true}};
  const store=new DesktopSettingsStore({loadConfig:async()=>({readConfig:()=>config,updateConfigAsync:async fn=>(config=fn(config))})});
  const value=await store.readActivityRailPins();assert.deepEqual(value.pins,expected);assert.equal(config.desktop.keepAwake,true);
 }
});
