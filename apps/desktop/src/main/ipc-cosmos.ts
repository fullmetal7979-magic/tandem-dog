import { DESKTOP_IPC } from '../shared/contract';
import type { IpcHandle as Handle } from './ipc';

type CosmosOperations = Record<
  'cosmosOverview' | 'cosmosSun' | 'cosmosMoon' | 'cosmosRequest' | 'cosmosSetStar' | 'cosmosSetupGalaxy' | 'cosmosHeartbeat',
  (...args: unknown[]) => Promise<unknown>
>;

/** COSMOS relay: Galaxy overview, 해/달/교대, star identity and Galaxy setup. The service validates every field. */
export function registerCosmosIpc({ handle, operations }: { handle: Handle; operations: CosmosOperations }): void {
  handle(DESKTOP_IPC.cosmosOverview, (_event, cwd, options) => operations.cosmosOverview(cwd ?? null, options ?? null));
  handle(DESKTOP_IPC.cosmosSun, (_event, cwd, request) => operations.cosmosSun(cwd, request ?? null));
  handle(DESKTOP_IPC.cosmosMoon, (_event, cwd, request) => operations.cosmosMoon(cwd, request ?? null));
  handle(DESKTOP_IPC.cosmosRequest, (_event, cwd, request) => operations.cosmosRequest(cwd, request ?? null));
  handle(DESKTOP_IPC.cosmosSetStar, (_event, request) => operations.cosmosSetStar(request ?? null));
  handle(DESKTOP_IPC.cosmosSetupGalaxy, (_event, request) => operations.cosmosSetupGalaxy(request ?? null));
  handle(DESKTOP_IPC.cosmosHeartbeat, (_event, planets) => operations.cosmosHeartbeat(planets ?? []));
}
