import test from 'node:test';
import assert from 'node:assert/strict';
import {taskEvidence,buildHandoffCard}from './workbench-task-evidence.ts';
test('validation requires a numeric exit result; optimistic text never claims a pass',()=>{
 const evidence=taskEvidence([{args:{command:'npm test'},result:{exit_code:0}},{args:{cmd:'npm run build'},result:{exitCode:1}},{args:{command:'npm test'},result:'All passed'},{args:{command:'ls'}}]);
 assert.deepEqual(evidence.map(row=>row.status),['passed','failed','unknown']);
 const text=buildHandoffCard({goal:'Fix auth',note:'token=do-not-share',changes:' M app.ts',evidence,provider:'test',model:'coder',project:'/project'});
 assert.ok(text.includes('[통과] npm test'));assert.ok(text.includes('[확인 필요] npm test'));assert.ok(!text.includes('do-not-share'));
 assert.equal(buildHandoffCard({goal:'',note:'',changes:'',evidence:[],provider:'',model:'',project:''}).includes('실행 결과가 확인된 검증 없음'),true);
});

test('runtime shell result headers establish exits while interrupted and streaming results stay unknown',()=>{
 const evidence=taskEvidence([{args:{command:'npm test'},rawResult:'[exit code: 0]\n3 passed'},
 {args:{command:'npm test'},rawResult:'[exit code: 2]\nfailed'},
 {args:{command:'npm test'},rawResult:'[timeout: 100ms]\n[exit code: 0]'},
 {args:{command:'npm test'},rawResult:'[exit code: 0]',streaming:true},
 {args:{command:'npm test'},rawResult:'some output\n[exit code: 0]'}]);
 assert.deepEqual(evidence.map(row=>row.status),['passed','failed','unknown','unknown','unknown']);
});
