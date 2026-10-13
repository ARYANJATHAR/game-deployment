import * as THREE from 'three';

const _tmp = [];
const _gs = {};
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Fixed-step simulation of all vehicles plus collision handling. */
export class PhysicsWorld {
  constructor(hf, colliders) {
    this.hf = hf;
    this.colliders = colliders;
    this.vehicles = [];
    this.weatherGrip = 1;
    this.onSmash = null;
    this.onCollision = null;
    this.kinematic = []; // remote players: boxes moving with a known velocity
  }

  groundSample(x, z, out) {
    return this.hf.sample(x, z, out);
  }

  add(v) {
    this.vehicles.push(v);
    v.world = this;
  }

  remove(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  step(dt) {
    for (const v of this.vehicles) v.step(dt);
    for (const v of this.vehicles) if (!v.frozen) this._static(v);
    const n = this.vehicles.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.vehicles[i], b = this.vehicles[j];
        if (a.ghost || b.ghost) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz > 49) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
        this._carCar(a, b);
      }
    }
    // remote players (network cars) push local cars but are not pushed back
    if (this.kinematic.length) {
      for (const v of this.vehicles) {
        if (v.frozen || v.ghost) continue;
        for (const k of this.kinematic) {
          const dx = v.pos.x - k.cx, dz = v.pos.z - k.cz;
          if (dx * dx + dz * dz > 49) continue;
          this._kinematicHit(v, k);
        }
      }
    }
    // water drag
    for (const v of this.vehicles) {
      if (v.pos.y < 0.4 && this.hf.sample(v.pos.x, v.pos.z, _gs).y < -0.2) {
        const depth = 0.4 - v.pos.y;
        v.vel.multiplyScalar(1 - Math.min(0.9, depth * 0.08));
        v.vel.y += Math.min(depth, 1.2) * 9.81 * 0.016 * 0.9;
        v.inWater = true;
      } else v.inWater = false;
    }
  }

  _obb(v) {
    const f = _tmpVec(0).set(v.forward.x, 0, v.forward.z);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    const r = _tmpVec(1).set(-f.z, 0, f.x);
    // geometric centre (model origin is at ground, wheelbase middle)
    const comW = _tmpVec(2).copy(v.com).applyQuaternion(v.quat);
    const cx = v.pos.x - comW.x, cz = v.pos.z - comW.z;
    return {
      cx, cz, fx: f.x, fz: f.z, rx: r.x, rz: r.z,
      hl: v.def.dims.length / 2, hw: v.def.dims.width / 2,
      y0: v.pos.y - v.p.comY + v.def.dims.ride, y1: v.pos.y - v.p.comY + v.def.dims.height,
    };
  }

  _static(v) {
    const o = this._obb(v);
    const list = this.colliders.query(o.cx, o.cz, o.hl + 2, _tmp);
    for (const c of list) {
      if (c.y1 < o.y0 + 0.15 || c.y0 > o.y1) continue;
      let hit = null;
      if (c.type === 'circle') hit = circleVsObb(c, o);
      else hit = obbVsObb(o, toObb(c));
      if (!hit) continue;
      if (c.smash) {
        if (v.speed > 2.5) {
          this.onSmash && this.onSmash(c.prop, v, c);
          const loss = c.smash.mass / (v.mass + c.smash.mass);
          v.vel.multiplyScalar(1 - loss * 0.6);
          continue;
        }
      }
      // push out and apply impulse
      _n.set(hit.nx, 0, hit.nz);
      v.pos.x -= _n.x * hit.depth;
      v.pos.z -= _n.z * hit.depth;
      _r.set(hit.px - v.pos.x, 0, hit.pz - v.pos.z);
      const pv = v.angVel.clone().cross(_r).add(v.vel);
      const vn = pv.dot(_n);
      if (vn > 0) {
        const k = v.invMassAlong(_r, _n);
        const e = c.rail ? 0.05 : 0.25;
        const j = ((1 + e) * vn) / k;
        v._applyImpulse(_r, _n.clone().multiplyScalar(-j));
        const vt = pv.clone().addScaledVector(_n, -vn);
        vt.y = 0;
        const vtl = vt.length();
        if (vtl > 0.01) {
          const td = vt.multiplyScalar(1 / vtl);
          const mu = c.rail ? 0.12 : 0.4;
          const kt = v.invMassAlong(_r, td);
          const jt = Math.min(vtl / kt, mu * j);
          v._applyImpulse(_r, td.multiplyScalar(-jt));
        }
        if (vn > 2) {
          v._impact(vn, new THREE.Vector3(hit.px, v.pos.y, hit.pz));
          this.onCollision && this.onCollision(v, null, vn, hit, c);
        }
      }
    }
  }

  _kinematicHit(v, k) {
    const o = this._obb(v);
    if (k.y1 < o.y0 || k.y0 > o.y1) return;
    const hit = obbVsObb(o, k);
    if (!hit) return;
    _n.set(hit.nx, 0, hit.nz); // from local car toward the remote car
    v.pos.x -= _n.x * hit.depth;
    v.pos.z -= _n.z * hit.depth;
    const ra = new THREE.Vector3(hit.px - v.pos.x, 0, hit.pz - v.pos.z);
    const rel = v.angVel.clone().cross(ra).add(v.vel).sub(k.vel);
    const vn = rel.dot(_n);
    if (vn <= 0) return;
    // the remote car is treated as an equal mass we cannot move
    const kk = v.invMassAlong(ra, _n) + 1 / v.mass;
    const j = ((1 + 0.2) * vn) / kk;
    v._applyImpulse(ra, _n.clone().multiplyScalar(-j));
    if (vn > 1.5) {
      v._impact(vn, new THREE.Vector3(hit.px, v.pos.y, hit.pz));
      this.onCollision && this.onCollision(v, k.remote.proxy, vn, hit);
    }
  }

  _carCar(a, b) {
    const oa = this._obb(a);
    const ob = this._obb(b);
    const hit = obbVsObb(oa, ob);
    if (!hit) return;
    _n.set(hit.nx, 0, hit.nz); // from a to b
    const total = a.mass + b.mass;
    const fa = b.mass / total, fb = a.mass / total;
    a.pos.x -= _n.x * hit.depth * fa; a.pos.z -= _n.z * hit.depth * fa;
    b.pos.x += _n.x * hit.depth * fb; b.pos.z += _n.z * hit.depth * fb;
    const ra = new THREE.Vector3(hit.px - a.pos.x, 0, hit.pz - a.pos.z);
    const rb = new THREE.Vector3(hit.px - b.pos.x, 0, hit.pz - b.pos.z);
    const va = a.angVel.clone().cross(ra).add(a.vel);
    const vb = b.angVel.clone().cross(rb).add(b.vel);
    const rel = va.sub(vb);
    const vn = rel.dot(_n);
    if (vn <= 0) return;
    const k = a.invMassAlong(ra, _n) + b.invMassAlong(rb, _n);
    const j = ((1 + 0.2) * vn) / k;
    a._applyImpulse(ra, _n.clone().multiplyScalar(-j));
    b._applyImpulse(rb, _n.clone().multiplyScalar(j));
    // friction
    const vt = rel.clone().addScaledVector(_n, -vn);
    vt.y = 0;
    const vtl = vt.length();
    if (vtl > 0.05) {
      const td = vt.multiplyScalar(1 / vtl);
      const kt = a.invMassAlong(ra, td) + b.invMassAlong(rb, td);
      const jt = Math.min(vtl / kt, 0.3 * j);
      a._applyImpulse(ra, td.clone().multiplyScalar(-jt));
      b._applyImpulse(rb, td.clone().multiplyScalar(jt));
    }
    if (vn > 1.5) {
      a._impact(vn, new THREE.Vector3(hit.px, a.pos.y, hit.pz));
      b._impact(vn, new THREE.Vector3(hit.px, b.pos.y, hit.pz));
      this.onCollision && this.onCollision(a, b, vn, hit);
    }
  }
}

