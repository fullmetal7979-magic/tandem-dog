// Canvas renderer for the town: static map layer, day/night tint, and
// characters interpolated between server ticks with bubbles and status icons.
import { drawAvatar } from './avatar.js';

const TILE = 24;
const TICK_MS = 250;
const ACTIVITY_ICON = { working: '💼', meeting: '🧠', chat: '💬', sleep: '💤', coffee: '☕', lunch: '🍱', nap: '💤', game: '🎮', read: '📖', walk: '🌿', daydream: '💭' };

export class TownView {
  constructor(canvas, catalog, { onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.catalog = catalog;
    this.rows = catalog.map.rows;
    this.width = this.rows[0].length * TILE;
    this.height = this.rows.length * TILE;
    this.onSelect = onSelect;
    this.characters = new Map();
    this.motion = new Map();
    this.selected = null;
    this.minute = 0;
    this.layer = this.buildLayer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('click', (event) => this.handleClick(event));
    canvas.addEventListener('mousemove', (event) => {
      canvas.style.cursor = this.hit(event) ? 'pointer' : 'default';
    });
  }

  zoneOf(x, y) {
    return this.catalog.map.zones.find(({ rect: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  }

  buildLayer() {
    const scale = 2;
    const layer = document.createElement('canvas');
    layer.width = this.width * scale;
    layer.height = this.height * scale;
    const ctx = layer.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const art = this.catalog.map.art;
    for (let y = 0; y < this.rows.length; y++) {
      for (let x = 0; x < this.rows[y].length; x++) {
        const ch = this.rows[y][x];
        const px = x * TILE;
        const py = y * TILE;
        if (ch === '#') {
          ctx.fillStyle = '#5b5249';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = '#6d6359';
          ctx.fillRect(px, py, TILE, 6);
          continue;
        }
        const zone = this.zoneOf(x, y);
        const base = ch === ',' || ch === 'T' || ch === 'p' || ch === '~' ? '#bfe0a8' : zone?.floor ?? '#d8d2c4';
        ctx.fillStyle = base;
        ctx.fillRect(px, py, TILE, TILE);
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.035)';
          ctx.fillRect(px, py, TILE, TILE);
        }
        if (ch === ',') {
          ctx.fillStyle = 'rgba(60,120,40,0.35)';
          ctx.fillRect(px + 6, py + 8, 2, 4);
          ctx.fillRect(px + 15, py + 14, 2, 4);
        } else if (ch === '~') {
          ctx.fillStyle = '#7cc3ea';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.fillRect(px + 4, py + 9, 8, 2);
        } else if (ch === 'M') {
          ctx.fillStyle = '#9b6b43';
          ctx.fillRect(px, py + 3, TILE, TILE - 6);
        } else if (ch === 'W') {
          ctx.fillStyle = '#fbfbf7';
          ctx.fillRect(px, py + 4, TILE, TILE - 10);
          ctx.strokeStyle = '#8f8f9a';
          ctx.strokeRect(px + 0.5, py + 4.5, TILE - 1, TILE - 11);
        } else if (ch === 'K') {
          ctx.fillStyle = '#a7774e';
          ctx.beginPath();
          ctx.arc(px + TILE / 2, py + TILE / 2, 8, 0, Math.PI * 2);
          ctx.fill();
        } else if (ch === 'C') {
          ctx.fillStyle = '#7a5537';
          ctx.fillRect(px, py + 2, TILE, TILE - 4);
          if (x % 3 === 1) {
            ctx.font = '14px system-ui, "Apple Color Emoji", "Segoe UI Emoji"';
            ctx.fillText('☕', px + TILE / 2, py + TILE / 2);
          }
        } else if (/[a-z]/.test(ch) && ch !== 'p') {
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
        } else if (art[ch]) {
          ctx.font = `${ch === 'T' ? 20 : 16}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
          ctx.fillText(art[ch], px + TILE / 2, py + TILE / 2 + 1);
        }
      }
    }
    ctx.textAlign = 'left';
    ctx.font = '600 11px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';
    for (const zone of this.catalog.map.zones) {
      const [x0, y0] = zone.rect;
      const label = zone.name;
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(40,34,30,0.55)';
      ctx.fillRect(x0 * TILE + 2, (zone.id === 'garden' ? 17 : y0) * TILE + 2, w, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x0 * TILE + 7, (zone.id === 'garden' ? 17 : y0) * TILE + 10);
    }
    return layer;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const cssWidth = parent.clientWidth;
    const cssHeight = Math.round(cssWidth * (this.height / this.width));
    const ratio = window.devicePixelRatio || 1;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * ratio);
    this.canvas.height = Math.round(cssHeight * ratio);
    this.scale = (cssWidth / this.width) * ratio;
  }

  setCharacter(view) {
    this.characters.set(view.id, { ...(this.characters.get(view.id) ?? {}), ...view });
    if (!this.motion.has(view.id) && view.state?.pos) {
      this.motion.set(view.id, { from: { ...view.state.pos }, to: { ...view.state.pos }, t0: performance.now(), facing: 1 });
    }
  }

  removeCharacter(id) {
    this.characters.delete(id);
    this.motion.delete(id);
  }

  applyTick(tick) {
    this.minute = tick.clock.minute;
    const now = performance.now();
    for (const entry of tick.characters) {
      const known = this.characters.get(entry.id);
      if (!known) continue;
      Object.assign(known, { tickActivity: entry.activity, bubble: entry.bubble, mood: entry.mood, taskId: entry.taskId });
      const motion = this.motion.get(entry.id);
      if (!motion) {
        this.motion.set(entry.id, { from: { ...entry.pos }, to: { ...entry.pos }, t0: now, facing: 1 });
        continue;
      }
      const current = this.position(motion, now);
      const facing = entry.pos.x > motion.to.x ? 1 : entry.pos.x < motion.to.x ? -1 : motion.facing;
      this.motion.set(entry.id, { from: current, to: { ...entry.pos }, t0: now, facing });
    }
  }

  position(motion, now) {
    const t = Math.min(1, (now - motion.t0) / TICK_MS);
    return { x: motion.from.x + (motion.to.x - motion.from.x) * t, y: motion.from.y + (motion.to.y - motion.from.y) * t };
  }

  darkness() {
    const hour = (this.minute % 1440) / 60;
    if (hour >= 7 && hour < 18) return 0;
    if (hour >= 18 && hour < 21) return ((hour - 18) / 3) * 0.38;
    if (hour >= 5 && hour < 7) return ((7 - hour) / 2) * 0.38;
    return 0.42;
  }

  start() {
    const frame = () => {
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  draw() {
    const { ctx } = this;
    const now = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layer, 0, 0, this.width, this.height);

    const list = [...this.characters.values()].map((character) => {
      const motion = this.motion.get(character.id);
      const pos = motion ? this.position(motion, now) : character.state.pos;
      return { character, pos, facing: motion?.facing ?? 1 };
    }).sort((a, b) => a.pos.y - b.pos.y);

    const dark = this.darkness();
    for (const { character, pos, facing } of list) this.drawCharacter(character, pos, facing, now);
    if (dark > 0) {
      ctx.fillStyle = `rgba(18,24,70,${dark})`;
      ctx.fillRect(0, 0, this.width, this.height);
      // Lamps keep characters readable at night.
      for (const { pos } of list) {
        const gradient = ctx.createRadialGradient((pos.x + 0.5) * TILE, (pos.y + 0.5) * TILE, 2, (pos.x + 0.5) * TILE, (pos.y + 0.5) * TILE, 34);
        gradient.addColorStop(0, `rgba(255,236,170,${dark * 0.6})`);
        gradient.addColorStop(1, 'rgba(255,236,170,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect((pos.x + 0.5) * TILE - 34, (pos.y + 0.5) * TILE - 34, 68, 68);
      }
    }
    for (const { character, pos } of list) this.drawOverlay(character, pos, now);
  }

  drawCharacter(character, pos, facing, now) {
    const { ctx } = this;
    const cx = (pos.x + 0.5) * TILE;
    const cy = (pos.y + 0.5) * TILE - 6;
    const activity = character.tickActivity ?? character.state?.activity;
    if (this.selected === character.id) {
      const pulse = 1 + Math.sin(now / 220) * 0.12;
      ctx.strokeStyle = '#ffcf3f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 15, 12 * pulse, 4.5 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const bob = activity === 'working' || activity === 'meeting' ? Math.sin(now / 160) * 0.8 : 0;
    drawAvatar(ctx, cx, cy + bob, 26, character.appearance, { sleeping: activity === 'sleep', mood: character.mood?.value ?? 60, facing });
  }

  drawOverlay(character, pos, now) {
    const { ctx } = this;
    const cx = (pos.x + 0.5) * TILE;
    const cy = (pos.y + 0.5) * TILE - 6;
    const activity = character.tickActivity ?? character.state?.activity;
    ctx.font = '600 9.5px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `${character.name} · Lv${character.level}`;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = this.selected === character.id ? 'rgba(255,207,63,0.95)' : 'rgba(30,28,36,0.72)';
    roundRect(ctx, cx - w / 2, cy + 18, w, 12, 6);
    ctx.fill();
    ctx.fillStyle = this.selected === character.id ? '#2b2310' : '#fff';
    ctx.fillText(label, cx, cy + 24.5);

    const bubble = character.bubble;
    if (bubble?.text) {
      ctx.font = '10.5px system-ui, -apple-system, "Apple SD Gothic Neo", "Apple Color Emoji", sans-serif';
      const text = bubble.text.length > 22 ? `${bubble.text.slice(0, 21)}…` : bubble.text;
      const bw = ctx.measureText(text).width + 12;
      const by = cy - 34;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.strokeStyle = 'rgba(40,40,50,0.25)';
      roundRect(ctx, cx - bw / 2, by - 9, bw, 18, 8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 4, by + 9);
      ctx.lineTo(cx, by + 14);
      ctx.lineTo(cx + 4, by + 9);
      ctx.fill();
      ctx.fillStyle = '#2b2a33';
      ctx.fillText(text, cx, by + 0.5);
    } else if (ACTIVITY_ICON[activity]) {
      ctx.font = '13px system-ui, "Apple Color Emoji", "Segoe UI Emoji"';
      const float = activity === 'sleep' ? Math.sin(now / 400) * 2 : 0;
      ctx.fillText(ACTIVITY_ICON[activity], cx + 11, cy - 15 + float);
    }
  }

  hit(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * this.width;
    const y = ((event.clientY - rect.top) / rect.height) * this.height;
    const now = performance.now();
    let best = null;
    for (const character of this.characters.values()) {
      const motion = this.motion.get(character.id);
      const pos = motion ? this.position(motion, now) : character.state.pos;
      const dx = (pos.x + 0.5) * TILE - x;
      const dy = (pos.y + 0.5) * TILE - 4 - y;
      const d = Math.hypot(dx, dy);
      if (d < 18 && (!best || d < best.d)) best = { id: character.id, d };
    }
    return best?.id ?? null;
  }

  handleClick(event) {
    const id = this.hit(event);
    if (id) this.onSelect?.(id);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
