import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const iconSizes = [16, 24, 32, 48, 64, 128, 256];
const supersample = 4;
// COSMOS mark (256 grid): a deep-space tile with a faint nebula, scattered
// stars, a ringed planet (해·달 사이의 행성) and one four-point sparkle (별).
// The ring's far half passes behind the planet and its near half in front.
const SPACE_TOP = [33, 36, 104];
const SPACE_EDGE = [7, 9, 28];
const NEBULA = [124, 92, 255];
const PLANET_LIGHT = [199, 210, 254];
const PLANET_MID = [129, 140, 248];
const PLANET_DARK = [55, 48, 163];
const RING_LIGHT = [254, 240, 138];
const RING_DARK = [245, 158, 11];
const STARS = [
  [46, 58, 2.4],
  [150, 44, 1.8],
  [58, 202, 1.8],
  [214, 176, 2.4],
  [96, 36, 1.4],
  [160, 220, 1.5],
  [30, 128, 1.3],
];
const PLANET = { x: 120, y: 140, r: 52 };
const RING = { a: 94, b: 25, tilt: (-22 * Math.PI) / 180, inner: 0.78, outer: 1 };
const SPARKLE = { x: 198, y: 60, long: 22, short: 5 };
let crcTable;
function crc32(buffer) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedSquare(x, y, size) {
  const radius = size * (60 / 256);
  const inset = size / 2 - radius;
  const dx = Math.max(Math.abs(x - size / 2) - inset, 0);
  const dy = Math.max(Math.abs(y - size / 2) - inset, 0);
  return dx * dx + dy * dy <= radius * radius;
}

function insideRoundedSquareInset(x, y, size, inset) {
  const radius = Math.max(0, size * (60 / 256) - inset);
  const half = size / 2 - inset;
  const straight = Math.max(0, half - radius);
  const dx = Math.max(Math.abs(x - size / 2) - straight, 0);
  const dy = Math.max(Math.abs(y - size / 2) - straight, 0);
  return dx * dx + dy * dy <= radius * radius;
}

const mix = (from, to, t) => from.map((channel, index) => channel + (to[index] - channel) * t);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function spaceColor(x, y) {
  const toCenter = Math.hypot(x - 96, y - 72) / 230;
  let color = mix(SPACE_TOP, SPACE_EDGE, clamp01(toCenter));
  const nebula = clamp01(1 - Math.hypot(x - 196, y - 196) / 120);
  color = mix(color, NEBULA, nebula * nebula * 0.35);
  return color;
}

function ringSample(x, y) {
  const dx = x - PLANET.x;
  const dy = y - PLANET.y;
  const cos = Math.cos(-RING.tilt);
  const sin = Math.sin(-RING.tilt);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const radius = Math.hypot(localX / RING.a, localY / RING.b);
  if (radius < RING.inner || radius > RING.outer) return null;
  const band = (radius - RING.inner) / (RING.outer - RING.inner);
  const color = mix(RING_LIGHT, RING_DARK, clamp01(0.25 + band * 0.6 + (localX / RING.a) * 0.25));
  return { color, front: localY > 0 };
}

function planetColor(x, y) {
  const dx = (x - PLANET.x) / PLANET.r;
  const dy = (y - PLANET.y) / PLANET.r;
  if (dx * dx + dy * dy > 1) return null;
  // Light from the upper left: lit limb pale, terminator deep indigo.
  const light = clamp01(0.55 - dx * 0.55 - dy * 0.6);
  const base = light > 0.5 ? mix(PLANET_MID, PLANET_LIGHT, (light - 0.5) * 2) : mix(PLANET_DARK, PLANET_MID, light * 2);
  // Two soft cloud bands follow the ring's tilt.
  const band = Math.sin((dy * Math.cos(RING.tilt) - dx * Math.sin(RING.tilt)) * 7.5);
  return mix(base, PLANET_LIGHT, band > 0.6 ? 0.12 : 0);
}

function sparkleColor(x, y) {
  const dx = Math.abs(x - SPARKLE.x);
  const dy = Math.abs(y - SPARKLE.y);
  // Four-point star: the union of two thin diamonds plus a bright core.
  const inDiamond = (u, v) => u / SPARKLE.short + v / SPARKLE.long <= 1;
  if (Math.hypot(dx, dy) <= 3.2) return [255, 255, 255];
  if (inDiamond(dx, dy) || inDiamond(dy, dx)) return mix([255, 255, 255], RING_LIGHT, clamp01(Math.hypot(dx, dy) / SPARKLE.long));
  return null;
}

