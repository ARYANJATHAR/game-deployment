import * as THREE from 'three';
import { makeBannerTexture } from '../world/Textures.js';
import { clamp } from '../core/utils.js';

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let gateMats = null;
function getGateMats() {
  if (gateMats) return gateMats;
  gateMats = {
    pillar: new THREE.MeshStandardMaterial({ color: '#ff2d87', emissive: '#ff2d87', emissiveIntensity: 0.6, roughness: 0.4 }),
    pillarNext: new THREE.MeshStandardMaterial({ color: '#19d3ff', emissive: '#19d3ff', emissiveIntensity: 0.6, roughness: 0.4 }),
    cp: new THREE.MeshBasicMaterial({ map: makeBannerTexture('CHECKPOINT', '#ff2d87'), side: THREE.DoubleSide }),
    finish: new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide }),
    start: new THREE.MeshBasicMaterial({ map: makeBannerTexture('HORIZON RUSH', '#19a7ff'), side: THREE.DoubleSide }),
    curtain: new THREE.MeshBasicMaterial({ color: '#ff2d87', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
  };
  return gateMats;
}

function makeGate(route, s, kind) {
  const M = getGateMats();
  const p = route.pointAtS(s);
  const hw = p.hw + 1.8;
  const g = new THREE.Group();
  const h = 8;
  const pillarGeo = new THREE.BoxGeometry(0.8, h, 0.8);
  const l = new THREE.Mesh(pillarGeo, M.pillar);
  const r = new THREE.Mesh(pillarGeo, M.pillar);
  l.position.set(-hw, h / 2, 0);
  r.position.set(hw, h / 2, 0);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 0.8, 1.6), kind === 'finish' ? M.finish : kind === 'start' ? M.start : M.cp);
  banner.position.y = h - 0.4;
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, h - 1.2), M.curtain);
  curtain.position.y = (h - 1.2) / 2;
  g.add(l, r, banner, curtain);
  g.position.set(p.x, p.y, p.z);
  g.rotation.y = Math.atan2(p.tx, p.tz);
  g.userData = { l, r, curtain };
  return g;
}

/** Stunt jet for showcase events. */
function makeJet() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f2f4f7', metalness: 0.4, roughness: 0.3 });
  const pink = new THREE.MeshStandardMaterial({ color: '#ff2d87', metalness: 0.3, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2633', metalness: 0.6, roughness: 0.1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 12, 14).rotateX(Math.PI / 2), white);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 14).rotateX(-Math.PI / 2), pink);
  nose.position.z = -7.5;
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 8).scale(1, 0.7, 2.2), glass);
  canopy.position.set(0, 0.7, -3.2);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 3.2), pink);
  wing.position.set(0, -0.1, 0.8);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 1.6), pink);
  tail.position.set(0, 0.1, 5.2);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 1.8), white);
  fin.position.set(0, 1.3, 5.2);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb36b' });
  const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), glowMat);
  exhaust.position.z = 6.01;
  g.add(body, nose, canopy, wing, tail, fin, exhaust);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // smoke trail
  const trailGeo = new THREE.BufferGeometry();
  const N = 120;
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: '#ff8ac2', transparent: true, opacity: 0.7 }));
  trail.frustumCulled = false;
  return { mesh: g, trail, N, hist: [] };
}

/**
 * Race session: grid, countdown, progress tracking, checkpoints, laps,
 * finishing order and results.
 */
export class Race {
  constructor(scene, ev, route, participants) {
    this.scene = scene;
    this.ev = ev;
    this.route = route;
    this.closed = route.closed && ev.type === 'circuit';
    this.laps = this.closed ? ev.laps || 1 : 1;
    this.total = this.closed ? route.length * this.laps : route.length - 10;
    this.p = participants; // {vehicle, ai, name, isPlayer}
    this.state = 'countdown';
    this.countdown = 3.999;
    this.time = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.finishOrder = [];
    // checkpoints
    const spacing = clamp(route.length / 8, 220, 600);
    this.checkpoints = [];
    for (let s = spacing; s < this.total - spacing * 0.4; s += spacing) this.checkpoints.push(s);
    this.checkpoints.push(this.total);
    for (const pp of this.p) {
      pp.progress = 0;
      pp.lastS = null;
      pp.cp = 0;
      pp.lap = 0;
      pp.lapStart = 0;
      pp.lapTimes = [];
      pp.finished = false;
      pp.finishTime = Infinity;
      pp.hint = -1;
    }
    this.gates = [];
    this.startGate = makeGate(route, 0, this.closed ? 'finish' : 'start');
    this.group.add(this.startGate);
    if (!this.closed) {
      this.finishGate = makeGate(route, route.length - 10, 'finish');
      this.group.add(this.finishGate);
    }
    this._refreshGates();
    if (ev.type === 'showcase') {
      this.jet = makeJet();
      this.group.add(this.jet.mesh);
      this.group.add(this.jet.trail);
      this.jetS = 0;
      this.jetV = 0;
      this.jetFinished = false;
    }
  }

