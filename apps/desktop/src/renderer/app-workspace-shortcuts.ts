import { matchesWorkbenchShortcut as matches } from './workbench-shortcuts';
// THE workbench keymap. One table, resolved in the CAPTURE phase, so every
// surface (xterm, Monaco, composer, Studio prompt) obeys the same bindings
// instead of swallowing them;
// user: 단축키는 우리 걸로 다 인터셉트해서 먼저 처리). Only an open modal
// outranks the table. User-tuned bindings:
// mod+N new task · ctrl+Tab MRU switcher · ctrl+PageUp/PageDown cycle ·
// mod+Left/Right tab traversal, crossing pane boundaries in visual order ·
// mod+Up/Down focus the pane directly above/below (both pairs stay with a
// focused code editor: word jumps and line scrolling are editing keys) ·
// mod+P Quick Open · shift+mod+P Command Palette ·
// mod+, settings · mod+B left sidebar · alt+mod+B right utility dock ·
// mod+J panel ·
// shift+mod+F find in files · shift+mod+D 은하수 · shift+mod+S 이어받기 ·
// shift+mod+L 내려놓기 · shift+mod+E ▶ 실행 · mod+W and ctrl+Q close.
import { useEffect, useRef } from 'react';

import type { WorkspaceTab } from './navigation';
import { modalDialogPresented } from './surface-input-focus';

interface WorkspaceShortcutActions {
  tabs: WorkspaceTab[];
  activeTabKey: string;
  navigateTab: (tab: WorkspaceTab) => void;
  startTask: () => void;
  openSettings: () => void;
  /** mod+/ : the keyboard shortcut reference. */
  openShortcuts?: () => void;
  /** mod+Shift+D : the Galaxy (은하수) dock (multi-PC session). */
  openTandem?: () => void;
  /** mod+Shift+S 이어받기 (sit) / mod+Shift+L 내려놓기 (leave). */
  cosmosSeat?: (action: 'sit' | 'leave') => void;
  /** mod+Shift+E : ▶ the Run pane. (mod+Shift+R is the native Remote Access menu accelerator.) */
  openRun?: () => void;
  toggleSidebar: () => void;
  toggleDock: () => void;
  togglePanel: () => void;
  openQuickAccess: () => void;
  openCommandPalette: () => void;
  openFindInFiles: () => void;
  /** Ctrl+Tab: open or advance the MRU tab switcher. */
  openTabSwitcher: (offset: number) => void;
  /** Move focus to the previous/next pane in visual row-major order. */
  focusSiblingPane: (offset: number) => void;
  /** Move focus to the nearest pane directly above/below. */
  focusVerticalPane: (direction: 'up' | 'down') => void;
  navigateBack: () => void;
  navigateForward: () => void;
}

