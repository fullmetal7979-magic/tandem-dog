import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { pruneDesktopPtyPackage, pruneDesktopRuntime } from './prune-desktop-runtime.mjs';

async function put(path, contents = 'fixture') {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

async function missing(path) {
  await assert.rejects(access(path));
}

test('desktop runtime prune removes production sources and native Sharp WASM fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mixdog-desktop-runtime-prune-'));
  try {
    await put(join(root, 'node_modules', 'pkg', 'index.js'));
    await put(join(root, 'node_modules', 'pkg', 'index.js.map'));
    await put(join(root, 'node_modules', 'pkg', 'src', 'index.ts'));
    await put(join(root, 'node_modules', '@img', 'sharp-win32-x64', 'lib', 'sharp.node'));
    await put(join(root, 'node_modules', '@img', 'sharp-wasm32', 'lib', 'sharp.wasm'));

    const result = await pruneDesktopRuntime(root, { platform: 'win32', arch: 'x64' });

    await access(join(root, 'node_modules', 'pkg', 'index.js'));
    await missing(join(root, 'node_modules', 'pkg', 'index.js.map'));
    await missing(join(root, 'node_modules', 'pkg', 'src', 'index.ts'));
    await missing(join(root, 'node_modules', '@img', 'sharp-wasm32'));
    assert.equal(result.removedSharpWasm, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop runtime prune keeps the PDF.js entrypoints only and drops the native canvas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mixdog-desktop-runtime-variants-'));
  try {
    const pdfJsRoot = join(root, 'node_modules', 'pdfjs-dist');
    await put(join(pdfJsRoot, 'package.json'), '{"name":"pdfjs-dist"}');
    await put(join(pdfJsRoot, 'LICENSE'));
    await put(join(pdfJsRoot, 'legacy', 'build', 'pdf.mjs'));
    await put(join(pdfJsRoot, 'legacy', 'build', 'pdf.worker.mjs'));
    await put(join(pdfJsRoot, 'legacy', 'build', 'pdf.min.mjs'), Buffer.alloc(128));
    await put(join(pdfJsRoot, 'legacy', 'web', 'pdf_viewer.mjs'), Buffer.alloc(128));
    await put(join(pdfJsRoot, 'build', 'pdf.mjs'), Buffer.alloc(128));
    await put(join(pdfJsRoot, 'web', 'pdf_viewer.mjs'), Buffer.alloc(128));
    await put(join(pdfJsRoot, 'image_decoders', 'pdf.image_decoders.mjs'), Buffer.alloc(128));
    await put(join(pdfJsRoot, 'cmaps', 'Identity-H.bcmap'));
    await put(join(pdfJsRoot, 'standard_fonts', 'FoxitSans.pfb'));
    await put(join(pdfJsRoot, 'wasm', 'openjpeg.wasm'));
    await put(join(pdfJsRoot, 'iccs', 'CGATS001Compat-v2-micro.icc'));

    await put(join(root, 'node_modules', '@napi-rs', 'canvas', 'index.js'));
    await put(join(root, 'node_modules', '@napi-rs', 'canvas-darwin-x64', 'skia.node'), Buffer.alloc(256));

    const unpdfRoot = join(root, 'node_modules', 'unpdf');
    await put(join(unpdfRoot, 'package.json'), '{"name":"unpdf","type":"module"}');
    await put(join(unpdfRoot, 'LICENSE'));
    await put(join(unpdfRoot, 'dist', 'index.mjs'));
    await put(join(unpdfRoot, 'dist', 'index.cjs'), Buffer.alloc(128));
    await put(join(unpdfRoot, 'dist', 'pdfjs.mjs'), Buffer.alloc(128));

    const result = await pruneDesktopRuntime(root, { platform: 'win32', arch: 'x64' });

    await access(join(pdfJsRoot, 'legacy', 'build', 'pdf.mjs'));
    await access(join(pdfJsRoot, 'legacy', 'build', 'pdf.worker.mjs'));
    await access(join(pdfJsRoot, 'cmaps', 'Identity-H.bcmap'));
    await access(join(pdfJsRoot, 'standard_fonts', 'FoxitSans.pfb'));
    await access(join(pdfJsRoot, 'wasm', 'openjpeg.wasm'));
    await missing(join(pdfJsRoot, 'build'));
    await missing(join(pdfJsRoot, 'legacy', 'web'));
    await missing(join(pdfJsRoot, 'legacy', 'build', 'pdf.min.mjs'));
    await missing(join(root, 'node_modules', '@napi-rs'));
    await access(join(unpdfRoot, 'dist', 'index.mjs'));
    await missing(join(unpdfRoot, 'dist', 'index.cjs'));
    await missing(join(unpdfRoot, 'dist', 'pdfjs.mjs'));
    assert.ok(result.removedPdfBytes > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop node-pty prune keeps the active Windows payload only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mixdog-node-pty-prune-'));
  try {
    await put(join(root, 'package.json'), '{"main":"./lib/index.js"}');
    await put(join(root, 'LICENSE'));
    await put(join(root, 'lib', 'index.js'));
    await put(join(root, 'lib', 'index.js.map'));
    await put(join(root, 'build', 'Release', 'pty.node'));
    await put(join(root, 'build', 'Release', 'pty.pdb'), Buffer.alloc(1024));
    await put(join(root, 'prebuilds', 'linux-x64', 'node.abi127.node'));
    await put(join(root, 'third_party', 'conpty', 'win10-arm64', 'OpenConsole.exe'));
    await put(join(root, 'src', 'index.ts'));

    const result = await pruneDesktopPtyPackage(root, { platform: 'win32', arch: 'x64' });

    await access(join(root, 'lib', 'index.js'));
    await access(join(root, 'build', 'Release', 'pty.node'));
    await missing(join(root, 'build', 'Release', 'pty.pdb'));
    await missing(join(root, 'prebuilds'));
    await missing(join(root, 'third_party'));
    await missing(join(root, 'src'));
    assert.ok(result.afterBytes < result.beforeBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