  /** Grid positions: returns array of {x,y,z,heading} for slot k. */
  gridSlot(k) {
    const r = this.route;
    const row = Math.floor(k / 2);
    const col = k % 2;
    const s = this.closed ? -10 - row * 9 : 12 + (this.p.length / 2 - row) * 9;
    const pt = r.pointAtS(this.closed ? (s + r.length) % r.length : s);
    const lat = (col ? 1 : -1) * Math.min(2.6, pt.hw - 1.5);
    const rx = -pt.tz, rz = pt.tx;
    return { x: pt.x + rx * lat, y: pt.y, z: pt.z + rz * lat, heading: Math.atan2(-pt.tx, -pt.tz), lat };
  }

  _refreshGates() {
    for (const g of this.gates) this.group.remove(g);
    this.gates = [];
    const player = this.p.find((x) => x.isPlayer);
    if (!player) return;
    const M = getGateMats();
    for (let k = 0; k < 2; k++) {
      const idx = player.cp + k;
      if (idx >= this.checkpoints.length - 1) break;
      const cs = this.checkpoints[idx];
      const s = this.closed ? cs % this.route.length : cs;
      if (Math.abs(s) < 30) continue;
      const g = makeGate(this.route, s, 'cp');
      if (k === 1) { g.userData.l.material = M.pillarNext; g.userData.r.material = M.pillarNext; }
      this.group.add(g);
      this.gates.push(g);
    }
  }

  start() {
    this.state = 'running';
    this.time = 0;
    for (const pp of this.p) pp.vehicle.frozen = false;
  }

