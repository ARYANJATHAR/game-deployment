import * as THREE from 'three';
import { buildCar } from '../vehicle/CarBuilder.js';
import { CARS } from '../config/cars.js';

const KEY = 'horizon-rush-ghost-';
const RATE = 0.2; // seconds between samples

/** Records the player's run and replays the best one as a translucent rival. */
export class GhostRecorder {
  constructor() {
    this.samples = [];
    this.t = 0;
  }

  record(time, v) {
    if (time - this.t < RATE && this.samples.length) return;
    this.t = time;
    const p = v.root.position, q = v.root.quaternion;
    this.samples.push(+time.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2),
      +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3));
  }

  save(eventId, carId, paint, time) {
    try {
      localStorage.setItem(KEY + eventId, JSON.stringify({ car: carId, paint, time, s: this.samples }));
    } catch (e) {
      /* storage full: ghosts are optional */
    }
  }
}

export function loadGhost(eventId) {
  try {
    const raw = localStorage.getItem(KEY + eventId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export class GhostPlayer {
  constructor(scene, data) {
    this.scene = scene;
    this.data = data;
    const def = CARS.find((c) => c.id === data.car) || CARS[0];
    this.model = buildCar(def, { paint: data.paint || '#19d3ff' });
    this.model.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = mats.map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.35;
        c.depthWrite = false;
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    if (this.model.blob) this.model.blob.visible = false;
    scene.add(this.model.root);
    this.i = 0;
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion();
  }

  update(time) {
    const s = this.data.s;
    const n = s.length / 8;
    if (n < 2) return;
    while (this.i < n - 2 && s[(this.i + 1) * 8] <= time) this.i++;
    while (this.i > 0 && s[this.i * 8] > time) this.i--;
    const a = this.i * 8, b = Math.min(n - 1, this.i + 1) * 8;
    const span = Math.max(1e-3, s[b] - s[a]);
    const f = Math.min(1, Math.max(0, (time - s[a]) / span));
    const root = this.model.root;
    root.position.set(s[a + 1] + (s[b + 1] - s[a + 1]) * f, s[a + 2] + (s[b + 2] - s[a + 2]) * f, s[a + 3] + (s[b + 3] - s[a + 3]) * f);
    this._q0.set(s[a + 4], s[a + 5], s[a + 6], s[a + 7]);
    this._q1.set(s[b + 4], s[b + 5], s[b + 6], s[b + 7]);
    root.quaternion.slerpQuaternions(this._q0, this._q1, f);
    root.visible = time <= s[(n - 1) * 8] + 2;
  }

  dispose() {
    this.scene.remove(this.model.root);
  }
}
