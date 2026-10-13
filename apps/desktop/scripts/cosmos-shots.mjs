// Design review screenshots: build first (npm run build), then
//   node scripts/cosmos-shots.mjs <scenes.json> <output.png>
// Runs the capture harness in screenshot-only mode against an isolated
// profile; each scene is written as <output>-<scene>.png.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const [scenes, output] = process.argv.slice(2);
if (!scenes || !output?.endsWith('.png')) {
  console.error('usage: node scripts/cosmos-shots.mjs <scenes.json> <output.png>');
  process.exit(2);
}
const entry = fileURLToPath(new URL('../out/main/capture-window.js', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'cosmos-shots-'));
const home = process.env.COSMOS_SHOTS_HOME || join(root, 'home');
const code = await new Promise((done) => {
  const child = spawn(electronPath, [entry, resolve(output), randomUUID()], {
    env: {
      ...process.env,
      MIXDOG_CAPTURE_SHOTS: resolve(scenes),
      MIXDOG_CAPTURE_USER_DATA: join(root, 'user-data'),
      MIXDOG_HOME: home,
      MIXDOG_DATA_DIR: join(home, 'data'),
      MIXDOG_RUNTIME_ROOT: join(root, 'runtime'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), Number(process.env.COSMOS_SHOTS_TIMEOUT_MS || 120_000));
  child.on('exit', (exitCode) => {
    clearTimeout(timer);
    done(exitCode ?? 1);
  });
});
rmSync(root, { recursive: true, force: true });
process.exit(code);