  update(dt, events) {
    if (this.state === 'countdown') {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== prev && now >= 1 && now <= 3) events.push({ type: 'countdown', n: now });
      if (this.countdown <= 0) {
        this.start();
        events.push({ type: 'go' });
      }
      return;
    }
    if (this.state === 'done') return;
    this.time += dt;
    const r = this.route;
    for (const pp of this.p) {
      if (pp.finished) continue;
      const v = pp.vehicle;
      let pr = r.project(v.pos.x, v.pos.z, pp.hint, 50);
      if (pr.dist > 40) pr = r.project(v.pos.x, v.pos.z, -1);
      pp.hint = pr.i;
      pp.offRoute = pr.dist;
      if (pp.lastS === null) {
        // initial position may be behind the start line on circuits
        pp.progress = this.closed && pr.s > r.length / 2 ? pr.s - r.length : pr.s;
      } else {
        let ds = pr.s - pp.lastS;
        if (this.closed) {
          if (ds < -r.length / 2) ds += r.length;
          if (ds > r.length / 2) ds -= r.length;
        }
        if (Math.abs(ds) < 60) pp.progress += ds;
      }
      pp.lastS = pr.s;
      // checkpoints
      while (pp.cp < this.checkpoints.length && pp.progress >= this.checkpoints[pp.cp]) {
        pp.cp++;
        if (pp.isPlayer && pp.cp < this.checkpoints.length) {
          events.push({ type: 'checkpoint', index: pp.cp, total: this.checkpoints.length });
          this._refreshGates();
        }
      }
      // laps
      if (this.closed) {
        const lap = Math.floor(Math.max(0, pp.progress) / r.length);
        if (lap > pp.lap) {
          const lt = this.time - pp.lapStart;
          pp.lapTimes.push(lt);
          pp.lapStart = this.time;
          pp.lap = lap;
          if (pp.isPlayer && lap < this.laps) events.push({ type: 'lap', lap: lap + 1, laps: this.laps, time: lt });
        }
      }
      if (pp.progress >= this.total) {
        pp.finished = true;
        pp.finishTime = this.time;
        if (!this.closed) pp.lapTimes.push(this.time);
        this.finishOrder.push(pp);
        if (pp.ai) pp.ai.cruise = 12; // coast after the line
        events.push({ type: 'finish', who: pp, position: this.finishOrder.length + (this.jetFinished ? 1 : 0) });
      }
    }
    // rubber banding relative to the player
    const player = this.p.find((x) => x.isPlayer);
    if (player) {
      for (const pp of this.p) {
        if (!pp.ai || pp.finished) continue;
        const gap = pp.progress - player.progress;
        const rb = pp.ai.diff.rubber;
        pp.ai.rubber = clamp(1 - gap / 400 * rb * 4, 1 - rb, 1 + rb * 1.5);
        // slipstream detection for everyone
      }
    }
    this._slipstream();
    if (this.jet) this._updateJet(dt, events);
  }

  _slipstream() {
    for (const pp of this.p) {
      const v = pp.vehicle;
      let best = 0;
      for (const o of this.p) {
        if (o === pp) continue;
        const dx = o.vehicle.pos.x - v.pos.x, dz = o.vehicle.pos.z - v.pos.z;
        const ahead = dx * v.forward.x + dz * v.forward.z;
        const side = Math.abs(dx * v.right.x + dz * v.right.z);
        if (ahead > 2 && ahead < 30 && side < 2.2 && v.speed > 20) best = Math.max(best, 1 - ahead / 30);
      }
      v.slipstream = best;
    }
  }

  _updateJet(dt, events) {
    const j = this.jet;
    const target = this.ev.jetSpeed || 70;
    this.jetV = Math.min(target, this.jetV + dt * 9);
    this.jetS += this.jetV * dt;
    const r = this.route;
    const s = Math.min(this.jetS, r.length);
    const p = r.pointAtS(s);
    const p2 = r.pointAtS(Math.min(r.length, s + 30));
    const alt = Math.min(28, 4 + this.jetS * 0.12);
    j.mesh.position.set(p.x, p.y + alt, p.z);
    j.mesh.lookAt(p2.x, p2.y + alt, p2.z);
    j.mesh.rotateY(Math.PI);
    j.mesh.rotation.z += Math.sin(this.time * 1.3) * 0.05;
    j.hist.unshift(j.mesh.position.clone().add(new THREE.Vector3(0, 0, 0)));
    if (j.hist.length > j.N) j.hist.pop();
    const arr = j.trail.geometry.attributes.position.array;
    for (let i = 0; i < j.N; i++) {
      const h = j.hist[Math.min(i, j.hist.length - 1)];
      arr[i * 3] = h.x; arr[i * 3 + 1] = h.y; arr[i * 3 + 2] = h.z;
    }
    j.trail.geometry.attributes.position.needsUpdate = true;
    if (!this.jetFinished && this.jetS >= r.length - 10) {
      this.jetFinished = true;
      this.jetTime = this.time;
      events.push({ type: 'jetFinish' });
    }
    this.jetProgress = this.jetS;
  }

  standings() {
    const list = [...this.p];
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    return list;
  }

  positionOf(pp) {
    let pos = this.standings().indexOf(pp) + 1;
    if (this.jet && (this.jetFinished ? !pp.finished || this.jetTime < pp.finishTime : this.jetS > pp.progress)) pos = 2;
    else if (this.jet) pos = 1;
    return pos;
  }

  /** Estimated finishing time for racers still on track. */
  estimate(pp) {
    if (pp.finished) return pp.finishTime;
    const remaining = this.total - pp.progress;
    const avg = Math.max(8, pp.progress / Math.max(1, this.time));
    return this.time + remaining / avg;
  }

  snapshot() {
    return {
      time: this.time,
      jetS: this.jetS, jetV: this.jetV,
      p: this.p.map((pp) => ({ progress: pp.progress, lastS: pp.lastS, cp: pp.cp, lap: pp.lap, lapStart: pp.lapStart, hint: pp.hint })),
    };
  }

  restore(s) {
    this.time = s.time;
    if (this.jet) { this.jetS = s.jetS; this.jetV = s.jetV; }
    s.p.forEach((d, i) => Object.assign(this.p[i], d));
    this._refreshGates();
  }

  playerProgressFraction() {
    const pl = this.p.find((x) => x.isPlayer);
    return pl ? clamp(pl.progress / this.total, 0, 1) : 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
