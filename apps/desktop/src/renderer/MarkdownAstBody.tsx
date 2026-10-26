import { Fragment, memo, useEffect, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

import type { MarkdownAstRoot } from './markdown-ast';
import { markdownComponents, type MarkdownCopyControl } from './markdown-components';

type AstNode = MarkdownAstRoot['children'][number];

// Code blocks are the bulk of a long AST (one span per highlighted token) and
// can never hold rendered math, so the walk skips them.
const MATH_FREE_TAGS = new Set(['pre', 'code']);
function hasMath(nodes: readonly AstNode[] | undefined): boolean {
  if (!nodes) return false;
  for (const node of nodes) {
    if (node.type !== 'element' || MATH_FREE_TAGS.has(String(node.tagName))) continue;
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
// Each AST is walked at most once: a remounted row (virtualized transcript,
// pane switch) reuses its answer, and once the stylesheet is requested no AST
// is walked again.
let katexStyles: Promise<void> | null = null;
const checkedRoots = new WeakSet<MarkdownAstRoot>();
function ensureKatexStyles(root: MarkdownAstRoot): void {
  if (katexStyles || typeof document === 'undefined' || checkedRoots.has(root)) return;
  checkedRoots.add(root);
  if (!hasMath(root.children)) return;
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
