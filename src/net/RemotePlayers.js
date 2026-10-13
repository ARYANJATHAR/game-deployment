import * as THREE from 'three';
import { buildCar } from '../vehicle/CarBuilder.js';
import { CARS, effectivePhys } from '../config/cars.js';

const DELAY = 120; // ms of interpolation delay behind the newest snapshot
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _fwd = new THREE.Vector3();

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '800 54px "Saira Condensed", "Arial Narrow", Arial, sans-serif';
  const w = Math.min(500, ctx.measureText(name).width + 50);
  ctx.fillStyle = 'rgba(10,12,22,0.7)';
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 10, w, 76, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect((512 - w) / 2, 10, 10, 76);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 256 + 5, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(4.4, 0.83, 1);
  s.renderOrder = 21;
  return s;
}

/**
 * Other players' cars: interpolated from server snapshots, drawn with the
 * normal car models plus a name tag, and exposed as kinematic obstacles.
 */
export class RemotePlayers {
  constructor(scene, net, audio) {
    this.scene = scene;
    this.net = net;
    this.audio = audio;
    this.players = new Map(); // id -> remote
  }

  /** Room roster changed: add/remove/rebuild cars as needed. */
  syncRoster(list) {
    const ids = new Set();
    for (const info of list) {
      if (info.id === this.net.id) continue;
      ids.add(info.id);
      const r = this.players.get(info.id);
      if (r && (r.car !== info.car || r.paint !== info.paint || r.name !== info.name)) this._remove(info.id);
      if (!this.players.has(info.id)) this._add(info);
    }
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this._remove(id);
  }

  _add(info) {
    const def = CARS.find((c) => c.id === info.car) || CARS[0];
    const model = buildCar(def, { paint: info.paint });
    const label = nameSprite(info.name, info.paint || '#ff2d87');
    label.position.y = def.dims.height + 1.1;
    model.root.add(label);
    model.root.visible = false;
    this.scene.add(model.root);
    // a minimal vehicle-like object for engine audio and race standings
    const pos = new THREE.Vector3();
    const proxy = {
      uid: `net${info.id}`, remote: true, name: info.name, def, p: effectivePhys(def, {}),
      pos, vel: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0),
      speed: 0, rpm: def.phys.idle, gear: 1, controls: { throttle: 0, brake: 0 }, shiftTimer: 0, limiter: false,
      slipstream: 0, root: model.root,
    };
    const r = { id: info.id, name: info.name, car: info.car, paint: info.paint, def, model, label, buf: [], proxy, spin: 0 };
    if (this.audio && this.audio.enabled) r.engine = this.audio.createEngine(proxy, false);
    this.players.set(info.id, r);
  }

  _remove(id) {
    const r = this.players.get(id);
    if (!r) return;
    this.scene.remove(r.model.root);
    if (r.engine) this.audio.destroyEngine(r.engine);
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this._remove(id);
  }

  onSnapshot(snap) {
    for (const s of snap.players) {
      if (s.id === this.net.id) continue;
      const r = this.players.get(s.id);
      if (!r) continue;
      r.buf.push({ t: snap.now, ...s });
      if (r.buf.length > 30) r.buf.shift();
    }
  }

  update(dt, camPos) {
    const now = this.net.serverNow() - DELAY;
    for (const r of this.players.values()) {
      const b = r.buf;
      if (!b.length) continue;
      // find the two samples around `now`
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > now) i--;
      const s1 = b[i], s0 = b[Math.max(0, i - 1)];
      let f = s1.t === s0.t ? 1 : (now - s0.t) / (s1.t - s0.t);
      const root = r.model.root;
      if (f > 1) {
        // extrapolate briefly using velocity when packets are late
        const ex = Math.min(0.25, (now - s1.t) / 1000);
        root.position.set(s1.p[0] + s1.v[0] * ex, s1.p[1] + s1.v[1] * ex, s1.p[2] + s1.v[2] * ex);
        f = 1;
      } else {
        f = Math.max(0, f);
        root.position.set(
          s0.p[0] + (s1.p[0] - s0.p[0]) * f, s0.p[1] + (s1.p[1] - s0.p[1]) * f, s0.p[2] + (s1.p[2] - s0.p[2]) * f,
        );
      }
      _q0.fromArray(s0.q);
      _q1.fromArray(s1.q);
      root.quaternion.slerpQuaternions(_q0, _q1, f);
      root.visible = true;
      // proxy state for audio, collisions, standings
      const px = r.proxy;
      px.pos.copy(root.position);
      px.pos.y += r.def.phys.comY;
      px.vel.fromArray(s1.v);
      px.speed = px.vel.length();
      px.forward.set(0, 0, -1).applyQuaternion(root.quaternion);
      px.right.set(1, 0, 0).applyQuaternion(root.quaternion);
      px.rpm = s1.rpm || px.p.idle;
      px.gear = s1.g || 1;
      px.controls.throttle = s1.th || 0;
      px.controls.brake = s1.b ? 1 : 0;
      // wheels: spin with speed, steer
      _fwd.copy(px.forward);
      const signed = px.vel.dot(_fwd) >= 0 ? 1 : -1;
      r.spin += (px.speed * signed / r.def.dims.wheelR) * dt;
      for (const w of r.model.wheels) {
        w.spin.rotation.x = -r.spin;
        w.pivot.rotation.y = w.front ? -(s1.st || 0) : 0;
      }
      const m = r.model.materials;
      if (m) {
        m.tailMat.emissiveIntensity = s1.b ? 4 : s1.l ? 1.4 : 0.5;
        m.headMat.emissiveIntensity = s1.l ? 6 : 0.6;
      }
      r.label.visible = camPos.distanceTo(root.position) < 350;
      if (r.engine) r.engine.update(dt, camPos);
    }
  }

  /** Kinematic boxes for the local physics world. */
  obstacles() {
    const out = [];
    for (const r of this.players.values()) {
      if (!r.model.root.visible) continue;
      const px = r.proxy;
      const f = px.forward;
      const l = Math.hypot(f.x, f.z) || 1;
      const fx = f.x / l, fz = f.z / l;
      out.push({
        cx: r.model.root.position.x, cz: r.model.root.position.z, fx, fz, rx: -fz, rz: fx,
        hl: r.def.dims.length / 2, hw: r.def.dims.width / 2,
        y0: r.model.root.position.y + r.def.dims.ride, y1: r.model.root.position.y + r.def.dims.height,
        vel: px.vel, remote: r,
      });
    }
    return out;
  }
}
