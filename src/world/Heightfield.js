import { Simplex2, smoothstep, lerp, clamp } from '../core/utils.js';
import { WORLD, POI } from './WorldConfig.js';
import { RoadNetwork } from './RoadNetwork.js';

export const SURF = { GRASS: 0, SAND: 1, ROCK: 2, SNOW: 3, DIRT: 4, FIELD: 5, ASPHALT: 6, CONCRETE: 7 };

export const SURFACE_PROPS = {
  [SURF.GRASS]: { grip: 0.72, drag: 0.012, dust: [0.42, 0.5, 0.3], name: 'grass', bump: 0.05 },
  [SURF.SAND]: { grip: 0.62, drag: 0.03, dust: [0.85, 0.78, 0.6], name: 'sand', bump: 0.04 },
  [SURF.ROCK]: { grip: 0.8, drag: 0.01, dust: [0.55, 0.53, 0.5], name: 'rock', bump: 0.08 },
  [SURF.SNOW]: { grip: 0.5, drag: 0.02, dust: [0.95, 0.96, 1.0], name: 'snow', bump: 0.03 },
  [SURF.DIRT]: { grip: 0.78, drag: 0.008, dust: [0.62, 0.5, 0.36], name: 'dirt', bump: 0.04 },
  [SURF.FIELD]: { grip: 0.68, drag: 0.02, dust: [0.7, 0.62, 0.4], name: 'field', bump: 0.05 },
  [SURF.ASPHALT]: { grip: 1.0, drag: 0.0, dust: [0.5, 0.5, 0.5], name: 'asphalt', bump: 0 },
  [SURF.CONCRETE]: { grip: 0.95, drag: 0.0, dust: [0.6, 0.6, 0.6], name: 'concrete', bump: 0 },
};

/**
 * Terrain height grid with road flattening baked in. Provides exact
 * triangle-interpolated height queries matching the rendered mesh.
 */
export class Heightfield {
  constructor() {
    this.noise = new Simplex2(WORLD.seed);
    this.noise2 = new Simplex2(WORLD.seed + 7);
    this.N = WORLD.size / WORLD.cell; // cells per side
    this.V = this.N + 1; // vertices per side
    this.cell = WORLD.cell;
    this.half = WORLD.half;
    this.heights = new Float32Array(this.V * this.V);
    this.natural = new Float32Array(this.V * this.V);
    this.surface = new Uint8Array(this.V * this.V);
    this.roadDist = new Float32Array(this.V * this.V);
    this.ramps = [];
  }

  build() {
    const V = this.V;
    for (let j = 0; j < V; j++) {
      const z = j * this.cell - this.half;
      for (let i = 0; i < V; i++) {
        const x = i * this.cell - this.half;
        this.natural[j * V + i] = this.naturalHeight(x, z);
      }
    }
    this.roads = new RoadNetwork((x, z) => this.naturalHeight(x, z));
    this._stampRoads();
    this._classify();
  }

