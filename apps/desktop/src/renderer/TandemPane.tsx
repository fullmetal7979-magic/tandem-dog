import { Github } from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

type TandemRow = TandemBranchOverview['rows'][number];
type TandemMode = 'desk' | 'leave' | null;
type TandemBusy = 'desk' | 'leave' | 'resume' | null;
type TandemNotice =
  | { kind: 'leave'; result: TandemLeaveResult }
  | { kind: 'resume'; result: TandemResumeResult }
  | null;

const NOW_TICK_MS = 30_000;
const TIMELINE_LENGTH = 8;

const COLOR = {
  ok: 'var(--mx-success)',
  warn: 'var(--mx-warning)',
  bad: 'var(--mx-danger)',
  muted: 'var(--mx-text-muted)',
  accent: 'var(--mx-text-accent)',
} as const;

const paneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
  padding: '12px 12px 16px',
  fontSize: 'var(--mx-font-minor)',
  lineHeight: 'var(--mx-line-minor)',
  color: 'var(--mx-text)',
};
const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
  padding: 10,
  border: '1px solid var(--mx-border-muted)',
  borderRadius: 'var(--mx-radius-md)',
  background: 'var(--mx-bg-layer-1)',
};
const sectionTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--mx-text-muted)',
  fontSize: 'var(--mx-font-minor)',
  fontWeight: 600,
  letterSpacing: '0.02em',
};
const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const lineStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 };
const ellipsisStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const mutedStyle: CSSProperties = { color: 'var(--mx-text-muted)' };
const wrapStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, minWidth: 0 };
const fieldStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 8px', resize: 'vertical' };

function chipStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    flex: '0 0 auto',
    padding: '0 5px',
    border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    borderRadius: 'var(--mx-radius-sm)',
    color,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: '16px',
  };
}

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

