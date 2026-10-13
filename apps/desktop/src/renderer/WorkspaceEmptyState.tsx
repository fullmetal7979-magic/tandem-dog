// The empty workspace: the COSMOS mark, one tagline and the small set of
// shortcuts that remain useful before a first task exists.
import type React from 'react';

import { CosmosMark } from './cosmos/CosmosParts';
import { t } from './i18n';

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
          <div>
            <span>{t('New task')}</span>
            <span className="welcome-keys">
              <kbd>Ctrl</kbd>
              <i>+</i>
              <kbd>N</kbd>
            </span>
          </div>
          <div>
            <span>{t('Switch tab')}</span>
            <span className="welcome-keys">
              <kbd>Ctrl</kbd>
              <i>+</i>
              <kbd>←</kbd>
              <i>/</i>
              <kbd>→</kbd>
            </span>
          </div>
          <div>
            <span>{t('Sidebar')}</span>
            <span className="welcome-keys">
              <kbd>Ctrl</kbd>
              <i>+</i>
              <kbd>B</kbd>
            </span>
          </div>
          <div>
            <span>{t('Settings')}</span>
            <span className="welcome-keys">
              <kbd>Ctrl</kbd>
              <i>+</i>
              <kbd>,</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
