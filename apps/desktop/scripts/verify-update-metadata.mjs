#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// COSMOS must never auto-update from (or publish to) upstream Mixdog.
const UPSTREAM = Object.freeze({ owner: 'tribgames', repo: 'mixdog' });

async function findMetadataFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMetadataFiles(path)));
    } else if (entry.isFile() && entry.name === 'app-update.yml') {
      files.push(path);
    }
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The owner/repo the packaged updater feed must name. electron-builder.yml
 * carries no hard-coded publish target; CI passes
 * `-c.publish.owner/-c.publish.repo` from the repository it runs in, so the
 * same repository is the expectation here. Precedence: explicit arguments,
 * COSMOS_PUBLISH_OWNER / COSMOS_PUBLISH_REPO, then GITHUB_REPOSITORY. Null
 * when none is available (a local build), which still enforces "not upstream".
 */
export function expectedPublishTarget(env = process.env, argv = []) {
  const arg = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
  const [slugOwner, slugRepo] = String(env.GITHUB_REPOSITORY ?? '').split('/');
  const owner = arg('owner') || String(env.COSMOS_PUBLISH_OWNER ?? '').trim() || slugOwner || '';
  const repo = arg('repo') || String(env.COSMOS_PUBLISH_REPO ?? '').trim() || slugRepo || '';
  return owner && repo ? { owner, repo } : null;
}

function declaredValue(source, field) {
  return source.match(new RegExp(`^${field}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
}

export async function verifyUpdateMetadata(distDirectory, expected = expectedPublishTarget()) {
  const dist = resolve(distDirectory);
  const files = await findMetadataFiles(dist);
  if (files.length === 0) {
    throw new Error(`Packaged updater metadata is missing under ${dist}`);
  }
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!/^provider:\s*github\s*$/m.test(source)) {
      throw new Error(`${file} does not declare provider: github`);
    }
    if (expected) {
      for (const field of ['owner', 'repo']) {
        // GitHub owner and repository names are case-insensitive.
        const pattern = new RegExp(`^${field}:\\s*${escapeRegExp(expected[field])}\\s*$`, 'mi');
        if (!pattern.test(source)) {
          throw new Error(`${file} does not declare ${field}: ${expected[field]}`);
        }
      }
      continue;
    }
    const owner = declaredValue(source, 'owner');
    const repo = declaredValue(source, 'repo');
    if (!owner || !repo) {
      throw new Error(
        `${file} declares no owner/repo; pass -c.publish.owner/-c.publish.repo to electron-builder ` +
          'or set GITHUB_REPOSITORY / COSMOS_PUBLISH_OWNER / COSMOS_PUBLISH_REPO'
      );
    }
    if (owner.toLowerCase() === UPSTREAM.owner && repo.toLowerCase() === UPSTREAM.repo) {
      throw new Error(`${file} routes updates to upstream ${UPSTREAM.owner}/${UPSTREAM.repo}`);
    }
  }
  return files;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const argv = process.argv.slice(2);
  const distArg = argv.find((value) => value.startsWith('--dist='));
  const dist = distArg ? distArg.slice('--dist='.length) : resolve('dist');
  const files = await verifyUpdateMetadata(dist, expectedPublishTarget(process.env, argv));
  console.log(`Verified packaged updater metadata: ${files.length} file(s).`);
}
