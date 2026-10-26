import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycleApi } from '../../session-runtime/lifecycle-api.mjs';
import { inheritanceRouteTarget } from '../../session-runtime/inheritance-fit.mjs';

test('local recovery carries task identity and never spends AI calls to compact an oversized frozen conversation', async () => {
  let compactions=0;
  const make=window=>{
    const route={provider:'anthropic-oauth',model:'claude-opus-5',selectedContextWindow:window};
    const target={id:`restored-${window}`,messages:[],...inheritanceRouteTarget(route)};
    const api=createLifecycleApi({getSession:()=>target,getRoute:()=>route,mgr:{getSession:()=>null},invalidateContextStatusCache(){},saveSession(){},
      compactConversationToTargetWindow:async()=>{compactions++;throw new Error('unexpected paid call');}});
    return {api,target};
  };
  const doc={id:'checkpoint-session',taskId:'original-task',provider:'openai-oauth',model:'gpt-6-astra',localRecovery:true,
    messages:[{role:'user',content:'Implement '+ 'important context '.repeat(20000)},{role:'assistant',content:'Working'}]};
  const small=make(20000);
  await assert.rejects(small.api.inheritFromExport(doc),/자동 압축하거나 AI에 전송하지 않았습니다/);
  assert.equal(compactions,0);assert.deepEqual(small.target.messages,[]);
  const large=make(2000000);await large.api.inheritFromExport(doc);
  assert.equal(large.target.cosmosTaskId,'original-task');assert.equal(large.target.inheritedFromSessionId,'checkpoint-session');
  assert.equal(large.target.messages[0].content,doc.messages[0].content);assert.equal(compactions,0);
});
