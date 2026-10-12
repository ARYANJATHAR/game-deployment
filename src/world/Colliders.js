// 2D static colliders (circles and oriented boxes) in a spatial hash,
// plus smashable props that break when hit.

const CELL = 24;

export class Colliders {
  constructor() {
    this.hash = new Map();
    this.all = [];
  }

  _insert(c, minx, minz, maxx, maxz) {
    for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++) {
      for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
        const k = cx * 73856093 ^ cz * 19349663;
        let l = this.hash.get(k);
        if (!l) this.hash.set(k, (l = []));
        l.push(c);
      }
    }
    this.all.push(c);
  }

  addCircle(x, z, r, y0, y1, opts = {}) {
    const c = { type: 'circle', x, z, r, y0, y1, ...opts, id: this.all.length };
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  /** Oriented box with centre, half extents (hx along angle dir, hz perpendicular). */
  addBox(x, z, hx, hz, angle, y0, y1, opts = {}) {
    const c = {
      type: 'box', x, z, hx, hz, cos: Math.cos(angle), sin: Math.sin(angle), y0, y1, ...opts, id: this.all.length,
    };
    const r = Math.hypot(hx, hz);
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  addSegment(ax, az, bx, bz, thickness, y0, y1, opts = {}) {
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    return this.addBox(cx, cz, len / 2, thickness / 2, Math.atan2(bz - az, bx - ax), y0, y1, opts);
  }

  query(x, z, r, out) {
    out.length = 0;
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const l = this.hash.get(cx * 73856093 ^ cz * 19349663);
        if (!l) continue;
        for (const c of l) {
          if (c._q === stamp || c.dead) continue;
          c._q = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }
}
