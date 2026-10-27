// Shortcut labels as this platform types them. The workbench binds `mod` to
// ⌘ on macOS (workbench-shortcuts.ts), Monaco uses its own macOS keymap, and a
// few keys stay Control everywhere; one table names each label we show, so a
// Mac never reads "Ctrl" for a key it presses with ⌘.
import { isMacShortcutPlatform } from './workbench-shortcuts';

const MAC_LABELS: Readonly<Record<string, string>> = {
  'Ctrl+N': '⌘N',
  'Ctrl+P': '⌘P',
  'Ctrl+O': '⌘O',
  'Ctrl+S': '⌘S',
  'Ctrl+W': '⌘W',
  'Ctrl+B': '⌘B',
  'Ctrl+J': '⌘J',
  'Ctrl+,': '⌘,',
  'Ctrl+/': '⌘/',
  'Ctrl+.': '⌘.',
  'Ctrl+C': '⌘C',
  'Ctrl+X': '⌘X',
  'Ctrl+V': '⌘V',
  'Ctrl+F2': '⌘F2',
  'Ctrl+F12': '⌘F12',
  'Ctrl+Alt+B': '⌥⌘B',
  'Ctrl+Shift+D': '⇧⌘D',
  'Ctrl+Shift+F': '⇧⌘F',
  'Ctrl+Shift+M': '⇧⌘M',
  'Ctrl+Shift+O': '⇧⌘O',
  'Ctrl+Shift+Space': '⇧⌘Space',
  'Ctrl+Shift+[': '⌥⌘[',
  'Ctrl+Shift+]': '⌥⌘]',
  'Ctrl+K Ctrl+F': '⌘K ⌘F',
  // Monaco keeps Control for suggest on macOS.
  'Ctrl+Space': '⌃Space',
  'Alt+Z': '⌥Z',
  'Alt+F12': '⌥F12',
  'Shift+F12': '⇧F12',
  'Shift+Alt+F': '⇧⌥F',
  'Shift+Alt+H': '⇧⌥H',
  'Shift+Alt+C': '⇧⌥C',
};

/** The label for a shortcut written in its Windows/Linux form. */
export function platformShortcut(label: string, mac = isMacShortcutPlatform()): string {
  return mac ? (MAC_LABELS[label] ?? label) : label;
}

/** The workbench `mod` key cap: ⌘ on macOS, Ctrl elsewhere. */
export function modKeyCap(mac = isMacShortcutPlatform()): string {
  return mac ? '⌘' : 'Ctrl';
}

/** Key caps for <kbd> rendering: "⇧⌘D" → ['⇧', '⌘', 'D'], "Ctrl+Shift+D" → ['Ctrl', 'Shift', 'D']. */
export function shortcutKeyCaps(label: string, mac = isMacShortcutPlatform()): string[] {
  const shown = platformShortcut(label, mac);
  if (!mac) return shown.split('+');
  const caps: string[] = [];
  for (const char of shown) {
    if ('⌘⇧⌥⌃'.includes(char)) caps.push(char);
    else if (caps.length && !'⌘⇧⌥⌃'.includes(caps[caps.length - 1])) caps[caps.length - 1] += char;
    else caps.push(char);
  }
  return caps;
}
