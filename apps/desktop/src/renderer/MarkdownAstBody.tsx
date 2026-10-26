import { Fragment, memo, useEffect, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

import type { MarkdownAstRoot } from './markdown-ast';
import { markdownComponents, type MarkdownCopyControl } from './markdown-components';

type AstNode = MarkdownAstRoot['children'][number];

function hasMath(nodes: readonly AstNode[] | undefined): boolean {
  if (!nodes) return false;
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    const className = node.properties?.className;
    if (Array.isArray(className) && className.some((name) => String(name).startsWith('katex'))) return true;
    if (hasMath(node.children)) return true;
  }
  return false;
}

// KaTeX's stylesheet is not part of first paint. The first AST with math
// loads it; until then 28-usage-explorer-eager.css keeps `.katex` hidden so
// the MathML and HTML twins never print the formula twice. A failed load
// still reveals the math, unstyled, rather than leaving it invisible.
let katexStyles: Promise<void> | null = null;
function ensureKatexStyles(root: MarkdownAstRoot): void {
  if (katexStyles || typeof document === 'undefined' || !hasMath(root.children)) return;
  const mark = (state: string) => {
    document.documentElement.dataset.katexStyles = state;
  };
  katexStyles = import('./katex-styles').then(
    () => mark('ready'),
    () => mark('unavailable')
  );
}

// A streamed token re-renders the owner while the same parse stays on screen;
// only a newly landed AST rebuilds the element tree.
export default memo(function MarkdownAstBody({
  root,
  copyControl,
}: {
  root: MarkdownAstRoot;
  copyControl: MarkdownCopyControl;
}) {
  useEffect(() => ensureKatexStyles(root), [root]);
  return toJsxRuntime(root as never, {
    Fragment,
    jsx,
    jsxs,
    components: markdownComponents(copyControl) as never,
    ignoreInvalidStyle: true,
    passKeys: true,
  }) as ReactNode;
});
