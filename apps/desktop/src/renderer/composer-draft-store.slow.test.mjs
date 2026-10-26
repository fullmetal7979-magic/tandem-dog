import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

test('real Chromium recovers text and binary drafts across reload, isolates tasks and expires old entries', { timeout: 30000 }, async t => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: 'import * as drafts from "./composer-draft-store"; window.drafts = drafts;', loader: 'ts' },
    bundle: true, write: false, format: 'iife',
  });
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Draft recovery</title>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await puppeteer.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(bundle.outputFiles[0].text);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const draft = { text: '한글 입력 [Image #4]', attachments: [{ id: 4, name: '화면.png', kind: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=', token: '[Image #4]' }] };
  await page.evaluate(async saved => {
    await window.drafts.saveComposerDraft('task-a', saved);
    await window.drafts.saveComposerDraft('task-b', { text: 'other task', attachments: [] });
  }, draft);
  await page.reload();
  assert.deepEqual(await page.evaluate(() => window.drafts.readComposerDraft('task-a')), draft);
  assert.equal(await page.evaluate(async () => (await window.drafts.readComposerDraft('task-b')).text), 'other task');
  assert.equal(await page.evaluate(() => window.drafts.readComposerDraft('missing')), undefined);
  await page.evaluate(() => window.drafts.saveComposerDraft('task-a', { text: '', attachments: [] }));
  await page.reload();
  assert.equal(await page.evaluate(() => window.drafts.readComposerDraft('task-a')), undefined, 'sent drafts stay cleared after restart');
  await page.evaluate(async () => {
    for (let i = 0; i < 25; i++) await window.drafts.saveComposerDraft(`scope-${i}`, { text: `text-${i}`, attachments: [] });
  });
  await page.reload();
  assert.equal(await page.evaluate(() => window.drafts.readComposerDraft('scope-0')), undefined, 'older drafts are pruned');
  assert.equal(await page.evaluate(async () => (await window.drafts.readComposerDraft('scope-24')).text), 'text-24');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('cosmos-composer-drafts-v1', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      const get = store.get('scope-24');
      get.onsuccess = () => store.put({ ...get.result, updatedAt: Date.now() - 8 * 24 * 60 * 60_000 });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload();
  assert.equal(await page.evaluate(() => window.drafts.readComposerDraft('scope-24')), undefined, 'expired drafts never reappear');
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'attachments never enter localStorage');
  const unavailable = await browser.newPage();
  await unavailable.evaluateOnNewDocument('Object.defineProperty(window, "indexedDB", { value: undefined });');
  await unavailable.evaluateOnNewDocument(bundle.outputFiles[0].text);
  await unavailable.goto(`http://127.0.0.1:${server.address().port}`);
  assert.match(await unavailable.evaluate(async () => {
    try { await window.drafts.saveComposerDraft('offline', { text: 'keep me', attachments: [] }); return ''; } catch (error) { return error.message; }
  }), /unavailable/);
  assert.equal(await unavailable.evaluate(async () => (await window.drafts.readComposerDraft('offline')).text), 'keep me', 'in-memory input survives a storage failure');
});
