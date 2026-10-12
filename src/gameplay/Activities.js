import * as THREE from 'three';
import { ACTIVITIES, EVENTS } from '../config/events.js';
import { makeSignTexture } from '../world/Textures.js';

const DISC_COLORS = {
  'Road Racing': '#ff2d87',
  'Street Racing': '#ffb000',
  'Dirt Racing': '#c87533',
  'Drag Racing': '#19d3ff',
  Showcase: '#b14bff',
};

function labelSprite(text, sub, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,12,20,0.75)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 496, 144, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(8, 8, 12, 144);
  ctx.fillStyle = '#fff';
  ctx.font = '800 46px "Saira Condensed", "Arial Narrow", Arial, sans-serif';
  ctx.fillText(text.toUpperCase(), 40, 72);
  ctx.fillStyle = color;
  ctx.font = '700 32px Rajdhani, Arial, sans-serif';
  ctx.fillText(sub.toUpperCase(), 40, 120);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(16, 5, 1);
  s.renderOrder = 20;
  return s;
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * World markers for events plus the logic of speed traps, speed zones,
 * drift zones, danger-sign jumps and XP boards.
 */
export class Activities {
  constructor(scene, hf, scenery, save) {
    this.scene = scene;
    this.hf = hf;
    this.save = save;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.beamTex = beamTexture();
    this.events = [];
    this.list = [];
    this.jumps = scenery.jumps || [];
    this.boards = scenery.xpBoards || [];
    this.activeZone = null;
    this.trapState = new Map();
    this.jumpState = null;
    this.time = 0;
  }