const _vecs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function _tmpVec(i) {
  return _vecs[i];
}

function toObb(c) {
  // collider boxes: hx along (cos, sin) direction, hz perpendicular
  return { cx: c.x, cz: c.z, fx: -c.sin, fz: c.cos, rx: c.cos, rz: c.sin, hl: c.hz, hw: c.hx };
}

function circleVsObb(c, o) {
  const dx = c.x - o.cx, dz = c.z - o.cz;
  const lx = dx * o.rx + dz * o.rz;
  const lz = dx * o.fx + dz * o.fz;
  const qx = Math.max(-o.hw, Math.min(o.hw, lx));
  const qz = Math.max(-o.hl, Math.min(o.hl, lz));
  let ex = lx - qx, ez = lz - qz;
  let d = Math.hypot(ex, ez);
  let depth, nlx, nlz;
  if (d < 1e-6) {
    // centre inside box: push along the smallest axis
    const px = o.hw - Math.abs(lx), pz = o.hl - Math.abs(lz);
    if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; depth = px + c.r; } else { nlx = 0; nlz = Math.sign(lz) || 1; depth = pz + c.r; }
  } else {
    if (d >= c.r) return null;
    nlx = ex / d; nlz = ez / d;
    depth = c.r - d;
  }
  // normal from car toward obstacle in world
  const nx = nlx * o.rx + nlz * o.fx;
  const nz = nlx * o.rz + nlz * o.fz;
  const px = o.cx + qx * o.rx + qz * o.fx;
  const pz = o.cz + qx * o.rz + qz * o.fz;
  return { nx, nz, depth, px, pz };
}

function corners(o) {
  const out = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push([o.cx + o.rx * o.hw * sx + o.fx * o.hl * sz, o.cz + o.rz * o.hw * sx + o.fz * o.hl * sz]);
  }
  return out;
}

function obbVsObb(a, b) {
  const axes = [[a.rx, a.rz], [a.fx, a.fz], [b.rx, b.rz], [b.fx, b.fz]];
  const ca = corners(a), cb = corners(b);
  let best = Infinity, bn = null;
  for (const [ax, az] of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    const o = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (o <= 0) return null;
    if (o < best) { best = o; bn = [ax, az]; }
  }
  // orient normal from a to b
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  if (dx * bn[0] + dz * bn[1] < 0) bn = [-bn[0], -bn[1]];
  // contact point: average of corners inside the other box
  const inside = (o, x, z) => {
    const lx = (x - o.cx) * o.rx + (z - o.cz) * o.rz;
    const lz = (x - o.cx) * o.fx + (z - o.cz) * o.fz;
    return Math.abs(lx) <= o.hw + 0.05 && Math.abs(lz) <= o.hl + 0.05;
  };
  let px = 0, pz = 0, cnt = 0;
  for (const [x, z] of ca) if (inside(b, x, z)) { px += x; pz += z; cnt++; }
  for (const [x, z] of cb) if (inside(a, x, z)) { px += x; pz += z; cnt++; }
  if (cnt) { px /= cnt; pz /= cnt; } else { px = (a.cx + b.cx) / 2; pz = (a.cz + b.cz) / 2; }
  return { nx: bn[0], nz: bn[1], depth: best, px, pz };
}
