import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REDACTED,
  SECRET_PLACEHOLDER,
  containsSecret,
  isSecretFile,
  redactJson,
  redactText,
  restoreSecrets,
} from './secrets.mjs';

test('token-shaped strings are redacted from free text', () => {
  const text = [
    'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'aws AKIAABCDEFGHIJKLMNOP',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
    'plain words stay',
  ].join('\n');
  assert.equal(containsSecret(text), true);
  const result = redactText(text);
  assert.equal(result.count, 4);
  assert.equal(containsSecret(result.text), false);
  assert.match(result.text, /plain words stay/);
  assert.equal(result.text.split(REDACTED).length - 1, 4);
});

test('credential-shaped keys become placeholders and come back from the local copy', () => {
  const config = {
    mcpServers: {
      search: { command: 'npx', env: { API_KEY: 'live-value', MODE: 'fast' }, headers: { Authorization: 'Bearer x' } },
    },
    profile: { title: '형님' },
  };
  const { value, count } = redactJson(config);
  assert.equal(count, 2);
  assert.equal(value.mcpServers.search.env.API_KEY, SECRET_PLACEHOLDER);
  assert.equal(value.mcpServers.search.headers.Authorization, SECRET_PLACEHOLDER);
  assert.equal(value.mcpServers.search.env.MODE, 'fast');
  assert.equal(value.profile.title, '형님');

  const local = { mcpServers: { search: { env: { API_KEY: 'this-pc-key' } } } };
  const restored = restoreSecrets(value, local);
  assert.equal(restored.mcpServers.search.env.API_KEY, 'this-pc-key');
  // A PC that never had the secret simply lacks the field.
  const fresh = restoreSecrets(value, {});
  assert.equal('API_KEY' in fresh.mcpServers.search.env, false);
  assert.equal('Authorization' in fresh.mcpServers.search.headers, false);
});

test('credential files are recognised by name', () => {
  for (const path of ['.env', 'app/.env.local', 'id_rsa', 'keys/server.pem', 'openai-oauth.json', 'provider-accounts.json', 'relay-e2ee.json', '.npmrc']) {
    assert.equal(isSecretFile(path), true, path);
  }
  for (const path of ['skills/review/SKILL.md', 'hooks.json', 'core-memory.json', 'src/env.ts']) {
    assert.equal(isSecretFile(path), false, path);
  }
});