  /** eventRoutes: Map id -> Route */
  build(eventRoutes) {
    for (const ev of EVENTS) {
      const route = eventRoutes.get(ev.id);
      if (!route) continue;
      const i = route.indexAtS(route.closed ? 0 : 20);
      // marker placed at the roadside next to the start
      const side = route.hw[i] + 7;
      const x = route.x[i] + -route.tz[i] * side, z = route.z[i] + route.tx[i] * side;
      const y = this.hf.heightAt(x, z);
      const color = DISC_COLORS[ev.discipline] || '#ff2d87';
      const g = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 90, 20, 1, true),
        new THREE.MeshBasicMaterial({ color, map: this.beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
      );
      beam.position.y = 45;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.25, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, fog: false }));
      ring.position.y = 0.4;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
      disc.position.y = 0.15;
      const label = labelSprite(ev.name, ev.discipline, color);
      label.position.y = 9;
      g.add(beam, ring, disc, label);
      g.position.set(x, y, z);
      this.group.add(g);
      this.events.push({ ev, route, x, y, z, group: g, label, ring, color });
    }
    // activities
    const signTex = makeSignTexture('danger');
    for (const a of ACTIVITIES) {
      const road = this.hf.roads.roads.find((r) => r.id === a.road);
      if (!road) continue;
      const i0 = Math.floor(road.count * a.frac);
      const act = { ...a, road, i0, x: road.x[i0], z: road.z[i0], y: road.y[i0] };
      if (a.type !== 'trap') {
        const steps = Math.round(a.length / 2);
        const i1 = road.closed ? (i0 + steps) % road.count : Math.min(road.count - 1, i0 + steps);
        act.i1 = i1;
        act.x1 = road.x[i1]; act.z1 = road.z[i1]; act.y1 = road.y[i1];
      }
      const color = a.type === 'trap' ? '#2f8bff' : a.type === 'zone' ? '#19d3ff' : '#b14bff';
      act.color = color;
      act.markers = [this._strip(road, i0, color, a.type === 'trap' ? 'trap' : 'start')];
      if (act.i1 !== undefined) act.markers.push(this._strip(road, act.i1, color, 'end'));
      if (a.type === 'trap') {
        const cam = this._trapCamera(road, i0);
        act.markers.push(cam);
      }
      this.list.push(act);
    }
    // danger signs for jumps
    this.jumps.forEach((j, k) => {
      const back = 40;
      const r = j.road;
      const ib = Math.max(0, j.i - Math.round(back / 2));
      const side = r.halfWidth + 2;
      const x = r.x[ib] + -r.tz[ib] * side, z = r.z[ib] + r.tx[ib] * side;
      const y = this.hf.heightAt(x, z);
      const sign = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), new THREE.MeshStandardMaterial({ color: '#555' }));
      post.position.y = 1.5;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide }));
      board.position.y = 3.3;
      sign.add(post, board);
      sign.position.set(x, y, z);
      sign.rotation.y = Math.atan2(r.tx[ib], r.tz[ib]) + Math.PI;
      this.group.add(sign);
      j.id = `jump-${k}`;
      j.stars = [30, 55, 80];
    });
  }

  _strip(road, i, color, kind) {
    const w = road.halfWidth * 2;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(w, kind === 'trap' ? 1.2 : 0.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12 }),
    );
    g.position.set(road.x[i], road.y[i] + 0.09, road.z[i]);
    g.rotation.y = Math.atan2(road.tx[i], road.tz[i]);
    this.group.add(g);
    return g;
  }

  _trapCamera(road, i) {
    const g = new THREE.Group();
    const side = road.halfWidth + 1.8;
    const x = road.x[i] + -road.tz[i] * side, z = road.z[i] + road.tx[i] * side;
    const y = this.hf.heightAt(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.5, 8), new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.6, roughness: 0.4 }));
    post.position.y = 2.25;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: '#2f8bff', emissive: '#2f8bff', emissiveIntensity: 0.5 }));
    box.position.y = 4.6;
    g.add(post, box);
    g.position.set(x, y, z);
    this.group.add(g);
    return g;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  nearestEvent(pos, maxDist = 12) {
    let best = null, bd = maxDist;
    for (const e of this.events) {
      const d = Math.hypot(e.x - pos.x, e.z - pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt, camPos, player, skills, out) {
    this.time += dt;
    // event marker animation + label visibility
    for (const e of this.events) {
      const d = Math.hypot(e.x - camPos.x, e.z - camPos.z);
      e.label.visible = d < 260;
      const s = 1 + Math.sin(this.time * 3) * 0.06;
      e.ring.scale.set(s, 1, s);
      e.group.visible = d < 2400;
    }
    if (!player) return;
    const p = player.pos;
    const kmh = player.speedKmh;
    // speed traps
    for (const a of this.list) {
      if (a.type !== 'trap') continue;
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      let st = this.trapState.get(a.id);
      if (d < a.road.halfWidth + 3) {
        if (!st) this.trapState.set(a.id, (st = { max: 0 }));
        st.max = Math.max(st.max, kmh);
      } else if (st && d > a.road.halfWidth + 6) {
        this.trapState.delete(a.id);
        if (st.max > 40) out.push({ type: 'trap', act: a, value: st.max });
      }
    }
    // speed / drift zones
    if (this.activeZone) {
      const z = this.activeZone;
      z.t += dt;
      z.dist += player.speed * dt;
      if (z.type === 'drift') {
        const da = Math.abs(player.driftAngle);
        if (player.grounded && da > 0.26 && da < 1.6 && player.speed > 8) z.score += player.speed * da * 28 * dt * (skills ? skills.mult : 1);
      }
      const dEnd = Math.hypot(z.act.x1 - p.x, z.act.z1 - p.z);
      const near = this.hf.roads.nearest(p.x, p.z, 80);
      if (!near) {
        out.push({ type: 'zoneFail', act: z.act });
        this.activeZone = null;
      } else if (dEnd < z.act.road.halfWidth + 3) {
        const value = z.type === 'zone' ? (z.act.length / Math.max(0.1, z.t)) * 3.6 : Math.round(z.score);
        out.push({ type: z.type, act: z.act, value });
        this.activeZone = null;
      } else if (z.t > 90) {
        this.activeZone = null;
      }
    } else {
      for (const a of this.list) {
        if (a.type === 'trap') continue;
        const d = Math.hypot(a.x - p.x, a.z - p.z);
        if (d < a.road.halfWidth + 2 && player.speed > 5) {
          // direction check: must be heading toward the end marker
          const dir = (a.x1 - a.x) * player.vel.x + (a.z1 - a.z) * player.vel.z;
          if (dir <= 0 && a.road.closed !== true) continue;
          this.activeZone = {
            act: a, type: a.type, t: 0, dist: 0, score: 0, best: 0,
            baseScore: skills ? Math.round(skills.chain * skills.mult) : 0,
          };
          out.push({ type: 'zoneStart', act: a });
          break;
        }
      }
    }
    // danger sign jumps
    if (!this.jumpState) {
      if (!player.grounded && player.airTime > 0.05) {
        for (const j of this.jumps) {
          if (Math.hypot(j.x - p.x, j.z - p.z) < 14) {
            this.jumpState = { j, x: p.x, z: p.z, t: 0 };
            break;
          }
        }
      }
    } else {
      const js = this.jumpState;
      js.t += dt;
      if (player.grounded && js.t > 0.15) {
        const dist = Math.hypot(p.x - js.x, p.z - js.z);
        out.push({ type: 'jump', act: { id: js.j.id, name: js.j.name, stars: js.j.stars }, value: dist });
        this.jumpState = null;
      } else if (js.t > 8) this.jumpState = null;
    }
  }

  static starsFor(act, value) {
    let s = 0;
    for (const t of act.stars) if (value >= t) s++;
    return s;
  }
}

export { DISC_COLORS };
