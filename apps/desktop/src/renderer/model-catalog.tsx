import { Check, Plus, Search, Star, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DesktopModelOption } from '../shared/contract';
import { t } from './i18n';
import { ErrorNotice } from './ErrorNotice';
import { PaneSurfaceGate } from './PaneSurfaceGate';
import { record } from './record-utils';
import {
  modelDisplayName,
  formatContextWindow,
  modelContextWindow,
  modelOptionDescription,
  ProviderIcon,
  providerDisplayName,
  providerDisplayRank,
} from './provider-display';
import type { RecordValue } from './desktop-types';

const RECENT_MODELS_KEY = 'mixdog.desktop-recent-models';
const RECENT_MODELS_LIMIT = 7;
const FAVORITE_MODELS_KEY = 'cosmos.desktop-favorite-models';
const FAVORITE_MODELS_LIMIT = 12;
function readFavoriteModelKeys(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FAVORITE_MODELS_KEY) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === 'string'))].slice(0, FAVORITE_MODELS_LIMIT) : [];
  } catch { return []; }
}
// A drilled catalog can unmount between choices; acknowledgement order must
// not rewind recents across catalog instances.
let latestModelChoice = 0;

function providerSetupEntries(value: unknown): Array<RecordValue & { group: 'api' | 'oauth' | 'local' }> {
  const setup = record(value);
  return (['api', 'oauth', 'local'] as const).flatMap((group) => {
    const entries = setup[group];
    return Array.isArray(entries)
      ? entries.map(record).map((entry) => ({ ...entry, group }) as RecordValue & { group: typeof group })
      : [];
  });
}

export function filterConfiguredModels(
  models: DesktopModelOption[],
  providerSetup: unknown,
  providerSetupError = ''
): DesktopModelOption[] {
  if (providerSetup == null || providerSetupError) return models;
  const entries = providerSetupEntries(providerSetup);
  return models.filter((model) => {
    const provider = entries.find((entry) => String(entry.id || entry.provider || '') === model.provider);
    if (!provider) return false;
    if (provider.custom === true) return provider.enabled !== false && provider.authenticated !== false;
    return provider.group === 'local'
      ? provider.detected === true && provider.enabled === true
      : provider.authenticated === true;
  });
}

/** Touch surfaces raise the on-screen keyboard on focus. */
function coarsePointer(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}

function modelKey(option: DesktopModelOption, scope = ''): string {
  return `${scope}model:${option.provider}:${option.model}`;
}

function readRecentModelKeys(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_MODELS_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, RECENT_MODELS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeRecentModelKeys(keys: string[]): void {
  try {
    window.localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(keys));
  } catch {
    // Selection still works when storage is unavailable.
  }
}

function emptyCatalogText(loading: boolean, hasQuery: boolean): string {
  if (loading) return t('Loading models…');
  return hasQuery ? t('No matching models.') : t('No connected provider models.');
}

