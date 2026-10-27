// The empty workspace: the COSMOS mark, one tagline and the small set of
// shortcuts that remain useful before a first task exists.
import type React from 'react';

import { CosmosMark } from './cosmos/CosmosParts';
import { t } from './i18n';
import { modKeyCap, shortcutKeyCaps } from './shortcut-display';

/** [label, key caps]; ⌘ on macOS where the workbench binds `mod` to it. */
const WELCOME_SHORTCUTS: ReadonlyArray<readonly [string, string[]]> = [
  ['New task', shortcutKeyCaps('Ctrl+N')],
  ['Switch tab', [modKeyCap(), '←', '/', '→']],
  ['Sidebar', shortcutKeyCaps('Ctrl+B')],
  ['Open Tandem', shortcutKeyCaps('Ctrl+Shift+D')],
  ['Settings', shortcutKeyCaps('Ctrl+,')],
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

export function WorkspaceEmptyState(): React.JSX.Element {
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
          {WELCOME_SHORTCUTS.map(([label, keys]) => (
            <div key={label}>
              <span>{t(label)}</span>
              <KeyCaps keys={keys} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
