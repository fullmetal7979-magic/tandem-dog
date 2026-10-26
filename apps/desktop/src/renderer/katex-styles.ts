// KaTeX's stylesheet and its ~20 font faces, split out of the first-paint CSS.
// MarkdownAstBody imports this module the first time a rendered AST carries
// math; Vite resolves the import only after the stylesheet has loaded.
import 'katex/dist/katex.min.css';

export const KATEX_STYLES = true;
