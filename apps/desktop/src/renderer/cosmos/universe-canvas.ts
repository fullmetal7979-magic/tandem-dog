// The painter for 행성의 우주. No React here: the component hands it a model
// and tells it when it may move. While stopped (reduced motion, effects off,
// hidden window, scrolled away) it draws one still frame on every change;
// running, it turns the galaxy at about 30 frames a second.
//
// Layers, back to front: the cached sky (nebula clouds, galaxy disk, dust),
// twinkling dust, the two spiral arms, lights and 성운 behind the planet, the
// back half of the ring, the planet, the front half of the ring, threads to
// unpushed lights, lights and 성운 in front, then the pointed-at light and a
// newborn light flying out of the planet.
import type { PlanetPalette, UniverseLight } from './universe-model';
import { UNIVERSE_ARMS, armAngle, hashString, orbitSpeed, seededRandom } from './universe-model';

export interface SceneModel {
  seed: string;
  palette: PlanetPalette;
  lights: readonly UniverseLight[];
  /** Particles of 성운 circling the planet. */
  nebula: number;
  /** Draw threads from the planet to lights that are not pushed yet. */
  tethers: boolean;
}

export interface PickedLight {
  light: UniverseLight;
  x: number;
  y: number;
}

export interface UniverseScene {
  update(model: SceneModel): void;
  resize(width: number, height: number, dpr: number): void;
  setRunning(running: boolean): void;
  setHover(hash: string | null): void;
  pick(x: number, y: number): PickedLight | null;
  /** Where a light is drawn right now (keyboard travel points at it), or null when it is not on screen. */
  locate(hash: string): PickedLight | null;
  destroy(): void;
}

/** How flat the galaxy disk looks: its vertical radius over its horizontal one. */
const TILT = 0.36;
const RING_TILT = -0.3;
const FRAME_MS = 32;
const BIRTH_MS = 1700;
const MAX_NEBULA = 42;
const MAX_TETHERS = 24;
const MAX_LABELS = 5;

interface Placed {
  light: UniverseLight;
  x: number;
  y: number;
  depth: number;
}

interface Spot {
  lon: number;
  lat: number;
  size: number;
  light: boolean;
}

interface Mote {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
  phase: number;
}

interface Particle {
  orbit: number;
  speed: number;
  phase: number;
  lift: number;
  tone: 0 | 1;
}

