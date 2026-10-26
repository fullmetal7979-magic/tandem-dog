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
  /**
   * The folder a terminal was opened in, as the host knows it: null for a
   * terminal with no folder, undefined for an id the host has never seen.
   * Without it, PC-owned terminals (the ▶ 실행 terminal included) are judged
   * against every registered project instead.
   */
  terminalCwd?(terminalId: string): Promise<string | null | undefined> | string | null | undefined;
  /** Every registered project directory; the fallback judge of an unknown terminal. */
  projectDirectories?(): Promise<string[]>;
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
  // The GitHub lane creates PRs, issues and comments in the repo's name.
  'githubRequest',
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

/** Lanes whose first argument is a folder that must be one of the host's registered projects. */
export const SEAT_GATED_PROJECT_CWD_METHODS = ['cosmosContinueConversation'] as const;

export class SeatRefusedError extends Error {
  readonly code = 'seat_refused';
}

/** Said when the seat could not be checked: a write never goes ahead on a guess. */
export const SEAT_UNVERIFIED_MESSAGE = '🔒 작업 상태를 확인하지 못해서 안전하게 막았어요. 잠시 뒤 다시 시도해 주세요.';

/** Ask the seat for one folder; a refusal and a failed check both come back as a SeatRefusedError. */
async function checked(gate: SeatGate, cwd: string | null): Promise<void> {
  let refusal: string | null;
  try {
    refusal = await gate(cwd);
  } catch {
    throw new SeatRefusedError(SEAT_UNVERIFIED_MESSAGE);
  }
  if (refusal) throw new SeatRefusedError(refusal);
}

function guarded(method: RemoteMethod, where: (params: unknown[]) => Promise<string | null>, gate: SeatGate): RemoteMethod {
  return async (params) => {
    let cwd: string | null;
    try {
      cwd = await where(params);
    } catch {
      throw new SeatRefusedError(SEAT_UNVERIFIED_MESSAGE);
    }
    await checked(gate, cwd);
    return method(params);
  };
}

/** A terminal verdict is reused briefly: keystrokes arrive far faster than the seat can change. */
const TERMINAL_VERDICT_MS = 1_500;

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
  for (const name of SEAT_GATED_PROJECT_CWD_METHODS) wrap(name, ([cwd]) => projectDirectory(cwd));
  wrap('submitToSession', ([sessionId]) => sessionCwd(sessionId));
  wrap('submitNewTask', async ([, , draft]) => {
    const projectPath = draft && typeof draft === 'object' ? (draft as { projectPath?: unknown }).projectPath : null;
    return projectPath ? projectDirectory(projectPath) : null;
  });

  // Terminals the phone opened remember the folder the host actually opened
  // them in: never the folder the phone asked for, since ensuring an id that
  // already runs on the PC reuses that PTY wherever it lives. The rest (the
  // PC's own, term_cosmos_run_* among them) are looked up host-side, and when
  // even the host cannot say, every registered project must pass.
  const terminalCwd = new Map<string, string | null>();
  const verdicts = new Map<string, { at: number; refusal: Promise<string | null> }>();
  const ensure = methods.termEnsure;
  if (ensure) {
    methods.termEnsure = async (params) => {
      const opened = (await ensure(params)) as { id?: unknown } | null;
      if (opened && typeof opened.id === 'string') {
        let cwd: string | null | undefined;
        try {
          cwd = resolvers.terminalCwd ? await resolvers.terminalCwd(opened.id) : undefined;
        } catch {
          cwd = undefined;
        }
        // Unknown to the host: judged per write by the every-project fallback.
        if (cwd === undefined) terminalCwd.delete(opened.id);
        else terminalCwd.set(opened.id, typeof cwd === 'string' && cwd ? cwd : null);
        verdicts.delete(opened.id);
      }
      return opened;
    };
  }
  const terminalRefusal = async (id: string): Promise<string | null> => {
    try {
      let cwd: string | null | undefined = terminalCwd.has(id) ? terminalCwd.get(id) : undefined;
      if (cwd === undefined && resolvers.terminalCwd) cwd = await resolvers.terminalCwd(id);
      if (cwd !== undefined) return await gate(cwd);
      const folders = resolvers.projectDirectories ? await resolvers.projectDirectories() : [];
      if (!folders.length) return await gate(null);
      for (const folder of folders) {
        const refusal = await gate(folder);
        if (refusal) return refusal;
      }
      return null;
    } catch {
      return SEAT_UNVERIFIED_MESSAGE;
    }
  };
  const write = methods.termWrite;
  if (write) {
    methods.termWrite = async (params) => {
      const id = String(params[0] || '');
      const now = Date.now();
      let verdict = verdicts.get(id);
      if (!verdict || now - verdict.at > TERMINAL_VERDICT_MS) {
        verdict = { at: now, refusal: terminalRefusal(id) };
        verdicts.set(id, verdict);
        if (verdicts.size > 256) verdicts.delete(verdicts.keys().next().value as string);
      }
      const refusal = await verdict.refusal;
      if (refusal) throw new SeatRefusedError(refusal);
      return write(params);
    };
  }
  const dispose = methods.termDispose;
  if (dispose) {
    methods.termDispose = (params) => {
      terminalCwd.delete(String(params[0] || ''));
      verdicts.delete(String(params[0] || ''));
      return dispose(params);
    };
  }
  return methods;
}
