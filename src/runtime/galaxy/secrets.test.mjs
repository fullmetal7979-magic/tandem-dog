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

test('camelCase and spelled-out credential keys are placeholders too', async () => {
  const { isSecretKey } = await import('./secrets.mjs');
  for (const key of ['accessToken', 'githubToken', 'openaiApiKey', 'openaiAPIKey', 'clientSecret', 'dbPass', 'db_pass', 'passphrase', 'bearer', 'signingKey', 'DATABASE_DSN', 'connectionString']) {
    assert.equal(isSecretKey(key), true, key);
  }
  for (const key of ['maxTokens', 'tokenBudget', 'bypass', 'compass', 'authMode', 'title', 'model', 'oauth']) {
    assert.equal(isSecretKey(key), false, key);
  }
  const { value, count } = redactJson({ mcp: { env: { githubToken: 'abc', maxTokens: 4096 } } });
  assert.equal(count, 1);
  assert.equal(value.mcp.env.githubToken, SECRET_PLACEHOLDER);
  assert.equal(value.mcp.env.maxTokens, 4096);
});

test('registry, payment, cloud and webhook tokens are recognised', () => {
  const samples = [
    `npm_${'a'.repeat(36)}`,
    `pypi-AgEIcHlwaS5vcmc${'b'.repeat(60)}`,
    `sk_live_${'c'.repeat(24)}`,
    `SG.${'d'.repeat(22)}.${'e'.repeat(43)}`,
    `hf_${'f'.repeat(34)}`,
    `dop_v1_${'0'.repeat(64)}`,
    `GOCSPX-${'g'.repeat(28)}`,
    `https://hooks.slack.com/services/T000/B000/${'h'.repeat(24)}`,
    `https://discord.com/api/webhooks/123456/${'i'.repeat(40)}`,
    `123456789:AA${'j'.repeat(33)}`,
  ];
  for (const sample of samples) {
    assert.equal(containsSecret(`value ${sample} end`), true, sample);
    assert.equal(redactText(sample).text, REDACTED, sample);
  }
  for (const plain of ['sk_test_is_not_blocked', 'npm_install', 'hf_small', 'SG.short.value', 'https://hooks.slack.com/']) {
    assert.equal(containsSecret(plain), false, plain);
  }
});

test('key stores, saved passwords and vaults are secret files', () => {
  for (const path of ['.git-credentials', 'home/.pgpass', '.my.cnf', 'android/release.jks', 'app/upload.keystore', 'putty.ppk', 'vault.kdbx']) {
    assert.equal(isSecretFile(path), true, path);
  }
  for (const path of ['secrets.yaml', 'src/keystore.ts', 'docs/passwords.md', 'notes.kdbx.md']) {
    assert.equal(isSecretFile(path), false, path);
  }
});
