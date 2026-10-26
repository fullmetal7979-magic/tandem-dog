import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./dev-update-mac.sh', import.meta.url));
async function fixture(t, arch) {
  const root = await mkdtemp(join(tmpdir(), 'cosmos-mac-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); await mkdir(bin);
  const stubs = {
    uname: `#!/bin/sh\necho ${arch}\n`,
    defaults: '#!/bin/sh\necho 1.0.12\n',
    security: '#!/bin/sh\nexit 1\n',
    ps: `#!/bin/sh
if [ "$1" = "-p" ]; then
  if [ "$2" = "54321" ]; then echo '/Applications/COSMOS.app/Contents/Resources/app.asar.unpacked/out/main/daemon.cjs'; fi
else
  echo '100 /Applications/Mixdog.app/Contents/MacOS/Mixdog'
  echo '200 /Users/test/Apps With Spaces/COSMOS.app/Contents/MacOS/COSMOS'
  echo '300 /Applications/COSMOS.app/Contents/Frameworks/COSMOS Helper.app/Contents/MacOS/COSMOS Helper'
fi
`,
  };
  for (const [name, content] of Object.entries(stubs)) await writeFile(join(bin, name), content, { mode: 0o755 });
  const runtime = join(root, 'runtime'); await mkdir(runtime);
  await writeFile(join(runtime, 'daemon.json'), JSON.stringify({ pid: 54321 }));
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MIXDOG_RUNTIME_ROOT: runtime } };
}

for (const [arch, expected, directory] of [['arm64', 'arm64', 'mac-arm64'], ['x86_64', 'x64', 'mac']]) {
  test(`mac updater plans the COSMOS bundle for ${arch} and excludes upstream/helper processes`, async t => {
    const { env } = await fixture(t, arch);
    const result = spawnSync('bash', [script, '--dry-run'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`--${expected} (ad-hoc)`), result.stdout);
    assert.ok(result.stdout.includes(`/dist/${directory}/COSMOS.app -> /Applications/COSMOS.app`));
    assert.match(result.stdout, /stop app\s+: 200\n/);
    assert.doesNotMatch(result.stdout, /Mixdog\.app/);
  });
}

test('daemon fallback targets only the recorded service PID', async t => {
  const { root, env } = await fixture(t, 'arm64');
  const source = await readFile(script, 'utf8');
  const prefix = source.slice(0, source.indexOf('version_before="$(installed_version)"'));
  const probe = join(root, 'probe.sh');
  await writeFile(probe, `${prefix}\ndaemon_pids\n`);
  const result = spawnSync('bash', [probe], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '54321');
});
