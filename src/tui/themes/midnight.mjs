/**
 * src/tui/themes/midnight.mjs — Midnight (Tandem Dog default).
 *
 * Clean, low-saturation midnight blue: deep navy-black surfaces, cool slate
 * text, one muted periwinkle accent and a calm sky-blue live state instead of
 * the orange used by other themes. Spreads `basePalette` first so the full key
 * set is always present.
 */
import { basePalette } from './base.mjs';

const ACCENT = 'rgb(122,150,230)';
const ACCENT_SOFT = 'rgb(150,172,236)';
const LIVE = 'rgb(110,190,230)';
const TEXT = 'rgb(220,226,240)';
const MUTED = 'rgb(134,146,174)';
const FAINT = 'rgb(104,116,146)';

/** Midnight — calm navy dark with a single periwinkle accent. */
export const midnightPalette = {
  ...basePalette,
  background: 'transparent',
  text: TEXT,
  statusText: TEXT,
  thinkingText: 'rgb(186,196,222)',
  thinkingGlow: 'rgb(208,220,250)',
  mixdogIvory: TEXT,
  inactive: MUTED,
  subtle: FAINT,
  thinkingAccent: 'rgb(102,126,186)',
  thinkingBase: 'rgb(70,86,132)',
  statusSubtle: MUTED,
  timerText: MUTED,
  promptBorder: 'rgb(52,62,92)',
  claude: ACCENT,
  logo: ACCENT_SOFT,
  mixdogOrange: ACCENT,
  spinnerGlyph: LIVE,
  spinnerText: LIVE,
  panelTitle: ACCENT_SOFT,
  mdHeading: ACCENT_SOFT,
  claudeShimmer: 'rgb(170,190,245)',
  spinnerShimmer: 'rgb(160,215,240)',
  mixdogAmber: ACCENT_SOFT,
  suggestion: ACCENT_SOFT,
  code: 'rgb(140,190,235)',
  mdLink: ACCENT_SOFT,
  mdListBullet: ACCENT,
  mdCode: 'rgb(140,190,235)',
  mdLinkText: 'rgb(130,200,225)',
  codeBlock: 'rgb(208,214,230)',
  mdCodeBlock: 'rgb(208,214,230)',
  success: 'rgb(94,184,140)',
  error: 'rgb(226,104,112)',
  warning: 'rgb(222,178,96)',
  permission: 'rgb(226,104,112)',
  mdStrong: 'rgb(178,196,245)',
  mdEmph: 'rgb(130,200,225)',
  inverseText: 'rgb(10,14,24)',
  selectionText: 'rgb(232,238,252)',
  selectionBackground: 'rgb(40,56,104)',
  mdCodeBlockBg: 'rgb(16,21,34)',
  mdCodeSpanBg: 'rgb(26,32,50)',
  mdCodeBlockBorder: 'rgb(40,48,72)',
  userMessageBackground: 'rgb(21,27,43)',
  userMessageBackgroundHover: 'rgb(31,39,60)',
  mdQuote: FAINT,
  mdQuoteBorder: 'rgb(52,62,92)',
  mdHr: 'rgb(44,52,78)',
  syntaxComment: FAINT,
  mdDiffContext: FAINT,
  mdDiffAdded: 'rgb(94,184,140)',
  mdDiffRemoved: 'rgb(226,104,112)',
  mdDiffHunk: ACCENT,
  mdDiffHeader: ACCENT_SOFT,
  mdDiffAddedBg: 'rgb(18,40,38)',
  mdDiffRemovedBg: 'rgb(44,24,34)',
  syntaxKeyword: 'rgb(150,170,240)',
  syntaxFunction: 'rgb(124,196,228)',
  syntaxString: 'rgb(146,196,150)',
  syntaxNumber: 'rgb(226,180,120)',
  syntaxType: 'rgb(124,196,228)',
  syntaxVariable: TEXT,
  syntaxOperator: 'rgb(150,170,240)',
  syntaxPunctuation: 'rgb(170,180,204)',
  fastMode: LIVE,
};
