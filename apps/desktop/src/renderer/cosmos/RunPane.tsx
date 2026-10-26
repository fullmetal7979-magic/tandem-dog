// ▶ 실행 화면: the project's scripts and make targets as big buttons over their
// run terminals. Each task runs in a terminal of its own: running "test" leaves
// a "dev" server alone, and running the same task again restarts only that
// task's terminal, so output and Ctrl+C behave like a shell and a command is
// never typed into a process that is still running. Every live run gets a tab
// to see and stop it. Running changes the project, so it follows the seat:
// while another device (or the phone) holds it, or while that is still being
// checked, the buttons rest.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { cosmosSeatHeldElsewhere, cosmosSeatUnknown, useCosmos } from './cosmos-store';
import { openCosmosGalaxy } from './CosmosHome';
import { josa } from './cosmos-format';
import {
  makefileName,
  makeTasks,
  orderTasks,
  packageManagerFor,
  packageScriptTasks,
  projectRuns,
  skippedScriptNames,
  startRun,
  type RunTask,
} from './run-tasks';

const TerminalPane = lazy(() => import('../TerminalPane'));

interface Loaded {
  key: string;
  tasks: RunTask[];
  sources: string[];
  /** Scripts left out because their name is not safe to type into a shell. */
  skipped: string[];
  error: string;
}

/** Frees a finished run's PTY together with its xterm view. */
async function releaseRunTerminal(id: string): Promise<void> {
  try {
    await (await import('../TerminalPane')).disposeTerminalPane(id);
  } catch {
    await window.mixdogDesktop?.termDispose?.(id);
  }
}

/** The run tab shown for each project, kept across dock tab switches. */
const shownRuns = new Map<string, string>();
let runCounter = 0;

async function loadTasks(projectPath: string): Promise<Omit<Loaded, 'key'>> {
  const desktop = window.mixdogDesktop;
  if (!desktop?.listProjectDir || !desktop.readProjectFile) return { tasks: [], sources: [], skipped: [], error: '이 화면에서는 실행 목록을 읽을 수 없어요.' };
  const names = (await desktop.listProjectDir(projectPath, '')).filter((entry) => !entry.dir).map((entry) => entry.name);
  const tasks: RunTask[] = [];
  const sources: string[] = [];
  const skipped: string[] = [];
  if (names.includes('package.json')) {
    const pm = packageManagerFor(names);
    const file = await desktop.readProjectFile(projectPath, 'package.json').catch(() => null);
    if (file) {
      tasks.push(...packageScriptTasks(file.content, pm));
      skipped.push(...skippedScriptNames(file.content));
      sources.push(`package.json · ${pm}`);
    }
  }
  const makefile = makefileName(names);
  if (makefile) {
    const file = await desktop.readProjectFile(projectPath, makefile).catch(() => null);
    if (file) {
      tasks.push(...makeTasks(file.content, makefile));
      sources.push(makefile);
    }
  }
  return { tasks: orderTasks(tasks), sources, skipped, error: '' };
}

