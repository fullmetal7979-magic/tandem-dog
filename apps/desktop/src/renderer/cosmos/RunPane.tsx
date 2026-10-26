// ▶ 실행 화면: the project's scripts and make targets as big buttons over the
// project's run terminal. A button starts its command in a fresh terminal (the
// previous run's is released first), so output and Ctrl+C behave like a shell
// and a command is never typed into a process that is still running. Running
// changes the planet, so it follows the seat: while another star (or the
// phone) holds it, the buttons rest.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useCosmos } from './cosmos-store';
import { openCosmosGalaxy } from './CosmosHome';
import { josa } from './cosmos-format';
import {
  makefileName,
  makeTasks,
  orderTasks,
  packageManagerFor,
  packageScriptTasks,
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

/** The run terminal of each project, kept across tab switches so the next run can release it. */
const activeRuns = new Map<string, string>();
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
  const cosmos = useCosmos(projectPath || '');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [last, setLast] = useState<{ task: RunTask; at: number } | null>(null);
  const [ownRun, setOwnRun] = useState<{ key: string; id: string } | null>(null);
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

  // A run that is still going when the pane is left keeps its terminal on screen.
  const terminalId = ownRun?.key === key ? ownRun.id : (activeRuns.get(key) ?? '');
  const state = cosmos.view?.state ?? null;
  const locked = state === 'occupied' || state === 'stale' || state === 'remote';

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
          activeRuns.get(projectPath) ?? null,
          nonce
        );
        activeRuns.set(projectPath, next);
        setOwnRun({ key: projectPath, id: next });
        setLast({ task, at: Date.now() });
      } catch (error) {
        setNotice(`실행을 시작하지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        starting.current = false;
      }
    },
    [projectPath]
  );
  const stop = useCallback(() => {
    if (terminalId) window.mixdogDesktop?.termWrite?.(terminalId, '\x03');
  }, [terminalId]);

  if (!projectPath) {
    return <p className="cosmos-empty-note">🪐 행성(프로젝트)을 고르면 실행할 수 있는 명령이 여기 나와요.</p>;
  }
  const current = loaded?.key === projectPath ? loaded : null;
  const tasks = current?.tasks ?? [];
  const primary = tasks.filter((task) => task.primary);
  const rest = tasks.filter((task) => !task.primary);
  const visible = showAll || primary.length === 0 ? tasks : primary;

  return (
    <section className="cosmos-run" aria-label="실행">
      <header className="cosmos-run-head">
        <h2>▶ 실행</h2>
        <span className="cosmos-run-source">{current?.sources.join(' · ') || (current ? '실행할 파일 없음' : '읽는 중…')}</span>
        <button type="button" className="cosmos-link" onClick={reload} title="목록 새로고침">
          ↻
        </button>
      </header>

      {locked && (
        <div className="cosmos-run-locked" role="status">
          🔒 {josa(cosmos.view?.seat?.holder?.name || '다른 기기', '이가')} 작업 중이라 실행이 잠겨 있어요.{' '}
          <button type="button" className="cosmos-link" onClick={openCosmosGalaxy}>
            우주 지도 →
          </button>
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
          package.json 의 scripts 나 Makefile 이 없어요. 터미널에서 직접 실행하거나, 💬 교신에 “실행 방법 알려줘”라고 물어보세요.
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
          <div className="cosmos-run-terminal-bar">
            <span>
              {last ? (
                <>
                  ▶ <code>{last.task.command}</code>
                </>
              ) : (
                '실행 터미널'
              )}
            </span>
            <button type="button" className="cosmos-button cosmos-button--plain" onClick={stop} disabled={locked}>
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
