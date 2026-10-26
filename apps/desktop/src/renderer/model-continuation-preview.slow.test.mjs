import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

test('model preview reads capacity without generating, preserves failure retry and cancels safely',{timeout:30000},async t=>{
 const result=await build({stdin:{loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url)),contents:`
 import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';import Preview from './ModelContinuationPreview';
 window.calls=[];window.fail=true;window.attempts=0;window.fit={known:true,fits:true,willCompact:false,used:1200,limit:100000};
 window.mixdogDesktop={invokeCapability:async request=>{window.calls.push(request);return{value:window.fit}}};
 const target={provider:'test',model:'new-coder'};
 function App(){const[open,setOpen]=useState(false),anchor=useRef(null);return <><button id="launch" ref={anchor}onClick={()=>setOpen(true)}>모델 전환</button>{open&&<Preview anchor={anchor}sessionId="source"sourceModel="old-coder"target={target}attachmentCount={2}onCancel={()=>{window.cancelled=true;setOpen(false)}}onContinue={async()=>{window.attempts++;if(window.fail)throw Error('연결 실패');window.continued=true;setOpen(false);return true}}/>}</>}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,format:'iife',jsx:'automatic',write:false,loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'});
 const browser=await puppeteer.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();page.setDefaultTimeout(6000);await page.setContent('<div id="root"></div>');
 await page.addStyleTag({content:'body{font:14px system-ui}.schedules-dialog-layer{position:fixed;inset:0;display:grid;place-items:center}'});
 await page.addStyleTag({content:await readFile(new URL('./desktop/workbench-task-center.css',import.meta.url),'utf8')});
 await page.addScriptTag({content:result.outputFiles[0].text});
 const click=async text=>page.evaluate(text=>[...document.querySelectorAll('button')].find(e=>e.textContent===text)?.click(),text);
 await page.click('#launch');await page.waitForFunction(()=>document.querySelector('.workbench-panel')?.textContent.includes('1,200'));
 await page.waitForFunction(()=>document.activeElement?.textContent==='이 모델로 이어가기');
 assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('is-primary')),true,'first focus is the primary action, not ✕');
 assert.equal(await page.evaluate(()=>window.calls.length),1);assert.equal(await page.evaluate(()=>window.calls[0].capability),'inheritancePreflight');assert.equal(await page.evaluate(()=>window.attempts),0);
 await click('이 모델로 이어가기');await page.waitForSelector('[role=alert]');assert.match(await page.$eval('[role=alert]',e=>e.textContent),/기존 대화와 초안은 유지/);
 await page.evaluate(()=>window.fail=false);await click('다시 시도');await page.waitForFunction(()=>window.continued===true);assert.equal(await page.evaluate(()=>window.attempts),2);
 await page.evaluate(()=>window.fit={known:true,fits:false,willCompact:false});await page.click('#launch');await page.waitForFunction(()=>document.querySelector('.workbench-panel')?.textContent.includes('컨텍스트에 맞지'));
 assert.equal(await page.$$eval('button',es=>es.find(e=>e.textContent==='이 모델로 이어가기').disabled),true);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.cancelled),true);assert.equal(await page.evaluate(()=>window.attempts),2);
});
