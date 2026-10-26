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
export function matchesWorkbenchShortcut(event: Pick<KeyboardEvent, 'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'>, id: WorkbenchShortcut): boolean {
  const entry = WORKBENCH_SHORTCUTS.find(item => item.id === id)!;
  const parts = entry.keys.split('+');
  const mod = parts.includes('mod');
  return event.key.toLowerCase() === parts[parts.length - 1] &&
    event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt') &&
    (mod ? (event.ctrlKey || event.metaKey) : (event.ctrlKey === parts.includes('ctrl') && !event.metaKey));
}
export function shortcutLabel(keys: string, mac: boolean): string {
  const labels: Record<string, string> = { mod: mac ? '⌘' : 'Ctrl', ctrl: 'Ctrl', shift: mac ? '⇧' : 'Shift', alt: mac ? '⌥' : 'Alt', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', tab: 'Tab' };
  return keys.split('+').map(part => labels[part] || part.toUpperCase()).join('+');
}
