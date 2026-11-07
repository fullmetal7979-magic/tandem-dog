// Procedural chibi avatars (and their pets) drawn on canvas from a
// character's appearance. Item ids come from src/catalog/wardrobe.mjs.
const cache = new Map();

const shade = (hex, amount) => {
  const value = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(value)) return hex;
  const channel = (shift) => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBody(ctx, s, look) {
  const color = look.shirt ?? '#4f7cff';
  const outfit = look.outfit ?? 'tee';
  if (outfit === 'cape') {
    ctx.fillStyle = shade(color, -40);
    ctx.beginPath();
    ctx.moveTo(-9 * s, 3 * s); ctx.lineTo(9 * s, 3 * s); ctx.lineTo(12 * s, 15 * s); ctx.lineTo(-12 * s, 15 * s); ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = outfit === 'labcoat' ? '#f4f6fb' : outfit === 'suit' ? '#2f3442' : color;
  roundRect(ctx, -8 * s, 2 * s, 16 * s, 12 * s, 5 * s);
  ctx.fill();
  switch (outfit) {
    case 'hoodie':
      ctx.fillStyle = shade(color, -30);
      roundRect(ctx, -6 * s, 1.5 * s, 12 * s, 3 * s, 1.5 * s); ctx.fill();
      ctx.fillRect(-4 * s, 8 * s, 8 * s, 3 * s);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(0.6, 0.6 * s);
      ctx.beginPath(); ctx.moveTo(-1.5 * s, 4 * s); ctx.lineTo(-1.5 * s, 7 * s); ctx.moveTo(1.5 * s, 4 * s); ctx.lineTo(1.5 * s, 7 * s); ctx.stroke();
      break;
    case 'shirt':
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(-3.5 * s, 2 * s); ctx.lineTo(0, 5 * s); ctx.lineTo(3.5 * s, 2 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(color, -45);
      for (const y of [7, 10]) { ctx.beginPath(); ctx.arc(0, y * s, 0.7 * s, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'suit':
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(-3 * s, 2 * s); ctx.lineTo(0, 7 * s); ctx.lineTo(3 * s, 2 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(-1 * s, 3 * s); ctx.lineTo(1 * s, 3 * s); ctx.lineTo(1.4 * s, 9 * s); ctx.lineTo(0, 10.5 * s); ctx.lineTo(-1.4 * s, 9 * s); ctx.closePath(); ctx.fill();
      break;
    case 'labcoat':
      ctx.fillStyle = color;
      ctx.fillRect(-1.6 * s, 2 * s, 3.2 * s, 12 * s);
      ctx.strokeStyle = '#c8ccd8';
      ctx.lineWidth = Math.max(0.6, 0.7 * s);
      ctx.strokeRect(3 * s, 8 * s, 3 * s, 3 * s);
      break;
    case 'apron':
      ctx.fillStyle = '#fff7e6';
      roundRect(ctx, -5 * s, 5 * s, 10 * s, 9 * s, 2 * s); ctx.fill();
      ctx.strokeStyle = shade(color, -40);
      ctx.lineWidth = Math.max(0.6, 0.6 * s);
      ctx.beginPath(); ctx.moveTo(-5 * s, 5 * s); ctx.lineTo(-3 * s, 2 * s); ctx.moveTo(5 * s, 5 * s); ctx.lineTo(3 * s, 2 * s); ctx.stroke();
      break;
    case 'cape':
      ctx.fillStyle = '#f2b631';
      ctx.beginPath(); ctx.arc(0, 3.5 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
      break;
    default: // tee
      ctx.fillStyle = shade(color, 35);
      ctx.beginPath(); ctx.arc(0, 2.6 * s, 3 * s, 0, Math.PI); ctx.fill();
  }
}

function drawHairBack(ctx, s, look) {
  ctx.fillStyle = look.hair ?? '#2b2118';
  switch (look.hairStyle ?? 0) {
    case 1: // long
      ctx.fillRect(-9.6 * s, -6 * s, 3.4 * s, 12 * s);
      ctx.fillRect(6.2 * s, -6 * s, 3.4 * s, 12 * s);
      break;
    case 4: // twin tails
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 11.5 * s, -2 * s, 3.2 * s, 6 * s, side * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 6: // ponytail
      ctx.beginPath();
      ctx.ellipse(8.5 * s, -1 * s, 2.6 * s, 6.5 * s, -0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      break;
  }
}

function drawHairFront(ctx, s, look) {
  ctx.fillStyle = look.hair ?? '#2b2118';
  ctx.beginPath();
  switch (look.hairStyle ?? 0) {
    case 1:
      ctx.arc(0, -6 * s, 9.6 * s, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      break;
    case 2: // bun
      ctx.arc(0, -6 * s, 9.4 * s, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -15 * s, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 3: // spiky
      ctx.moveTo(-9.5 * s, -5 * s);
      for (let i = 0; i <= 6; i++) ctx.lineTo(-9.5 * s + i * 3.2 * s, (i % 2 ? -17 : -11) * s);
      ctx.lineTo(9.5 * s, -5 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 5: // curly
      for (let i = 0; i < 7; i++) {
        const angle = Math.PI * (1 + i / 6);
        ctx.moveTo(Math.cos(angle) * 8 * s + 3.2 * s, -6 * s + Math.sin(angle) * 8 * s);
        ctx.arc(Math.cos(angle) * 8 * s, -6 * s + Math.sin(angle) * 8 * s, 3.2 * s, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    case 4:
    case 6:
      ctx.arc(0, -6 * s, 9.4 * s, Math.PI * 1.0, Math.PI * 2.0);
      ctx.fill();
      ctx.fillStyle = '#ff5c8a';
      ctx.beginPath();
      if ((look.hairStyle ?? 0) === 4) { ctx.arc(-9 * s, -7 * s, 1.4 * s, 0, Math.PI * 2); ctx.arc(9 * s, -7 * s, 1.4 * s, 0, Math.PI * 2); }
      else ctx.arc(7.5 * s, -8 * s, 1.4 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: // short
      ctx.arc(0, -6 * s, 9.4 * s, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();
  }
}

function drawEyes(ctx, s, look, { sleeping, facing }) {
  ctx.strokeStyle = '#2a2320';
  ctx.fillStyle = '#2a2320';
  ctx.lineWidth = Math.max(1, 1.3 * s);
  const ex = 3.4 * s;
  const shift = 0.4 * s * facing;
  const eyes = sleeping ? 'closed' : look.eyes ?? 'dot';
  ctx.beginPath();
  switch (eyes) {
    case 'closed':
    case 'sleepy':
      ctx.moveTo(-ex - 1.8 * s + shift, -4 * s); ctx.lineTo(-ex + 1.6 * s + shift, -4 * s);
      ctx.moveTo(ex - 1.6 * s + shift, -4 * s); ctx.lineTo(ex + 1.8 * s + shift, -4 * s);
      ctx.stroke();
      if (eyes === 'sleepy') {
        ctx.beginPath();
        ctx.arc(-ex + shift, -3.6 * s, 1 * s, 0, Math.PI);
        ctx.arc(ex + shift, -3.6 * s, 1 * s, 0, Math.PI);
        ctx.fill();
      }
      break;
    case 'smile':
      ctx.arc(-ex + shift, -3.4 * s, 1.5 * s, Math.PI * 1.1, Math.PI * 1.9);
      ctx.moveTo(ex + 1.5 * s + shift, -3.4 * s);
      ctx.arc(ex + shift, -3.4 * s, 1.5 * s, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    case 'wink':
      ctx.arc(-ex + shift, -4 * s, 1.3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + shift, -3.4 * s, 1.5 * s, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    case 'sparkle':
      ctx.arc(-ex + shift, -4 * s, 1.6 * s, 0, Math.PI * 2);
      ctx.arc(ex + shift, -4 * s, 1.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-ex + shift + 0.6 * s, -4.6 * s, 0.6 * s, 0, Math.PI * 2);
      ctx.arc(ex + shift + 0.6 * s, -4.6 * s, 0.6 * s, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.arc(-ex + shift, -4 * s, 1.3 * s, 0, Math.PI * 2);
      ctx.arc(ex + shift, -4 * s, 1.3 * s, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawAccessory(ctx, s, accessory) {
  ctx.strokeStyle = '#1d1d24';
  switch (accessory) {
    case 'glasses':
      ctx.lineWidth = Math.max(1, 1.1 * s);
      ctx.beginPath();
      ctx.arc(-3.6 * s, -4 * s, 2.7 * s, 0, Math.PI * 2);
      ctx.moveTo(6.3 * s, -4 * s);
      ctx.arc(3.6 * s, -4 * s, 2.7 * s, 0, Math.PI * 2);
      ctx.moveTo(-0.9 * s, -4 * s); ctx.lineTo(0.9 * s, -4 * s);
      ctx.stroke();
      break;
    case 'sunglasses':
      ctx.fillStyle = '#15151c';
      roundRect(ctx, -7 * s, -6 * s, 6 * s, 4 * s, 1.5 * s); ctx.fill();
      roundRect(ctx, 1 * s, -6 * s, 6 * s, 4 * s, 1.5 * s); ctx.fill();
      ctx.fillRect(-1 * s, -5 * s, 2 * s, 0.9 * s);
      break;
    case 'headphones':
      ctx.lineWidth = Math.max(1.5, 2 * s);
      ctx.beginPath();
      ctx.arc(0, -6 * s, 10.5 * s, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.fillStyle = '#e8505b';
      roundRect(ctx, -12 * s, -7 * s, 4 * s, 6 * s, 1.5 * s); ctx.fill();
      roundRect(ctx, 8 * s, -7 * s, 4 * s, 6 * s, 1.5 * s); ctx.fill();
      break;
    case 'hat':
      ctx.fillStyle = '#3b3b48';
      roundRect(ctx, -7 * s, -19 * s, 14 * s, 7 * s, 2 * s); ctx.fill();
      roundRect(ctx, -11 * s, -13 * s, 22 * s, 2.5 * s, 1 * s); ctx.fill();
      break;
    case 'beret':
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.ellipse(-1 * s, -14 * s, 9.5 * s, 3.6 * s, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-0.6 * s, -19 * s, 1.2 * s, 2.5 * s);
      break;
    case 'party':
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath(); ctx.moveTo(-5 * s, -13 * s); ctx.lineTo(0, -24 * s); ctx.lineTo(5 * s, -13 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(0, -24 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-2.5 * s, -17.5 * s, 5 * s, 1.2 * s);
      break;
    case 'catears':
      ctx.fillStyle = '#3a3036';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * 3 * s, -13.5 * s); ctx.lineTo(side * 7.5 * s, -20 * s); ctx.lineTo(side * 9 * s, -11 * s); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#f7a8c4';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(side * 4.6 * s, -13.6 * s); ctx.lineTo(side * 7.3 * s, -17.6 * s); ctx.lineTo(side * 8 * s, -12.3 * s); ctx.closePath(); ctx.fill();
      }
      break;
    case 'bow':
      ctx.fillStyle = '#ff5c8a';
      ctx.beginPath();
      ctx.moveTo(5 * s, -13 * s); ctx.lineTo(11 * s, -17 * s); ctx.lineTo(11 * s, -9 * s); ctx.closePath();
      ctx.moveTo(5 * s, -13 * s); ctx.lineTo(-1 * s, -17 * s); ctx.lineTo(-1 * s, -9 * s); ctx.closePath();
      ctx.fill();
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5;
        ctx.fillStyle = '#ff9ec7';
        ctx.beginPath(); ctx.arc(7 * s + Math.cos(angle) * 1.9 * s, -12 * s + Math.sin(angle) * 1.9 * s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(7 * s, -12 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 'halo':
      ctx.strokeStyle = '#f7c948';
      ctx.lineWidth = Math.max(1.2, 1.5 * s);
      ctx.beginPath(); ctx.ellipse(0, -19 * s, 6.5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'crown':
      ctx.fillStyle = '#f2b631';
      ctx.beginPath();
      ctx.moveTo(-6 * s, -13 * s); ctx.lineTo(-6 * s, -19 * s); ctx.lineTo(-3 * s, -16 * s); ctx.lineTo(0, -20.5 * s);
      ctx.lineTo(3 * s, -16 * s); ctx.lineTo(6 * s, -19 * s); ctx.lineTo(6 * s, -13 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e0565b';
      ctx.beginPath(); ctx.arc(0, -15.5 * s, 1 * s, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      break;
  }
}

export function drawAvatar(ctx, x, y, size, look, { sleeping = false, mood = 60, facing = 1 } = {}) {
  const s = size / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 14 * s, 9 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  drawHairBack(ctx, s, look);
  drawBody(ctx, s, look);
  ctx.fillStyle = look.skin ?? '#f6d7c3';
  ctx.beginPath();
  ctx.arc(0, -5 * s, 9 * s, 0, Math.PI * 2);
  ctx.fill();
  drawHairFront(ctx, s, look);
  drawEyes(ctx, s, look, { sleeping, facing });
  ctx.strokeStyle = '#2a2320';
  ctx.lineWidth = Math.max(1, 1.3 * s);
  ctx.beginPath();
  if (mood >= 60) ctx.arc(0, -1 * s, 2.6 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood >= 35) { ctx.moveTo(-2 * s, 0.5 * s); ctx.lineTo(2 * s, 0.5 * s); }
  else ctx.arc(0, 2.2 * s, 2.4 * s, 1.15 * Math.PI, 1.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240,110,120,0.35)';
  ctx.beginPath();
  ctx.arc(-6 * s, -1.5 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.arc(6 * s, -1.5 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  drawAccessory(ctx, s, look.accessory);
  ctx.restore();
}

// Pets sit beside their owner, bobbing a little.
export function drawPet(ctx, x, y, size, pet, t = 0) {
  if (!pet || pet === 'none') return;
  const s = size / 16;
  const bob = Math.sin(t / 260) * 0.8 * s;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(0, 6 * s - bob, 5 * s, 1.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  const eye = (ex, ey, r = 0.8) => { ctx.fillStyle = '#1d1a1c'; ctx.beginPath(); ctx.arc(ex * s, ey * s, r * s, 0, Math.PI * 2); ctx.fill(); };
  switch (pet) {
    case 'cat':
      ctx.fillStyle = '#f0a35e';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4 * s, -1 * s); ctx.lineTo(-3 * s, -5 * s); ctx.lineTo(-1 * s, -2 * s); ctx.moveTo(4 * s, -1 * s); ctx.lineTo(3 * s, -5 * s); ctx.lineTo(1 * s, -2 * s); ctx.fill();
      ctx.strokeStyle = '#f0a35e'; ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ctx.moveTo(4.5 * s, 4 * s); ctx.quadraticCurveTo(8 * s, 3 * s, 7 * s, -1 * s); ctx.stroke();
      eye(-1.8, 1); eye(1.8, 1);
      break;
    case 'dog':
      ctx.fillStyle = '#c99a6b';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a5f3c';
      ctx.beginPath(); ctx.ellipse(-4.5 * s, 0, 1.6 * s, 3 * s, 0.3, 0, Math.PI * 2); ctx.ellipse(4.5 * s, 0, 1.6 * s, 3 * s, -0.3, 0, Math.PI * 2); ctx.fill();
      eye(-1.8, 1); eye(1.8, 1);
      ctx.fillStyle = '#1d1a1c'; ctx.beginPath(); ctx.arc(0, 3 * s, 0.9 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 'chick':
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath(); ctx.arc(0, 2 * s, 4.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.moveTo(-1 * s, 2.5 * s); ctx.lineTo(1 * s, 2.5 * s); ctx.lineTo(0, 4 * s); ctx.closePath(); ctx.fill();
      eye(-1.5, 1, 0.7); eye(1.5, 1, 0.7);
      break;
    case 'owl':
      ctx.fillStyle = '#8b6f5a';
      ctx.beginPath(); ctx.ellipse(0, 1.5 * s, 4.5 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-1.8 * s, 0, 1.7 * s, 0, Math.PI * 2); ctx.arc(1.8 * s, 0, 1.7 * s, 0, Math.PI * 2); ctx.fill();
      eye(-1.8, 0, 0.8); eye(1.8, 0, 0.8);
      ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.moveTo(-0.7 * s, 1.6 * s); ctx.lineTo(0.7 * s, 1.6 * s); ctx.lineTo(0, 2.8 * s); ctx.fill();
      break;
    case 'robot':
      ctx.fillStyle = '#9aa7c2';
      roundRect(ctx, -4.5 * s, -2 * s, 9 * s, 8 * s, 2 * s); ctx.fill();
      ctx.fillStyle = '#5eead4';
      ctx.beginPath(); ctx.arc(-1.8 * s, 1.5 * s, 1 * s, 0, Math.PI * 2); ctx.arc(1.8 * s, 1.5 * s, 1 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9aa7c2'; ctx.lineWidth = 0.9 * s;
      ctx.beginPath(); ctx.moveTo(0, -2 * s); ctx.lineTo(0, -4.5 * s); ctx.stroke();
      ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.arc(0, -4.8 * s, 0.9 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 'slime':
      ctx.fillStyle = 'rgba(96, 165, 250, 0.9)';
      ctx.beginPath(); ctx.moveTo(-5 * s, 5 * s); ctx.quadraticCurveTo(-5 * s, -3 * s, 0, -3 * s); ctx.quadraticCurveTo(5 * s, -3 * s, 5 * s, 5 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(-2.4 * s, -0.5 * s, 0.9 * s, 0, Math.PI * 2); ctx.fill();
      eye(-1.5, 1.5, 0.7); eye(1.5, 1.5, 0.7);
      break;
    default:
      break;
  }
  ctx.restore();
}

// Data-URL portrait for lists and headers, cached per look + mood bucket.
export function portrait(look, mood = 60, size = 64) {
  const bucket = mood >= 60 ? 2 : mood >= 35 ? 1 : 0;
  const key = `${JSON.stringify(look)}|${bucket}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  // Tall hats and halos need headroom.
  drawAvatar(ctx, size / 2, size * 0.6, size * 0.82, look, { mood });
  const url = canvas.toDataURL();
  if (cache.size > 400) cache.clear();
  cache.set(key, url);
  return url;
}

// A larger preview with the pet, for the wardrobe.
export function paintPreview(canvas, look, { mood = 70, t = 0 } = {}) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 220;
  const height = canvas.clientHeight || 220;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  drawAvatar(ctx, width / 2 - (look.pet && look.pet !== 'none' ? 18 : 0), height * 0.58, Math.min(width, height) * 0.62, look, { mood });
  drawPet(ctx, width / 2 + Math.min(width, height) * 0.3, height * 0.72, Math.min(width, height) * 0.2, look.pet, t);
}
