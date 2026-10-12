import * as THREE from 'three';
import { ROAD_DEFS } from './WorldConfig.js';
import { clamp, smoothstep } from '../core/utils.js';

const SPACING = 2;
const MAX_GRADE = { highway: 0.07, road: 0.09, street: 0.05, dirt: 0.14, runway: 0.01 }; // metres between centreline samples
const HASH_CELL = 32;

export const ROAD_STYLE = {
  highway: { grip: 1.0, color: '#2b2c30', priority: 5, lanes: 4, surface: 'asphalt' },
  road: { grip: 1.0, color: '#303135', priority: 4, lanes: 2, surface: 'asphalt' },
  street: { grip: 0.97, color: '#35363a', priority: 3, lanes: 2, surface: 'asphalt' },
  runway: { grip: 1.0, color: '#2f3034', priority: 6, lanes: 0, surface: 'asphalt' },
  dirt: { grip: 0.78, color: '#8a6b47', priority: 2, lanes: 0, surface: 'dirt' },
};

/**
 * Road network: spline sampling, heights, junctions, nearest point queries,
 * and A* routing across the road graph.
 */
export class RoadNetwork {
  constructor(naturalHeight) {
    this.naturalHeight = naturalHeight;
    this.roads = [];
    this.junctions = [];
    this.hash = new Map();
    this._build();
  }

  _build() {
    // 1. sample splines
    for (const def of ROAD_DEFS) {
      const pts = def.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
      this.roads.push({ def, ctrl: pts });
    }
    // 2. snap open endpoints onto other roads (temporarily sample first)
    for (const r of this.roads) this._sample(r);
    for (const r of this.roads) {
      if (r.def.closed) continue;
      for (const end of [0, r.ctrl.length - 1]) {
        const p = r.ctrl[end];
        let best = null;
        for (const o of this.roads) {
          if (o === r) continue;
          const q = this._nearestOnRoad(o, p.x, p.z);
          if (q.dist < 40 && (!best || q.dist < best.dist)) best = { ...q, road: o };
        }
        if (best) {
          p.x = best.x;
          p.z = best.z;
          r.snaps = r.snaps || [];
          r.snaps.push({ end, road: best.road });
        }
      }
    }
    for (const r of this.roads) this._sample(r);

    // 3. heights: smoothed natural height along the road
    for (const r of this.roads) this._computeHeights(r);

    // 4. junctions
    this._findJunctions();

    // 5. junction heights become pins; each road is fitted between its pins
    for (const j of this.junctions) {
      const ha = this._heightAt(j.a, j.ia), hb = this._heightAt(j.b, j.ib);
      const pa = j.a.style.priority, pb = j.b.style.priority;
      j.y = (ha * pa + hb * pb) / (pa + pb);
    }
    // relax pins so that pins on the same road respect the grade limit
    for (let it = 0; it < 20; it++) {
      for (const r of this.roads) {
        const g = MAX_GRADE[r.type];
        const pins = this.junctions.filter((j) => j.a === r || j.b === r);
        for (const p of pins) {
          for (const q of pins) {
            if (p === q) continue;
            const ds = this._dist(r, p.a === r ? p.ia : p.ib, q.a === r ? q.ia : q.ib);
            const maxDy = g * ds;
            const dy = q.y - p.y;
            if (Math.abs(dy) > maxDy) {
              const fix = (Math.abs(dy) - maxDy) / 2 * Math.sign(dy);
              p.y += fix;
              q.y -= fix;
            }
          }
        }
      }
    }
    for (const r of this.roads) {
      const pins = this.junctions
        .filter((j) => j.a === r || j.b === r)
        .map((j) => ({ i: j.a === r ? j.ia : j.ib, y: j.y }));
      this._fitBetweenPins(r, pins);
    }
    for (const r of this.roads) this._finalizeGeometry(r);

    // 6. spatial hash
    for (const r of this.roads) this._hashRoad(r);

    // 7. graph
    this._buildGraph();
  }