  islandMask(x, z) {
    // superellipse distance to coast with noisy shoreline
    const nx = x / 1880, nz = z / 1880;
    const d = Math.pow(Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(nz), 4), 0.25);
    const wobble = this.noise.fbm(x / 600, z / 600, 3) * 0.06;
    return smoothstep(1.02, 0.9, d + wobble);
  }

  naturalHeight(x, z) {
    const n = this.noise;
    let h = 16 + n.fbm(x / 1100, z / 1100, 4) * 26;
    h += n.fbm(x / 260 + 10, z / 260 - 5, 3) * 7;
    // mountains (north-west)
    const md = Math.hypot(x - POI.mountain.x, z - POI.mountain.z);
    const m = smoothstep(POI.mountain.r, 200, md);
    if (m > 0) {
      const ridge = n.ridged(x / 750 + 3, z / 750 + 9, 5);
      h += m * (ridge * 330 + 40);
    }
    // forest hills (north-east)
    const fd = Math.hypot(x - POI.forest.x, z - POI.forest.z);
    const f = smoothstep(POI.forest.r + 250, 100, fd);
    if (f > 0) h += f * (n.fbm(x / 300, z / 300, 3) * 18 + 20);
    // golden fields: gentle
    const gd = Math.hypot(x - POI.fields.x, z - POI.fields.z);
    const g = smoothstep(POI.fields.r, 150, gd);
    h = lerp(h, 14 + n.fbm(x / 700, z / 700, 2) * 6, g * 0.8);
    // town flatten
    const td = Math.hypot(x - POI.town.x, z - POI.town.z);
    h = lerp(h, 9, smoothstep(POI.town.r + 120, POI.town.r - 40, td));
    // festival flatten
    const fsd = Math.hypot(x - POI.festival.x, z - POI.festival.z);
    h = lerp(h, 20, smoothstep(POI.festival.r + 90, POI.festival.r - 30, fsd));
    // airstrip flatten
    {
      const a = POI.airstrip;
      const dx = Math.max(a.x0 - 80 - x, 0, x - a.x1 - 80);
      const dz = Math.abs(z - a.z) - 60;
      const d = Math.hypot(dx, Math.max(dz, 0));
      h = lerp(h, 10, smoothstep(160, 10, d));
    }
    // lake
    const ld = Math.hypot(x - POI.lake.x, (z - POI.lake.z) * 1.3);
    h = lerp(h, -9, smoothstep(POI.lake.r + 60, POI.lake.r - 120, ld + n.noise(x / 120, z / 120) * 25));
    // coast
    const isl = this.islandMask(x, z);
    const beach = 1.6 + n.noise(x / 200, z / 200) * 1.2;
    h = lerp(-28, Math.max(h, beach), isl);
    // shore shelf so beaches are wide
    return h;
  }

  _stampRoads() {
    const V = this.V, cell = this.cell, half = this.half;
    const best = new Float32Array(V * V).fill(1e9); // edge distance
    const roadH = new Float32Array(V * V);
    const roadType = new Uint8Array(V * V);
    const shoulderW = { highway: 26, road: 20, street: 10, dirt: 14, runway: 30 };
    for (const r of this.roads.roads) {
      const segs = r.closed ? r.count : r.count - 1;
      const reach = r.halfWidth + shoulderW[r.type];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.count;
        const ax = r.x[i], az = r.z[i], bx = r.x[j], bz = r.z[j];
        const ay = r.y[i], by = r.y[j];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + half) / cell));
        const i1 = Math.min(V - 1, Math.ceil((Math.max(ax, bx) + reach + half) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach + half) / cell));
        const j1 = Math.min(V - 1, Math.ceil((Math.max(az, bz) + reach + half) / cell));
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        for (let gj = j0; gj <= j1; gj++) {
          const pz = gj * cell - half;
          for (let gi = i0; gi <= i1; gi++) {
            const px = gi * cell - half;
            let t = ((px - ax) * dx + (pz - az) * dz) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - px, ez = az + dz * t - pz;
            const d = Math.sqrt(ex * ex + ez * ez);
            const e = d - r.halfWidth;
            if (e > shoulderW[r.type]) continue;
            const idx = gj * V + gi;
            // normalised edge distance so wider shoulders blend correctly
            const score = e - r.style.priority * 0.05;
            if (score < best[idx]) {
              best[idx] = score;
              roadH[idx] = ay + (by - ay) * t;
              roadType[idx] = (['highway', 'road', 'street', 'dirt', 'runway'].indexOf(r.type)) + 1;
            }
          }
        }
      }
    }
    const types = ['highway', 'road', 'street', 'dirt', 'runway'];
    for (let idx = 0; idx < V * V; idx++) {
      const nat = this.natural[idx];
      this.roadDist[idx] = best[idx];
      if (best[idx] > 1e8) {
        this.heights[idx] = nat;
        continue;
      }
      const e = best[idx];
      const type = types[roadType[idx] - 1];
      const hr = roadH[idx] - 0.18;
      const t = smoothstep(1.2, 1.2 + shoulderW[type], e);
      this.heights[idx] = lerp(hr, nat, t);
    }
  }

  _classify() {
    const V = this.V, cell = this.cell, half = this.half;
    const n2 = this.noise2;
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const idx = j * V + i;
        const x = i * cell - half, z = j * cell - half;
        const h = this.heights[idx];
        const slope = this.slopeAt(i, j);
        let s = SURF.GRASS;
        const nn = n2.noise(x / 90, z / 90);
        if (h < 3.2 + nn * 1.2) s = SURF.SAND;
        else if (h > 190 + nn * 25) s = SURF.SNOW;
        else if (slope > 0.75 || (h > 120 + nn * 30 && slope > 0.4)) s = SURF.ROCK;
        else {
          const fd = Math.hypot(x - POI.fields.x, z - POI.fields.z);
          if (fd < POI.fields.r - 60 && n2.noise(x / 160, z / 160) > -0.35) s = SURF.FIELD;
        }
        const rd = this.roadDist[idx];
        if (rd < 4 && rd > -50) {
          const near = this.roads.nearest(x, z, 20);
          if (near && near.road.type === 'dirt') s = SURF.DIRT;
          else if (rd < 1.5) s = SURF.DIRT;
        }
        const fsd = Math.hypot(x - POI.festival.x, z - POI.festival.z);
        if (fsd < POI.festival.r - 60) s = SURF.CONCRETE;
        this.surface[idx] = s;
      }
    }
  }

  slopeAt(i, j) {
    const V = this.V;
    const i0 = Math.max(0, i - 1), i1 = Math.min(V - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(V - 1, j + 1);
    const dx = (this.heights[j * V + i1] - this.heights[j * V + i0]) / ((i1 - i0) * this.cell);
    const dz = (this.heights[j1 * V + i] - this.heights[j0 * V + i]) / ((j1 - j0) * this.cell);
    return Math.hypot(dx, dz);
  }

  /** Terrain height (mesh-exact). */
  terrainHeight(x, z) {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    if (gx < 0 || gz < 0 || gx >= this.N || gz >= this.N) return -30;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const V = this.V;
    const h00 = this.heights[j * V + i];
    const h10 = this.heights[j * V + i + 1];
    const h01 = this.heights[(j + 1) * V + i];
    const h11 = this.heights[(j + 1) * V + i + 1];
    if (fx + fz < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /**
   * Ground sample used by physics. Writes into out: {y, nx, ny, nz, surface, grip, drag, road}.
   */
  sample(x, z, out) {
    const road = this.roads.surfaceAt(x, z);
    let y = this.terrainHeight(x, z);
    let surface;
    if (road) {
      y = road.y;
      surface = road.road.type === 'dirt' ? SURF.DIRT : SURF.ASPHALT;
      out.road = road.road;
      out.nx = 0; out.ny = 1; out.nz = 0;
      // road normal from its slope along tangent
      const r = road.road;
      const j = (road.i + 1) % r.count;
      const ds = Math.hypot(r.x[j] - r.x[road.i], r.z[j] - r.z[road.i]) || 1;
      const g = (r.y[j] - r.y[road.i]) / ds;
      out.nx = -r.tx[road.i] * g;
      out.nz = -r.tz[road.i] * g;
      out.ny = 1;
      const l = Math.hypot(out.nx, out.ny, out.nz);
      out.nx /= l; out.ny /= l; out.nz /= l;
    } else {
      out.road = null;
      const gx = clamp(Math.round((x + this.half) / this.cell), 0, this.N);
      const gz = clamp(Math.round((z + this.half) / this.cell), 0, this.N);
      surface = this.surface[gz * this.V + gx];
      // triangle normal
      const e = 0.6;
      const hx = this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z);
      const hz = this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e);
      let nx = -hx, ny = 2 * e, nz = -hz;
      const l = Math.hypot(nx, ny, nz);
      out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
    }
    // ramps (jump kickers)
    for (let k = 0; k < this.ramps.length; k++) {
      const rp = this.ramps[k];
      const dx = x - rp.x, dz = z - rp.z;
      if (dx * dx + dz * dz > rp.r2) continue;
      const lx = dx * rp.cos + dz * rp.sin; // along ramp
      const lz = -dx * rp.sin + dz * rp.cos;
      if (Math.abs(lz) > rp.w || lx < 0 || lx > rp.len) continue;
      const ry = rp.y + (lx / rp.len) * rp.h;
      if (ry > y) {
        y = ry;
        surface = SURF.CONCRETE;
        const slope = rp.h / rp.len;
        const l = Math.hypot(slope, 1);
        out.nx = -rp.cos * slope / l;
        out.nz = -rp.sin * slope / l;
        out.ny = 1 / l;
        out.road = null;
      }
    }
    out.y = y;
    out.surface = surface;
    const p = SURFACE_PROPS[surface];
    out.grip = road ? road.road.style.grip : p.grip;
    out.drag = road ? (road.road.type === 'dirt' ? 0.006 : 0) : p.drag;
    out.bump = road ? (road.road.type === 'dirt' ? 0.02 : 0) : p.bump;
    return out;
  }

  heightAt(x, z) {
    const road = this.roads.surfaceAt(x, z);
    if (road) return road.y;
    return this.terrainHeight(x, z);
  }

  addRamp(x, z, angle, len, h, w) {
    // ramp rises along direction angle (cos,sin in xz)
    const y = this.heightAt(x, z);
    this.ramps.push({ x, z, y, cos: Math.cos(angle), sin: Math.sin(angle), len, h, w: w / 2, r2: (len + w) * (len + w) });
  }
}
