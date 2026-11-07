// Screens for the computer toolset (computer_toolset_20260801). One task uses
// at most one screen:
//   BrowserScreen — a private headless Chrome (playwright-core), isolated from
//                   the user's own browser: fresh profile, no downloads, only
//                   http(s) pages. Adds browser_open / read_page tools.
//   DesktopScreen — the user's real screen. macOS: screencapture + CoreGraphics
//                   events through JXA; Linux: xdotool + ImageMagick.
//   FakeScreen    — deterministic, for tests.
// Coordinates are in the pixel space of the screenshots we return.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class ScreenError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clampWait = (seconds, max = 10) => Math.min(max, Math.max(0, Number(seconds) || 0)) * 1000;

function run(file, args, { input, timeout = 15_000, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout, encoding, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new ScreenError(`${file} 실패: ${String(stderr || error.message).trim().slice(0, 300)}`));
      else resolve(stdout);
    });
    if (input != null) child.stdin.end(input);
  });
}

// Model key names (xdotool style) → normalized parts.
const KEY_ALIASES = {
  return: 'Enter', enter: 'Enter', kp_enter: 'Enter', tab: 'Tab', space: 'Space', ' ': 'Space', backspace: 'Backspace', delete: 'Delete',
  escape: 'Escape', esc: 'Escape', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', page_up: 'PageUp', prior: 'PageUp',
  page_down: 'PageDown', next: 'PageDown', home: 'Home', end: 'End', insert: 'Insert',
};
const MODIFIERS = { ctrl: 'Control', control: 'Control', shift: 'Shift', alt: 'Alt', option: 'Alt', super: 'Meta', cmd: 'Meta', command: 'Meta', meta: 'Meta', win: 'Meta' };

export function parseCombo(text) {
  const parts = String(text ?? '').split('+').map((part) => part.trim()).filter(Boolean);
  const mods = [];
  let key = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS[lower]) mods.push(MODIFIERS[lower]);
    else key = KEY_ALIASES[lower] ?? (/^f\d{1,2}$/i.test(part) ? part.toUpperCase() : part.length === 1 ? part : part[0].toUpperCase() + part.slice(1));
  }
  return { mods, key };
}

const parseMods = (text) => (text ? parseCombo(text).mods : []);

function point(value, label = 'coordinate') {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(Number(n)))) throw new ScreenError(`${label}는 [x, y] 형식이어야 합니다.`);
  return [Math.round(Number(value[0])), Math.round(Number(value[1]))];
}

// ---- base -------------------------------------------------------------------------------

class Screen {
  constructor() {
    this.cursor = [0, 0];
    this.last = null; // { png, width, height }
  }

  inBounds([x, y]) {
    const { width, height } = this.size;
    if (x < 0 || y < 0 || x >= width || y >= height) throw new ScreenError(`좌표 (${x}, ${y})가 화면(${width}×${height}) 밖입니다.`);
    return [x, y];
  }

