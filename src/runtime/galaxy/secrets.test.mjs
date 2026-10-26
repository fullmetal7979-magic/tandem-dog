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
  scrubUrlsInText,
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

test('URL credentials are matched by the whole parameter name only', () => {
  const scrub = (url) => scrubUrlsInText(url, { mark: true });
  // Names that merely contain a credential word stay untouched (and so do the files that hold them).
  for (const url of [
    'https://h.example/search?keyword=cats&monkey=1',
    'https://h.example/x?keys=a&tokenizer=bpe&author=me&session_length=3&barcode=9&passage=2',
    'https://h.example/x?signature_type=pdf&credentialed=no',
  ]) {
    assert.equal(scrub(url), url, url);
  }
  assert.equal(scrub('https://h.example/x?token=abc&ok=1'), 'https://h.example/x?token=redacted-secret&ok=1');
  assert.equal(scrub('https://h.example/x?Access_Token=abc#top'), 'https://h.example/x?Access_Token=redacted-secret#top');
  assert.equal(scrub('https://h.example/x?a=1;api_key=zz'), 'https://h.example/x?a=1;api_key=redacted-secret');
  assert.equal(
    scrub('https://b.s3.example/o?X-Amz-Credential=AK%2F1&X-Amz-Signature=ff&v=2'),
    'https://b.s3.example/o?X-Amz-Credential=redacted-secret&X-Amz-Signature=redacted-secret&v=2'
  );
  assert.equal(scrub(scrub('https://h.example/x?sig=1')), 'https://h.example/x?sig=redacted-secret', 'idempotent');
});
