import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import electron from 'electron';

test('macOS native traffic-light boundary stays clear at 75%, 100% and 150% zoom', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cosmos-titlebar-mac-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await build({
    entryPoints: [fileURLToPath(new URL('../main/window-options.ts', import.meta.url))],
    outfile: join(root, 'options.cjs'), bundle: true, format: 'cjs', platform: 'node',
    external: ['electron'], logLevel: 'error',
  });
  const css = await readFile(new URL('./desktop/03-titlebar.css', import.meta.url), 'utf8');
  const brandCss = await readFile(new URL('./desktop/40-cosmos.css', import.meta.url), 'utf8');
  const html = `<html><style>:root{--titlebar-height:35px}body{margin:0;font:14px system-ui}.topbar{display:flex;box-sizing:border-box}.titlebar-spacer{flex:1}${css}${brandCss}</style><header class="topbar" data-native-controls="mac"><div class="cosmos-titlebar-brand">코스모스</div><div class="titlebar-spacer"></div><button>설정</button></header></html>`;
  const entry = join(root, 'main.cjs');
  await writeFile(entry, `
    const {app,BrowserWindow}=require('electron');
    const fs=require('node:fs');
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    const deadline=setTimeout(()=>app.exit(2),20000);
    app.whenReady().then(async()=>{
      const {DESKTOP_WINDOW_OPTIONS}=require('./options.cjs');
      const win=new BrowserWindow({...DESKTOP_WINDOW_OPTIONS,show:false});
      try{
        await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(${JSON.stringify(html)}));
        const readings=[];
        for(const width of [400,1040]) for(const zoom of [.75,1,1.5]){
          win.setSize(width,650);win.webContents.setZoomFactor(zoom);
          await new Promise(resolve=>setTimeout(resolve,150));
          readings.push(await win.webContents.executeJavaScript(
            '(()=>{const native=navigator.windowControlsOverlay.getTitlebarAreaRect();return {width:'+width+',zoom:'+zoom+',nativeX:native.x,visible:navigator.windowControlsOverlay.visible,brandLeft:document.querySelector(".cosmos-titlebar-brand").getBoundingClientRect().left}})()'
          ));
        }
        fs.writeFileSync(${JSON.stringify(join(root, 'readings.json'))},JSON.stringify(readings));
        clearTimeout(deadline);win.destroy();app.quit();
      }catch(error){console.error(error.stack);clearTimeout(deadline);app.exit(1);}
    });
  `);
  const child = spawn(electron, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, output);
  const readings = JSON.parse(await readFile(join(root, 'readings.json'), 'utf8'));
  assert.equal(readings.length, 6);
  for (const reading of readings) {
    assert.equal(reading.visible, true, JSON.stringify(reading));
    assert.ok(reading.nativeX > 0, JSON.stringify(reading));
    assert.ok(reading.brandLeft >= reading.nativeX + 4, JSON.stringify(reading));
  }
});
