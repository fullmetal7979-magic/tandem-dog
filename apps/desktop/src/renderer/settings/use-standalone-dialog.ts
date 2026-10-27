// Modality for a dialog that may open on its own (from the title bar) or
// nested inside Settings. On its own it makes the rest of the app inert and
// keeps Tab inside itself, using the same helpers as the Settings dialog.
// Nested, Settings already does both for its nested dialog, so this steps aside.
import { type RefObject, useLayoutEffect } from 'react';
import { FOCUSABLE_SELECTOR, inertBackground, trapTab } from './dialog-modality';

export function useStandaloneDialogModality(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (dialog.parentElement?.closest('[role="dialog"]')) return undefined;
    // The scrim layer is the body child the dialog lives in; everything else goes inert.
    const layer = dialog.parentElement ?? dialog;
    const restoreBackground = inertBackground((element) => element !== layer && !element.contains(layer));
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      trapTab(event, dialog, Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)));
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restoreBackground();
    };
  }, [ref]);
}
