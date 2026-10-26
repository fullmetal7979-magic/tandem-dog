// The 코스모스 deploy kit: the domain reaches remote shells and sed, so only a
// plain hostname may pass, and the images it pulls are pinned to a version.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const relayRoot = join(here, '..', '..');
const bash = spawnSync('bash', ['--version']).status === 0;

function run(script, args, env = {}) {
  return spawnSync('bash', [join(here, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('deploy.sh refuses a domain that could inject into the remote command', { skip: !bash }, () => {
  for (const bad of ["a.com'; touch /tmp/pwn; '", 'a b.com', 'x.com$(id)', 'localhost', '-rf.com']) {
    const result = run('deploy.sh', ['root@203.0.113.10', bad]);
    assert.equal(result.status, 2, `${bad}: ${result.stderr}`);
    assert.match(result.stderr, /도메인 형식/);
  }
  const target = run('deploy.sh', ['-oProxyCommand=evil', 'relay.example.com']);
  assert.equal(target.status, 2);
  assert.match(target.stderr, /서버 주소 형식/);
});

test('install.sh refuses a malformed RELAY_DOMAIN before touching docker', { skip: !bash }, () => {
  const result = run('install.sh', [], { RELAY_DOMAIN: 'x.com; id' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /RELAY_DOMAIN 형식/);
});

test('container images are pinned to explicit versions', () => {
  const compose = readFileSync(join(here, 'compose.yml'), 'utf8');
  const dockerfile = readFileSync(join(relayRoot, 'Dockerfile'), 'utf8');
  for (const image of compose.match(/^\s*image:\s*(\S+)/gm) ?? []) {
    assert.match(image, /:\d+\.\d+\.\d+/, image);
  }
  assert.match(dockerfile, /^FROM node:\d+\.\d+\.\d+-/m);
  assert.doesNotMatch(compose + dockerfile, /:(latest|\d+-alpine|\d+-)\s*$/m);
});
