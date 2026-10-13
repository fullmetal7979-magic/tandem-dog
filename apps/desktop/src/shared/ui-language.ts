/** Shared by renderer preferences and native dialogs. COSMOS speaks one
 *  user-facing language, Korean. English is the source text every catalog is
 *  keyed by, so it stays selectable only as the developer/test escape hatch
 *  (MIXDOG_UI_LANGUAGE=en); no settings surface offers it. */
export const SUPPORTED_UI_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
] as const;

export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number]['value'];
export type UiLanguagePreference = 'system' | UiLanguage;
export const UI_LANGUAGE_STORAGE_KEY = 'mixdog.desktop.ui-language.v1';

export function uiLanguageForLocale(locale: string): UiLanguage | null {
  const base = String(locale || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED_UI_LANGUAGES.find(({ value }) => value === base)?.value ?? null;
}

/** Korean unless English was asked for explicitly. System locales never pick
 *  another language: the product ships a single Korean catalog. */
export function selectUiLanguage(preference: unknown, _systemLocales: readonly string[]): UiLanguage {
  return preference === 'en' ? 'en' : 'ko';
}