  // Runs one member of the computer toolset. Returns { text } or { text, image }.
  async act(name, input = {}) {
    switch (name) {
      case 'screenshot': return this.shot();
      case 'zoom': {
        const region = input.region;
        if (!Array.isArray(region) || region.length !== 4) throw new ScreenError('region은 [x0, y0, x1, y1] 형식이어야 합니다.');
        const [x0, y0, x1, y1] = region.map((n) => Math.round(Number(n)));
        if (!(x1 > x0 && y1 > y0)) throw new ScreenError('region의 오른쪽 아래 좌표가 왼쪽 위보다 커야 합니다.');
        return { text: 'OK', image: await this.zoom([x0, y0, x1, y1]) };
      }
      case 'cursor_position': return { text: `X=${this.cursor[0]}, Y=${this.cursor[1]}` };
      case 'wait': await sleep(clampWait(input.duration)); return this.shot();
      case 'mouse_move': this.cursor = this.inBounds(point(input.coordinate)); await this.move(this.cursor); return { text: 'OK' };
      case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click': {
        if (input.coordinate) this.cursor = this.inBounds(point(input.coordinate));
        const button = name === 'right_click' ? 'right' : name === 'middle_click' ? 'middle' : 'left';
        const count = name === 'double_click' ? 2 : name === 'triple_click' ? 3 : 1;
        await this.click(this.cursor, { button, count, mods: parseMods(input.text) });
        return this.settle();
      }
      case 'left_click_drag': {
        const from = this.inBounds(point(input.start_coordinate, 'start_coordinate'));
        const to = this.inBounds(point(input.coordinate));
        await this.drag(from, to, parseMods(input.text));
        this.cursor = to;
        return this.settle();
      }
      case 'left_mouse_down': await this.button('down'); return { text: 'OK' };
      case 'left_mouse_up': await this.button('up'); return this.settle();
      case 'scroll': {
        if (input.coordinate) this.cursor = this.inBounds(point(input.coordinate));
        const direction = input.scroll_direction;
        if (!['up', 'down', 'left', 'right'].includes(direction)) throw new ScreenError('scroll_direction은 up/down/left/right 중 하나입니다.');
        const amount = Math.min(30, Math.max(1, Math.round(Number(input.scroll_amount) || 3)));
        await this.scroll(this.cursor, direction, amount, parseMods(input.text));
        return this.settle();
      }
      case 'type': {
        const text = String(input.text ?? '');
        if (!text) throw new ScreenError('입력할 text가 비어 있습니다.');
        if (text.length > 5000) throw new ScreenError('한 번에 5000자까지 입력할 수 있습니다.');
        await this.typeText(text);
        return this.settle();
      }
      case 'key': {
        const { mods, key } = parseCombo(input.text);
        if (!key && !mods.length) throw new ScreenError('누를 키(text)가 비어 있습니다.');
        const repeat = Math.min(100, Math.max(1, Math.round(Number(input.repeat) || 1)));
        for (let index = 0; index < repeat; index++) await this.press(mods, key);
        return this.settle();
      }
      case 'hold_key': {
        const { mods, key } = parseCombo(input.text);
        await this.hold(mods, key, clampWait(input.duration, 10));
        return this.settle();
      }
      default:
        throw new ScreenError(`지원하지 않는 화면 동작입니다: ${name}`);
    }
  }

  // After an action, let the screen settle; callers attach a screenshot when
  // the batch ends without one.
  async settle() {
    await sleep(250);
    return { text: 'OK' };
  }

  async shot() {
    this.last = await this.capture();
    return { text: 'OK', image: this.last };
  }

  async close() {}
}

// ---- private browser -----------------------------------------------------------------------

const ALLOWED_SCHEMES = /^(https?:|about:blank$|data:|blob:)/i;

export async function browserAvailable() {
  try {
    await import('playwright-core');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'playwright-core가 설치되지 않았습니다 (apps/agentville에서 npm install).' };
  }
}

export class BrowserScreen extends Screen {
  constructor({ width = 1280, height = 800, executablePath = process.env.AGENTVILLE_CHROME, headless = true } = {}) {
    super();
    this.size = { width, height };
    this.options = { executablePath, headless };
    this.browser = null;
    this.page = null;
    this.held = false;
  }

