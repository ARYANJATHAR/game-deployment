// Skill chain system: drifts, air, speed, near misses, wreckage, drafting.
// Skills chain together with a growing multiplier and bank after a pause.

const BANK_DELAY = 3.2;

export class Skills {
  constructor() {
    this.chain = 0;
    this.mult = 1;
    this.count = 0;
    this.timer = 0;
    this.active = {}; // continuous skills being built (drift/air/speed/draft)
    this.listeners = { skill: [], bank: [], broken: [] };
    this.lastNear = new Map();
    this.enabled = true;
  }

  on(evt, fn) {
    this.listeners[evt].push(fn);
  }

  _emit(evt, data) {
    for (const f of this.listeners[evt]) f(data);
  }

  add(name, points, label = name) {
    if (!this.enabled) return;
    this.chain += points;
    this.count++;
    if (this.count % 3 === 0 && this.mult < 10) this.mult++;
    this.timer = BANK_DELAY;
    this._emit('skill', { name, label, points: Math.round(points), mult: this.mult, chain: this.chain });
  }

  breakChain(reason = 'Crash') {
    if (this.chain > 0) this._emit('broken', { reason, lost: Math.round(this.chain * this.mult) });
    this.chain = 0;
    this.mult = 1;
    this.count = 0;
    this.active = {};
  }

  _bank() {
    const total = Math.round(this.chain * this.mult);
    if (total > 0) this._emit('bank', { total, mult: this.mult, chain: Math.round(this.chain) });
    this.chain = 0;
    this.mult = 1;
    this.count = 0;
  }

  /** Continuous skill helper: accumulates while condition holds, awards on release. */
  _cont(key, on, rate, dt, finish) {
    const a = this.active[key];
    if (on) {
      if (!a) this.active[key] = { pts: 0, t: 0 };
      const s = this.active[key];
      s.pts += rate * dt;
      s.t += dt;
      this.timer = BANK_DELAY;
    } else if (a) {
      delete this.active[key];
      finish(a);
    }
  }

  update(dt, v, others = [], ctx = {}) {
    if (!this.enabled || !v) return;
    const speed = v.speed;
    // drift
    const drift = Math.abs(v.driftAngle);
    const drifting = v.grounded && speed > 8 && drift > 0.26 && drift < 1.6;
    this._cont('drift', drifting, speed * drift * 28, dt, (a) => {
      if (a.t > 0.45) {
        const lbl = a.pts > 3000 ? 'GREAT DRIFT' : a.pts > 8000 ? 'EPIC DRIFT' : 'DRIFT';
        this.add('drift', a.pts, a.pts > 8000 ? 'EPIC DRIFT' : lbl);
        ctx.onDrift && ctx.onDrift(a.pts);
      }
    });
    // air
    const air = !v.grounded && v.airTime > 0.15;
    this._cont('air', air, 520, dt, (a) => {
      if (a.t > 0.6) {
        const lbl = a.t > 2.2 ? 'EPIC AIR' : a.t > 1.3 ? 'GREAT AIR' : 'AIR';
        this.add('air', a.pts * (a.t > 2.2 ? 2 : a.t > 1.3 ? 1.4 : 1), lbl);
        ctx.onAir && ctx.onAir(a.t);
      }
    });
    // speed
    const fast = speed * 3.6 > 220 && v.grounded;
    this._cont('speed', fast, speed * 6, dt, (a) => {
      if (a.t > 1) this.add('speed', a.pts, 'SPEED');
    });
    // drafting
    this._cont('draft', v.slipstream > 0.3 && speed > 25, 220, dt, (a) => {
      if (a.t > 1.5) this.add('draft', a.pts, 'DRAFTING');
    });
    // near misses
    for (const o of others) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const d2 = dx * dx + dz * dz;
      const rel = v.vel.clone().sub(o.vel).length();
      const key = o.uid;
      if (d2 < 3.3 * 3.3 && rel > 9 && speed > 15) {
        if (!this.lastNear.has(key)) this.lastNear.set(key, { t: 0, hit: false });
      }
      const st = this.lastNear.get(key);
      if (st) {
        st.t += dt;
        if (st.t > 1.2 || d2 > 12 * 12) {
          if (!st.hit) this.add('near', 350 + rel * 12, 'NEAR MISS');
          this.lastNear.delete(key);
        }
      }
    }
    // bank when chain idles
    const building = Object.keys(this.active).length > 0;
    if (!building && this.chain > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this._bank();
    }
  }

  notifyCollision(other) {
    if (other && this.lastNear.has(other.uid)) this.lastNear.get(other.uid).hit = true;
  }

  /** Points currently pending in active continuous skills (for display). */
  pending() {
    let p = 0;
    for (const k in this.active) p += this.active[k].pts;
    return p;
  }

  activeName() {
    if (this.active.drift) return 'DRIFT';
    if (this.active.air) return 'AIR';
    if (this.active.speed) return 'SPEED';
    if (this.active.draft) return 'DRAFTING';
    return null;
  }
}
