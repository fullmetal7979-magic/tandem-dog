import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

test('task tools save limits, recover drafts, show ownership, preserve keyboard access and fit compact windows', {timeout:45000},async t=>{
 const result=await build({stdin:{loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url)),contents:`
 import React,{useState,useRef}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
 import WorkbenchTaskCenter from './WorkbenchTaskCenter';import{saveComposerDraft}from'./composer-draft-store';
 window.calls=[];window.restored=null;
 const checkpoint={id:'11111111-1111-4111-8111-111111111111',label:'Before edit',at:Date.now(),paths:['src/app.ts'],messageCount:2,hasConversation:true};
 let data={git:true,root:'/project',policy:{dailyLimit:{},projectLimit:{},context:{include:[],exclude:[],instructions:''}},context:{tokens:0,files:[]},usage:{daily:{tokens:100,requests:2,costUsd:.02},project:{tokens:100,requests:2,costUsd:.02,input:90,output:10,cached:50}},snapshots:[checkpoint],changes:' M src/app.ts',claims:[],conflicts:[]};
 window.mixdogDesktop={rendererDiagnostic(){},workbench:async request=>{window.calls.push(request);if(request.action==='save-policy')data={...data,policy:request.policy};if(request.action==='save-claim')data={...data,claims:[{owner:request.owner,paths:request.paths}],conflicts:[{path:request.paths[0],owners:['Claude','Codex']}]};return {...data,...(request.action==='preview-snapshot'?{preview:{snapshot:checkpoint,diff:'src/app.ts | 2 +-' }}:{}),...(request.action==='restore-snapshot'?{restored:{path:'/recovered',sessionId:'restored-session'}}:{})};},invokeCapability:async request=>({value:request.capability==='getProviderSetup'?{api:[{authenticated:true}]}:{}}),gitCliStatus:async()=>({available:true}),githubCliStatus:async()=>({authenticated:true}),cosmosOverview:async()=>({ready:true}),getRemoteAccessInfo:async()=>({enabled:true})};
 function App(){const[open,setOpen]=useState(false),[attachments,setAttachments]=useState([{id:1,name:'notes.txt',kind:'text',mimeType:'text/plain',data:'relevant text',token:'[File #1]'}]);const anchor=useRef(null);return <><button id="launch" ref={anchor} onClick={()=>setOpen(true)}>작업 도구</button>{open&&<WorkbenchTaskCenter anchor={anchor}projectPath="/project"sessionId=""scope="draft-current"draft="Review [File #1]"attachments={attachments}provider="test"model="coder"turnBusy={false}onClose={()=>setOpen(false)}onRestoreDraft={async value=>{window.restored=value}}onRemoveAttachment={id=>setAttachments(current=>current.filter(x=>x.id!==id))}onResumeSession={id=>window.resumed=id}onOpenProjects={()=>{}}onOpenSettings={section=>window.settings=section}/>}</>}
 window.ready=saveComposerDraft('older-draft',{text:'Recover this input',attachments:[]}).then(()=>flushSync(()=>createRoot(document.getElementById('root')).render(<App/>)));
 `},plugins:[{name:'worker-fixture',setup(build){build.onResolve({filter:/\?worker$/},args=>({path:args.path,namespace:'test-worker'}));build.onLoad({filter:/.*/,namespace:'test-worker'},()=>({contents:'export default class WorkerFixture {}',loader:'js'}));}}],bundle:true,jsx:'automatic',format:'iife',write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
 const server=createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><div id="root"></div>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await puppeteer.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;font:14px system-ui}:root{--mx-bg-base:#fff;--mx-bg-layer-1:#f5f6fa;--mx-bg-layer-2:#eef;--mx-bg-layer-3:#ddd;--mx-text:#222;--mx-text-muted:#667;--mx-border:#ccd;--mx-text-accent:#6655cf;--mx-focus:#65d}.schedules-dialog-layer{position:fixed;inset:0;display:grid;place-items:center;background:#0003}'});
 await page.addStyleTag({content:await readFile(new URL('./desktop/workbench-task-center.css',import.meta.url),'utf8')});
 await page.addScriptTag({content:result.outputFiles[0].text});await page.evaluate(()=>window.ready);
 const click=async text=>{const found=await page.evaluate(label=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label);if(!el)return false;el.click();return true;},text);assert.equal(found,true,`button ${text}`);await new Promise(r=>setTimeout(r,40));};
 await page.click('#launch');await page.waitForSelector('[role=dialog]');
 await click('초안에서 제외');assert.equal(await page.$$('.workbench-list-row').then(x=>x.length),0);
 await click('사용량');await (await page.$('.workbench-limit-fields input')).type('500');await click('한도 저장');
 assert.equal(await page.evaluate(()=>window.calls.findLast(x=>x.action==='save-policy').policy.dailyLimit.maxTokens),500);
 await page.$eval('.workbench-limit-fields input',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'-1');e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.$$eval('button',es=>es.find(e=>e.textContent==='한도 저장').disabled),true);
 await page.$eval('.workbench-limit-fields input',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'500');e.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('인계·검증');assert.match(await page.$eval('.workbench-panel',e=>e.textContent),/실행 결과가 확인된 테스트가 없습니다/);
 await page.$$eval('.workbench-card',cards=>{const area=cards.find(e=>e.textContent.includes('담당 파일 표시')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'src/chat');area.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('담당 표시');assert.match(await page.$eval('.workbench-panel',e=>e.textContent),/겹치는 경로: src\/chat/);
 await click('연결');await click('지금 확인');await page.waitForSelector('.workbench-diagnostic');assert.equal(await page.$$('.workbench-diagnostic').then(es=>es.length),5);
 for(const width of [420,800,1280])for(const zoom of [.75,1,1.5]){
  await page.setViewport({width,height:760});await page.$eval('[role=dialog]',(e,zoom)=>e.style.zoom=zoom,zoom);
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('.workbench-heading,.workbench-panel,.workbench-card,.workbench-footer')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className));
  assert.deepEqual(overflow,[],`no clipping at ${width}/${zoom}`);
 }
 await page.$eval('[role=dialog]',e=>e.style.zoom=1);await page.setViewport({width:1000,height:760});
 await click('복원');await page.waitForSelector('.workbench-list-row');await click('초안 복원');await page.waitForFunction(()=>!!window.restored);assert.equal(await page.evaluate(()=>window.restored.text),'Recover this input');
 await click('복원 미리보기');await click('새 작업 폴더에서 복원');assert.equal(await page.evaluate(()=>window.resumed),'restored-session');assert.equal(await page.$('[role=dialog]'),null);
 await page.click('#launch');await page.waitForSelector('[role=dialog]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(await page.evaluate(()=>document.activeElement.id),'launch');
 assert.deepEqual(errors,[]);
});
