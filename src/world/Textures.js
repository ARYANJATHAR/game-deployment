import * as THREE from 'three';
import { rng } from '../core/utils.js';

// All textures are generated procedurally on canvases (no external assets).

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx, w, h, base, amp, seed, size = 1) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      const v = (r() - 0.5) * amp;
      for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
          const i = ((y + yy) * w + x + xx) * 4;
          d[i] = Math.max(0, Math.min(255, base[0] + v));
          d[i + 1] = Math.max(0, Math.min(255, base[1] + v));
          d[i + 2] = Math.max(0, Math.min(255, base[2] + v));
          d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function makeTerrainDetail() {
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  noiseFill(ctx, S, S, [228, 228, 228], 46, 11);
  const r = rng(5);
  // soft blotches
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 8 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
    g.addColorStop(0, v);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      ctx.restore();
    }
  }
  // grass blades / speckles
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    ctx.stroke();
  }
  return toTexture(c, { srgb: true });
}

/** Road surface texture. u spans the full width incl. shoulders, v covers `period` metres. */
export function makeRoadTexture(type, halfWidth) {
  const W = 512, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const totalW = (halfWidth + 1.5) * 2;
  const mx = (m) => ((m + totalW / 2) / totalW) * W; // metres from centre -> px
  const period = 16; // metres represented vertically
  const my = (m) => (m / period) * H;
  const r = rng(type.length * 31 + halfWidth * 7);

  if (type === 'dirt') {
    noiseFill(ctx, W, H, [132, 104, 72], 40, 3, 2);
    // ruts
    for (const off of [-1.9, -0.8, 0.8, 1.9]) {
      ctx.fillStyle = 'rgba(70,50,30,0.35)';
      ctx.fillRect(mx(off) - 10, 0, 20, H);
    }
    // pebbles
    for (let i = 0; i < 2500; i++) {
      const v = r();
      ctx.fillStyle = `rgba(${Math.round(150 + v * 60)},${Math.round(128 + v * 50)},${Math.round(98 + v * 40)},0.8)`;
      ctx.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3);
    }
    // grass edges
    const eg = ctx.createLinearGradient(0, 0, mx(-halfWidth + 0.5), 0);
    eg.addColorStop(0, 'rgba(70,95,45,1)');
    eg.addColorStop(1, 'rgba(70,95,45,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, mx(-halfWidth + 0.5), H);
    const eg2 = ctx.createLinearGradient(W, 0, mx(halfWidth - 0.5), 0);
    eg2.addColorStop(0, 'rgba(70,95,45,1)');
    eg2.addColorStop(1, 'rgba(70,95,45,0)');
    ctx.fillStyle = eg2;
    ctx.fillRect(mx(halfWidth - 0.5), 0, W - mx(halfWidth - 0.5), H);
    return toTexture(c);
  }

  // asphalt base
  noiseFill(ctx, W, H, [64, 65, 69], 22, 7, 1);
  // aggregate speckles
  for (let i = 0; i < 14000; i++) {
    const v = 40 + r() * 90;
    ctx.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    ctx.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // tyre wear darkening in lanes
  const lanes = type === 'highway' ? [-5.4, -1.9, 1.9, 5.4] : type === 'runway' ? [] : [-2.6, 2.6];
  for (const l of lanes) {
    for (const o of [-0.85, 0.85]) {
      const g = ctx.createLinearGradient(mx(l + o - 0.5), 0, mx(l + o + 0.5), 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(10,10,12,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx(l + o - 0.5), 0, mx(l + o + 0.5) - mx(l + o - 0.5), H);
    }
  }
  // cracks / patches
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = 'rgba(20,20,22,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let x = r() * W, y = r() * H;
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 30;
      y += r() * 25;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // shoulders (gravel)
  const sh = (from, to) => {
    ctx.fillStyle = '#5d5a52';
    ctx.fillRect(Math.min(from, to), 0, Math.abs(to - from), H);
    for (let i = 0; i < 1800; i++) {
      const v = 70 + r() * 80;
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.9)`;
      ctx.fillRect(Math.min(from, to) + r() * Math.abs(to - from), r() * H, 2, 2);
    }
  };
  sh(0, mx(-halfWidth));
  sh(mx(halfWidth), W);

  const white = 'rgba(235,235,230,0.92)';
  const yellow = 'rgba(240,190,40,0.92)';
  const line = (m, w, color, dash = 0, gap = 0, off = 0) => {
    ctx.fillStyle = color;
    const x0 = mx(m - w / 2), x1 = mx(m + w / 2);
    if (!dash) {
      ctx.fillRect(x0, 0, x1 - x0, H);
      return;
    }
    for (let y = off; y < period; y += dash + gap) ctx.fillRect(x0, my(y), x1 - x0, my(dash));
  };

  if (type === 'highway') {
    line(-halfWidth + 0.35, 0.18, white);
    line(halfWidth - 0.35, 0.18, white);
    line(-0.15, 0.12, yellow);
    line(0.15, 0.12, yellow);
    line(-3.6, 0.13, white, 4, 4);
    line(3.6, 0.13, white, 4, 4);
  } else if (type === 'road') {
    line(-halfWidth + 0.3, 0.15, white);
    line(halfWidth - 0.3, 0.15, white);
    line(0, 0.14, white, 5, 3);
  } else if (type === 'street') {
    line(-halfWidth + 0.25, 0.12, white);
    line(halfWidth - 0.25, 0.12, white);
    line(-0.12, 0.1, yellow);
    line(0.12, 0.1, yellow);
  } else if (type === 'runway') {
    line(0, 0.5, white, 8, 8);
    line(-halfWidth + 1, 0.4, white);
    line(halfWidth - 1, 0.4, white);
  }
  return toTexture(c);
}

export function makeRoughnessForRoad() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  noiseFill(ctx, S, S, [215, 215, 215], 50, 21, 2);
  return toTexture(c, { srgb: false });
}

export function makeWaterNormal() {
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  // sum of sines tileable height -> normal
  const h = new Float32Array(S * S);
  const r = rng(77);
  const waves = [];
  for (let i = 0; i < 14; i++) {
    waves.push({ kx: r.int(-6, 6), ky: r.int(-6, 6), a: 0.4 + r() * 0.6, p: r() * 6.28 });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.p);
      h[y * S + x] = v;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      let nx = -dx * 0.6, ny = -dy * 0.6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

/** Building facade texture with lit/unlit windows; emissive variant for night. */
export function makeFacade(seed, style = 0) {
  const W = 256, H = 512;
  const c = canvas(W, H);
  const e = canvas(W, H);
  const ctx = c.getContext('2d');
  const ectx = e.getContext('2d');
  const r = rng(seed);
  const palettes = [
    ['#d9cdb8', '#c8b79c', '#e8e0d0'],
    ['#9aa6b2', '#7f8c99', '#b5c0cb'],
    ['#c98e6b', '#b5765a', '#dba584'],
    ['#e6e2da', '#f2efe8', '#d1ccc1'],
  ];
  const pal = palettes[style % palettes.length];
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, W, H);
  noiseFill(ctx, W, H, hexToRgb(pal[0]), 14, seed, 2);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const cols = 4, rows = 8;
  const cw = W / cols, rh = H / rows;
  for (let y = 0; y < rows; y++) {
    // floor band
    ctx.fillStyle = pal[1];
    ctx.fillRect(0, y * rh, W, 4);
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.18, wy = y * rh + rh * 0.22;
      const ww = cw * 0.64, wh = rh * 0.58;
      const lit = r() < 0.35;
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, '#3d5468');
      g.addColorStop(1, '#1b2632');
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(wx, wy, ww * 0.35, wh);
      ctx.strokeStyle = pal[2];
      ctx.lineWidth = 3;
      ctx.strokeRect(wx, wy, ww, wh);
      if (lit) {
        const warm = r() < 0.7;
        ectx.fillStyle = warm ? `rgb(255,${190 + r() * 40},${110 + r() * 40})` : 'rgb(200,220,255)';
        ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
  }
  return { map: toTexture(c), emissive: toTexture(e) };
}

export function makeHouseTexture(seed) {
  return makeFacade(seed, 3);
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function makeBannerTexture(text, bg = '#ff2d87', fg = '#ffffff', w = 1024, h = 128) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -40));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.floor(h * 0.6)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  return toTexture(c, { repeat: false });
}

export function makeChevronTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(10, 100);
  ctx.lineTo(64, 40);
  ctx.lineTo(118, 100);
  ctx.lineTo(96, 100);
  ctx.lineTo(64, 66);
  ctx.lineTo(32, 100);
  ctx.closePath();
  ctx.fill();
  return toTexture(c, { repeat: false, srgb: false });
}

export function makeSignTexture(kind) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  if (kind === 'chevron') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d61f1f';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const x = 30 + i * 70;
      ctx.moveTo(x, 40);
      ctx.lineTo(x + 50, 128);
      ctx.lineTo(x, 216);
      ctx.lineTo(x + 25, 216);
      ctx.lineTo(x + 75, 128);
      ctx.lineTo(x + 25, 40);
      ctx.fill();
    }
  } else if (kind === 'xp') {
    const g = ctx.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, '#ff9f1a');
    g.addColorStop(1, '#ff5e00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.fillStyle = '#fff';
    ctx.font = '900 110px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('XP', 128, 128);
  } else if (kind === 'danger') {
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.moveTo(128, 10);
    ctx.lineTo(250, 240);
    ctx.lineTo(6, 240);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = '900 150px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('!', 128, 220);
  }
  return toTexture(c, { repeat: false });
}

export function makeTireTexture() {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1b1d';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#121214';
  for (let x = 0; x < 256; x += 8) {
    ctx.fillRect(x, 8, 4, 48);
  }
  return toTexture(c);
}

export function makeSmokeTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false, srgb: false });
}

export function makeGlowTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false, srgb: false });
}

export function makeSkidTexture() {
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  const r = rng(9);
  ctx.clearRect(0, 0, 64, 256);
  for (let x = 0; x < 64; x++) {
    const edge = Math.min(x, 63 - x) / 10;
    const a = Math.min(1, edge) * (0.6 + r() * 0.4);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  return toTexture(c, { srgb: false });
}

export function makeCarbonTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  for (let y = 0; y < 64; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      const odd = ((x + y) / 8) % 2;
      const g = ctx.createLinearGradient(x, y, x + 8, y + 8);
      g.addColorStop(0, odd ? '#2a2a2e' : '#151517');
      g.addColorStop(1, odd ? '#151517' : '#2a2a2e');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 8, 8);
    }
  }
  return toTexture(c);
}

export function makePlateTexture(text) {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#1a1a2a';
  ctx.font = '700 40px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  return toTexture(c, { repeat: false });
}

function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