function cosmosColor(x, y) {
  let color = spaceColor(x, y);
  for (const [sx, sy, radius] of STARS) {
    const distance = Math.hypot(x - sx, y - sy);
    if (distance <= radius) color = mix(color, [255, 255, 255], clamp01(1.2 - distance / radius));
  }
  const ring = ringSample(x, y);
  if (ring && !ring.front) color = ring.color;
  const planet = planetColor(x, y);
  if (planet) color = planet;
  if (ring && ring.front) color = ring.color;
  const sparkle = sparkleColor(x, y);
  if (sparkle) color = sparkle;
  return color.map((channel) => Math.round(channel));
}

function renderIcon(size) {
  const highSize = size * supersample;
  const highPixels = new Uint8Array(highSize * highSize * 4);

  for (let y = 0; y < highSize; y += 1) {
    for (let x = 0; x < highSize; x += 1) {
      const iconX = (x + 0.5) / supersample;
      const iconY = (y + 0.5) / supersample;
      const offset = (y * highSize + x) * 4;

      if (insideRoundedSquare(iconX, iconY, size)) {
        const scale = size / 256;
        const color = insideRoundedSquareInset(iconX, iconY, size, 2.5 * scale)
          ? cosmosColor(iconX / scale, iconY / scale)
          : [76, 82, 160];
        highPixels.set([...color, 255], offset);
      }
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  const samples = supersample * supersample;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sampleY = 0; sampleY < supersample; sampleY += 1) {
        for (let sampleX = 0; sampleX < supersample; sampleX += 1) {
          const highOffset = ((y * supersample + sampleY) * highSize + x * supersample + sampleX) * 4;
          red += highPixels[highOffset];
          green += highPixels[highOffset + 1];
          blue += highPixels[highOffset + 2];
          alpha += highPixels[highOffset + 3];
        }
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(red / samples);
      rgba[offset + 1] = Math.round(green / samples);
      rgba[offset + 2] = Math.round(blue / samples);
      rgba[offset + 3] = Math.round(alpha / samples);
    }
  }

  return rgba;
}

const pngEntries = iconSizes.map((size) => ({ size, png: encodePng(size, renderIcon(size)) }));
const icoHeaderSize = 6 + pngEntries.length * 16;
const ico = Buffer.alloc(icoHeaderSize);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(pngEntries.length, 4);

let offset = icoHeaderSize;
for (const [index, entry] of pngEntries.entries()) {
  const entryOffset = 6 + index * 16;
  ico[entryOffset] = entry.size === 256 ? 0 : entry.size;
  ico[entryOffset + 1] = entry.size === 256 ? 0 : entry.size;
  ico.writeUInt16LE(1, entryOffset + 4);
  ico.writeUInt16LE(32, entryOffset + 6);
  ico.writeUInt32LE(entry.png.length, entryOffset + 8);
  ico.writeUInt32LE(offset, entryOffset + 12);
  offset += entry.png.length;
}

// macOS lays app icons on a 1024 grid with the tile inset to 824 (Big Sur
// template). A full-bleed tile looks oversized next to every other Dock icon.
function renderMacIcon(size) {
  const body = Math.round((size * 824) / 1024);
  const inset = Math.floor((size - body) / 2);
  const tileRgba = renderIcon(body);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < body; y += 1) {
    tileRgba.copy(rgba, ((y + inset) * size + inset) * 4, y * body * 4, (y + 1) * body * 4);
  }
  return rgba;
}

// ICNS: 'icns' + total length, then one PNG per OSType (@2x types share the
// pixel size of the next 1x type).
const macPngs = new Map([16, 32, 64, 128, 256, 512, 1024].map((size) => [size, encodePng(size, renderMacIcon(size))]));
const icnsEntries = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
].map(([type, size]) => {
  const png = macPngs.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const icnsBody = Buffer.concat(icnsEntries);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);

const buildDir = fileURLToPath(new URL('../build/', import.meta.url));
await mkdir(buildDir, { recursive: true });
await writeFile(`${buildDir}/mixdog.ico`, Buffer.concat([ico, ...pngEntries.map(({ png }) => png)]));
await writeFile(`${buildDir}/mixdog.png`, pngEntries.at(-1).png);
await writeFile(`${buildDir}/icon.icns`, Buffer.concat([icnsHeader, icnsBody]));
// The installable web app (phone PWA) and the desktop tab icon share the mark.
const publicDir = fileURLToPath(new URL('../src/renderer/public/', import.meta.url));
await writeFile(`${publicDir}/mixdog-192.png`, encodePng(192, renderIcon(192)));
await writeFile(`${publicDir}/mixdog-512.png`, encodePng(512, renderIcon(512)));
console.log(`BRAND_ICONS=COSMOS; ICO_BYTES=${offset}; ICNS_BYTES=${icnsBody.length + 8}`);
