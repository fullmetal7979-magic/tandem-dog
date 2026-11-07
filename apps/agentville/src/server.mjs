// HTTP server: JSON API, Server-Sent Events, static UI. Binds to localhost.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportCard, importCard } from './cards.mjs';
import { ACCEPT, FileStore, MAX_ATTACHMENTS, MAX_UPLOAD } from './files.mjs';
import { ASPIRATIONS, ROLES, SPEECH_STYLES, aspirationPublic, KOREAN_NAMES } from './catalog/roles.mjs';
import { ATTRIBUTES, SKILLS } from './catalog/skills.mjs';
import { TRAITS, traitPublic } from './catalog/traits.mjs';
import { EQUIPMENT, MASTERY_PERKS, MASTERY_STEPS, TOOLS, toolPublic, unlockText } from './catalog/tools.mjs';
import { wardrobePublic } from './catalog/wardrobe.mjs';
import { TIERS } from './agent/policy.mjs';
import { browserAvailable, desktopStatus } from './agent/screens.mjs';
import { Workspace, detectSandbox } from './agent/workspace.mjs';
import { ACTIVITIES, MAP_ROWS, NEEDS, STATE_LABELS, TILE_ART, ZONES } from './catalog/world.mjs';
import { characterView } from './engine/character.mjs';
import { MEMORY_KINDS } from './engine/memory.mjs';
import { MOODLETS } from './engine/needs.mjs';
import { BIG_FIVE } from './engine/personality.mjs';
import { Town, emptyState } from './engine/town.mjs';
import { selectBrain } from './llm/index.mjs';
import { STARTERS } from './seed.mjs';
import { DEFAULT_DATA_FILE, loadState, reviveState, saveState } from './store.mjs';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const TICK_MS = 250;
const MAX_BODY = 1_000_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

export function catalog() {
  return {
    attributes: ATTRIBUTES,
    skills: SKILLS,
    tools: Object.fromEntries(Object.entries(TOOLS).map(([id, tool]) => [id, { ...toolPublic(tool), unlock: unlockText(tool, SKILLS) }])),
    equipment: EQUIPMENT,
    mastery: { steps: MASTERY_STEPS, perks: MASTERY_PERKS },
    trust: TIERS,
    wardrobe: wardrobePublic(SKILLS),
    attachments: { max: MAX_ATTACHMENTS, accept: ACCEPT },
    traits: Object.fromEntries(Object.entries(TRAITS).map(([id, trait]) => [id, traitPublic(trait)])),
    roles: ROLES,
    aspirations: Object.fromEntries(Object.entries(ASPIRATIONS).map(([id, value]) => [id, aspirationPublic(value)])),
    speech: SPEECH_STYLES,
    activities: ACTIVITIES,
    needs: NEEDS,
    states: STATE_LABELS,
    moodlets: MOODLETS,
    memoryKinds: MEMORY_KINDS,
    bigFive: BIG_FIVE,
    names: KOREAN_NAMES,
    map: { rows: MAP_ROWS, zones: ZONES, art: TILE_ART },
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req, max) {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new HttpError(413, '요청이 너무 큽니다.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req, MAX_BODY);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다.');
  }
}

const queryOf = (req) => new URL(req.url, 'http://localhost').searchParams;

function headerName(req) {
  try {
    return decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
  } catch {
    return '';
  }
}

