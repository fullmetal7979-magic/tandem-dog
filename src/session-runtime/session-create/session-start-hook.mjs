// session-create/session-start-hook.mjs — the SessionStart project hook:
// best-effort dispatch whose additionalContext lands before the first turn.
import { runAbortable, throwIfAborted } from '../../runtime/shared/abort-race.mjs';
import { loadTandemContext } from '../cwd-plugins/tandem-context.mjs';

function sessionStartSource(reason) {
  const reasonText = String(reason || '');
  if (/resume/i.test(reasonText)) return 'resume';
  if (/clear/i.test(reasonText)) return 'clear';
  return 'startup';
}

/** SessionStart: bridge to the standard project hook bus. Best-effort; a
 *  hook error must never break session creation. additionalContext is
 *  injected before the first user turn as a system-reminder context pair. */
export async function dispatchSessionStart(deps, reason, signal) {
  const { rt, hooks, hookCommonPayload } = deps;
  // Tandem virtual-session block: local, offline, time-boxed and never
  // rejecting, so it runs beside the hooks and survives a hook failure.
  const tandemPending = loadTandemContext(rt.currentCwd);
  try {
    let startContext = '';
    try {
      const startDispatch = await runAbortable(signal, () =>
        hooks.dispatch(
          'SessionStart',
          hookCommonPayload({ session_id: rt.session.id, source: sessionStartSource(reason), model: rt.route.model })
        )
      );
      startContext = Array.isArray(startDispatch?.additionalContext)
        ? startDispatch.additionalContext.join('\n\n')
        : String(startDispatch?.additionalContext || '');
    } catch {
      throwIfAborted(signal);
      // best-effort: ordinary hook failure never breaks session create
    }
    const injected = [startContext, await tandemPending]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
    if (injected) {
      rt.session.messages.push({
        role: 'user',
        content: `<system-reminder>\n# SessionStart Hook Context\n${injected}\n</system-reminder>`,
      });
      rt.session.messages.push({ role: 'assistant', content: '.' });
      rt.session.updatedAt = Date.now();
    }
  } catch {
    throwIfAborted(signal);
    // best-effort: ordinary hook failure never breaks session create
  }
}
