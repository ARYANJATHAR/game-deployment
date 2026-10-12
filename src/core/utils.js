// Shared math helpers, seeded RNG and 2D simplex noise.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const sign = (v) => (v < 0 ? -1 : 1);
export const TAU = Math.PI * 2;
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};

// Mulberry32 seeded random generator.
export function rng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

// Simplex noise 2D (Stefan Gustavson, public domain), seeded permutation.
export class Simplex2 {
  constructor(seed = 1) {
    const r = rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise(xin, yin) {
    const grad3 = GRAD3;
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const perm = this.perm;
    const permMod12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj]] * 3;
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  ridged(x, y, octaves = 5) {
    let amp = 0.5, freq = 1, sum = 0, prev = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      prev = n;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum;
  }
}

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export function formatTime(t) {
  if (!isFinite(t) || t < 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

// Distance from point to segment in 2D, returns {d2, t}.
export function pointSegDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return { d2: cx * cx + cz * cz, t };
}
