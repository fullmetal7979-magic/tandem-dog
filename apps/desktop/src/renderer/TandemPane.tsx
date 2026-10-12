import { Github } from 'lucide-react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  TANDEM_DESKS,
  type TandemBranchOverview,
  type TandemDesk,
  type TandemHandoff,
  type TandemLeaveResult,
  type TandemOverview,
  type TandemResumeResult,
} from '../shared/contract-tandem';
import { ErrorNotice } from './ErrorNotice';
import { t } from './i18n';
import { copyTextToClipboard } from './text-format';
import { tandemApiAvailable, useTandemOverview } from './use-tandem-overview';
import { Button, IconButton, TextInput } from './ui/primitives';
import './tandem-pane.css';

type TandemRow = TandemBranchOverview['rows'][number];
type TandemMode = 'desk' | 'leave' | null;
type TandemBusy = 'desk' | 'leave' | 'resume' | null;
type TandemNotice =
  | { kind: 'leave'; result: TandemLeaveResult }
  | { kind: 'resume'; result: TandemResumeResult }
  | null;

const NOW_TICK_MS = 30_000;
const TIMELINE_LENGTH = 8;

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : String(reason ?? '');
}

/** A clock for the relative times; ticks only while the tab shows. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** "just now" / "5 min ago" / "3 h ago" / "2 d ago". */
function ageLabel(at: number, now: number): string {
  if (!Number.isFinite(at)) return '';
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{{minutes}} min ago', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{{hours}} h ago', { hours });
  return t('{{days}} d ago', { days: Math.floor(hours / 24) });
}

/** Handoff stamps are local "YYYY-MM-DD HH:mm" strings. */
function handoffTime(at: string): number {
  return Date.parse(at.replace(' ', 'T'));
}

function relationGlyph(row: TandemRow): { glyph: string; tone: Tone } {
  const { k } = row.rel;
  if (k === 'ok') return { glyph: '=', tone: 'ok' };
  if (k === 'ahead') return { glyph: row.branch?.ahead ? `↑${row.branch.ahead}` : '↑', tone: 'warn' };
  if (k === 'behind') return { glyph: row.branch?.behind ? `↓${row.branch.behind}` : '↓', tone: 'warn' };
  if (k === 'diverged') return { glyph: '↑↓', tone: 'bad' };
  return { glyph: '?', tone: 'muted' };
}

function selectableDesks(overview: TandemOverview): TandemDesk[] {
  const taken = new Set((overview.desks ?? []).map((record) => record.desk));
  const mine = overview.config?.desk ?? null;
  return TANDEM_DESKS.filter((desk) => desk === mine || !taken.has(desk));
}

function leaveSummary(result: TandemLeaveResult): { tone: 'ok' | 'warn'; text: string } {
  const { branch } = result;
  if (result.pushError) {
    return {
      tone: 'warn',
      text: t('Saved {{branch}} on this PC, but the push failed: {{error}}', { branch, error: result.pushError }),
    };
  }
  if (result.pushed) {
    return {
      tone: 'ok',
      text: result.committed
        ? t('Committed and pushed {{branch}}.', { branch })
        : t('Nothing new to commit. {{branch}} is pushed.', { branch }),
    };
  }
  return { tone: 'ok', text: t('Handoff logged on {{branch}}.', { branch }) };
}

function Pill({ tone, children, ...rest }: { tone: Tone; children: ReactNode; [attr: `data-${string}`]: string | undefined; title?: string }) {
  return (
    <span className={`tdm-pill tdm-pill--${tone}`} {...rest}>
      {children}
    </span>
  );
}

function DeskBadge({ desk, accent = false }: { desk: string; accent?: boolean }) {
  return (
    <span className={cx('tdm-badge', accent && 'tdm-badge--accent')} data-tandem-desk={desk}>
      {desk}
    </span>
  );
}

function LatestMarker({ localOnly }: { localOnly: boolean }) {
  return (
    <span className="tdm-pill tdm-pill--latest" data-tandem-latest={localOnly ? 'local' : 'true'}>
      <span aria-hidden="true">♛</span>
      {localOnly ? t('latest · local only') : t('latest')}
    </span>
  );
}

