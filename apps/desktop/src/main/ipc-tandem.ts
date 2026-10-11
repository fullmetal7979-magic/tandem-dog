import { DESKTOP_IPC } from '../shared/contract';
import { requiredRepositoryCwd } from './git-contract.mjs';
import type { IpcHandle as Handle } from './ipc';

type TandemOperations = Record<
  'tandemOverview' | 'tandemLeave' | 'tandemResume' | 'tandemSetDesk' | 'tandemContext' | 'tandemSaveSession',
  (...args: unknown[]) => Promise<unknown>
>;

/** Plain-object request payloads only; the daemon validates every field. */
function requestObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** Tandem dock: multi-PC session continuity over the project's git remote. */
export function registerTandemIpc({ handle, operations }: { handle: Handle; operations: TandemOperations }): void {
  handle(DESKTOP_IPC.tandemOverview, (_event, cwd, options) =>
    operations.tandemOverview(requiredRepositoryCwd(cwd), requestObject(options))
  );
  handle(DESKTOP_IPC.tandemLeave, (_event, cwd, request) =>
    operations.tandemLeave(requiredRepositoryCwd(cwd), requestObject(request))
  );
  handle(DESKTOP_IPC.tandemResume, (_event, cwd, request) =>
    operations.tandemResume(requiredRepositoryCwd(cwd), requestObject(request))
  );
  handle(DESKTOP_IPC.tandemSetDesk, (_event, cwd, request) =>
    operations.tandemSetDesk(requiredRepositoryCwd(cwd), requestObject(request))
  );
  handle(DESKTOP_IPC.tandemContext, (_event, cwd) => operations.tandemContext(requiredRepositoryCwd(cwd)));
  handle(DESKTOP_IPC.tandemSaveSession, (_event, cwd, session) =>
    operations.tandemSaveSession(requiredRepositoryCwd(cwd), requestObject(session))
  );
}
