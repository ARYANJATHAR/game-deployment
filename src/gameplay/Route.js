import { clamp } from '../core/utils.js';

/**
 * Polyline route over the road network with a racing line and a target
 * speed profile. Points: {x, y, z, hw (road half width)}.
 */
export class Route {
  constructor(points, closed = false) {
    // resample to ~2 m and drop duplicates
    const pts = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.5) continue;
      pts.push({ x: p.x, y: p.y, z: p.z, hw: p.road ? p.road.halfWidth : (p.hw || 5), grip: p.road ? p.road.style.grip : (p.grip || 1) });
    }
    if (closed && pts.length > 2) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 3) pts.pop();
    }
    // round off sharp junction corners
    for (let it = 0; it < 6; it++) {
      const n0 = pts.length;
      const sm = pts.map((p) => ({ ...p }));
      for (let i = 0; i < n0; i++) {
        if (!closed && (i < 3 || i >= n0 - 3)) continue;
        let sx = 0, sz = 0;
        for (let k = -3; k <= 3; k++) {
          const q = pts[(i + k + n0) % n0];
          sx += q.x; sz += q.z;
        }
        sm[i].x = sx / 7;
        sm[i].z = sz / 7;
      }
      for (let i = 0; i < n0; i++) { pts[i].x = sm[i].x; pts[i].z = sm[i].z; }
    }
    this.closed = closed;
    this.n = pts.length;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    this.hw = new Float32Array(this.n);
    this.grip = new Float32Array(this.n);
    this.s = new Float32Array(this.n);
    pts.forEach((p, i) => {
      this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z; this.hw[i] = p.hw; this.grip[i] = p.grip;
      if (i) this.s[i] = this.s[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    });
    this.length = this.s[this.n - 1] + (closed ? Math.hypot(this.x[0] - this.x[this.n - 1], this.z[0] - this.z[this.n - 1]) : 0);
    this._tangents();
    this.buildRacingLine();
    // vertical curvature (positive on crests)
    this.vcurv = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const K = 6;
      const a = this.idx(i - K), b = this.idx(i + K);
      const ds = Math.max(4, Math.abs(this.s[b] - this.s[a]) / 2) || 12;
      this.vcurv[i] = -(this.y[b] - 2 * this.y[i] + this.y[a]) / (ds * ds);
    }
    for (let it = 0; it < 2; it++) {
      const t = Float32Array.from(this.vcurv);
      for (let i = 0; i < this.n; i++) this.vcurv[i] = Math.max(t[this.idx(i - 3)], t[i], t[this.idx(i + 3)]);
    }
  }

  idx(i) {
    if (this.closed) return ((i % this.n) + this.n) % this.n;
    return clamp(i, 0, this.n - 1);
  }

  _tangents() {
    const n = this.n;
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 1), b = this.idx(i + 1);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
  }

  /** Elastic-band racing line constrained to the road width. */
  buildRacingLine() {
    const n = this.n;
    const lx = Float32Array.from(this.x);
    const lz = Float32Array.from(this.z);
    const off = new Float32Array(n);
    const K = 6;
    for (let it = 0; it < 70; it++) {
      for (let i = 0; i < n; i++) {
        if (!this.closed && (i < K || i >= n - K)) continue;
        const a = this.idx(i - K), b = this.idx(i + K);
        const mx = (lx[a] + lx[b]) / 2, mz = (lz[a] + lz[b]) / 2;
        let px = lx[i] + (mx - lx[i]) * 0.5;
        let pz = lz[i] + (mz - lz[i]) * 0.5;
        // project onto road normal and clamp lateral offset
        const rx = -this.tz[i], rz = this.tx[i];
        let o = (px - this.x[i]) * rx + (pz - this.z[i]) * rz;
        const lim = Math.max(0, this.hw[i] - 1.3);
        o = clamp(o, -lim, lim);
        off[i] = o;
        lx[i] = this.x[i] + rx * o;
        lz[i] = this.z[i] + rz * o;
      }
    }
    this.lx = lx;
    this.lz = lz;
    this.loff = off;
    // curvature of racing line
    const curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 4), b = this.idx(i + 4);
      const ax = lx[i] - lx[a], az = lz[i] - lz[a];
      const bx = lx[b] - lx[i], bz = lz[b] - lz[i];
      const cross = ax * bz - az * bx;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(lx[b] - lx[a], lz[b] - lz[a]);
      curv[i] = la * lb * lc > 1e-6 ? (2 * cross) / (la * lb * lc) : 0;
    }
    // smooth curvature
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += Math.abs(curv[this.idx(i + k)]);
      sm[i] = s / 7;
    }
    this.curv = sm;
  }

  /** Target speeds (m/s) for a lateral grip budget in g. */
  speedProfile(gripG, brakeG = 1.0, vmax = 120, offroad = 0) {
    const n = this.n;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.curv[i];
      const sg = this.grip[i] < 1 ? this.grip[i] + (0.95 - this.grip[i]) * offroad * 0.8 : 1;
      let vc = k > 1e-5 ? Math.sqrt((gripG * sg * 0.95 * 9.81) / k) : vmax;
      // keep extra margin in very fast sweepers where a slide is hard to catch
      if (vc > 50) vc = 50 + (vc - 50) * 0.8;
      v[i] = Math.min(vmax, vc);
      // crests: stay below lift-off speed
      const kv = this.vcurv[i];
      if (kv > 1e-4) v[i] = Math.min(v[i], Math.sqrt((9.81 * 0.75) / kv));
    }
    // backward pass for braking
    const passes = this.closed ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = this.closed ? (i + 1) % n : i + 1;
        if (j >= n) continue;
        const ds = Math.abs(this.s[j] - this.s[i]) || 2;
        const sg = this.grip[i] < 1 ? 0.8 : 1;
        const lim = Math.sqrt(v[j] * v[j] + 2 * brakeG * sg * 9.81 * ds);
        if (v[i] > lim) v[i] = lim;
      }
    }
    return v;
  }

  /** Nearest index search around a hint (or global when hint < 0). */
  project(px, pz, hint = -1, range = 60) {
    let best = -1, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < this.n; i++) {
        const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let k = -range; k <= range; k++) {
        const i = this.closed ? this.idx(hint + k) : hint + k;
        if (i < 0 || i >= this.n) continue;
        const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    // refine with segment projection
    const i = best;
    const j = this.closed ? this.idx(i + 1) : Math.min(this.n - 1, i + 1);
    const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - this.x[i]) * dx + (pz - this.z[i]) * dz) / l2 : 0;
    t = clamp(t, 0, 1);
    const segLen = Math.sqrt(l2);
    const s = this.s[i] + t * segLen;
    const lat = (px - this.x[i]) * -this.tz[i] + (pz - this.z[i]) * this.tx[i];
    return { i, s, lat, dist: Math.sqrt(bd) };
  }

  indexAtS(s) {
    if (this.closed) s = ((s % this.length) + this.length) % this.length;
    else s = clamp(s, 0, this.s[this.n - 1]);
    // binary search
    let lo = 0, hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  pointAtS(s, out = {}) {
    const i = this.indexAtS(s);
    out.i = i;
    out.x = this.x[i]; out.y = this.y[i]; out.z = this.z[i];
    out.tx = this.tx[i]; out.tz = this.tz[i];
    out.lx = this.lx[i]; out.lz = this.lz[i];
    out.hw = this.hw[i];
    return out;
  }

  heading(i) {
    return Math.atan2(-this.tx[i], -this.tz[i]);
  }
}