export function RunPane({ projectPath, active }: { projectPath: string | null; active: boolean }) {
  // A hidden dock tab stops watching the seat (no polling).
  const cosmos = useCosmos(active && projectPath ? projectPath : null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [last, setLast] = useState<{ task: RunTask; at: number } | null>(null);
  const [shown, setShown] = useState<{ key: string; id: string } | null>(null);
  const [notice, setNotice] = useState('');
  const starting = useRef(false);
  const key = projectPath || '';

  const reload = useCallback(() => {
    if (!projectPath) return;
    void loadTasks(projectPath)
      .then((result) => setLoaded({ key: projectPath, ...result }))
      .catch((error) => setLoaded({ key: projectPath, tasks: [], sources: [], skipped: [], error: error instanceof Error ? error.message : String(error) }));
  }, [projectPath]);

  useEffect(() => {
    if (active && projectPath && loaded?.key !== projectPath) reload();
  }, [active, projectPath, loaded?.key, reload]);
  useEffect(() => {
    setLast(null);
    setNotice('');
  }, [key]);

  // Runs that are still going when the pane is left keep their terminals.
  const runs = key ? projectRuns(key) : [];
  const wanted = shown?.key === key ? shown.id : (shownRuns.get(key) ?? '');
  const terminalId = runs.some((entry) => entry.terminalId === wanted) ? wanted : (runs.at(-1)?.terminalId ?? '');
  const held = cosmosSeatHeldElsewhere(cosmos.view);
  const checking = active && cosmosSeatUnknown(cosmos, projectPath);
  const locked = held || checking;
  const showRun = useCallback(
    (id: string) => {
      if (!projectPath) return;
      shownRuns.set(projectPath, id);
      setShown({ key: projectPath, id });
    },
    [projectPath]
  );

  const run = useCallback(
    async (task: RunTask) => {
      const desktop = window.mixdogDesktop;
      if (!projectPath || !desktop?.termEnsure || !desktop.termWrite) return;
      // A second click while the first run is still being set up would type a
      // command into a shell that is not ready (or already busy).
      if (starting.current) {
        setNotice('이미 실행 중이에요. 잠시만 기다려 주세요.');
        return;
      }
      starting.current = true;
      setNotice('');
      try {
        const nonce = `${Date.now().toString(36)}${(runCounter++).toString(36)}`;
        const { terminalId: next } = await startRun(
          {
            termEnsure: (id, cwd, shell) => desktop.termEnsure!(id, cwd, shell),
            termWrite: (id, data) => desktop.termWrite!(id, data),
            release: releaseRunTerminal,
          },
          projectPath,
          task,
          null,
          nonce
        );
        showRun(next);
        setLast({ task, at: Date.now() });
      } catch (error) {
        setNotice(`실행을 시작하지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        starting.current = false;
      }
    },
    [projectPath, showRun]
  );
  const stop = useCallback(() => {
    if (terminalId) window.mixdogDesktop?.termWrite?.(terminalId, '\x03');
  }, [terminalId]);

  if (!projectPath) {
    return <p className="cosmos-empty-note">🪐 프로젝트를 고르면 실행할 수 있는 명령이 여기 나와요.</p>;
  }
  const current = loaded?.key === projectPath ? loaded : null;
  const tasks = current?.tasks ?? [];
  const primary = tasks.filter((task) => task.primary);
  const rest = tasks.filter((task) => !task.primary);
  const visible = showAll || primary.length === 0 ? tasks : primary;
  const taskName = (taskId: string) => tasks.find((task) => task.id === taskId)?.name ?? taskId;
  const shownTask = runs.find((entry) => entry.terminalId === terminalId)?.taskId ?? null;
  const shownCommand = shownTask ? (tasks.find((task) => task.id === shownTask)?.command ?? (last?.task.id === shownTask ? last.task.command : '')) : '';

  return (
    <section className="cosmos-run" aria-label="실행">
      <header className="cosmos-run-head">
        <h2>▶ 실행</h2>
        <span className="cosmos-run-source">{current?.sources.join(' · ') || (current ? '실행할 파일 없음' : '읽는 중…')}</span>
        <button type="button" className="cosmos-link" onClick={reload} title="실행 목록 새로고침" aria-label="실행 목록 새로고침">
          ↻
        </button>
      </header>

      {held && (
        <div className="cosmos-run-locked" role="status">
          🔒 {josa(cosmos.view?.seat?.holder?.name || '다른 기기', '이가')} 작업 중이라 실행이 잠겨 있어요.{' '}
          <button type="button" className="cosmos-link" onClick={openCosmosGalaxy}>
            은하수 보기 →
          </button>
        </div>
      )}
      {checking && (
        <div className="cosmos-run-locked" role="status">
          ⏳ 작업 자리를 확인하는 중이에요. 확인되면 실행할 수 있어요.
        </div>
      )}
      {current?.error && <p className="cosmos-run-error">⚠️ {current.error}</p>}
      {notice && (
        <p className="cosmos-run-error" role="status">
          ⚠️ {notice}
        </p>
      )}
      {current && current.skipped.length > 0 && (
        <p className="cosmos-empty-note">
          이름에 특수문자가 있어 목록에서 뺀 명령 {current.skipped.length}개: {current.skipped.join(', ')}
        </p>
      )}
      {current && !current.error && tasks.length === 0 && (
        <p className="cosmos-empty-note">
          package.json의 scripts나 Makefile이 없어요. 터미널에서 직접 실행하거나, 💬 세션에서 “실행 방법 알려줘”라고 물어보세요.
        </p>
      )}

      <div className="cosmos-run-grid" role="group" aria-label="실행할 명령">
        {visible.map((task) => (
          <button
            key={task.id}
            type="button"
            className={`cosmos-run-task${last?.task.id === task.id ? ' is-last' : ''}`}
            disabled={locked}
            onClick={() => void run(task)}
            title={task.command}
          >
            <span className="cosmos-run-icon" aria-hidden="true">
              {task.icon}
            </span>
            <span className="cosmos-run-name">{task.name}</span>
            <span className="cosmos-run-detail">{task.kind === 'make' ? task.detail : task.command}</span>
          </button>
        ))}
      </div>
      {primary.length > 0 && rest.length > 0 && (
        <button type="button" className="cosmos-link cosmos-run-more" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '자주 쓰는 것만 보기' : `나머지 ${rest.length}개 더 보기`}
        </button>
      )}

      {terminalId && (
        <div className="cosmos-run-terminal">
          {runs.length > 1 && (
            <div className="cosmos-run-tabs" role="group" aria-label="실행 중인 명령">
              {runs.map((entry) => (
                <button
                  key={entry.terminalId}
                  type="button"
                  className={`cosmos-run-tab${entry.terminalId === terminalId ? ' is-on' : ''}`}
                  aria-pressed={entry.terminalId === terminalId}
                  onClick={() => showRun(entry.terminalId)}
                >
                  ▶ {taskName(entry.taskId)}
                </button>
              ))}
            </div>
          )}
          <div className="cosmos-run-terminal-bar">
            <span>
              {shownCommand ? (
                <>
                  ▶ <code>{shownCommand}</code>
                </>
              ) : (
                '실행 터미널'
              )}
            </span>
            <button
              type="button"
              className="cosmos-button cosmos-button--plain"
              onClick={stop}
              disabled={held}
              aria-label={shownTask ? `${taskName(shownTask)} 멈추기` : '실행 멈추기'}
            >
              ⏹ 멈추기
            </button>
          </div>
          <div className="cosmos-run-terminal-body">
            <Suspense fallback={<p className="cosmos-empty-note">터미널 준비 중…</p>}>
              <TerminalPane key={terminalId} cwd={projectPath} terminalId={terminalId} active={active} />
            </Suspense>
          </div>
        </div>
      )}
    </section>
  );
}
