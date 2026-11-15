// The empty workspace: the COSMOS mark, one tagline and the small set of
// shortcuts that remain useful before a first task exists.
import type React from 'react';

import { CosmosMark } from './cosmos/CosmosParts';
import { t } from './i18n';
import { modKeyCap, shortcutKeyCaps } from './shortcut-display';

/** What a shortcut row does when clicked; rows without a handler stay text. */
export type WorkspaceEmptyAction = 'new-task' | 'sidebar' | 'settings';

/** [label, key caps, click action]; ⌘ on macOS where the workbench binds `mod` to it. */
const WELCOME_SHORTCUTS: ReadonlyArray<readonly [string, string[], WorkspaceEmptyAction | null]> = [
  ['New task', shortcutKeyCaps('Ctrl+N'), 'new-task'],
  ['Switch tab', [modKeyCap(), '←', '/', '→'], null],
  ['Sidebar', shortcutKeyCaps('Ctrl+B'), 'sidebar'],
  ['Open Tandem', shortcutKeyCaps('Ctrl+Shift+D'), null],
  ['Settings', shortcutKeyCaps('Ctrl+,'), 'settings'],
];

function KeyCaps({ keys }: { keys: string[] }): React.JSX.Element {
  return (
    <span className="welcome-keys">
      {keys.map((key, index) =>
        key === '/' ? (
          <i key={index}>/</i>
        ) : (
          <span key={index}>
            {index > 0 && keys[index - 1] !== '/' && !'⌘⇧⌥⌃'.includes(keys[index - 1]) && <i>+</i>}
            <kbd>{key}</kbd>
          </span>
        )
      )}
    </span>
  );
}

/**
 * Every empty pane offers the same primary moves (user: 빈 화면의 주요 동작
 * 통일): the shortcut rows that have an app action are buttons too, so the
 * empty state is usable by pointer as well as by keyboard.
 */
export function WorkspaceEmptyState({
  actions = {},
}: {
  actions?: Partial<Record<WorkspaceEmptyAction, () => void>>;
} = {}): React.JSX.Element {
  return (
    <div className="workspace-empty" data-testid="workspace-empty">
      <div className="thread-welcome">
        <span className="welcome-logo welcome-logo--cosmos" aria-hidden="true">
          <CosmosMark size={132} />
        </span>
        <p className="welcome-tagline">코스모스 · 어느 기기에서든 같은 세션으로</p>
        {/* Product vocabulary has ONE Project concept (user decision) — no
            "workspace" wording anywhere, including assistive labels. */}
        <h1 className="sr-only">COSMOS</h1>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: labels the plain shortcuts container for assistive tech; adding a role would change semantics */}
        <div className="welcome-shortcuts" aria-label={t('Keyboard shortcuts')}>
          {WELCOME_SHORTCUTS.map(([label, keys, action]) => {
            const run = action ? actions[action] : undefined;
            return run ? (
              <button key={label} type="button" className="welcome-shortcut-action" onClick={run}>
                <span>{t(label)}</span>
                <KeyCaps keys={keys} />
              </button>
            ) : (
              <div key={label}>
                <span>{t(label)}</span>
                <KeyCaps keys={keys} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
