import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expectedPublishTarget, verifyUpdateMetadata } from './verify-update-metadata.mjs';

const TARGET = { owner: 'acme', repo: 'tandem-dog' };

const metadataFor = ({ owner, repo }) =>
  ['provider: github', `owner: ${owner}`, `repo: ${repo}`, 'updaterCacheDirName: tandem-dog-desktop-updater', ''].join(
    '\n'
  );
const validMetadata = metadataFor(TARGET);

async function withDist(run) {
  const root = await mkdtemp(join(tmpdir(), 'tandem-update-metadata-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeMetadata(root, source) {
  const resources = join(root, 'win-unpacked', 'resources');
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, 'app-update.yml'), source);
}

test('packaged updater metadata accepts every platform resource layout', async () => {
  await withDist(async (root) => {
    const paths = [
      join(root, 'win-unpacked', 'resources'),
      join(root, 'mac-arm64', 'Tandem Dog.app', 'Contents', 'Resources'),
      join(root, 'linux-unpacked', 'resources'),
    ];
    for (const directory of paths) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'app-update.yml'), validMetadata);
    }
    const files = await verifyUpdateMetadata(root, TARGET);
    assert.equal(files.length, paths.length);
  });
});

test('packaged updater metadata fails closed when absent or misrouted', async () => {
  await withDist(async (root) => {
    await assert.rejects(() => verifyUpdateMetadata(root, TARGET), /metadata is missing/);
    await writeMetadata(root, validMetadata.replace('repo: tandem-dog', 'repo: other'));
    await assert.rejects(() => verifyUpdateMetadata(root, TARGET), /does not declare repo: tandem-dog/);
    await writeMetadata(root, validMetadata.replace('owner: acme', 'owner: tribgames'));
    await assert.rejects(() => verifyUpdateMetadata(root, TARGET), /does not declare owner: acme/);
    await writeMetadata(root, validMetadata.replace('provider: github', 'provider: generic'));
    await assert.rejects(() => verifyUpdateMetadata(root, TARGET), /does not declare provider: github/);
  });
});

test('owner and repository comparison ignores case like GitHub does', async () => {
  await withDist(async (root) => {
    await writeMetadata(root, metadataFor({ owner: 'ACME', repo: 'Tandem-Dog' }));
    assert.equal((await verifyUpdateMetadata(root, TARGET)).length, 1);
  });
});

test('without an expected target the feed must name some non-upstream repository', async () => {
  await withDist(async (root) => {
    await writeMetadata(root, validMetadata);
    assert.equal((await verifyUpdateMetadata(root, null)).length, 1);
    await writeMetadata(root, metadataFor({ owner: 'tribgames', repo: 'mixdog' }));
    await assert.rejects(() => verifyUpdateMetadata(root, null), /routes updates to upstream tribgames\/mixdog/);
    await writeMetadata(root, 'provider: github\nchannel: latest\n');
    await assert.rejects(() => verifyUpdateMetadata(root, null), /declares no owner\/repo/);
  });
});

test('the expected publish target comes from arguments, TANDEM_PUBLISH_*, then GITHUB_REPOSITORY', () => {
  assert.equal(expectedPublishTarget({}, []), null);
  assert.deepEqual(expectedPublishTarget({ GITHUB_REPOSITORY: 'acme/tandem-dog' }, []), TARGET);
  assert.deepEqual(
    expectedPublishTarget({ GITHUB_REPOSITORY: 'acme/tandem-dog', TANDEM_PUBLISH_OWNER: 'zed', TANDEM_PUBLISH_REPO: 'fork' }, []),
    { owner: 'zed', repo: 'fork' }
  );
  assert.deepEqual(
    expectedPublishTarget({ GITHUB_REPOSITORY: 'acme/tandem-dog' }, ['--owner=other', '--repo=thing']),
    { owner: 'other', repo: 'thing' }
  );
  assert.equal(expectedPublishTarget({ TANDEM_PUBLISH_OWNER: 'zed' }, []), null);
});
