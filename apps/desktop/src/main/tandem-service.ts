import {
  configureGitEnvironment,
  context as tandemCoreContext,
  isValidBranch,
  isValidDesk,
  leave as tandemCoreLeave,
  oneLine,
  overview as tandemCoreOverview,
  readDeskConfig,
  readSession,
  repoRoot,
  resume as tandemCoreResume,
  runGit,
  writeDeskConfig,
  writeSession,
} from '../../../../src/runtime/tandem/tandem-core.mjs';
import type {
  TandemDeskConfig,
  TandemLeaveRequest,
  TandemLeaveResult,
  TandemOverview,
  TandemResumeRequest,
  TandemResumeResult,
  TandemSession,
  TandemSetDeskRequest,
} from '../shared/contract-tandem';
import { childEnvironment } from './child-environment';
import { requiredRepositoryCwd } from './git-contract.mjs';
import { scrubGitCredentials } from './git-runner';

configureGitEnvironment(() => childEnvironment({ GIT_SEQUENCE_EDITOR: 'true' }) as Record<string, string | undefined>);

const MEMO_LIMIT = 500;
const NEXT_LIMIT = 2000;
const SESSION_FIELD_LIMIT = 4000;

/** One mutating Tandem operation per repository at a time (leave/resume/save race otherwise). */
const repoTails = new Map<string, Promise<unknown>>();
function serialized<T>(root: string, run: () => Promise<T>): Promise<T> {
  const prev = repoTails.get(root) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(run);
  const tail = next.catch(() => undefined);
  repoTails.set(root, tail);
  void tail.then(() => {
    if (repoTails.get(root) === tail) repoTails.delete(root);
  });
  return next;
}

function cleanError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(scrubGitCredentials(message));
}

async function resolveRoot(cwd: unknown): Promise<string> {
  try {
    return await repoRoot(requiredRepositoryCwd(cwd));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new Error('This folder is not a git repository.');
  }
}

function boundedText(value: unknown, limit: number, field: string): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError(`${field} must be text.`);
  if (value.length > limit) throw new TypeError(`${field} is too long (max ${limit} characters).`);
  return value;
}

export async function tandemOverview(cwd: unknown, options?: unknown): Promise<TandemOverview> {
  const fetch = !(options && typeof options === 'object' && (options as { fetch?: unknown }).fetch === false);
  let root: string;
  try {
    root = await resolveRoot(cwd);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return { available: false, reason: 'Open a git project to use Tandem.' };
  }
  const origin = await runGit(root, ['remote', 'get-url', 'origin']);
  if (origin.code !== 0) {
    return { available: false, root, reason: 'Add an origin remote (for example on GitHub) so other PCs can follow this session.' };
  }
  try {
    const data = await tandemCoreOverview(root, { fetch });
    return { available: true, root, ...data } as TandemOverview;
  } catch (error) {
    throw cleanError(error);
  }
}

export async function tandemLeave(cwd: unknown, request: unknown): Promise<TandemLeaveResult> {
  const record = (request && typeof request === 'object' ? request : {}) as Partial<TandemLeaveRequest>;
  const memo = oneLine(boundedText(record.memo, MEMO_LIMIT, 'Memo'));
  const next = boundedText(record.next, NEXT_LIMIT, 'Next step');
  const root = await resolveRoot(cwd);
  const config = await readDeskConfig(root);
  if (!config.desk) throw new Error("Set this PC's desk first.");
  return serialized(root, async () => {
    try {
      const result = await tandemCoreLeave(root, { memo, next });
      return { branch: result.branch, committed: result.committed, pushed: result.pushed, pushError: result.pushError ? scrubGitCredentials(result.pushError) : null };
    } catch (error) {
      throw cleanError(error);
    }
  });
}

export async function tandemResume(cwd: unknown, request: unknown): Promise<TandemResumeResult> {
  const record = (request && typeof request === 'object' ? request : {}) as Partial<TandemResumeRequest>;
  const branch = record.branch == null || record.branch === '' ? null : String(record.branch);
  if (branch !== null && !isValidBranch(branch)) throw new TypeError('Branch name is invalid.');
  const root = await resolveRoot(cwd);
  const config = await readDeskConfig(root);
  if (!config.desk) throw new Error("Set this PC's desk first.");
  return serialized(root, async () => {
    try {
      const result = await tandemCoreResume(root, { branch });
      return { branch: result.branch, pulled: result.pulled, pullError: result.pullError ? scrubGitCredentials(result.pullError) : null, prompt: result.prompt };
    } catch (error) {
      throw cleanError(error);
    }
  });
}

export async function tandemSetDesk(cwd: unknown, request: unknown): Promise<TandemDeskConfig> {
  const record = (request && typeof request === 'object' ? request : {}) as Partial<TandemSetDeskRequest>;
  if (typeof record.desk !== 'string' || !isValidDesk(record.desk)) throw new TypeError('Desk must be a letter from A to H.');
  const tool = record.tool == null ? null : oneLine(boundedText(record.tool, 60, 'Account label'));
  const root = await resolveRoot(cwd);
  return serialized(root, async () => {
    await writeDeskConfig(root, { desk: record.desk, tool });
    return (await readDeskConfig(root)) as TandemDeskConfig;
  });
}

export async function tandemContext(cwd: unknown): Promise<string> {
  const root = await resolveRoot(cwd);
  try {
    return await tandemCoreContext(root, { pull: false });
  } catch (error) {
    throw cleanError(error);
  }
}

export async function tandemSaveSession(cwd: unknown, patch: unknown): Promise<TandemSession> {
  const record = (patch && typeof patch === 'object' ? patch : {}) as Partial<TandemSession>;
  const root = await resolveRoot(cwd);
  return serialized(root, async () => {
    const current = (await readSession(root)) ?? { goal: '', state: '', next: '', decisions: [], log: [] };
    const merged = { ...current };
    for (const key of ['goal', 'state', 'next'] as const) {
      if (record[key] !== undefined) merged[key] = boundedText(record[key], SESSION_FIELD_LIMIT, key);
    }
    if (record.decisions !== undefined) {
      if (!Array.isArray(record.decisions) || record.decisions.length > 100) throw new TypeError('Decisions must be a list of at most 100 items.');
      merged.decisions = record.decisions.map((d) => oneLine(boundedText(d, 300, 'Decision'))).filter(Boolean);
    }
    await writeSession(root, merged);
    const saved = (await readSession(root)) ?? merged;
    return { goal: saved.goal, state: saved.state, next: saved.next, decisions: saved.decisions, log: saved.log };
  });
}