function relationGlyph(row: TandemRow): { glyph: string; color: string } {
  const { k } = row.rel;
  if (k === 'ok') return { glyph: '=', color: COLOR.ok };
  if (k === 'ahead') return { glyph: row.branch?.ahead ? `↑${row.branch.ahead}` : '↑', color: COLOR.warn };
  if (k === 'behind') return { glyph: row.branch?.behind ? `↓${row.branch.behind}` : '↓', color: COLOR.warn };
  if (k === 'diverged') return { glyph: '↑↓', color: COLOR.bad };
  return { glyph: '?', color: COLOR.muted };
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

function DeskBadge({ desk, accent = false }: { desk: string; accent?: boolean }) {
  return (
    <span
      data-tandem-desk={desk}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 20px',
        width: 20,
        height: 20,
        borderRadius: 'var(--mx-radius-sm)',
        color: accent ? 'var(--mx-grey-50)' : 'var(--mx-text)',
        background: accent ? 'var(--mx-accent-bg)' : 'var(--mx-bg-layer-3)',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {desk}
    </span>
  );
}

function LatestMarker({ localOnly }: { localOnly: boolean }) {
  return (
    <span data-tandem-latest={localOnly ? 'local' : 'true'} style={chipStyle(localOnly ? COLOR.warn : COLOR.accent)}>
      <span aria-hidden="true">♛</span>
      {localOnly ? t('latest · local only') : t('latest')}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <h3 style={sectionTitleStyle}>{title}</h3>
      {children}
    </section>
  );
}

function GithubRow({ focus, now }: { focus: TandemBranchOverview; now: number }) {
  const { gh } = focus;
  const latest = focus.latest.where.includes('github');
  return (
    <li data-tandem-row="github" style={{ ...lineStyle, alignItems: 'flex-start' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 20px',
          width: 20,
          height: 20,
          borderRadius: 'var(--mx-radius-sm)',
          background: 'var(--mx-bg-layer-3)',
        }}
      >
        <Github size={12} aria-hidden="true" />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div style={lineStyle}>
          <b>GitHub</b>
          {gh && <code style={{ ...mutedStyle, fontSize: 11 }}>{gh.head}</code>}
          {gh && <span style={{ ...mutedStyle, marginLeft: 'auto' }}>{ageLabel(gh.ts * 1000, now)}</span>}
        </div>
        <div style={wrapStyle}>
          {latest && <LatestMarker localOnly={false} />}
          <span style={{ ...mutedStyle, ...ellipsisStyle, flex: 1 }}>
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
      style={{ ...lineStyle, alignItems: 'flex-start', opacity: row.current ? 1 : 0.8 }}
    >
      <DeskBadge desk={row.desk} accent={mine} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <div style={lineStyle}>
          <b style={{ ...ellipsisStyle, flex: '0 1 auto', maxWidth: '60%' }}>{row.tool || t('No account label')}</b>
          <span style={{ ...mutedStyle, ...ellipsisStyle, flex: '1 1 0' }}>{row.host}</span>
          {mine && <span style={chipStyle(COLOR.accent)}>{t('this PC')}</span>}
          <span
            data-tandem-rel={row.rel.k}
            title={row.rel.label}
            style={{ ...chipStyle(relation.color), marginLeft: 'auto' }}
          >
            {relation.glyph}
          </span>
        </div>
        <div style={wrapStyle}>
          {latest && <LatestMarker localOnly={focus.latest.localOnly} />}
          {holding && <span style={chipStyle(COLOR.ok)}>{t('holding')}</span>}
          <span style={mutedStyle}>
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
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (desk) onSubmit(desk, tool.trim());
      }}
    >
      {options.length === 0 ? (
        <p style={{ ...mutedStyle, margin: 0 }}>{t('Every desk letter is already taken.')}</p>
      ) : (
        <div role="radiogroup" aria-label={t('Desk letter')} style={wrapStyle}>
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
      <div style={wrapStyle}>
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
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(memo.trim(), next.trim());
      }}
    >
      <textarea
        className="mx-input"
        rows={2}
        value={memo}
        onChange={(event) => setMemo(event.currentTarget.value)}
        placeholder={t('What did you do on this PC?')}
        aria-label={t('Handoff memo')}
        style={fieldStyle}
      />
      <textarea
        className="mx-input"
        rows={2}
        value={next}
        onChange={(event) => setNext(event.currentTarget.value)}
        placeholder={t('What should the next PC do first?')}
        aria-label={t('Next step')}
        style={fieldStyle}
      />
      <div style={wrapStyle}>
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
    <div data-tandem-notice="resume" style={{ ...cardStyle, background: 'transparent' }}>
      <div style={lineStyle}>
        <b style={{ ...ellipsisStyle, flex: 1 }}>{t('Resumed {{branch}}', { branch: result.branch })}</b>
        <IconButton icon="close-small" label={t('Dismiss')} onClick={onDismiss} />
      </div>
      {result.pullError && (
        <p style={{ margin: 0, color: COLOR.warn }}>{t('Pull failed: {{error}}', { error: result.pullError })}</p>
      )}
      <p style={{ ...mutedStyle, margin: 0 }}>
        {t(
          'Claude Code and Mixdog read .tandem/SESSION.md automatically. Other agents can start from this prompt:'
        )}
      </p>
      <pre
        data-tandem-prompt=""
        style={{
          margin: 0,
          maxHeight: 120,
          overflow: 'auto',
          padding: 6,
          borderRadius: 'var(--mx-radius-sm)',
          background: 'var(--mx-bg-base)',
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
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
    <div data-tandem-notice="leave" style={{ ...cardStyle, background: 'transparent' }}>
      <div style={lineStyle}>
        <span style={{ flex: 1, color: summary.tone === 'warn' ? COLOR.warn : COLOR.ok }}>{summary.text}</span>
        <IconButton icon="close-small" label={t('Dismiss')} onClick={onDismiss} />
      </div>
    </div>
  );
}

function SessionCard({ overview }: { overview: TandemOverview }) {
  const session = overview.session;
  if (!session) {
    return <p style={{ ...mutedStyle, margin: 0 }}>{t('No shared session yet. Leave from a PC to start one.')}</p>;
  }
  const decisions = session.decisions.filter(Boolean);
  const field = (name: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ ...mutedStyle, fontSize: 11 }}>{name}</span>
      <span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value || '—'}</span>
    </div>
  );
  return (
    <div data-tandem-session="" style={cardStyle}>
      {field(t('Goal'), session.goal)}
      {field(t('Next step'), session.next)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ ...mutedStyle, fontSize: 11 }}>{t('Decisions')}</span>
        {decisions.length === 0 ? (
          <span>—</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, overflowWrap: 'anywhere' }}>
            {decisions.map((decision, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional read-only list; identical lines may repeat
              <li key={`${index}:${decision}`}>{decision}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Timeline({ handoffs, now }: { handoffs: readonly TandemHandoff[]; now: number }) {
  const recent = handoffs.slice(-TIMELINE_LENGTH).reverse();
  if (recent.length === 0) return <p style={{ ...mutedStyle, margin: 0 }}>{t('No handoffs yet.')}</p>;
  return (
    <ol data-tandem-timeline="" style={listStyle}>
      {recent.map((entry, index) => {
        const kindLabel = entry.kind === 'leave' ? t('Left') : entry.kind === 'resume' ? t('Resumed') : t('Note');
        const kindColor = entry.kind === 'leave' ? COLOR.warn : entry.kind === 'resume' ? COLOR.ok : COLOR.muted;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only and may repeat a stamp
            key={`${entry.at}:${index}`}
            data-tandem-handoff={entry.kind}
            style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
          >
            <div style={lineStyle}>
              <DeskBadge desk={entry.desk} />
              <span style={chipStyle(kindColor)}>{kindLabel}</span>
              {entry.branch && <code style={{ ...ellipsisStyle, fontSize: 11 }}>{entry.branch}</code>}
              <span style={{ ...mutedStyle, marginLeft: 'auto', flex: '0 0 auto' }} title={entry.at}>
                {ageLabel(handoffTime(entry.at), now)}
              </span>
            </div>
            <div style={{ ...mutedStyle, overflowWrap: 'anywhere' }}>
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
    <div data-tandem-pane="" style={paneStyle}>
      <section aria-label={t('Tandem status')} style={cardStyle}>
        <div style={lineStyle}>
          <span
            data-tandem-dot={level}
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: COLOR[level],
            }}
          />
          <b data-tandem-verdict={level} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
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
        <div style={{ ...wrapStyle, ...mutedStyle }}>
          {checked && <span data-tandem-checked="">{checked}</span>}
          {focus && checked && <span aria-hidden="true">·</span>}
          {focus && <code style={{ fontSize: 11 }}>{focus.branch}</code>}
        </div>
        {action && (
          <Button
            variant="primary"
            size="md"
            style={{ width: '100%' }}
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
        <div style={{ ...lineStyle, ...mutedStyle }}>
          <DeskBadge desk={desk} accent />
          <span style={{ ...ellipsisStyle, flex: 1 }}>
            {config.tool || t('No account label')} · {config.host}
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

      {focus && (
        <Section title={t('Where is the latest version?')}>
          <ul data-tandem-map="" style={listStyle}>
            <GithubRow focus={focus} now={now} />
            {focus.rows.map((row) => (
              <DeskRow key={row.desk} row={row} focus={focus} mine={row.desk === desk} now={now} />
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('Session')}>
        <SessionCard overview={overview} />
      </Section>

      <Section title={t('Handoffs')}>
        <Timeline handoffs={overview.handoffs ?? []} now={now} />
      </Section>
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
        <div style={paneStyle}>
          <ErrorNotice error={error} role="status" onRetry={() => void refresh({ fetch: true, force: true })} />
        </div>
      );
    }
    return <p className="utility-dock-empty">{t('Loading…')}</p>;
  }
  if (!overview.available) {
    return (
      <div className="utility-dock-empty" data-tandem-unavailable="">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
