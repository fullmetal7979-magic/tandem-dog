import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

test('Galaxy connection controls fit narrow sidebars, zoom and settings without clipping', { timeout: 30000 }, async t => {
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {GalaxyPane} from './GalaxyPane';
      const star = {id:'me',name:'긴 이름의 개발용 MacBook Pro',kind:'mac',color:'#3cf',me:true};
      window.mixdogDesktop = {
        cosmosOverview: async () => ({ready:false,star,stars:[star],planets:[],conversations:[],state:'not_setup',seat:null,syncedAt:0}),
        invokeCapability: async () => ({value:{api:[],oauth:[]}}), rendererDiagnostic() {},
      };
      flushSync(() => createRoot(document.getElementById('root')).render(<GalaxyPane projectPath={null}/>));
    ` }, bundle: true, jsx: 'automatic', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewport({width:1100,height:750});
  await page.setContent('<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui}#root{height:600px;width:252px}</style><div id="root"></div>');
  await page.addStyleTag({content:await readFile(new URL('../desktop/40-cosmos.css', import.meta.url), 'utf8')});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForSelector('.cosmos-setup').catch(error => { throw new Error(pageErrors.join('\n') || error.message); });
  await page.$eval('details', e=>{e.open=true;});
  // Include the optional project-receive form, whose trigger used to occupy
  // the 20px checklist icon column.
  await page.evaluate(()=>[...document.querySelectorAll('.cosmos-checklist button')].find(e=>e.textContent.includes('프로젝트 받기'))?.click());
  await page.waitForSelector('.cosmos-clone-picker form');
  for(const width of [220,252,320,520]) for(const zoom of [0.75,1,1.5]) {
    await page.$eval('#root',(e,{width,zoom})=>{e.style.width=`${width}px`;e.style.zoom=zoom;},{width,zoom});
    const clipped = await page.evaluate(()=>[...document.querySelectorAll('.cosmos-pane *')].filter(e=>!e.matches('input,textarea') && e.clientWidth>0 && e.scrollWidth>e.clientWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.clientWidth,content:e.scrollWidth})));
    assert.deepEqual(clipped, [], `sidebar ${width}px at ${zoom} zoom`);
    const outside = await page.evaluate(()=>[...document.querySelectorAll('.cosmos-pane button,.cosmos-pane input')].filter(e=>{
      const card=(e.closest('.cosmos-card') || e.closest('.cosmos-pane')).getBoundingClientRect();const bounds=e.getBoundingClientRect();
      return bounds.left<card.left-1 || bounds.right>card.right+1;
    }).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent})));
    assert.deepEqual(outside, [], `controls remain inside cards at ${width}px/${zoom}`);
  }
  await page.$eval('.cosmos-pane',e=>{e.scrollTop=e.scrollHeight;});
  assert.ok(await page.$eval('.cosmos-pane',e=>e.scrollTop>0),'lower cards remain reachable by vertical scrolling');
});