function send(res, status, body) {
  const text = JSON.stringify(body, (key, value) => (value === Infinity ? null : value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export async function createApp({ town, log = console } = {}) {
  const clients = new Set();
  const broadcast = (type, payload) => {
    if (!clients.size) return;
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload, (key, value) => (value === Infinity ? null : value))}\n\n`;
    for (const res of clients) res.write(frame);
  };
  town.on('event', broadcast);

  const routes = [
    ['GET', /^\/api\/state$/, () => town.snapshot()],
    ['GET', /^\/api\/catalog$/, () => catalog()],
    ['POST', /^\/api\/characters$/, async (req) => characterView(town.addCharacter(await readJson(req)), town.clock.minute)],
    ['POST', /^\/api\/characters\/generate$/, async (req) => town.draftCharacter((await readJson(req)).description)],
    ['POST', /^\/api\/characters\/import$/, async (req) => {
      const result = importCard(await readJson(req));
      const character = result.full ? town.adoptCharacter(result.full) : town.addCharacter(result.input);
      return characterView(character, town.clock.minute);
    }],
    ['GET', /^\/api\/characters\/([\w-]+)\/card$/, (req, [id]) => {
      const character = town.characters[id];
      if (!character) throw new HttpError(404, '캐릭터를 찾을 수 없어요.');
      return exportCard(character);
    }],
    ['PATCH', /^\/api\/characters\/([\w-]+)$/, async (req, [id]) => {
      const character = town.updateCharacter(id, await readJson(req));
      if (!character) throw new HttpError(404, '캐릭터를 찾을 수 없어요.');
      return characterView(character, town.clock.minute);
    }],
    ['DELETE', /^\/api\/characters\/([\w-]+)$/, (req, [id]) => {
      if (!town.removeCharacter(id)) throw new HttpError(409, '업무 중이거나 없는 캐릭터입니다.');
      return { ok: true };
    }],
    ['GET', /^\/api\/approvals$/, () => town.pendingApprovals()],
    ['POST', /^\/api\/approvals\/([\w-]+)$/, async (req, [id]) => town.resolveApproval(id, await readJson(req))],
    ['POST', /^\/api\/tasks\/([\w-]+)\/cancel$/, (req, [id]) => town.cancelTask(id)],
    ['POST', /^\/api\/stop$/, () => town.cancelAll()],
    ['GET', /^\/api\/agent\/status$/, async () => agentStatus()],
    ['POST', /^\/api\/files$/, async (req) => town.files.put(await readBody(req, MAX_UPLOAD), { name: headerName(req), type: req.headers['content-type'] })],
    ['GET', /^\/api\/archive$/, (req) => {
      const query = queryOf(req);
      return town.archive({ q: query.get('q') ?? '', category: query.get('category') ?? '', charId: query.get('charId') ?? '', minRating: Number(query.get('minRating')) || 0 });
    }],
    ['GET', /^\/api\/report$/, (req) => town.report(queryOf(req).get('days') ?? 7)],
    ['GET', /^\/api\/tasks\/([\w-]+)$/, (req, [id]) => {
      if (!town.tasks[id]) throw new HttpError(404, '업무를 찾을 수 없어요.');
      return town.tasks[id];
    }],
    ['POST', /^\/api\/tasks\/preview$/, async (req) => town.previewTask(await readJson(req))],
    ['POST', /^\/api\/tasks$/, async (req) => town.submitTask(await readJson(req))],
    ['POST', /^\/api\/tasks\/([\w-]+)\/feedback$/, async (req, [id]) => {
      const body = await readJson(req);
      return town.feedback(id, body.rating, body.comment);
    }],
    ['POST', /^\/api\/tasks\/([\w-]+)\/retry$/, (req, [id]) => {
      const task = town.retryTask(id);
      if (!task) throw new HttpError(409, '다시 시도할 수 없는 업무입니다.');
      return task;
    }],
    ['POST', /^\/api\/chat\/([\w-]+)$/, async (req, [id]) => ({ reply: await town.chat(id, (await readJson(req)).message) })],
    ['POST', /^\/api\/world$/, async (req) => {
      const body = await readJson(req);
      if (body.speed !== undefined) {
        if (![0, 1, 3, 10, 30].includes(body.speed)) throw new HttpError(400, '배속은 0, 1, 3, 10, 30 중 하나여야 합니다.');
        town.clock.speed = body.speed;
      }
      if (typeof body.paused === 'boolean') town.clock.paused = body.paused;
      for (const key of ['effortByLevel', 'llmSmallTalk', 'tools', 'browser', 'shell']) if (typeof body[key] === 'boolean') town.settings[key] = body[key];
      // Real desktop control is opt-in with an explicit consent flag.
      if (body.desktop === true && body.consent !== true) throw new HttpError(400, '내 컴퓨터 조작을 켜려면 위험 안내에 동의해야 합니다.');
      if (typeof body.desktop === 'boolean') town.settings.desktop = body.desktop;
      if (body.autonomyCap !== undefined) {
        if (![1, 2, 3, 4].includes(body.autonomyCap)) throw new HttpError(400, '자율성 상한은 1~4입니다.');
        town.settings.autonomyCap = body.autonomyCap;
      }
      town.saveSoon();
      broadcast('world', { clock: town.clock, settings: town.settings });
      return { clock: town.clock, settings: town.settings };
    }],
  ];

  let statusCache = null;
  async function agentStatus() {
    if (statusCache && Date.now() - statusCache.at < 20_000) return statusCache.value;
    const [browser, desktop] = await Promise.all([browserAvailable(), desktopStatus()]);
    const value = { browser, desktop, sandbox: detectSandbox(), workspaceDir: town.workspaceDir, platform: process.platform };
    statusCache = { at: Date.now(), value };
    return value;
  }

  // Only files the task reported as its results, read from its work folder.
  function sendArtifact(res, task, path) {
    if (!task?.workspace || !task.artifacts?.some((file) => file.path === path)) throw new HttpError(404, '결과 파일을 찾을 수 없어요.');
    const space = new Workspace(task.workspace.root, { own: task.workspace.own });
    let body;
    try {
      body = readFileSync(space.resolve(path, { mustExist: true }));
    } catch {
      throw new HttpError(404, '결과 파일이 옮겨졌거나 지워졌어요.');
    }
    const ext = extname(path).toLowerCase();
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext]
      ?? (body.subarray(0, 8000).includes(0) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    const inline = !type.startsWith('application/octet');
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.split('/').pop())}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  async function serveStatic(req, res, pathname) {
    const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
    const file = resolve(PUBLIC_DIR, relative);
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(403, '접근할 수 없습니다.');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      throw new HttpError(404, '찾을 수 없습니다.');
    }
  }

  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && pathname === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const screenMatch = req.method === 'GET' && pathname.match(/^\/api\/tasks\/([\w-]+)\/screen$/);
      if (screenMatch) {
        const task = town.tasks[screenMatch[1]];
        const live = town.liveScreens.get(screenMatch[1]);
        const body = live?.png ?? (task?.finalScreen ? town.files.read(task.finalScreen.id) : null);
        if (!body) throw new HttpError(404, '보여 줄 화면이 없어요.');
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(body);
        return;
      }
      const artifactMatch = req.method === 'GET' && pathname.match(/^\/api\/tasks\/([\w-]+)\/artifact$/);
      if (artifactMatch) {
        sendArtifact(res, town.tasks[artifactMatch[1]], queryOf(req).get('path'));
        return;
      }
      const fileMatch = req.method === 'GET' && pathname.match(/^\/api\/files\/(f_[0-9a-f]{10})$/);
      if (fileMatch) {
        const meta = town.files.meta(fileMatch[1]);
        const body = meta ? town.files.read(meta.id) : null;
        if (!body) throw new HttpError(404, '파일을 찾을 수 없어요.');
        res.writeHead(200, {
          'content-type': meta.kind === 'text' ? 'text/plain; charset=utf-8' : meta.type,
          'content-length': body.length,
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, max-age=86400',
          ...(meta.kind === 'pdf' ? {} : { 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }),
        });
        res.end(body);
        return;
      }
      for (const [method, pattern, handler] of routes) {
        const match = req.method === method && pathname.match(pattern);
        if (match) {
          send(res, 200, await handler(req, match.slice(1)));
          return;
        }
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, '없는 API입니다.');
      if (req.method !== 'GET') throw new HttpError(405, '허용되지 않는 메서드입니다.');
      await serveStatic(req, res, pathname);
    } catch (error) {
      const status = error.status ?? 400;
      if (status >= 500) log.error?.(error);
      if (!res.headersSent) send(res, status, { error: error.message });
      else res.end();
    }
  });

  const timer = setInterval(() => {
    town.tick(TICK_MS);
    broadcast('tick', town.tickView());
  }, TICK_MS);
  timer.unref?.();
  const heartbeat = setInterval(() => broadcast('ping', {}), 20_000);
  heartbeat.unref?.();

  server.on('close', () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    for (const res of clients) res.end();
  });
  return server;
}

export async function main(env = process.env) {
  const file = env.AGENTVILLE_DATA ? resolve(env.AGENTVILLE_DATA) : DEFAULT_DATA_FILE;
  const brain = await selectBrain(env);
  const saved = loadState(file);
  const save = (state) => {
    try {
      saveState(state, file);
    } catch (error) {
      console.warn(`[agentville] 저장 실패: ${error.message}`);
    }
  };
  const files = new FileStore(join(dirname(file), 'files'));
  const workspaceDir = env.AGENTVILLE_WORKSPACES ? resolve(env.AGENTVILLE_WORKSPACES) : join(dirname(file), 'workspaces');
  const town = new Town({ state: saved ? reviveState(saved) : emptyState(), brain, save, files, workspaceDir });
  if (!saved) {
    for (const starter of STARTERS) town.addCharacter(starter);
    town.chronicle({ emoji: '🌱', text: 'AgentVille이 문을 열었다. 주민 네 명이 첫 출근을 했다.' });
  }
  const server = await createApp({ town });
  const port = Number(env.PORT ?? 4747);
  const host = env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`\n  🏘️  AgentVille → http://${host}:${port}`);
    console.log(`  🧠 두뇌: ${brain.live ? `Claude (${brain.model})` : '시뮬레이션 (ANTHROPIC_API_KEY를 설정하면 Claude로 동작)'}`);
    if (brain.live) console.log('  🛟 서버 측 폴백 켜짐: 안전 정책 거절 시 다른 모델로 재시도 (fallbacks: "default")');
    console.log(`  💾 저장: ${file} (첨부 파일: ${files.dir})`);
    console.log(`  🗂️ 작업 폴더: ${workspaceDir} · 샌드박스: ${detectSandbox() ?? '없음 (명령마다 승인)'}\n`);
  });
  const shutdown = () => {
    save(town.state);
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, town };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