export function useWorkspaceShortcuts(actions: WorkspaceShortcutActions) {
  // The listener binds once; every render refreshes the callbacks it reads so
  // a shortcut always acts on the current tab set.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const cycleTab = (offset: number, crossPaneBoundary = false) => {
      const { tabs, activeTabKey, navigateTab } = actionsRef.current;
      const index = tabs.findIndex((tab) => tab.key === activeTabKey);
      if (index < 0) return;
      const nextIndex = index + offset;
      const next = crossPaneBoundary ? tabs[nextIndex] : tabs[(nextIndex + tabs.length) % tabs.length];
      if (next) navigateTab(next);
      else if (crossPaneBoundary) actionsRef.current.focusSiblingPane(offset);
    };
    const closeActiveTab = () => {
      // The workspace handles keyboard and pointer close through one path.
      window.dispatchEvent(new window.CustomEvent('mixdog:close-active-tab'));
    };
    /** The keymap itself: returns the command for an event, or null. */
    const resolve = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return null;
      const key = event.key.toLowerCase();
      const plain = !event.shiftKey && !event.altKey;
      const target = event.target as Partial<Element> | null;
      const inEditor = Boolean(target?.closest?.('.monaco-editor'));
      const inTextEntry = Boolean(target?.closest?.('input, textarea, [contenteditable]:not([contenteditable="false"])'));
      // macOS Command+Arrow moves to line/document boundaries in text fields.
      // Let the focused editor/composer own these native editing commands.
      if (plain && event.key.startsWith('Arrow') && (inEditor || (event.metaKey && inTextEntry))) return null;
      if (plain && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const offset = event.key === 'ArrowLeft' ? -1 : 1;
        return () => cycleTab(offset, true);
      }
      if (plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const direction = event.key === 'ArrowUp' ? 'up' : 'down';
        return () => actionsRef.current.focusVerticalPane(direction);
      }
      if (plain && (event.key === 'PageUp' || event.key === 'PageDown')) {
        const offset = event.key === 'PageDown' ? 1 : -1;
        return () => cycleTab(offset);
      }
      if (matches(event, 'nextTab') || matches(event, 'previousTab')) {
        const offset = event.shiftKey ? -1 : 1;
        return () => actionsRef.current.openTabSwitcher(offset);
      }
      if (matches(event, 'quickOpen') || matches(event, 'palette')) {
        return event.shiftKey
          ? () => actionsRef.current.openCommandPalette()
          : () => actionsRef.current.openQuickAccess();
      }
      if (matches(event, 'find')) {
        return () => actionsRef.current.openFindInFiles();
      }
      // Ctrl+B = left side bar, Ctrl+Alt+B = right utility dock (user).
      if (matches(event, 'leftSidebar')) return () => actionsRef.current.toggleSidebar();
      if (matches(event, 'rightSidebar')) {
        return () => actionsRef.current.toggleDock();
      }
      // COSMOS keys. mod+Shift+L is Monaco's "select all occurrences", so the
      // seat-leave key yields inside a focused code editor.
      if (event.shiftKey && !event.altKey) {
        const actions = actionsRef.current;
        if (matches(event, 'sync') && actions.openTandem) return () => actions.openTandem?.();
        if (matches(event, 'sit') && actions.cosmosSeat) return () => actions.cosmosSeat?.('sit');
        if (matches(event, 'leave') && actions.cosmosSeat && !inEditor) return () => actions.cosmosSeat?.('leave');
        if (matches(event, 'run') && actions.openRun) return () => actions.openRun?.();
      }
      if (!plain) return null;
      if (matches(event, 'new')) return () => actionsRef.current.startTask();
      if (matches(event, 'settings')) return () => actionsRef.current.openSettings();
      // mod+/ is also Monaco's "Toggle line comment": leave it to the editor.
      if (matches(event, 'help') && !inEditor && actionsRef.current.openShortcuts) return () => actionsRef.current.openShortcuts?.();
      if (matches(event, 'panel') && !(event.ctrlKey && !event.metaKey && Boolean(target?.closest?.('form.composer textarea')))) return () => actionsRef.current.togglePanel();
      // Command+Q belongs to the native macOS app menu. Ctrl+Q keeps the
      // workbench close binding without intercepting the system Quit command.
      if (matches(event, 'close') || (key === 'q' && event.ctrlKey && !event.metaKey)) return closeActiveTab;
      return null;
    };
    const onShortcutCapture = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // An IME composition owns its own keystrokes until it commits.
      if (event.isComposing || event.keyCode === 229) return;
      // Save/discard and other modal confirmations own every key until they
      // settle, even if focus momentarily remains in the covered editor. Only a
      // PRESENTED dialog counts: Settings and the command surfaces stay mounted
      // while parked, and treating those as modal killed the whole keymap.
      if (modalDialogPresented()) return;
      const run = resolve(event);
      if (!run) return;
      event.preventDefault();
      // Capture + stopImmediatePropagation: xterm, Monaco and the composer
      // never see a workbench shortcut, so the SAME key does the SAME thing on
      // every surface. Keys outside this table stay untouched.
      event.stopImmediatePropagation();
      run();
    };
    window.addEventListener('keydown', onShortcutCapture, true);
    // Event routes for surfaces that reach the workbench without a keystroke
    // (Monaco commands inside a modal diff, menus, mouse back/forward).
    const onCycle = (event: Event) => {
      const offset = Number((event as CustomEvent).detail) || 1;
      cycleTab(offset);
    };
    window.addEventListener('mixdog:cycle-tab', onCycle);
    const onSwitcher = (event: Event) => {
      const offset = Number((event as CustomEvent).detail) || 1;
      actionsRef.current.openTabSwitcher(offset);
    };
    window.addEventListener('mixdog:tab-switcher', onSwitcher);
    const onNavigateHistory = (event: Event) => {
      const offset = Number((event as CustomEvent).detail) || -1;
      if (offset < 0) actionsRef.current.navigateBack();
      else actionsRef.current.navigateForward();
    };
    window.addEventListener('mixdog:navigate-history', onNavigateHistory);
    return () => {
      window.removeEventListener('keydown', onShortcutCapture, true);
      window.removeEventListener('mixdog:cycle-tab', onCycle);
      window.removeEventListener('mixdog:tab-switcher', onSwitcher);
      window.removeEventListener('mixdog:navigate-history', onNavigateHistory);
    };
  }, []);
}