function Section({ title, kind, children }: { title: string; kind: 'map' | 'session' | 'timeline'; children: ReactNode }) {
  return (
    <section aria-label={title} className={`tdm-section tdm-section--${kind}`}>
      <h3 className="tdm-section-title">{title}</h3>
      {children}
    </section>
  );
}

function GithubRow({ focus, now }: { focus: TandemBranchOverview; now: number }) {
  const { gh } = focus;
  const latest = focus.latest.where.includes('github');
  return (
    <li className="tdm-row" data-tandem-row="github">
      <span className="tdm-badge">
        <Github size={12} aria-hidden="true" />
      </span>
      <div className="tdm-row-main">
        <div className="tdm-line">
          <b>GitHub</b>
          {gh && <code className="tdm-mono tdm-muted">{gh.head.slice(0, 7)}</code>}
          {gh && <span className="tdm-trail">{ageLabel(gh.ts * 1000, now)}</span>}
        </div>
        <div className="tdm-wrap">
          {latest && <LatestMarker localOnly={false} />}
          <span className="tdm-subject tdm-ellipsis">
            {gh ? gh.subject : t('No copy of this branch on GitHub yet')}
          </span>
        </div>
      </div>
    </li>
  );
}

function DeskRow({
  row,
  focus,
  mine,
  now,
}: {
  row: TandemRow;
  focus: TandemBranchOverview;
  mine: boolean;
  now: number;
}) {
  const latest = focus.latest.where.includes(row.desk);
  const holding = focus.holder === row.desk;
  const relation = relationGlyph(row);
  return (
    <li
      data-tandem-row={row.desk}
      data-rel={row.rel.k}
      data-current={row.current ? 'true' : 'false'}
      title={t('Published {{age}}', { age: ageLabel(row.at, now) })}
      className="tdm-row"
    >
      <DeskBadge desk={row.desk} accent={mine} />
      <div className="tdm-row-main">
        <div className="tdm-line">
          <b className="tdm-tool tdm-ellipsis">{row.tool || t('No account label')}</b>
          <span className="tdm-host tdm-ellipsis">{row.host}</span>
          {mine && <Pill tone="accent">{t('this PC')}</Pill>}
          <span className="tdm-trail">
            <Pill tone={relation.tone} data-tandem-rel={row.rel.k} title={row.rel.label}>
              {relation.glyph}
            </Pill>
          </span>
        </div>
        <div className="tdm-wrap">
          {latest && <LatestMarker localOnly={focus.latest.localOnly} />}
          {holding && <Pill tone="ok">{t('holding')}</Pill>}
          <span className="tdm-muted tdm-hide-compact">
            {row.dirty > 0 ? `${row.rel.label} · ${t('{{n}} modified', { n: row.dirty })}` : row.rel.label}
          </span>
        </div>
      </div>
    </li>
  );
}

function DeskForm({
  overview,
  busy,
  onSubmit,
  onCancel,
}: {
  overview: TandemOverview;
  busy: boolean;
  onSubmit(desk: TandemDesk, tool: string): void;
  onCancel(): void;
}) {
  const options = selectableDesks(overview);
  const [desk, setDesk] = useState<TandemDesk | null>(overview.config?.desk ?? options[0] ?? null);
  const [tool, setTool] = useState(overview.config?.tool ?? '');
  return (
    <form
      data-tandem-form="desk"
      className="tdm-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (desk) onSubmit(desk, tool.trim());
      }}
    >
      {options.length === 0 ? (
        <p className="tdm-p tdm-muted">{t('Every desk letter is already taken.')}</p>
      ) : (
        <div role="radiogroup" aria-label={t('Desk letter')} className="tdm-letters">
          {options.map((letter) => (
            <Button
              key={letter}
              size="xs"
              role="radio"
              aria-checked={desk === letter}
              variant={desk === letter ? 'primary' : 'secondary'}
              onClick={() => setDesk(letter)}
            >
              {letter}
            </Button>
          ))}
        </div>
      )}
      <TextInput
        value={tool}
        onChange={(event) => setTool(event.currentTarget.value)}
        placeholder={t('Account label, e.g. Claude personal')}
        aria-label={t('Account label')}
        maxLength={40}
      />
      <div className="tdm-actions">
        <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!desk}>
          {t('Save desk')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}

