// Procedural chibi avatars drawn on canvas from a character's appearance.
const cache = new Map();

export function drawAvatar(ctx, x, y, size, look, { sleeping = false, mood = 60, facing = 1 } = {}) {
  const s = size / 32;
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 14 * s, 9 * s, 3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = look.shirt ?? '#4f7cff';
  roundRect(ctx, -8 * s, 2 * s, 16 * s, 12 * s, 5 * s);
  ctx.fill();
  // head
  ctx.fillStyle = look.skin ?? '#f6d7c3';
  ctx.beginPath();
  ctx.arc(0, -5 * s, 9 * s, 0, Math.PI * 2);
  ctx.fill();
  // hair
  ctx.fillStyle = look.hair ?? '#2b2118';
  ctx.beginPath();
  switch (look.hairStyle ?? 0) {
    case 1: // long
      ctx.arc(0, -6 * s, 9.6 * s, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      ctx.fillRect(-9.6 * s, -6 * s, 3.4 * s, 11 * s);
      ctx.fillRect(6.2 * s, -6 * s, 3.4 * s, 11 * s);
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
    default: // short
      ctx.arc(0, -6 * s, 9.4 * s, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();
  }
  // face
  ctx.strokeStyle = '#2a2320';
  ctx.fillStyle = '#2a2320';
  ctx.lineWidth = Math.max(1, 1.3 * s);
  const ex = 3.4 * s * facing;
  if (sleeping) {
    ctx.beginPath();
    ctx.moveTo(-ex - 2 * s, -4 * s); ctx.lineTo(-ex + 1.5 * s, -4 * s);
    ctx.moveTo(ex - 1.5 * s, -4 * s); ctx.lineTo(ex + 2 * s, -4 * s);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(-3.4 * s, -4 * s, 1.3 * s, 0, Math.PI * 2);
    ctx.arc(3.4 * s, -4 * s, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  if (mood >= 60) ctx.arc(0, -1 * s, 2.6 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood >= 35) { ctx.moveTo(-2 * s, 0.5 * s); ctx.lineTo(2 * s, 0.5 * s); }
  else ctx.arc(0, 2.2 * s, 2.4 * s, 1.15 * Math.PI, 1.85 * Math.PI);
  ctx.stroke();
  // cheeks
  ctx.fillStyle = 'rgba(240,110,120,0.35)';
  ctx.beginPath();
  ctx.arc(-6 * s, -1.5 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.arc(6 * s, -1.5 * s, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  // accessory
  ctx.strokeStyle = '#1d1d24';
  switch (look.accessory) {
    case 'glasses':
      ctx.lineWidth = Math.max(1, 1.1 * s);
      ctx.beginPath();
      ctx.arc(-3.6 * s, -4 * s, 2.7 * s, 0, Math.PI * 2);
      ctx.moveTo(6.3 * s, -4 * s);
      ctx.arc(3.6 * s, -4 * s, 2.7 * s, 0, Math.PI * 2);
      ctx.moveTo(-0.9 * s, -4 * s); ctx.lineTo(0.9 * s, -4 * s);
      ctx.stroke();
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
    case 'bow':
      ctx.fillStyle = '#ff5c8a';
      ctx.beginPath();
      ctx.moveTo(5 * s, -13 * s); ctx.lineTo(11 * s, -17 * s); ctx.lineTo(11 * s, -9 * s); ctx.closePath();
      ctx.moveTo(5 * s, -13 * s); ctx.lineTo(-1 * s, -17 * s); ctx.lineTo(-1 * s, -9 * s); ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
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
  drawAvatar(ctx, size / 2, size * 0.56, size * 0.95, look, { mood });
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