export function ModelCatalog({
  models,
  provider,
  model,
  active = true,
  catalogLoaded = true,
  catalogRefreshing = false,
  catalogError = '',
  providerSetupError = '',
  onSelect,
  onOpenProviders,
  onClose,
}: {
  models: DesktopModelOption[];
  provider: string;
  model: string;
  active?: boolean;
  catalogLoaded?: boolean;
  catalogRefreshing?: boolean;
  catalogError?: string;
  providerSetupError?: string;
  onSelect(option: DesktopModelOption): unknown;
  onOpenProviders?: () => void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(readFavoriteModelKeys);
  const [activeRowKey, setActiveRowKey] = useState('');
  const [recentModelKeys, setRecentModelKeys] = useState<string[]>(readRecentModelKeys);
  const dialog = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const modelList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The composer's flyout keeps this catalog MOUNTED while it is hidden, so
    // the typed filter outlived its close and still trimmed the list at the
    // next open (user: 모델 선택하고 닫았는데 타이핑한게 남아있지 않게). The
    // close drops the query; the open re-reads recents and re-centers.
    if (!active) {
      setQuery('');
      return;
    }
    setRecentModelKeys(readRecentModelKeys());
    setFavoriteKeys(readFavoriteModelKeys());
    // Opening the list must not summon the keyboard on a phone: it covered
    // half the catalog before a single row was read (user: 검색창 터치도 안
    // 했는데 바로 타이핑창 열리게 하지 말고). The field waits for a tap.
    if (!coarsePointer()) search.current?.focus({ preventScroll: true });
    modelList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [active]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is a deliberate trigger; a new filter resets the list scroll.
  useEffect(() => {
    if (active && modelList.current) modelList.current.scrollTop = 0;
  }, [active, query]);

  const providerEntries = useMemo(() => {
    const entries = new Map<string, DesktopModelOption[]>();
    for (const option of models) {
      const options = entries.get(option.provider) || [];
      options.push(option);
      entries.set(option.provider, options);
    }
    return [...entries].sort(
      ([left], [right]) =>
        providerDisplayRank(left) - providerDisplayRank(right) ||
        providerDisplayName(left).localeCompare(providerDisplayName(right)) ||
        left.localeCompare(right)
    );
  }, [models]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (option: DesktopModelOption) =>
    !normalizedQuery ||
    `${option.provider} ${providerDisplayName(option.provider)} ${option.model} ${option.display} ${modelDisplayName(option.model, option.provider, option.display)} ${modelOptionDescription(option)}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  const visibleProviderEntries = providerEntries
    .map(([entryProvider, options]) => [entryProvider, options.filter(matchesQuery)] as const)
    .filter(([, options]) => options.length > 0);
  const favoriteModels = favoriteKeys.flatMap((key) => {
    const option = models.find((entry) => modelKey(entry) === key);
    return option && matchesQuery(option) ? [option] : [];
  });
  const currentOption = models.find((entry) => entry.provider === provider && entry.model === model);
  const currentFavorite = Boolean(currentOption && favoriteKeys.includes(modelKey(currentOption)));
  const toggleFavorite = () => {
    if (!currentOption) return;
    const key = modelKey(currentOption);
    const next = currentFavorite ? favoriteKeys.filter((entry) => entry !== key)
      : [key, ...favoriteKeys.filter((entry) => entry !== key)].slice(0, FAVORITE_MODELS_LIMIT);
    setFavoriteKeys(next);
    try { window.localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(next)); } catch { /* usable in memory */ }
  };
  const recentModels = recentModelKeys.filter((key) => !favoriteKeys.includes(key)).flatMap((key) => {
    const option = models.find((entry) => modelKey(entry) === key);
    return option && matchesQuery(option) ? [option] : [];
  });
  const renderedKeys = [
    ...favoriteModels.map((option) => modelKey(option, 'favorite:')),
    ...recentModels.map((option) => modelKey(option, 'recent:')),
    ...visibleProviderEntries.flatMap(([, options]) => options.map((option) => modelKey(option))),
  ];

  // biome-ignore lint/correctness/useExhaustiveDependencies: the derived lists are recomputed each render; the primitive inputs (normalizedQuery, models, recentModelKeys) are the intended triggers.
  useEffect(() => {
    if (!active) return;
    const favorite = favoriteModels.find((option) => option.provider === provider && option.model === model);
    if (favorite) {
      setActiveRowKey(modelKey(favorite, 'favorite:'));
      return;
    }
    const recent = recentModels.find((option) => option.provider === provider && option.model === model);
    if (recent) {
      setActiveRowKey(modelKey(recent, 'recent:'));
      return;
    }
    const visibleModels = visibleProviderEntries.flatMap(([, options]) => options);
    const preferred =
      visibleModels.find((option) => option.provider === provider && option.model === model) || visibleModels[0];
    setActiveRowKey(preferred ? modelKey(preferred) : '');
  }, [active, model, normalizedQuery, models, provider, recentModelKeys, favoriteKeys]);

  const focusRow = (index: number) => {
    const options = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>('.model-list [role="option"]') || []
    );
    const target = options[Math.max(0, Math.min(index, options.length - 1))];
    if (!target) return;
    setActiveRowKey(target.dataset.rowKey || '');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  };
  const navigateRows = (event: React.KeyboardEvent, fromSearch = false) => {
    if (event.key === 'Enter' && fromSearch) {
      const target = Array.from(
        dialog.current?.querySelectorAll<HTMLButtonElement>('.model-list [role="option"]') || []
      ).find((option) => option.dataset.rowKey === activeRowKey);
      if (target) {
        event.preventDefault();
        target.click();
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>('.model-list [role="option"]') || []
    );
    if (!options.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') return focusRow(0);
    if (event.key === 'End') return focusRow(options.length - 1);
    if (fromSearch) {
      const initialized = options.findIndex((option) => option.dataset.rowKey === activeRowKey);
      if (initialized >= 0) return focusRow(initialized);
      return focusRow(event.key === 'ArrowDown' ? 0 : options.length - 1);
    }
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    focusRow(current + (event.key === 'ArrowDown' ? 1 : -1));
  };
  const choose = async (option: DesktopModelOption) => {
    const token = ++latestModelChoice;
    // Selection owns this close, not the eventual persistence reply. A late
    // reply must never close a menu the user has opened in the meantime.
    onClose();
    try {
      const selected = await onSelect(option);
      if (selected === false || token !== latestModelChoice) return;
      const key = modelKey(option);
      const next = [key, ...readRecentModelKeys().filter((entry) => entry !== key)].slice(0, RECENT_MODELS_LIMIT);
      writeRecentModelKeys(next);
    } catch {
      // The mutation owner reports failure. Do not move the reopened list or
      // overwrite a newer choice's history while handling an old response.
    }
  };
  const renderModelOption = (option: DesktopModelOption, scope = '') => {
    const selected = option.provider === provider && option.model === model;
    const key = modelKey(option, scope);
    return (
      <button
        type="button"
        className="model-option-row"
        role="option"
        aria-selected={selected}
        key={key}
        data-row-key={key}
        data-active={activeRowKey === key}
        tabIndex={activeRowKey === key ? 0 : -1}
        onKeyDown={(event) => navigateRows(event)}
        onMouseMove={() => setActiveRowKey(key)}
        onClick={() => void choose(option)}
      >
        <span className="model-row-copy">
          <span className="model-row-title">
            <strong>
              {modelDisplayName(option.model, option.provider, option.display)}
              {(scope === 'recent:' || scope === 'favorite:') && (
                <span className="model-row-source">{` (${providerDisplayName(option.provider)})`}</span>
              )}
            </strong>
          </span>
          <span className="model-capabilities">
            {modelContextWindow(option) > 0 && <span>{formatContextWindow(modelContextWindow(option)).replace(/ Context$/, '')} {t('Context')}</span>}
            {option.supportsVision && <span>{t('Images')}</span>}
          </span>
        </span>
        {selected && (
          <span className="route-selection-check">
            <Check size={14} aria-hidden="true" />
          </span>
        )}
      </button>
    );
  };

  return (
    <section
      ref={dialog}
      className="model-catalog-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t('Select model')}
      tabIndex={-1}
    >
      <div className="model-catalog-body">
        <PaneSurfaceGate ready={catalogLoaded || models.length > 0} label={t('Loading models…')}>
          <div className="model-catalog-list">
            <div className="model-search-wrapper">
              <div className="model-search">
                <div className="model-search-container">
                  <Search size={16} aria-hidden="true" />
                  <input
                    ref={search}
                    type="text"
                    value={query}
                    placeholder={t('Search models…')}
                    aria-label={t('Search models')}
                    autoComplete="off"
                    spellCheck={false}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => navigateRows(event, true)}
                  />
                </div>
                {query && (
                  <button
                    type="button"
                    data-component="icon-button"
                    onClick={() => {
                      setQuery('');
                      search.current?.focus();
                    }}
                    aria-label={t('Clear picker search')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {currentOption && (
                <button type="button" className="model-provider-add model-favorite-toggle"
                  aria-label={currentFavorite ? t('Unpin current model') : t('Pin current model')}
                  title={currentFavorite ? t('Unpin current model') : t('Pin current model')}
                  aria-pressed={currentFavorite} onClick={toggleFavorite}>
                  <Star size={16} fill={currentFavorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
              )}
              {onOpenProviders && (
                <button
                  type="button"
                  className="model-provider-add"
                  aria-label={t('Add provider')}
                  data-tooltip={t('Add provider')}
                  onClick={onOpenProviders}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            <div ref={modelList} className="model-list" role="listbox" aria-label={t('Available models')}>
              {catalogError && <ErrorNotice error={catalogError} role="status" />}
              {providerSetupError && (
                <p className="model-notice" role="status">
                  {t('Provider status is temporarily unavailable. Try again.')}
                </p>
              )}
              {renderedKeys.length === 0 && (
                <p className="model-empty">
                  {emptyCatalogText(catalogRefreshing || !catalogLoaded, Boolean(normalizedQuery))}
                </p>
              )}
              {favoriteModels.length > 0 && (
                <section className="model-group model-group--favorite">
                  <h3>{t('Pinned models')}</h3>
                  <div className="model-items">{favoriteModels.map((option) => renderModelOption(option, 'favorite:'))}</div>
                </section>
              )}
              {recentModels.length > 0 && (
                <section className="model-group model-group--recent">
                  <h3>{t('Recent')}</h3>
                  <div className="model-items">
                    {recentModels.map((option) => renderModelOption(option, 'recent:'))}
                  </div>
                </section>
              )}
              {visibleProviderEntries.map(([entryProvider, options]) => (
                <section className="model-group model-group--provider" key={entryProvider}>
                  <h3>
                    <span className="model-provider-heading">
                      <ProviderIcon provider={entryProvider} />
                      <span>{providerDisplayName(entryProvider)}</span>
                    </span>
                  </h3>
                  <div className="model-items">{options.map((option) => renderModelOption(option))}</div>
                </section>
              ))}
            </div>
          </div>
        </PaneSurfaceGate>
      </div>
    </section>
  );
}