function LeaveForm({
  initialNext,
  busy,
  onSubmit,
  onCancel,
}: {
  initialNext: string;
  busy: boolean;
  onSubmit(memo: string, next: string): void;
  onCancel(): void;
}) {
  const [memo, setMemo] = useState('');
  const [next, setNext] = useState(initialNext);
  return (
    <form
      data-tandem-form="leave"
      className="tdm-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(memo.trim(), next.trim());
      }}
    >
      <textarea
        className="mx-input tdm-field"
        rows={2}
        value={memo}
        onChange={(event) => setMemo(event.currentTarget.value)}
        placeholder={t('What did you do on this PC?')}
        aria-label={t('Handoff memo')}
      />
      <textarea
        className="mx-input tdm-field"
        rows={2}
        value={next}
        onChange={(event) => setNext(event.currentTarget.value)}
        placeholder={t('What should the next PC do first?')}
        aria-label={t('Next step')}
      />
      <div className="tdm-actions">
        <Button type="submit" size="sm" variant="primary" busy={busy}>
          {t('Commit, push and leave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('Cancel')}
        </Button>
      </div>
    </form>
  );
}

function ResumeNotice({ result, onDismiss }: { result: TandemResumeResult; onDismiss(): void }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copyPrompt = async () => {
    let outcome: 'copied' | 'failed' = 'copied';
    try {
      await copyTextToClipboard(result.prompt);
    } catch {
      outcome = 'failed';
    }
    setCopy(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopy('idle'), 2_000);
  };
  return (
    <div data-tandem-notice="resume" className="tdm-notice">
      <div className="tdm-line">
        <b className="tdm-ellipsis tdm-grow">{t('Resumed {{branch}}', { branch: result.branch })}</b>
        <IconButton icon="close-small" label={t('Dismiss')} onClick={onDismiss} />
      </div>
      {result.pullError && (
        <p className="tdm-p tdm-warn-text">{t('Pull failed: {{error}}', { error: result.pullError })}</p>
      )}
      <p className="tdm-p tdm-muted">
        {t(
          'Claude Code and Mixdog read .tandem/SESSION.md automatically. Other agents can start from this prompt:'
        )}
      </p>
      <pre data-tandem-prompt="" className="tdm-prompt">
        {result.prompt}
      </pre>
      <div>
        <Button size="sm" icon={copy === 'copied' ? 'check' : 'copy'} onClick={() => void copyPrompt()}>
          {copy === 'copied' ? t('Copied') : copy === 'failed' ? t('Copy failed') : t('Copy')}
        </Button>
      </div>
    </div>
  );
}

function LeaveNotice({ result, onDismiss }: { result: TandemLeaveResult; onDismiss(): void }) {
  const summary = leaveSummary(result);
  return (
    <div data-tandem-notice="leave" className="tdm-notice">
      <div className="tdm-line">
        <span className={cx('tdm-grow', summary.tone === 'warn' ? 'tdm-warn-text' : 'tdm-ok-text')}>{summary.text}</span>
        <IconButton icon="close-small" label={t('Dismiss')} onClick={onDismiss} />
      </div>
    </div>
  );
}