  async open() {
    if (this.page) return this.page;
    let playwright;
    try {
      playwright = await import('playwright-core');
    } catch {
      throw new ScreenError('전용 브라우저를 쓰려면 playwright-core가 필요합니다 (apps/agentville에서 npm install).');
    }
    const launch = (extra) => playwright.chromium.launch({ headless: this.options.headless, ...extra });
    try {
      this.browser = this.options.executablePath ? await launch({ executablePath: this.options.executablePath }) : await launch({ channel: 'chrome' });
    } catch {
      try {
        this.browser = await launch({ channel: 'msedge' });
      } catch {
        try {
          this.browser = await launch({});
        } catch (error) {
          throw new ScreenError(`브라우저를 열지 못했습니다. Chrome을 설치하거나 AGENTVILLE_CHROME에 실행 파일 경로를 지정하세요. (${String(error.message).split('\n')[0]})`);
        }
      }
    }
    const context = await this.browser.newContext({ viewport: this.size, deviceScaleFactor: 1, acceptDownloads: false, locale: 'ko-KR', timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone });
    // Only web pages: no file://, chrome:// or other local schemes.
    await context.route('**/*', (route) => (ALLOWED_SCHEMES.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
    this.page = await context.newPage();
    this.page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    this.page.on('popup', async (popup) => {
      // Keep one tab: follow popups in the main page.
      const url = popup.url();
      await popup.close().catch(() => {});
      if (ALLOWED_SCHEMES.test(url) && url !== 'about:blank') await this.page.goto(url).catch(() => {});
    });
    return this.page;
  }

  async navigate(url) {
    const target = String(url ?? '').trim();
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new ScreenError(`주소 형식이 아닙니다: ${target}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new ScreenError('http(s) 주소만 열 수 있습니다.');
    const page = await this.open();
    try {
      await page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    } catch (error) {
      throw new ScreenError(`페이지를 열지 못했습니다: ${String(error.message).split('\n')[0]}`);
    }
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    return { title: await page.title(), url: page.url() };
  }

  async readPage({ maxChars = 12_000 } = {}) {
    const page = await this.open();
    const data = await page.evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
      const links = [...document.querySelectorAll('a[href]')].slice(0, 40).map((a) => `${(a.innerText || a.title || '').trim().slice(0, 60)} → ${a.href}`).filter((line) => !line.startsWith(' →'));
      return { title: document.title, url: location.href, text, links };
    });
    const body = data.text.length > maxChars ? `${data.text.slice(0, maxChars)}\n… (${data.text.length - maxChars}자 더 있음)` : data.text;
    return { ...data, text: body };
  }

  async capture() {
    const page = await this.open();
    const png = await page.screenshot({ type: 'png' });
    return { png, width: this.size.width, height: this.size.height };
  }

  async zoom([x0, y0, x1, y1]) {
    const page = await this.open();
    const clip = { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.min(this.size.width, x1) - Math.max(0, x0), height: Math.min(this.size.height, y1) - Math.max(0, y0) };
    const png = await page.screenshot({ type: 'png', clip });
    return { png, width: clip.width, height: clip.height };
  }

  async withMods(mods, action) {
    const page = await this.open();
    for (const mod of mods) await page.keyboard.down(mod);
    try {
      await action(page);
    } finally {
      for (const mod of [...mods].reverse()) await page.keyboard.up(mod);
    }
  }

  async move([x, y]) { await (await this.open()).mouse.move(x, y); }

  async click([x, y], { button, count, mods }) {
    await this.withMods(mods, (page) => page.mouse.click(x, y, { button, clickCount: count, delay: 30 }));
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  }

  async drag(from, to, mods) {
    await this.withMods(mods, async (page) => {
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(...to, { steps: 12 });
      await page.mouse.up();
    });
  }

  async button(direction) {
    const page = await this.open();
    await page.mouse.move(...this.cursor);
    if (direction === 'down') await page.mouse.down();
    else await page.mouse.up();
  }

  async scroll([x, y], direction, amount, mods) {
    const step = 120 * amount;
    const [dx, dy] = { up: [0, -step], down: [0, step], left: [-step, 0], right: [step, 0] }[direction];
    await this.withMods(mods, async (page) => {
      await page.mouse.move(x, y);
      await page.mouse.wheel(dx, dy);
    });
  }

  async typeText(text) { await (await this.open()).keyboard.type(text, { delay: 12 }); }

  async press(mods, key) {
    const page = await this.open();
    const combo = [...mods, key ?? null].filter(Boolean).join('+');
    await page.keyboard.press(combo);
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  }

  async hold(mods, key, ms) {
    const page = await this.open();
    const keys = [...mods, key].filter(Boolean);
    for (const name of keys) await page.keyboard.down(name);
    await sleep(ms);
    for (const name of keys.reverse()) await page.keyboard.up(name);
  }

  get url() {
    return this.page?.url() ?? null;
  }

  async close() {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    await browser?.close().catch(() => {});
  }
}

// ---- the user's desktop ----------------------------------------------------------------------

// macOS virtual key codes for named keys and US-layout characters.
const MAC_KEYS = {
  Enter: 36, Tab: 48, Space: 49, Backspace: 51, Escape: 53, Delete: 117, Home: 115, End: 119, PageUp: 116, PageDown: 121,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35,
  l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, '`': 50,
};
const MAC_FLAGS = { Shift: 1 << 17, Control: 1 << 18, Alt: 1 << 19, Meta: 1 << 20 };
const XDO_KEYS = { Enter: 'Return', Space: 'space', Backspace: 'BackSpace', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', PageUp: 'Prior', PageDown: 'Next' };
const XDO_MODS = { Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'super' };

// JXA program that posts CoreGraphics events. Every value is passed as JSON,
// never spliced into code as text.
const JXA_EVENTS = `
ObjC.import('CoreGraphics');
function run(argv) {
  const steps = JSON.parse(argv[0]);
  const delay = (s) => $.NSThread.sleepForTimeInterval(s);
  for (const step of steps) {
    if (step.op === 'mouse') {
      const e = $.CGEventCreateMouseEvent($(), step.type, $.CGPointMake(step.x, step.y), step.button);
      if (step.clicks) $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, step.clicks);
      if (step.flags) $.CGEventSetFlags(e, step.flags);
      $.CGEventPost($.kCGHIDEventTap, e);
    } else if (step.op === 'key') {
      const e = $.CGEventCreateKeyboardEvent($(), step.code, step.down);
      if (step.flags) $.CGEventSetFlags(e, step.flags);
      $.CGEventPost($.kCGHIDEventTap, e);
    } else if (step.op === 'scroll') {
      const e = $.CGEventCreateScrollWheelEvent2($(), 0, 2, step.dy, step.dx, 0);
      if (step.flags) $.CGEventSetFlags(e, step.flags);
      $.CGEventPost($.kCGHIDEventTap, e);
    } else if (step.op === 'sleep') {
      delay(step.s);
    }
  }
  return 'ok';
}`;

const JXA_INFO = `
ObjC.import('AppKit');
ObjC.import('ApplicationServices');
function run() {
  const frame = $.NSScreen.mainScreen.frame;
  return JSON.stringify({ width: frame.size.width, height: frame.size.height, scale: $.NSScreen.mainScreen.backingScaleFactor, trusted: $.AXIsProcessTrusted() });
}`;

export async function desktopStatus() {
  if (process.platform === 'darwin') {
    try {
      const info = JSON.parse(await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_INFO]));
      return { ok: true, platform: 'macOS', ...info, accessibility: info.trusted, note: info.trusted ? null : '시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 AgentVille을 실행한 터미널(또는 node)을 허용해야 마우스·키보드 조작이 됩니다. 화면 기록 권한도 필요합니다.' };
    } catch (error) {
      return { ok: false, platform: 'macOS', reason: error.message };
    }
  }
  if (process.platform === 'linux') {
    try {
      const geometry = await run('xdotool', ['getdisplaygeometry']);
      const [width, height] = geometry.trim().split(/\s+/).map(Number);
      await run('import', ['-version']);
      return { ok: true, platform: 'Linux', width, height, scale: 1, accessibility: true };
    } catch {
      return { ok: false, platform: 'Linux', reason: 'xdotool과 ImageMagick(import)이 필요하고, X11 화면(DISPLAY)이 있어야 합니다.' };
    }
  }
  return { ok: false, platform: process.platform, reason: '내 컴퓨터 조작은 macOS와 Linux(X11)에서만 지원합니다.' };
}

// Screenshots are scaled so the long edge is at most this many pixels; the
// model's coordinates are mapped back by the same factor.
const DESKTOP_MAX_EDGE = 1440;

export class DesktopScreen extends Screen {
  constructor({ runner = run, status = null } = {}) {
    super();
    this.runner = runner;
    this.status = status;
    this.size = null;
    this.mouseDown = false;
  }

  async init() {
    if (this.size) return;
    const status = this.status ?? (await desktopStatus());
    if (!status.ok) throw new ScreenError(status.reason ?? '이 컴퓨터에서는 화면 조작을 할 수 없습니다.');
    this.platform = status.platform;
    this.logical = { width: Math.round(status.width), height: Math.round(status.height) };
    this.factor = Math.min(1, DESKTOP_MAX_EDGE / Math.max(this.logical.width, this.logical.height));
    this.size = { width: Math.round(this.logical.width * this.factor), height: Math.round(this.logical.height * this.factor) };
  }

  // Screenshot pixels → screen points.
  toScreen([x, y]) {
    return [Math.round(x / this.factor), Math.round(y / this.factor)];
  }

  async act(name, input) {
    await this.init();
    return super.act(name, input);
  }

  async capture() {
    await this.init();
    const dir = mkdtempSync(join(tmpdir(), 'agentville-shot-'));
    const file = join(dir, 'screen.png');
    try {
      if (this.platform === 'macOS') {
        await this.runner('/usr/sbin/screencapture', ['-x', '-C', '-t', 'png', file]);
        await this.runner('/usr/bin/sips', ['-z', String(this.size.height), String(this.size.width), file]);
      } else {
        await this.runner('import', ['-window', 'root', '-resize', `${this.size.width}x${this.size.height}!`, file]);
      }
      return { png: readFileSync(file), width: this.size.width, height: this.size.height };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async zoom([x0, y0, x1, y1]) {
    const full = await this.capture();
    // Crop with sips (macOS) or ImageMagick; sips crops around the centre, so
    // ImageMagick is used where present and the full shot is the fallback.
    const dir = mkdtempSync(join(tmpdir(), 'agentville-zoom-'));
    try {
      const source = join(dir, 'full.png');
      const out = join(dir, 'zoom.png');
      writeFileSync(source, full.png);
      try {
        await this.runner('magick', [source, '-crop', `${x1 - x0}x${y1 - y0}+${x0}+${y0}`, out]);
        return { png: readFileSync(out), width: x1 - x0, height: y1 - y0 };
      } catch {
        return full;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async post(steps) {
    if (this.platform === 'macOS') await this.runner('/usr/bin/osascript', ['-l', 'JavaScript', '-e', JXA_EVENTS, JSON.stringify(steps)]);
    else throw new ScreenError('내부 오류: 이 플랫폼은 post를 쓰지 않습니다.');
  }

  flags(mods) {
    return mods.reduce((sum, mod) => sum | (MAC_FLAGS[mod] ?? 0), 0);
  }

  async xdo(args) {
    await this.runner('xdotool', args);
  }

  async move(at) {
    const [x, y] = this.toScreen(at);
    if (this.platform === 'macOS') await this.post([{ op: 'mouse', type: this.mouseDown ? 6 : 5, x, y, button: 0 }]);
    else await this.xdo(['mousemove', String(x), String(y)]);
  }

  async click(at, { button, count, mods }) {
    const [x, y] = this.toScreen(at);
    if (this.platform === 'macOS') {
      const [downType, upType, code] = { left: [1, 2, 0], right: [3, 4, 1], middle: [25, 26, 2] }[button];
      const flags = this.flags(mods);
      const steps = [{ op: 'mouse', type: 5, x, y, button: 0 }];
      for (let index = 1; index <= count; index++) {
        steps.push({ op: 'mouse', type: downType, x, y, button: code, clicks: index, flags }, { op: 'mouse', type: upType, x, y, button: code, clicks: index, flags });
      }
      await this.post(steps);
    } else {
      const xButton = { left: '1', right: '3', middle: '2' }[button];
      const modArgs = mods.map((mod) => XDO_MODS[mod]);
      await this.xdo(['mousemove', String(x), String(y), ...modArgs.flatMap((mod) => ['keydown', mod]), 'click', '--repeat', String(count), xButton, ...modArgs.flatMap((mod) => ['keyup', mod])]);
    }
  }

  async drag(fromAt, toAt, mods) {
    const from = this.toScreen(fromAt);
    const to = this.toScreen(toAt);
    if (this.platform === 'macOS') {
      const flags = this.flags(mods);
      const steps = [{ op: 'mouse', type: 5, x: from[0], y: from[1], button: 0 }, { op: 'mouse', type: 1, x: from[0], y: from[1], button: 0, clicks: 1, flags }];
      for (let index = 1; index <= 10; index++) {
        steps.push({ op: 'mouse', type: 6, x: from[0] + ((to[0] - from[0]) * index) / 10, y: from[1] + ((to[1] - from[1]) * index) / 10, button: 0, flags }, { op: 'sleep', s: 0.02 });
      }
      steps.push({ op: 'mouse', type: 2, x: to[0], y: to[1], button: 0, clicks: 1, flags });
      await this.post(steps);
    } else {
      await this.xdo(['mousemove', String(from[0]), String(from[1]), 'mousedown', '1', 'mousemove', String(to[0]), String(to[1]), 'mouseup', '1']);
    }
  }

  async button(direction) {
    const [x, y] = this.toScreen(this.cursor);
    this.mouseDown = direction === 'down';
    if (this.platform === 'macOS') await this.post([{ op: 'mouse', type: direction === 'down' ? 1 : 2, x, y, button: 0, clicks: 1 }]);
    else await this.xdo([direction === 'down' ? 'mousedown' : 'mouseup', '1']);
  }

  async scroll(at, direction, amount, mods) {
    const [x, y] = this.toScreen(at);
    if (this.platform === 'macOS') {
      const lines = amount * 3;
      const [dx, dy] = { up: [0, lines], down: [0, -lines], left: [lines, 0], right: [-lines, 0] }[direction];
      await this.post([{ op: 'mouse', type: 5, x, y, button: 0 }, { op: 'scroll', dx, dy, flags: this.flags(mods) }]);
    } else {
      const xButton = { up: '4', down: '5', left: '6', right: '7' }[direction];
      await this.xdo(['mousemove', String(x), String(y), 'click', '--repeat', String(amount), xButton]);
    }
  }

  // Text goes through the clipboard on macOS so any language types correctly;
  // the user's clipboard is restored afterwards.
  async typeText(text) {
    if (this.platform === 'macOS') {
      let saved = null;
      try { saved = await this.runner('/usr/bin/pbpaste', []); } catch { /* empty clipboard */ }
      await this.runner('/usr/bin/pbcopy', [], { input: text });
      await this.post([
        { op: 'key', code: MAC_KEYS.v, down: true, flags: MAC_FLAGS.Meta },
        { op: 'key', code: MAC_KEYS.v, down: false, flags: MAC_FLAGS.Meta },
        { op: 'sleep', s: 0.25 },
      ]);
      if (saved != null) await this.runner('/usr/bin/pbcopy', [], { input: saved }).catch(() => {});
    } else {
      await this.xdo(['type', '--delay', '12', '--', text]);
    }
  }

  keySteps(mods, key, { down = true, up = true } = {}) {
    const code = MAC_KEYS[key] ?? MAC_KEYS[String(key ?? '').toLowerCase()];
    if (key && code == null) throw new ScreenError(`이 키는 지원하지 않습니다: ${key}`);
    const flags = this.flags(mods);
    const steps = [];
    if (code == null) return steps;
    if (down) steps.push({ op: 'key', code, down: true, flags });
    if (up) steps.push({ op: 'key', code, down: false, flags });
    return steps;
  }

  async press(mods, key) {
    if (this.platform === 'macOS') await this.post(this.keySteps(mods, key));
    else await this.xdo(['key', [...mods.map((mod) => XDO_MODS[mod]), XDO_KEYS[key] ?? key].filter(Boolean).join('+')]);
  }

  async hold(mods, key, ms) {
    if (this.platform === 'macOS') await this.post([...this.keySteps(mods, key, { up: false }), { op: 'sleep', s: ms / 1000 }, ...this.keySteps(mods, key, { down: false })]);
    else {
      const combo = [...mods.map((mod) => XDO_MODS[mod]), XDO_KEYS[key] ?? key].filter(Boolean).join('+');
      await this.xdo(['keydown', combo]);
      await sleep(ms);
      await this.xdo(['keyup', combo]);
    }
  }
}

// ---- tests --------------------------------------------------------------------------------

// A tiny 1×1 PNG stands in for every screenshot; actions are recorded.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export class FakeScreen extends Screen {
  constructor({ width = 1280, height = 800, kind = 'browser' } = {}) {
    super();
    this.kind = kind;
    this.size = { width, height };
    this.log = [];
    this.pageUrl = 'about:blank';
  }

  record(entry) { this.log.push(entry); }
  async capture() { return { png: PIXEL, width: this.size.width, height: this.size.height }; }
  async zoom() { return { png: PIXEL, width: 10, height: 10 }; }
  async move(at) { this.record({ op: 'move', at }); }
  async click(at, options) { this.record({ op: 'click', at, ...options }); }
  async drag(from, to) { this.record({ op: 'drag', from, to }); }
  async button(direction) { this.record({ op: 'button', direction }); }
  async scroll(at, direction, amount) { this.record({ op: 'scroll', at, direction, amount }); }
  async typeText(text) { this.record({ op: 'type', text }); }
  async press(mods, key) { this.record({ op: 'key', mods, key }); }
  async hold(mods, key) { this.record({ op: 'hold', mods, key }); }
  async settle() { return { text: 'OK' }; }
  async navigate(url) {
    this.pageUrl = new URL(url).href;
    this.record({ op: 'open', url: this.pageUrl });
    return { title: `테스트 페이지 ${this.pageUrl}`, url: this.pageUrl };
  }
  async readPage() { return { title: '테스트 페이지', url: this.pageUrl, text: '# 테스트 제목\n본문 첫 줄입니다.\n- 항목 하나\n- 항목 둘', links: ['더 보기 → https://example.com/more'] }; }
  get url() { return this.pageUrl; }
}
