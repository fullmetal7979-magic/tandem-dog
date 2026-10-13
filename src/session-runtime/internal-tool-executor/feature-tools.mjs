// Optional feature tools gated by settings for model-initiated calls: tidy
// (loaded on first use), and the setup tool.
import { createCallerContextResolvers } from './caller-context.mjs';

export function createFeatureToolHandlers({ rt, setupTool, tidyToolEnabled }) {
  const { sessionIdFor, signalFor } = createCallerContextResolvers(rt);
  const requireEnabled = (callerCtx, enabled, label) => {
    if (callerCtx?.invocationSource === 'model-tool' && !enabled()) {
      throw new Error(`${label} is disabled in settings; start a new session to refresh the tool list`);
    }
  };

  return {
    tidy: async (args, { callerCtx, callerCwd }) => {
      requireEnabled(callerCtx, tidyToolEnabled, 'tidy');
      const { executeTidyTool } = await import('../../runtime/tidy/tool.mjs');
      return await executeTidyTool(args, {
        cwd: callerCwd,
        sessionId: sessionIdFor(callerCtx),
        signal: signalFor(callerCtx),
      });
    },
    setup: async (args, { callerCtx }) => await setupTool.execute(args || {}, { signal: signalFor(callerCtx) }),
  };
}