function SessionCard({ overview }: { overview: TandemOverview }) {
  const session = overview.session;
  if (!session) {
    return <p className="tdm-p tdm-muted">{t('No shared session yet. Leave from a PC to start one.')}</p>;
  }
  const decisions = session.decisions.filter(Boolean);
  const field = (name: string, value: string) => (
    <div className="tdm-session-item">
      <dt>{name}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
  return (
    <dl data-tandem-session="" className="tdm-session">
      {field(t('Goal'), session.goal)}
      {field(t('Next step'), session.next)}
      <div className="tdm-session-item">
        <dt>{t('Decisions')}</dt>
        <dd>
          {decisions.length === 0 ? (
            '—'
          ) : (
            <ul className="tdm-decisions">
              {decisions.map((decision, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional read-only list; identical lines may repeat
                <li key={`${index}:${decision}`}>{decision}</li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );
}

function Timeline({ handoffs, now }: { handoffs: readonly TandemHandoff[]; now: number }) {
  const recent = handoffs.slice(-TIMELINE_LENGTH).reverse();
  if (recent.length === 0) return <p className="tdm-p tdm-muted">{t('No handoffs yet.')}</p>;
  return (
    <ol data-tandem-timeline="" className="tdm-timeline">
      {recent.map((entry, index) => {
        const kindLabel = entry.kind === 'leave' ? t('Left') : entry.kind === 'resume' ? t('Resumed') : t('Note');
        const kindTone: Tone = entry.kind === 'leave' ? 'warn' : entry.kind === 'resume' ? 'ok' : 'muted';
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only and may repeat a stamp
            key={`${entry.at}:${index}`}
            data-tandem-handoff={entry.kind}
            className="tdm-entry"
          >
            <div className="tdm-line">
              <DeskBadge desk={entry.desk} />
              <Pill tone={kindTone}>{kindLabel}</Pill>
              {entry.branch && <code className="tdm-mono tdm-ellipsis tdm-hide-compact">{entry.branch}</code>}
              <span className="tdm-trail" title={entry.at}>
                {ageLabel(handoffTime(entry.at), now)}
              </span>
            </div>
            <div className="tdm-entry-note">
              {entry.tool}
              {entry.memo ? ` · ${entry.memo}` : ''}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TandemContent({
  projectPath,
  overview,
  fetchedAt,
  loading,
  error,
  refresh,
  now,
}: {
  projectPath: string;
  overview: TandemOverview;
  fetchedAt: number | null;
  loading: boolean;
  error: string;
  refresh(options?: { fetch?: boolean; force?: boolean }): Promise<void>;
  now: number;
}) {
  const [mode, setMode] = useState<TandemMode>(null);
  const [busy, setBusy] = useState<TandemBusy>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState<TandemNotice>(null);
  const { config, focus } = overview;
  const desk = config?.desk ?? null;
  const api = window.mixdogDesktop;
  const holding = Boolean(desk && focus && focus.holder === desk);
  let action: 'desk' | 'leave' | 'resume' | null = null;
  if (config) {
    if (desk === null) action = 'desk';
    else if (focus) action = holding ? 'leave' : 'resume';
  }
  const supported =
    action === 'desk'
      ? typeof api?.tandemSetDesk === 'function'
      : action === 'leave'
        ? typeof api?.tandemLeave === 'function'
        : action === 'resume'
          ? typeof api?.tandemResume === 'function'
          : false;

  const run = async (kind: Exclude<TandemBusy, null>, task: () => Promise<void>) => {
    setBusy(kind);
    setActionError('');
    try {
      await task();
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setBusy(null);
    }
  };
  const saveDesk = (nextDesk: TandemDesk, tool: string) =>
    run('desk', async () => {
      await window.mixdogDesktop?.tandemSetDesk?.(projectPath, { desk: nextDesk, tool: tool || null });
      setMode(null);
      await refresh({ fetch: false });
    });
  const leave = (memo: string, next: string) =>
    run('leave', async () => {
      const result = await window.mixdogDesktop?.tandemLeave?.(projectPath, { memo, next });
      setMode(null);
      setNotice(result ? { kind: 'leave', result } : null);
      await refresh({ fetch: true });
    });
  const resume = () =>
    run('resume', async () => {
      const result = await window.mixdogDesktop?.tandemResume?.(projectPath, { branch: focus?.branch ?? null });
      setNotice(result ? { kind: 'resume', result } : null);
      await refresh({ fetch: true });
    });
  const onPrimary = () => {
    setNotice(null);
    setActionError('');
    if (action === 'resume') void resume();
    else setMode((current) => (current === action ? null : action));
  };
  const primaryLabel =
    action === 'desk' ? t("Set this PC's desk") : action === 'leave' ? t('Leave this PC') : t('Resume here');
  const level = focus?.verdict.level ?? 'ok';
  const checked = fetchedAt ? t('Checked {{age}}', { age: ageLabel(fetchedAt, now) }) : '';

  return (
    <div data-tandem-pane="" className="tdm-pane">
      <div className="tdm-layout">
        <section aria-label={t('Tandem status')} className="tdm-hero">
          <div className="tdm-verdict-line">
            <span className="tdm-dot" data-tandem-dot={level} aria-hidden="true" />
            <b className="tdm-verdict" data-tandem-verdict={level} aria-live="polite">
              {focus ? focus.verdict.text : t('No branch to follow yet')}
            </b>
            <IconButton
              icon="refresh"
              label={t('Refresh')}
              disabled={loading}
              aria-busy={loading || undefined}
              onClick={() => void refresh({ fetch: true, force: true })}
            />
          </div>
          <div className="tdm-meta">
            {checked && <span data-tandem-checked="">{checked}</span>}
            {focus && checked && <span aria-hidden="true">·</span>}
            {focus && <code className="tdm-mono tdm-ellipsis">{focus.branch}</code>}
          </div>
          {action && (
            <Button
              className="tdm-primary"
              variant="primary"
              size="md"
              busy={busy === 'resume'}
              disabled={!supported || busy !== null}
              title={supported ? undefined : t('Not available in this app version')}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
          {mode === 'desk' && (
            <DeskForm
              overview={overview}
              busy={busy === 'desk'}
              onSubmit={(nextDesk, tool) => void saveDesk(nextDesk, tool)}
              onCancel={() => setMode(null)}
            />
          )}
          {mode === 'leave' && (
            <LeaveForm
              initialNext={overview.session?.next ?? ''}
              busy={busy === 'leave'}
              onSubmit={(memo, next) => void leave(memo, next)}
              onCancel={() => setMode(null)}
            />
          )}
          {actionError && <ErrorNotice error={actionError} role="status" />}
          {error && <ErrorNotice error={error} role="status" onRetry={() => void refresh({ fetch: true, force: true })} />}
          {notice?.kind === 'resume' && <ResumeNotice result={notice.result} onDismiss={() => setNotice(null)} />}
          {notice?.kind === 'leave' && <LeaveNotice result={notice.result} onDismiss={() => setNotice(null)} />}
        </section>

        {config && desk && (
          <div className="tdm-desk-line">
            <DeskBadge desk={desk} accent />
            <span className="tdm-ellipsis">
              {config.tool || t('No account label')}
              <span className="tdm-host-inline"> · {config.host}</span>
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setMode(mode === 'desk' ? null : 'desk')}
            >
              {t('Change')}
            </Button>
          </div>
        )}

        <div className="tdm-body">
          {focus && (
            <Section title={t('Where is the latest version?')} kind="map">
              <ul data-tandem-map="" className="tdm-list">
                <GithubRow focus={focus} now={now} />
                {focus.rows.map((row) => (
                  <DeskRow key={row.desk} row={row} focus={focus} mine={row.desk === desk} now={now} />
                ))}
              </ul>
            </Section>
          )}

          <Section title={t('Session')} kind="session">
            <SessionCard overview={overview} />
          </Section>

          <Section title={t('Handoffs')} kind="timeline">
            <Timeline handoffs={overview.handoffs ?? []} now={now} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Dock Tandem view: where the latest version of the work lives across PCs and
 *  accounts, with one-click Leave / Resume. */
export const TandemPane = memo(function TandemPane({ projectPath, active }: { projectPath: string; active: boolean }) {
  const { overview, fetchedAt, loading, error, refresh } = useTandemOverview(projectPath, active);
  const now = useNow(active);
  if (!tandemApiAvailable()) {
    return <p className="utility-dock-empty">{t('Tandem is not available in this app version.')}</p>;
  }
  if (!projectPath) return <p className="utility-dock-empty">{t('Open a project to use Tandem.')}</p>;
  if (!overview) {
    if (error) {
      return (
        <div className="tdm-pane">
          <div className="tdm-layout">
          <ErrorNotice error={error} role="status" onRetry={() => void refresh({ fetch: true, force: true })} />
          </div>
        </div>
      );
    }
    return <p className="utility-dock-empty">{t('Loading…')}</p>;
  }
  if (!overview.available) {
    return (
      <div className="utility-dock-empty" data-tandem-unavailable="">
        <div className="tdm-form">
          <span>{overview.reason || t('Open a git project with an origin remote')}</span>
          <Button size="sm" disabled={loading} onClick={() => void refresh({ fetch: true, force: true })}>
            {t('Refresh')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <TandemContent
      key={projectPath}
      projectPath={projectPath}
      overview={overview}
      fetchedAt={fetchedAt}
      loading={loading}
      error={error}
      refresh={refresh}
      now={now}
    />
  );
});
