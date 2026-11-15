import assert from 'node:assert/strict';
import test from 'node:test';
import { installTestDom } from '../test-support/test-dom.mjs';
import { searchSettingsCategories, settingsCategoriesForSurface } from './settings-items.ts';

const KO = {
  Theme: '테마',
  'App color theme.': '앱 색상 테마.',
  Version: '버전',
  'Auto-compact': '자동 압축',
};
const translate = (text) => KO[text] || text;
const values = (list) => list.map((item) => item.value);

test('an empty query keeps every category in rail order', () => {
  const categories = settingsCategoriesForSurface(false);
  assert.deepEqual(values(searchSettingsCategories('  ', categories, translate)), values(categories));
});

test('search matches item labels and descriptions in English and Korean', () => {
  const categories = settingsCategoriesForSurface(false);
  assert.deepEqual(values(searchSettingsCategories('theme', categories, translate)), ['general']);
  assert.deepEqual(values(searchSettingsCategories('테마', categories, translate)), ['general']);
  assert.deepEqual(values(searchSettingsCategories('자동 압축', categories, translate)), ['context']);
});

test('pages without settings items are found through their keywords', () => {
  const categories = settingsCategoriesForSurface(false);
  assert.ok(values(searchSettingsCategories('버전', categories, translate)).includes('about'));
  assert.deepEqual(values(searchSettingsCategories('no such setting', categories, translate)), []);
});

test('remote surfaces never return hidden categories', () => {
  const categories = settingsCategoriesForSurface(true);
  assert.deepEqual(values(searchSettingsCategories('providers', categories, translate)), []);
});

test('revealSettingsMatch scrolls to and flashes the first matching row', async (t) => {
  const { document } = installTestDom(t, { rootId: false, expose: ['HTMLElement', 'Node'] });
  const { revealSettingsMatch } = await import('./SettingsView.tsx');
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="mixdog-settings__row"><span class="mixdog-settings__row-title">Memory</span></div>
    <div class="mixdog-settings__row"><span class="mixdog-settings__row-title">테마</span></div>`;
  document.body.append(body);
  let scrolled = null;
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    scrolled = this;
  };
  const row = revealSettingsMatch(body, '테마 색상');
  assert.ok(row);
  assert.equal(row.textContent, '테마');
  assert.equal(scrolled, row);
  assert.ok(row.classList.contains('settings-search-hit'));
  assert.equal(revealSettingsMatch(body, 'absent'), null);
  assert.equal(revealSettingsMatch(body, ''), null);
});