const hueOf = (color: string) => Number(/hsl\((\d+)/.exec(color)?.[1] ?? 0);
const ease = (value: number) => 1 - (1 - value) ** 3;

export function createUniverseScene(canvas: HTMLCanvasElement): UniverseScene | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let model: SceneModel | null = null;
  let sky: HTMLCanvasElement | null = null;
  let spots: Spot[] = [];
  let motes: Mote[] = [];
  let particles: Particle[] = [];
  let placed: Placed[] = [];
  let hover: string | null = null;
  let birth: { hash: string; start: number } | null = null;
  let running = false;
  let raf = 0;
  let last = 0;
  // Scene time only advances while running, so a pause never jumps the sky.
  let clock = 0;
  const sprites = new Map<number, HTMLCanvasElement>();

  const geometry = () => {
    const planetR = Math.max(18, Math.min(44, Math.min(width, height) * 0.11));
    let rx = Math.min(width * 0.47, height * 1.3);
    if (rx * TILT > height * 0.44) rx = (height * 0.44) / TILT;
    rx = Math.max(rx, planetR * 3.2);
    return { cx: width / 2, cy: height * 0.54, planetR, rx, ry: rx * TILT };
  };

  // A soft glow, one per 30° of hue, drawn once and stamped for every light.
  const sprite = (hue: number, saturation = 80) => {
    const key = Math.round(hue / 30) * 30 + saturation * 1000;
    const cached = sprites.get(key);
    if (cached) return cached;
    const size = 64;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const g = out.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgb(255 255 255 / 1)');
      grad.addColorStop(0.16, `hsl(${key % 1000} ${saturation}% 84% / 0.7)`);
      grad.addColorStop(0.42, `hsl(${key % 1000} ${saturation}% 68% / 0.16)`);
      grad.addColorStop(1, `hsl(${key % 1000} ${saturation}% 60% / 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    sprites.set(key, out);
    return out;
  };

  const seedWorld = (seed: string) => {
    const random = seededRandom(hashString(`${seed}:world`));
    spots = Array.from({ length: 16 }, () => ({
      lon: random() * Math.PI * 2,
      lat: (random() - 0.5) * 2.2,
      size: 0.1 + random() * 0.22,
      light: random() > 0.45,
    }));
    motes = Array.from({ length: 46 }, () => ({
      x: random(),
      y: random(),
      size: 0.5 + random() * 1.1,
      alpha: 0.25 + random() * 0.55,
      speed: 0.5 + random() * 1.4,
      phase: random() * Math.PI * 2,
    }));
  };

  const seedNebula = (seed: string, count: number) => {
    const random = seededRandom(hashString(`${seed}:nebula`));
    particles = Array.from({ length: Math.min(count, MAX_NEBULA) }, () => ({
      orbit: 1.4 + random() * 1.15,
      speed: 0.2 + random() * 0.42,
      phase: random() * Math.PI * 2,
      lift: (random() - 0.5) * 0.5,
      tone: random() > 0.5 ? 1 : 0,
    }));
  };

  // The sky that never moves: clouds, the galaxy disk glow and fixed dust.
  const paintSky = () => {
    if (!model || !width || !height) return;
    const out = sky ?? document.createElement('canvas');
    out.width = Math.round(width * dpr);
    out.height = Math.round(height * dpr);
    const g = out.getContext('2d');
    if (!g) return;
    sky = out;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const random = seededRandom(hashString(`${model.seed}:sky`));
    const { cx, cy, rx, ry } = geometry();
    for (let index = 0; index < 4; index++) {
      const x = width * (0.08 + random() * 0.84);
      const y = height * (0.1 + random() * 0.8);
      const radius = Math.max(width, height) * (0.22 + random() * 0.3);
      const color = model.palette.nebula[index % 2];
      const grad = g.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, color.replace(')', ' / 0.16)'));
      grad.addColorStop(1, color.replace(')', ' / 0)'));
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
    }
    g.save();
    g.translate(cx, cy);
    g.scale(1, TILT);
    const disk = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.05);
    disk.addColorStop(0, model.palette.atmosphere.replace(')', ' / 0.16)'));
    disk.addColorStop(0.45, model.palette.nebula[1].replace(')', ' / 0.07)'));
    disk.addColorStop(1, 'rgb(0 0 0 / 0)');
    g.fillStyle = disk;
    g.beginPath();
    g.arc(0, 0, rx * 1.05, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const dust = Math.round((width * height) / 2600);
    for (let index = 0; index < dust; index++) {
      const x = random() * width;
      const y = random() * height;
      // Dust thickens toward the disk, like a real galaxy plane.
      const dx = (x - cx) / (rx * 1.2);
      const dy = (y - cy) / (ry * 2.4);
      const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      g.fillStyle = `rgb(235 238 255 / ${(0.12 + random() * 0.4 + near * 0.25).toFixed(3)})`;
      const size = random() < 0.08 ? 1.4 : 0.8;
      g.fillRect(x, y, size, size);
    }
  };

  const drawArms = (cx: number, cy: number, rx: number, ry: number, t: number) => {
    if (!model) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let arm = 0; arm < UNIVERSE_ARMS; arm++) {
      ctx.beginPath();
      for (let step = 0; step <= 57; step++) {
        const r = 0.17 + step * 0.015;
        const angle = armAngle(arm, r) + orbitSpeed(r) * t;
        const x = cx + Math.cos(angle) * r * rx;
        const y = cy + Math.sin(angle) * r * ry;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = model.palette.atmosphere.replace(')', ' / 0.035)');
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.strokeStyle = model.palette.atmosphere.replace(')', ' / 0.09)');
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawLight = (entry: Placed, t: number, scale = 1) => {
    const light = entry.light;
    const twinkle = 0.78 + 0.22 * Math.sin(t * 1.3 + light.twinkle);
    const depth = 0.86 + 0.14 * entry.depth;
    const alpha = Math.max(0.18, (1 - light.age * 0.55) * twinkle) * scale;
    const glow = (6 + light.size * 6) * depth;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite(light.hue, 70), entry.x - glow, entry.y - glow, glow * 2, glow * 2);
    ctx.globalAlpha = Math.min(1, alpha * 1.15);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(entry.x, entry.y, (0.55 + light.size * 0.5) * depth, 0, Math.PI * 2);
    ctx.fill();
    if (light.kind === 'tag' || light.kind === 'origin') {
      const flare = light.size * 7;
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(entry.x - flare, entry.y);
      ctx.lineTo(entry.x + flare, entry.y);
      ctx.moveTo(entry.x, entry.y - flare);
      ctx.lineTo(entry.x, entry.y + flare);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Tag names, newest first, skipping any that would sit on one already written.
  const drawLabels = () => {
    if (width <= 420) return;
    ctx.save();
    ctx.font = '600 10.5px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgb(232 236 255)';
    const taken: { x: number; y: number; w: number }[] = [];
    for (const entry of placed) {
      if (!entry.light.tag || entry.light.hash === birth?.hash) continue;
      if (taken.length >= MAX_LABELS) break;
      const x = entry.x + 9;
      const y = entry.y - 7;
      // The title and the verse are written over the top band and the lower left.
      if (y < height * 0.32 || (y > height * 0.7 && x < width * 0.62)) continue;
      const w = ctx.measureText(entry.light.tag).width;
      if (taken.some((box) => x < box.x + box.w + 6 && box.x < x + w + 6 && Math.abs(box.y - y) < 14)) continue;
      taken.push({ x, y, w });
      ctx.globalAlpha = entry.depth < 0 ? 0.55 : 0.85;
      ctx.fillText(entry.light.tag, x, y);
    }
    ctx.restore();
  };

  const particleAt = (particle: Particle, t: number, cx: number, cy: number, planetR: number, lag = 0) => {
    const angle = particle.phase + particle.speed * (t - lag);
    return {
      x: cx + Math.cos(angle) * planetR * particle.orbit,
      y: cy + Math.sin(angle) * planetR * particle.orbit * 0.42 + particle.lift * planetR,
      depth: Math.sin(angle),
    };
  };

  const drawParticles = (front: boolean, t: number, cx: number, cy: number, planetR: number) => {
    if (!model || !particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const head = particleAt(particle, t, cx, cy, planetR);
      if (head.depth >= 0 !== front) continue;
      const tone = sprite(hueOf(model.palette.nebula[particle.tone]), 72);
      // A short tail of earlier positions makes the orbit readable.
      for (let step = 4; step >= 0; step--) {
        const at = particleAt(particle, t, cx, cy, planetR, step * 0.14);
        const size = (front ? 7 : 5.5) * (1 - step * 0.14);
        ctx.globalAlpha = (front ? 0.85 : 0.5) * (1 - step * 0.2);
        ctx.drawImage(tone, at.x - size, at.y - size, size * 2, size * 2);
      }
    }
    ctx.restore();
  };

  const drawRing = (half: 'back' | 'front', cx: number, cy: number, planetR: number) => {
    if (!model) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(RING_TILT);
    ctx.beginPath();
    const big = planetR * 4;
    ctx.rect(-big, half === 'back' ? -big : 0, big * 2, big);
    ctx.clip();
    const bands: [number, number, number, string][] = [
      [2.05, 0.09, 0.6, model.palette.ring],
      [1.86, 0.05, 0.32, model.palette.ringShade],
      [1.68, 0.07, 0.42, model.palette.ring],
      [1.5, 0.035, 0.2, model.palette.ringShade],
    ];
    for (const [radius, line, alpha, color] of bands) {
      ctx.beginPath();
      ctx.ellipse(0, 0, planetR * radius, planetR * radius * 0.24, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color.replace(')', ` / ${half === 'back' ? alpha * 0.7 : alpha})`);
      ctx.lineWidth = planetR * line;
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawPlanet = (cx: number, cy: number, planetR: number, t: number) => {
    if (!model) return;
    const palette = model.palette;
    const halo = ctx.createRadialGradient(cx, cy, planetR * 0.8, cx, cy, planetR * 2.3);
    halo.addColorStop(0, palette.atmosphere.replace(')', ' / 0.34)'));
    halo.addColorStop(1, palette.atmosphere.replace(')', ' / 0)'));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, planetR * 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, planetR, 0, Math.PI * 2);
    ctx.clip();
    const body = ctx.createRadialGradient(cx - planetR * 0.38, cy - planetR * 0.42, planetR * 0.08, cx, cy, planetR * 1.05);
    body.addColorStop(0, palette.light);
    body.addColorStop(0.5, palette.mid);
    body.addColorStop(1, palette.deep);
    ctx.fillStyle = body;
    ctx.fillRect(cx - planetR, cy - planetR, planetR * 2, planetR * 2);
    // Latitude bands, then surface patches that rotate past the terminator.
    for (let band = -2; band <= 2; band++) {
      ctx.fillStyle = band % 2 ? 'rgb(255 255 255 / 0.045)' : 'rgb(0 0 0 / 0.06)';
      ctx.fillRect(cx - planetR, cy + band * planetR * 0.34 - planetR * 0.08, planetR * 2, planetR * 0.16);
    }
    const spin = t * 0.11;
    for (const spot of spots) {
      const lon = spot.lon + spin;
      const facing = Math.cos(lon);
      if (facing <= 0) continue;
      const x = cx + planetR * Math.cos(spot.lat * 0.7) * Math.sin(lon);
      const y = cy + planetR * Math.sin(spot.lat * 0.7);
      ctx.fillStyle = spot.light ? `rgb(255 255 255 / ${0.14 * facing})` : `rgb(0 0 0 / ${0.16 * facing})`;
      ctx.beginPath();
      ctx.ellipse(x, y, spot.size * planetR * facing, spot.size * planetR * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const shade = ctx.createRadialGradient(cx - planetR * 0.45, cy - planetR * 0.5, planetR * 0.3, cx, cy, planetR * 1.55);
    shade.addColorStop(0, 'rgb(0 0 0 / 0)');
    shade.addColorStop(0.55, 'rgb(0 0 0 / 0.1)');
    shade.addColorStop(1, 'rgb(3 4 18 / 0.74)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - planetR, cy - planetR, planetR * 2, planetR * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, planetR, Math.PI * 0.85, Math.PI * 1.75);
    ctx.strokeStyle = palette.atmosphere.replace(')', ' / 0.7)');
    ctx.lineWidth = 1.3;
    ctx.stroke();
  };

  const frame = (now: number) => {
    if (!model || !width || !height) return;
    const t = clock;
    const { cx, cy, planetR, rx, ry } = geometry();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (sky) ctx.drawImage(sky, 0, 0, width, height);
    for (const mote of motes) {
      const alpha = mote.alpha * (0.55 + 0.45 * Math.sin(t * mote.speed + mote.phase));
      ctx.fillStyle = `rgb(240 243 255 / ${alpha.toFixed(3)})`;
      ctx.fillRect(mote.x * width, mote.y * height, mote.size, mote.size);
    }
    drawArms(cx, cy, rx, ry, t);

    const born = birth ? Math.min(1, (now - birth.start) / BIRTH_MS) : 1;
    if (born >= 1) birth = null;
    placed = model.lights.map((light) => {
      const angle = light.theta + orbitSpeed(light.r) * t;
      return { light, x: cx + Math.cos(angle) * light.r * rx, y: cy + Math.sin(angle) * light.r * ry, depth: Math.sin(angle) };
    });
    const behind = placed.filter((entry) => entry.depth < 0);
    const before = placed.filter((entry) => entry.depth >= 0);
    const visible = (entry: Placed) => !birth || entry.light.hash !== birth.hash;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const entry of behind) if (visible(entry)) drawLight(entry, t, 0.85);
    ctx.restore();
    drawParticles(false, t, cx, cy, planetR);
    drawRing('back', cx, cy, planetR);
    drawPlanet(cx, cy, planetR, t);
    drawRing('front', cx, cy, planetR);

    if (model.tethers) {
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = model.palette.ring.replace(')', ' / 0.45)');
      // The newest few only: a long unpushed run would turn threads into a web.
      for (const entry of placed.slice(0, MAX_TETHERS)) {
        if (entry.light.pushed || !visible(entry)) continue;
        const angle = Math.atan2(entry.y - cy, entry.x - cx);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * planetR, cy + Math.sin(angle) * planetR);
        ctx.lineTo(entry.x, entry.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawParticles(true, t, cx, cy, planetR);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const entry of before) if (visible(entry)) drawLight(entry, t);
    ctx.restore();
    drawLabels();

    const pointed = hover ? placed.find((entry) => entry.light.hash === hover) : null;
    if (pointed) {
      const angle = Math.atan2(pointed.y - cy, pointed.x - cx);
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = model.palette.atmosphere.replace(')', ' / 0.6)');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * planetR * 1.05, cy + Math.sin(angle) * planetR * 1.05);
      ctx.lineTo(pointed.x, pointed.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgb(255 255 255 / 0.85)';
      ctx.beginPath();
      ctx.arc(pointed.x, pointed.y, 8.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (birth) {
      const target = placed.find((entry) => entry.light.hash === birth?.hash);
      if (target) {
        // The newest light leaves the planet on a gentle arc and settles.
        const p = ease(born);
        const angle = Math.atan2(target.y - cy, target.x - cx);
        const sx = cx + Math.cos(angle) * planetR;
        const sy = cy + Math.sin(angle) * planetR;
        const mx = (sx + target.x) / 2;
        const my = Math.min(sy, target.y) - planetR * 1.2;
        const at = (q: number) => ({
          x: (1 - q) * (1 - q) * sx + 2 * (1 - q) * q * mx + q * q * target.x,
          y: (1 - q) * (1 - q) * sy + 2 * (1 - q) * q * my + q * q * target.y,
        });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = sprite(target.light.hue, 70);
        for (let step = 6; step >= 0; step--) {
          const point = at(Math.max(0, p - step * 0.04));
          const size = 10 * (1 - step * 0.12);
          ctx.globalAlpha = 0.9 * (1 - step * 0.13);
          ctx.drawImage(glow, point.x - size, point.y - size, size * 2, size * 2);
        }
        if (p > 0.85) {
          const bloom = (p - 0.85) / 0.15;
          ctx.globalAlpha = 1 - bloom;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(target.x, target.y, 4 + bloom * 20, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  };

  const loop = (now: number) => {
    raf = window.requestAnimationFrame(loop);
    if (now - last < FRAME_MS) return;
    clock += last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    frame(now);
  };

  const still = () => {
    if (!running) frame(performance.now());
  };

  return {
    update(next) {
      const previous = model;
      if (!previous || previous.seed !== next.seed) seedWorld(next.seed);
      if (!previous || previous.seed !== next.seed || previous.nebula !== next.nebula) seedNebula(next.seed, next.nebula);
      const newest = next.lights[0];
      if (
        running &&
        previous?.seed === next.seed &&
        previous.lights.length > 0 &&
        newest &&
        !previous.lights.some((light) => light.hash === newest.hash)
      ) {
        birth = { hash: newest.hash, start: performance.now() };
      }
      model = next;
      if (!previous || previous.seed !== next.seed || previous.palette !== next.palette) paintSky();
      still();
    },
    resize(nextWidth, nextHeight, nextDpr) {
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      paintSky();
      still();
    },
    setRunning(next) {
      if (next === running) return;
      running = next;
      if (running) {
        last = 0;
        raf = window.requestAnimationFrame(loop);
      } else {
        window.cancelAnimationFrame(raf);
        raf = 0;
        frame(performance.now());
      }
    },
    setHover(hash) {
      if (hash === hover) return;
      hover = hash;
      still();
    },
    pick(x, y) {
      let best: Placed | null = null;
      let bestDistance = 14 * 14;
      for (const entry of placed) {
        const distance = (entry.x - x) ** 2 + (entry.y - y) ** 2;
        // Lights in front win ties with the ones behind them.
        const weighted = entry.depth < 0 ? distance * 1.3 : distance;
        if (weighted < bestDistance) {
          bestDistance = weighted;
          best = entry;
        }
      }
      return best ? { light: best.light, x: best.x, y: best.y } : null;
    },
    locate(hash) {
      const entry = placed.find((candidate) => candidate.light.hash === hash);
      return entry ? { light: entry.light, x: entry.x, y: entry.y } : null;
    },
    destroy() {
      window.cancelAnimationFrame(raf);
      raf = 0;
      running = false;
      sprites.clear();
      sky = null;
    },
  };
}
