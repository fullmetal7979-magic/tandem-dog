import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_ID,
  APP_NAME,
  ISSUES_URL,
  PROTOCOL_SCHEME,
  REPO_NAME,
  REPO_OWNER,
  REPO_SLUG,
  REPO_URL,
  USER_DATA_DIR_NAME,
} from './fork-identity.ts';

test('fork identity differs from upstream Mixdog so both install side by side', () => {
  assert.equal(APP_NAME, 'COSMOS');
  assert.equal(APP_ID, 'app.cosmos.desktop');
  assert.equal(PROTOCOL_SCHEME, 'cosmos');
  assert.equal(USER_DATA_DIR_NAME, 'cosmos-desktop');
  for (const value of [APP_NAME, APP_ID, PROTOCOL_SCHEME, USER_DATA_DIR_NAME, REPO_SLUG]) {
    assert.doesNotMatch(value, /mixdog|tribgames/i);
  }
});

test('without build-time defines the repository falls back to visible placeholders, never upstream', () => {
  // import.meta.env does not exist under plain Node/tsx; CI supplies
  // VITE_COSMOS_REPO_OWNER / VITE_COSMOS_REPO_NAME to electron-vite.
  assert.equal(REPO_OWNER, 'OWNER');
  assert.equal(REPO_NAME, 'cosmos');
  assert.equal(REPO_SLUG, 'OWNER/cosmos');
  assert.equal(REPO_URL, 'https://github.com/OWNER/cosmos');
  assert.equal(ISSUES_URL, 'https://github.com/OWNER/cosmos/issues');
});
