export const WORKBENCH_SHORTCUTS = [
  { id: 'new', keys: 'mod+n', label: 'New task' },
  { id: 'quickOpen', keys: 'mod+p', label: 'Quick Open' },
  { id: 'palette', keys: 'shift+mod+p', label: 'Command Palette' },
  { id: 'close', keys: 'mod+w', label: 'Close tab' },
  { id: 'previousTab', keys: 'shift+ctrl+tab', label: 'Previous tab' },
  { id: 'nextTab', keys: 'ctrl+tab', label: 'Next tab' },
  { id: 'previousPane', keys: 'mod+arrowleft', label: 'Previous tab or pane' },
  { id: 'nextPane', keys: 'mod+arrowright', label: 'Next tab or pane' },
  { id: 'paneUp', keys: 'mod+arrowup', label: 'Focus pane above' },
  { id: 'paneDown', keys: 'mod+arrowdown', label: 'Focus pane below' },
  { id: 'leftSidebar', keys: 'mod+b', label: 'Toggle left side bar' },
  { id: 'rightSidebar', keys: 'alt+mod+b', label: 'Toggle right utility panel' },
  { id: 'panel', keys: 'mod+j', label: 'Toggle terminal panel' },
  { id: 'settings', keys: 'mod+,', label: 'Open settings' },
  { id: 'help', keys: 'mod+/', label: 'Show keyboard shortcuts' },
  { id: 'find', keys: 'shift+mod+f', label: 'Find in files' },
  { id: 'sync', keys: 'shift+mod+d', label: 'Device sync' },
  { id: 'sit', keys: 'shift+mod+s', label: 'Continue on this device' },
  { id: 'leave', keys: 'shift+mod+l', label: 'Save and hand off' },
  { id: 'run', keys: 'shift+mod+e', label: 'Open Run (▶ 실행)' },
  { id: 'taskTools', keys: 'shift+mod+k', label: '작업 도구' },
  { id: 'models', keys: 'shift+mod+m', label: 'Select model' },
] as const;
export type WorkbenchShortcut = typeof WORKBENCH_SHORTCUTS[number]['id'];
type ShortcutEvent = Pick<KeyboardEvent, 'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'>;

/** macOS keeps Control for the terminal's readline (Ctrl+W/P/N/B/J) and
 *  Mission Control (Ctrl+Arrow), so `mod` is ⌘ alone there. */
export function isMacShortcutPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform || '';
  return /^mac|iphone|ipad|ipod/i.test(platform);
}

/** The workbench `mod` key: ⌘ on macOS, Ctrl (or the Meta key) elsewhere. */
export function workbenchModPressed(event: Pick<KeyboardEvent, 'ctrlKey'|'metaKey'>, mac = isMacShortcutPlatform()): boolean {
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey || event.metaKey;
}

export function matchesWorkbenchShortcut(event: ShortcutEvent, id: WorkbenchShortcut, mac = isMacShortcutPlatform()): boolean {
  const entry = WORKBENCH_SHORTCUTS.find(item => item.id === id)!;
  const parts = entry.keys.split('+');
  const mod = parts.includes('mod');
  return event.key.toLowerCase() === parts[parts.length - 1] &&
    event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt') &&
    (mod ? workbenchModPressed(event, mac) : (event.ctrlKey === parts.includes('ctrl') && !event.metaKey));
}
export function shortcutLabel(keys: string, mac: boolean): string {
  const labels: Record<string, string> = { mod: mac ? '⌘' : 'Ctrl', ctrl: 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', tab: 'Tab' };
  return keys.split('+').map(part => labels[part] || part.toUpperCase()).join('+');
}

/** ⌘/Ctrl+Shift+K and the composer's 도구 button share one open path: the
 *  shortcut table dispatches this, and the focused pane's composer claims it
 *  with preventDefault(). Returns whether a composer handled it. */
export const OPEN_TASK_TOOLS_EVENT = 'mixdog:open-task-tools';
export function requestOpenTaskTools(): boolean {
  return !window.dispatchEvent(new window.CustomEvent(OPEN_TASK_TOOLS_EVENT, { cancelable: true }));
}
