import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installTestDom } from './test-support/test-dom.mjs';
import { transcriptArtifacts } from './transcript-artifacts.ts';
import { ToolActivityGroup } from './transcript-tool-ui.tsx';
import { MarkdownProjectContext } from './MarkdownLink.tsx';

test('SVG files written by edit and apply_patch become image artifacts; failed, deleted and other files do not', () => {
  const edit = (file_path, extra = {}) => ({ kind: 'tool', name: 'edit', args: { file_path }, result: 'ok', ...extra });
  const patch = (text) => ({ kind: 'tool', name: 'apply_patch', args: { patch: text }, result: 'ok' });
  assert.deepEqual(
    transcriptArtifacts([
      edit('C:/work/chart.svg'),
      edit('C:/work/chart.svg'),
      edit('C:/work/app.ts'),
      edit('C:/work/failed.svg', { isError: true }),
      patch(
        [
          '*** Begin Patch',
          '*** Add File: out/new.svg',
          '+<svg/>',
          '*** Update File: old.svg',
          '*** Move to: moved.svg',
          '*** Delete File: gone.svg',
          '*** End Patch',
        ].join('\n')
      ),
    ]).map(({ kind, path }) => ({ kind, path })),
    [
      { kind: 'image', path: 'C:/work/chart.svg' },
      { kind: 'image', path: 'out/new.svg' },
      { kind: 'image', path: 'moved.svg' },
    ]
  );
});

test('artifact images open in the shared lightbox and navigate within the strip', async () => {
  const { dom, restore } = installTestDom(null, {
    html: '<!doctype html><div id="root"></div>',
    jsdom: { url: 'http://localhost/' },
    expose: ['navigator'],
  });
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  dom.window.mixdogDesktop = {
    statProjectFile: async () => ({ mtimeMs: 0, size: 1 }),
    resolveLocalPaths: async ([absolutePath]) => [
      { absolutePath, dir: false, projectPath: 'C:/work', relPath: absolutePath.slice('C:/work/'.length) },
    ],
    previewProjectFile: async (_project, relPath) => ({
      url: `mixdog-media://preview/token/${relPath}`,
      kind: 'image',
    }),
  };
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () =>
      root.render(
        React.createElement(
          MarkdownProjectContext.Provider,
          { value: 'C:/work' },
          React.createElement(ToolActivityGroup, {
            items: ['one.svg', 'two.svg'].map((name) => ({
              kind: 'tool',
              name: 'edit',
              args: { file_path: `C:/work/${name}` },
              result: 'ok',
            })),
          })
        )
      )
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const doc = dom.window.document;
    await act(async () => doc.querySelector('.transcript-artifact-frame').click());
    assert.equal(doc.querySelector('dialog img').getAttribute('src'), 'mixdog-media://preview/token/one.svg');
    await act(async () => doc.querySelector('dialog button[aria-label="Next image"]').click());
    assert.equal(doc.querySelector('dialog img').getAttribute('src'), 'mixdog-media://preview/token/two.svg');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});

test('collapsed activity exposes a written image through the file preview lane', async () => {
  const { dom, restore } = installTestDom(null, {
    html: '<!doctype html><div id="root"></div>',
    jsdom: { url: 'http://localhost/' },
    expose: ['navigator'],
  });
  // jsdom has no modal dialogs; the card only needs the dialog to open.
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  dom.window.mixdogDesktop = {
    statProjectFile: async () => ({ mtimeMs: 0, size: 1 }),
    resolveLocalPaths: async ([absolutePath]) => [
      { absolutePath, dir: false, projectPath: 'C:/work', relPath: absolutePath.slice('C:/work/'.length) },
    ],
    previewProjectFile: async (_project, relPath) => ({
      url: `mixdog-media://preview/token/${relPath}`,
      kind: 'image',
      mime: 'image/svg+xml',
    }),
  };
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () =>
      root.render(
        React.createElement(
          MarkdownProjectContext.Provider,
          { value: 'C:/work' },
          React.createElement(ToolActivityGroup, {
            items: [{ kind: 'tool', name: 'edit', args: { file_path: 'C:/work/chart.svg' }, result: 'ok' }],
          })
        )
      )
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal(dom.window.document.querySelector('.tool-activity-header').getAttribute('aria-expanded'), 'false');
    assert.ok(dom.window.document.querySelector('.transcript-artifacts img'));
    // A written SVG renders as an image through the file preview lane, never inline markup.
    const svg = dom.window.document.querySelector('img[src="mixdog-media://preview/token/chart.svg"]');
    assert.equal(svg?.closest('figure')?.querySelector('figcaption > span')?.textContent, 'chart.svg');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
