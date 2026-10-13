// 조종석 gate for the relay leg: a paired phone may change a project only
// while it holds that planet's seat through this PC. Reads stay open (the
// phone must see what it is about to take over); every lane that writes files,
// moves git, types into a terminal or starts an agent turn asks the seat
// first. Without a Galaxy the gate answers "go ahead", so plain remote access
// is unchanged.
type RemoteMethod = (params: unknown[]) => unknown;

/** Resolves to the refusal text, or null when the write may go ahead. */
export type SeatGate = (cwd: string | null) => Promise<string | null>;

export interface SeatGateResolvers {
  gate: SeatGate;
  /** A registered project id or path → its directory (null when unknown). */
  projectDirectory(projectPath: unknown): Promise<string | null>;
  /** The working directory of a session (null when unknown). */
  sessionCwd(sessionId: unknown): Promise<string | null>;
}

/** Git lanes that change the checkout, the index, refs or the remote. */
export const SEAT_GATED_GIT_METHODS = [
  'gitApplyPatch',
  'gitStage',
  'gitUnstage',
  'gitIgnore',
  'gitCommit',
  'gitCommitPaths',
  'gitAmend',
  'gitUndoLastCommit',
  'gitRevert',
  'gitStash',
  'gitStashPop',
  'gitStashApply',
  'gitStashDrop',
  'gitCheckoutBranch',
  'gitCreateBranch',
  'gitRenameBranch',
  'gitDeleteBranch',
  'gitMergeBranch',
  'gitCreateTag',
  'gitDeleteTag',
  'gitPush',
  'gitPull',
  'gitSync',
  'gitContinue',
  'gitAbortOperation',
  'gitResetToCommit',
  'gitRevertCommit',
  'gitCherryPickCommit',
  'gitCheckoutCommit',
  'gitCreateBranchAtCommit',
] as const;

/** Lanes whose first argument is a registered project. */
export const SEAT_GATED_PROJECT_METHODS = [
  'createProjectEntry',
  'renameProjectEntry',
  'moveProjectEntry',
  'copyProjectEntry',
  'writeProjectFile',
  'replaceWorkspaceText',
  'lspApplyWorkspaceEdit',
] as const;

export class SeatRefusedError extends Error {
  readonly code = 'seat_refused';
}

function guarded(method: RemoteMethod, where: (params: unknown[]) => Promise<string | null>, gate: SeatGate): RemoteMethod {
  return async (params) => {
    const cwd = await where(params).catch(() => null);
    const refusal = await gate(cwd).catch(() => null);
    if (refusal) throw new SeatRefusedError(refusal);
    return method(params);
  };
}

/**
 * Wrap the write lanes of a remote method table in place. Terminal writes are
 * gated by the directory the terminal was opened in.
 */
export function gateRemoteWrites(methods: Record<string, RemoteMethod>, resolvers: SeatGateResolvers): Record<string, RemoteMethod> {
  const { gate, projectDirectory, sessionCwd } = resolvers;
  const wrap = (name: string, where: (params: unknown[]) => Promise<string | null>) => {
    const method = methods[name];
    if (method) methods[name] = guarded(method, where, gate);
  };
  for (const name of SEAT_GATED_GIT_METHODS) {
    wrap(name, async ([cwd]) => (typeof cwd === 'string' && cwd ? cwd : null));
  }
  for (const name of SEAT_GATED_PROJECT_METHODS) wrap(name, ([projectPath]) => projectDirectory(projectPath));
  wrap('submitToSession', ([sessionId]) => sessionCwd(sessionId));
  wrap('submitNewTask', async ([, , draft]) => {
    const projectPath = draft && typeof draft === 'object' ? (draft as { projectPath?: unknown }).projectPath : null;
    return projectPath ? projectDirectory(projectPath) : null;
  });

  const terminalCwd = new Map<string, string | null>();
  const ensure = methods.termEnsure;
  if (ensure) {
    methods.termEnsure = async (params) => {
      const opened = (await ensure(params)) as { id?: unknown } | null;
      if (opened && typeof opened.id === 'string') {
        terminalCwd.set(opened.id, typeof params[1] === 'string' && params[1] ? params[1] : null);
      }
      return opened;
    };
  }
  wrap('termWrite', async ([id]) => terminalCwd.get(String(id || '')) ?? null);
  const dispose = methods.termDispose;
  if (dispose) {
    methods.termDispose = (params) => {
      terminalCwd.delete(String(params[0] || ''));
      return dispose(params);
    };
  }
  return methods;
}
