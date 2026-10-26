import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { installPdfjsGlobals } from './pdfjs-runtime.mjs';

const extractUrl = new URL('./pdf-extract.mjs', import.meta.url).href;
const fixturesUrl = new URL('../agent/orchestrator/tools/builtin/pdf-test-fixtures.mjs', import.meta.url).href;

test('installPdfjsGlobals fills only missing globals and keeps 2D matrix math correct', () => {
  const host = {};
  installPdfjsGlobals(host);
  const m = new host.DOMMatrix([2, 0, 0, 2, 10, 20]).multiplySelf([1, 0, 0, 1, 3, 4]);
  assert.deepEqual([m.a, m.b, m.c, m.d, m.e, m.f], [2, 0, 0, 2, 16, 28]);
  assert.deepEqual(m.inverse().transformPoint({ x: 16, y: 28 }), { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(new host.DOMMatrix().isIdentity, true);
  assert.doesNotThrow(() => new host.Path2D().addPath(new host.Path2D(), new host.DOMMatrix()));

  const native = class {};
  const preset = { DOMMatrix: native, Path2D: native };
  installPdfjsGlobals(preset);
  assert.equal(preset.DOMMatrix, native);
  assert.equal(preset.Path2D, native);
});

test('PDF text extraction works without the native @napi-rs/canvas package', () => {
  // The child refuses to load @napi-rs/canvas, exactly like the packaged
  // runtime where it is pruned, and counts the probes.
  const script = `
    import Module from 'node:module';
    const load = Module._load;
    let canvasRequests = 0;
    Module._load = function (request, ...rest) {
      if (String(request).startsWith('@napi-rs/canvas')) {
        canvasRequests += 1;
        throw Object.assign(new Error('not shipped: ' + request), { code: 'MODULE_NOT_FOUND' });
      }
      return load.call(this, request, ...rest);
    };
    const { inspectPdfBuffer } = await import(${JSON.stringify(extractUrl)});
    const { makePdf } = await import(${JSON.stringify(fixturesUrl)});
    const result = await inspectPdfBuffer(makePdf(2), { extractText: true });
    process.stdout.write(JSON.stringify({ result, canvasRequests, hasMatrix: typeof globalThis.DOMMatrix }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(child.status, 0, child.stderr);
  const { result, canvasRequests, hasMatrix } = JSON.parse(child.stdout);
  assert.equal(result.pageCount, 2);
  assert.match(result.text, /--- Page 1 ---\s*Page 1/);
  assert.match(result.text, /--- Page 2 ---\s*Page 2/);
  assert.ok(canvasRequests <= 1, 'pdf.js only probes for the optional canvas once');
  assert.equal(hasMatrix, 'function');
  assert.doesNotMatch(child.stderr, /Cannot polyfill|Cannot load|napi-rs/);
});
