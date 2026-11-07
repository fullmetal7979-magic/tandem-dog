// HTTP server: JSON API, Server-Sent Events, static UI. Binds to localhost.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportCard, importCard } from './cards.mjs';
import { ASPIRATIONS, ROLES, SPEECH_STYLES, aspirationPublic, KOREAN_NAMES } from './catalog/roles.mjs';
import { ATTRIBUTES, SKILLS } from './catalog/skills.mjs';
import { TRAITS, traitPublic } from './catalog/traits.mjs';
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

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 형식이 아닙니다.');
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
      for (const key of ['effortByLevel', 'llmSmallTalk']) if (typeof body[key] === 'boolean') town.settings[key] = body[key];
      town.saveSoon();
      broadcast('world', { clock: town.clock, settings: town.settings });
      return { clock: town.clock, settings: town.settings };
    }],
  ];

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
  const town = new Town({ state: saved ? reviveState(saved) : emptyState(), brain, save });
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
    console.log(`  💾 저장: ${file}\n`);
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