  _sample(r) {
    const curve = new THREE.CatmullRomCurve3(r.ctrl, !!r.def.closed, 'centripetal', 0.5);
    const len = curve.getLength();
    const n = Math.max(2, Math.round(len / SPACING));
    const pts = curve.getSpacedPoints(r.def.closed ? n : n);
    // getSpacedPoints returns n+1 points; for closed curves last == first
    if (r.def.closed) pts.pop();
    const count = pts.length;
    r.curve = curve;
    r.count = count;
    r.length = r.def.closed ? len : len;
    r.x = new Float32Array(count);
    r.z = new Float32Array(count);
    r.y = new Float32Array(count);
    r.s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      r.x[i] = pts[i].x;
      r.z[i] = pts[i].z;
      if (i > 0) r.s[i] = r.s[i - 1] + Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]);
    }
    r.length = r.def.closed
      ? r.s[count - 1] + Math.hypot(r.x[0] - r.x[count - 1], r.z[0] - r.z[count - 1])
      : r.s[count - 1];
    r.closed = !!r.def.closed;
    r.halfWidth = r.def.halfWidth;
    r.type = r.def.type;
    r.style = ROAD_STYLE[r.def.type];
    r.name = r.def.name;
    r.id = r.def.id;
  }

  _computeHeights(r) {
    const n = r.count;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // sample a few points across the road for a more representative height
      raw[i] = this.naturalHeight(r.x[i], r.z[i]);
    }
    const win = Math.max(1, Math.round(r.def.smooth / SPACING));
    const out = new Float32Array(n);
    // gaussian-ish smoothing via repeated box blur
    let src = raw;
    for (let pass = 0; pass < 3; pass++) {
      const dst = new Float32Array(n);
      const w = Math.max(1, Math.round(win / 2));
      for (let i = 0; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let k = -w; k <= w; k++) {
          let j = i + k;
          if (r.closed) j = (j + n) % n;
          else if (j < 0 || j >= n) continue;
          sum += src[j];
          cnt++;
        }
        dst[i] = sum / cnt;
      }
      src = dst;
    }
    for (let i = 0; i < n; i++) out[i] = Math.max(src[i], r.type === 'runway' ? 6 : 2.6);
    r.y = out;
  }

  _dist(r, i0, i1) {
    const d = Math.abs(r.s[i1] - r.s[i0]);
    return r.closed ? Math.min(d, r.length - d) : d;
  }

  _fitBetweenPins(r, pins) {
    const n = r.count;
    const g = MAX_GRADE[r.type] * 0.92;
    if (pins.length) {
      for (let i = 0; i < n; i++) {
        let lo = -Infinity, hi = Infinity;
        for (const p of pins) {
          const ds = this._dist(r, i, p.i);
          lo = Math.max(lo, p.y - g * ds);
          hi = Math.min(hi, p.y + g * ds);
        }
        if (lo > hi) lo = hi = (lo + hi) / 2;
        r.y[i] = clamp(r.y[i], lo, hi);
      }
    }
    this._limitGrade(r);
    // re-impose exact pin heights with a gentle local correction
    for (let it = 0; it < 3; it++) {
      for (const p of pins) this._applyHeightCorrection(r, p.i, p.y - r.y[p.i], { street: 30, dirt: 50, road: 90, runway: 90, highway: 150 }[r.type]);
    }
  }

  _limitGrade(r) {
    const maxGrade = MAX_GRADE[r.type];
    const n = r.count;
    const step = maxGrade * SPACING;
    for (let it = 0; it < 6; it++) {
      for (let i = 1; i < n + (r.closed ? 1 : 0); i++) {
        const a = r.y[(i - 1) % n];
        const k = i % n;
        r.y[k] = clamp(r.y[k], a - step, a + step);
      }
      for (let i = n - 2 + (r.closed ? 1 : 0); i >= 0; i--) {
        const a = r.y[(i + 1) % n];
        r.y[i] = clamp(r.y[i], a - step, a + step);
      }
    }
    // soften the kinks the clamp produced
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        let sum = 0, cnt = 0;
        for (let k = -6; k <= 6; k++) {
          let j = i + k;
          if (r.closed) j = (j + n) % n;
          else if (j < 0 || j >= n) continue;
          sum += r.y[j];
          cnt++;
        }
        tmp[i] = sum / cnt;
      }
      r.y.set(tmp);
    }
  }

  _heightAt(r, i) {
    return r.y[i];
  }

  _applyHeightCorrection(r, i0, delta, radius) {
    if (Math.abs(delta) < 1e-4) return;
    const n = r.count;
    const w = Math.round(radius / SPACING);
    for (let k = -w; k <= w; k++) {
      let j = i0 + k;
      if (r.closed) j = (j + n) % n;
      else if (j < 0 || j >= n) continue;
      const f = 1 - smoothstep(0, 1, Math.abs(k) / w);
      r.y[j] += delta * f;
    }
  }

  _finalizeGeometry(r) {
    const n = r.count;
    r.tx = new Float32Array(n);
    r.tz = new Float32Array(n);
    r.curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this._idx(r, i - 1), b = this._idx(r, i + 1);
      let dx = r.x[b] - r.x[a], dz = r.z[b] - r.z[a];
      const l = Math.hypot(dx, dz) || 1;
      r.tx[i] = dx / l;
      r.tz[i] = dz / l;
    }
    for (let i = 0; i < n; i++) {
      const a = this._idx(r, i - 3), b = this._idx(r, i + 3);
      const ang = Math.atan2(r.tz[b], r.tx[b]) - Math.atan2(r.tz[a], r.tx[a]);
      let d = ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const ds = SPACING * 6;
      r.curv[i] = d / ds; // signed curvature (1/m)
    }
  }

  _idx(r, i) {
    if (r.closed) return ((i % r.count) + r.count) % r.count;
    return clamp(i, 0, r.count - 1);
  }

  _segCount(r) {
    return r.closed ? r.count : r.count - 1;
  }

  _hashRoad(r) {
    const segs = this._segCount(r);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % r.count;
      const pad = r.halfWidth + 2;
      const minx = Math.min(r.x[i], r.x[j]) - pad, maxx = Math.max(r.x[i], r.x[j]) + pad;
      const minz = Math.min(r.z[i], r.z[j]) - pad, maxz = Math.max(r.z[i], r.z[j]) + pad;
      for (let cx = Math.floor(minx / HASH_CELL); cx <= Math.floor(maxx / HASH_CELL); cx++) {
        for (let cz = Math.floor(minz / HASH_CELL); cz <= Math.floor(maxz / HASH_CELL); cz++) {
          const key = cx * 100003 + cz;
          let list = this.hash.get(key);
          if (!list) this.hash.set(key, (list = []));
          list.push(r, i);
        }
      }
    }
  }

  _nearestOnRoad(r, px, pz, hint = -1) {
    let best = { dist: Infinity };
    const segs = this._segCount(r);
    let i0 = 0, i1 = segs;
    if (hint >= 0) {
      i0 = hint - 40;
      i1 = hint + 40;
    }
    for (let ii = i0; ii < i1; ii++) {
      const i = r.closed ? ((ii % segs) + segs) % segs : ii;
      if (i < 0 || i >= segs) continue;
      const j = (i + 1) % r.count;
      const ax = r.x[i], az = r.z[i], bx = r.x[j], bz = r.z[j];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const cx = ax + dx * t, cz = az + dz * t;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < best.dist) best = { dist: d, i, t, x: cx, z: cz };
    }
    return best;
  }

  _findJunctions() {
    // Segment-segment intersections between different roads (and endpoint snaps).
    const cell = 64;
    const grid = new Map();
    for (const r of this.roads) {
      const segs = this._segCount(r);
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.count;
        const cx = Math.floor((r.x[i] + r.x[j]) * 0.5 / cell);
        const cz = Math.floor((r.z[i] + r.z[j]) * 0.5 / cell);
        const key = cx * 100003 + cz;
        let l = grid.get(key);
        if (!l) grid.set(key, (l = []));
        l.push(r, i);
      }
    }
    const found = [];
    const seen = new Set();
    for (const r of this.roads) {
      const segs = this._segCount(r);
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.count;
        const ax = r.x[i], az = r.z[i], bx = r.x[j], bz = r.z[j];
        const cx = Math.floor((ax + bx) * 0.5 / cell), cz = Math.floor((az + bz) * 0.5 / cell);
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const l = grid.get(gx * 100003 + gz);
            if (!l) continue;
            for (let k = 0; k < l.length; k += 2) {
              const o = l[k];
              if (o === r || this.roads.indexOf(o) < this.roads.indexOf(r)) continue;
              const oi = l[k + 1];
              const oj = (oi + 1) % o.count;
              const hit = segIntersect(ax, az, bx, bz, o.x[oi], o.z[oi], o.x[oj], o.z[oj]);
              if (hit) {
                found.push({ a: r, ia: hit.t < 0.5 ? i : j, b: o, ib: hit.u < 0.5 ? oi : oj, x: hit.x, z: hit.z });
              }
            }
          }
        }
      }
    }
    // endpoint snaps that may not produce an exact crossing
    for (const r of this.roads) {
      if (!r.snaps) continue;
      for (const sn of r.snaps) {
        const ia = sn.end === 0 ? 0 : r.count - 1;
        const q = this._nearestOnRoad(sn.road, r.x[ia], r.z[ia]);
        const ib = q.t < 0.5 ? q.i : (q.i + 1) % sn.road.count;
        found.push({ a: r, ia, b: sn.road, ib, x: q.x, z: q.z });
      }
    }
    // merge duplicates within 20 m
    for (const f of found) {
      let dup = false;
      for (const j of this.junctions) {
        if (Math.hypot(j.x - f.x, j.z - f.z) < 20 &&
          ((j.a === f.a && j.b === f.b) || (j.a === f.b && j.b === f.a))) { dup = true; break; }
      }
      if (!dup) this.junctions.push(f);
    }
    void seen;
  }

  // ---------- graph & routing ----------
  _buildGraph() {
    // Nodes: junction points per road + endpoints.
    this.nodes = [];
    const roadNodes = new Map();
    const addNode = (x, z) => {
      for (const n of this.nodes) if (Math.hypot(n.x - x, n.z - z) < 25) return n;
      const n = { id: this.nodes.length, x, z, edges: [] };
      this.nodes.push(n);
      return n;
    };
    for (const r of this.roads) roadNodes.set(r, []);
    for (const j of this.junctions) {
      const n = addNode(j.x, j.z);
      roadNodes.get(j.a).push({ i: j.ia, node: n });
      roadNodes.get(j.b).push({ i: j.ib, node: n });
    }
    for (const r of this.roads) {
      const list = roadNodes.get(r);
      if (!r.closed) {
        list.push({ i: 0, node: addNode(r.x[0], r.z[0]) });
        list.push({ i: r.count - 1, node: addNode(r.x[r.count - 1], r.z[r.count - 1]) });
      }
      list.sort((a, b) => a.i - b.i);
      // dedupe same node
      const uniq = [];
      for (const e of list) if (!uniq.length || uniq[uniq.length - 1].node !== e.node) uniq.push(e);
      r.graphNodes = uniq;
      const m = uniq.length;
      const linkCount = r.closed ? m : m - 1;
      for (let k = 0; k < linkCount; k++) {
        const A = uniq[k], B = uniq[(k + 1) % m];
        if (A.node === B.node) continue;
        let len = r.s[B.i] - r.s[A.i];
        if (len <= 0) len += r.length;
        A.node.edges.push({ to: B.node, road: r, i0: A.i, i1: B.i, dir: 1, len });
        B.node.edges.push({ to: A.node, road: r, i0: B.i, i1: A.i, dir: -1, len });
      }
    }
  }

  /** Returns array of {x,y,z} polyline points from p0 to p1 following roads. */
  route(x0, z0, x1, z1) {
    const a = this.nearest(x0, z0, 4000);
    const b = this.nearest(x1, z1, 4000);
    if (!a || !b) return null;
    if (a.road === b.road) {
      // also consider direct along the same road
      const direct = this._walk(a.road, a.i, b.i, a.road.closed ? shortestDir(a.road, a.i, b.i) : (b.i >= a.i ? 1 : -1));
      const viaGraph = this._routeGraph(a, b);
      if (!viaGraph || pathLen(direct) <= pathLen(viaGraph) + 1) return direct;
      return viaGraph;
    }
    return this._routeGraph(a, b);
  }

  _routeGraph(a, b) {
    // temporary start/end nodes linked to neighbouring graph nodes on their roads
    const start = { id: -1, x: a.x, z: a.z, edges: [] };
    const goal = { id: -2, x: b.x, z: b.z, edges: [] };
    const link = (tmp, q, isGoal) => {
      const r = q.road;
      const list = r.graphNodes;
      if (!list.length) return;
      // find neighbours before/after along s
      let prev = null, next = null;
      for (const e of list) {
        if (e.i <= q.i) prev = e;
        if (e.i > q.i && !next) next = e;
      }
      if (r.closed) {
        if (!prev) prev = list[list.length - 1];
        if (!next) next = list[0];
      }
      const mk = (e, dir) => {
        let len = dir > 0 ? r.s[e.i] - r.s[q.i] : r.s[q.i] - r.s[e.i];
        if (len < 0) len += r.length;
        if (!isGoal) tmp.edges.push({ to: e.node, road: r, i0: q.i, i1: e.i, dir, len });
        else e.node.edges.push({ to: tmp, road: r, i0: e.i, i1: q.i, dir: -dir, len, temp: true });
      };
      if (next) mk(next, 1);
      if (prev) mk(prev, -1);
    };
    link(start, a, false);
    link(goal, b, true);
    // A*
    const open = [start];
    const g = new Map([[start, 0]]);
    const came = new Map();
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
    const closed = new Set();
    let found = false;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (g.get(open[k]) + h(open[k]) < g.get(open[bi]) + h(open[bi])) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      closed.add(cur);
      for (const e of cur.edges) {
        if (closed.has(e.to)) continue;
        const ng = g.get(cur) + e.len;
        if (!g.has(e.to) || ng < g.get(e.to)) {
          g.set(e.to, ng);
          came.set(e.to, { from: cur, edge: e });
          if (!open.includes(e.to)) open.push(e.to);
        }
      }
    }
    // cleanup temp edges
    for (const n of this.nodes) n.edges = n.edges.filter((e) => !e.temp);
    if (!found) return null;
    const edges = [];
    let cur = goal;
    while (came.has(cur)) {
      const c = came.get(cur);
      edges.unshift(c.edge);
      cur = c.from;
    }
    const out = [];
    for (const e of edges) {
      const seg = this._walk(e.road, e.i0, e.i1, e.dir);
      if (out.length) seg.shift();
      out.push(...seg);
    }
    return out;
  }

  _walk(r, i0, i1, dir) {
    const out = [];
    let i = i0;
    let guard = 0;
    while (guard++ < r.count + 2) {
      out.push({ x: r.x[i], y: r.y[i], z: r.z[i], road: r, i });
      if (i === i1) break;
      i += dir;
      if (r.closed) i = (i + r.count) % r.count;
      else if (i < 0 || i >= r.count) break;
    }
    return out;
  }

  /** Builds a polyline following a road from index i0 for a given length and direction. */
  walkDistance(r, i0, length, dir = 1) {
    const steps = Math.round(length / SPACING);
    const out = [];
    let i = i0;
    for (let k = 0; k <= steps; k++) {
      out.push({ x: r.x[i], y: r.y[i], z: r.z[i], road: r, i });
      i += dir;
      if (r.closed) i = (i + r.count) % r.count;
      else if (i < 0 || i >= r.count) break;
    }
    return out;
  }

  // ---------- queries ----------
  /** Nearest road point. Returns null when none within maxDist. */
  nearest(px, pz, maxDist = 30) {
    if (maxDist > 200) {
      let best = null;
      for (const r of this.roads) {
        const q = this._nearestOnRoad(r, px, pz);
        if (q.dist < maxDist && (!best || q.dist < best.dist)) best = { ...q, road: r };
      }
      if (best) this._fill(best);
      return best;
    }
    const cr = Math.ceil(maxDist / HASH_CELL);
    const cx0 = Math.floor(px / HASH_CELL), cz0 = Math.floor(pz / HASH_CELL);
    let best = null;
    let bestD = maxDist;
    for (let cx = cx0 - cr; cx <= cx0 + cr; cx++) {
      for (let cz = cz0 - cr; cz <= cz0 + cr; cz++) {
        const list = this.hash.get(cx * 100003 + cz);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const r = list[k], i = list[k + 1];
          const j = (i + 1) % r.count;
          const ax = r.x[i], az = r.z[i];
          const dx = r.x[j] - ax, dz = r.z[j] - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cxp = ax + dx * t, czp = az + dz * t;
          const d = Math.hypot(px - cxp, pz - czp);
          // prefer higher priority roads where overlapping
          const score = d - r.style.priority * 0.01;
          if (score < bestD) {
            bestD = score;
            best = { road: r, i, t, x: cxp, z: czp, dist: d };
          }
        }
      }
    }
    if (best) this._fill(best);
    return best;
  }

  _fill(q) {
    const r = q.road;
    const j = (q.i + 1) % r.count;
    q.y = r.y[q.i] + (r.y[j] - r.y[q.i]) * q.t;
    q.s = r.s[q.i] + (j === 0 ? r.length - r.s[q.i] : r.s[j] - r.s[q.i]) * q.t;
    q.tx = r.tx[q.i];
    q.tz = r.tz[q.i];
    return q;
  }

  /** Road surface under a point, or null when off-road. */
  surfaceAt(px, pz) {
    const cx0 = Math.floor(px / HASH_CELL), cz0 = Math.floor(pz / HASH_CELL);
    const list = this.hash.get(cx0 * 100003 + cz0);
    if (!list) return null;
    let best = null;
    let bestPri = -1;
    for (let k = 0; k < list.length; k += 2) {
      const r = list[k], i = list[k + 1];
      const j = (i + 1) % r.count;
      const ax = r.x[i], az = r.z[i];
      const dx = r.x[j] - ax, dz = r.z[j] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - px, ez = az + dz * t - pz;
      const d2 = ex * ex + ez * ez;
      const hw = r.halfWidth + 0.4;
      if (d2 < hw * hw) {
        const pri = r.style.priority * 1000 - d2;
        if (pri > bestPri) {
          bestPri = pri;
          const y = r.y[i] + (r.y[j] - r.y[i]) * t;
          best = { road: r, y, i, t };
        }
      }
    }
    return best;
  }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: ax + rx * t, z: az + rz * t };
}

function shortestDir(r, i0, i1) {
  const fwd = (i1 - i0 + r.count) % r.count;
  return fwd <= r.count / 2 ? 1 : -1;
}

function pathLen(p) {
  if (!p) return Infinity;
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return l;
}

export { SPACING as ROAD_SPACING };
