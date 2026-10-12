import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/utils.js';
import { makeSignTexture } from './Textures.js';

const REGION = 1024;

function colorGeo(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function jitter(geo, amount, seed) {
  const r = rng(seed);
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let off = map.get(key);
    if (!off) map.set(key, (off = [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]));
    p.setXYZ(i, p.getX(i) + off[0], p.getY(i) + off[1], p.getZ(i) + off[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildPropGeometries() {
  const G = {};
  // Pine tree
  {
    const parts = [];
    parts.push(colorGeo(new THREE.CylinderGeometry(0.18, 0.32, 3, 6).translate(0, 1.5, 0), '#5a3d26'));
    const greens = ['#1f4a26', '#24552b', '#2a6131'];
    for (let k = 0; k < 3; k++) {
      const h = 4.2 - k * 0.9;
      const r = 2.6 - k * 0.7;
      parts.push(colorGeo(jitter(new THREE.ConeGeometry(r, h, 7, 1).translate(0, 2.4 + k * 1.9 + h / 2, 0), 0.25, k + 1), greens[k]));
    }
    G.pine = mergeGeometries(parts);
  }
  // Broadleaf tree
  {
    const parts = [];
    parts.push(colorGeo(new THREE.CylinderGeometry(0.22, 0.38, 3.6, 6).translate(0, 1.8, 0), '#5b4129'));
    const blobs = [[0, 5.0, 0, 2.6], [1.3, 4.2, 0.6, 1.8], [-1.2, 4.4, -0.5, 1.9], [0.2, 6.2, -0.4, 1.7]];
    blobs.forEach(([x, y, z, r], i) => {
      parts.push(colorGeo(jitter(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), 0.45, i + 10), i % 2 ? '#3d6b2a' : '#467a31'));
    });
    G.broadleaf = mergeGeometries(parts);
  }
  // Palm tree
  {
    const parts = [];
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const y0 = i * 1.3;
      const g = new THREE.CylinderGeometry(0.2, 0.26, 1.35, 6).translate(i * i * 0.04, y0 + 0.65, 0);
      parts.push(colorGeo(g, i % 2 ? '#8b6b45' : '#7a5c3a'));
    }
    const top = new THREE.Vector3(segs * segs * 0.04, segs * 1.3, 0);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const leaf = new THREE.BoxGeometry(3.4, 0.06, 0.7);
      leaf.translate(1.7, 0, 0);
      const m = new THREE.Matrix4().makeRotationZ(-0.45).premultiply(new THREE.Matrix4().makeRotationY(a));
      leaf.applyMatrix4(m);
      leaf.translate(top.x, top.y, top.z);
      parts.push(colorGeo(leaf, k % 2 ? '#3f7a2e' : '#4b8a35'));
    }
    G.palm = mergeGeometries(parts);
  }
  // Bush
  G.bush = colorGeo(jitter(new THREE.IcosahedronGeometry(1.1, 0).scale(1.3, 0.8, 1.3).translate(0, 0.6, 0), 0.35, 3), '#3f6a2a');
  // Rock
  G.rock = colorGeo(jitter(new THREE.DodecahedronGeometry(1.4, 0).scale(1.4, 0.8, 1.1).translate(0, 0.4, 0), 0.6, 4), '#7b7873');
  // Lamp post
  {
    const parts = [];
    parts.push(colorGeo(new THREE.CylinderGeometry(0.09, 0.13, 7, 6).translate(0, 3.5, 0), '#3b3f45'));
    parts.push(colorGeo(new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0.75, 6.95, 0), '#3b3f45'));
    parts.push(colorGeo(new THREE.BoxGeometry(0.55, 0.16, 0.3).translate(1.45, 6.85, 0), '#2a2d31'));
    G.lamp = mergeGeometries(parts);
    G.lampHead = new THREE.BoxGeometry(0.45, 0.05, 0.24).translate(1.45, 6.76, 0);
  }
  // Fence segment (smashable)
  {
    const parts = [];
    parts.push(colorGeo(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(-1.5, 0.55, 0), '#d8d2c4'));
    parts.push(colorGeo(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(1.5, 0.55, 0), '#d8d2c4'));
    parts.push(colorGeo(new THREE.BoxGeometry(3.1, 0.14, 0.06).translate(0, 0.85, 0), '#e8e2d4'));
    parts.push(colorGeo(new THREE.BoxGeometry(3.1, 0.14, 0.06).translate(0, 0.45, 0), '#e8e2d4'));
    G.fence = mergeGeometries(parts);
  }
  // Traffic cone
  {
    const parts = [];
    parts.push(colorGeo(new THREE.ConeGeometry(0.22, 0.7, 10).translate(0, 0.38, 0), '#ff5a14'));
    parts.push(colorGeo(new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0), '#222'));
    G.cone = mergeGeometries(parts);
  }
  // Hay bale
  G.hay = colorGeo(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12).rotateZ(Math.PI / 2).translate(0, 0.75, 0), '#d6b55a');
  // Barrier (concrete jersey)
  G.barrier = colorGeo(new THREE.BoxGeometry(3, 0.9, 0.5).translate(0, 0.45, 0), '#c9c6bf');
  // Mailbox / small sign
  G.post = colorGeo(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5).translate(0, 1.1, 0), '#6d6f73');
  return G;
}

const TYPE_DEFS = {
  pine: { collider: { kind: 'circle', r: 0.45, h: 12 }, shadow: true, dist: 1300 },
  broadleaf: { collider: { kind: 'circle', r: 0.5, h: 9 }, shadow: true, dist: 1300 },
  palm: { collider: { kind: 'circle', r: 0.35, h: 8 }, shadow: true, dist: 1100 },
  bush: { collider: null, shadow: false, dist: 500 },
  rock: { collider: { kind: 'circle', r: 1.6, h: 1.5 }, shadow: true, dist: 900 },
  lamp: { collider: { kind: 'circle', r: 0.2, h: 7 }, shadow: false, dist: 700, smash: { mass: 80 } },
  fence: { collider: { kind: 'box', hx: 1.55, hz: 0.12, h: 1.1 }, shadow: false, dist: 450, smash: { mass: 25 } },
  cone: { collider: { kind: 'circle', r: 0.3, h: 0.7 }, shadow: false, dist: 300, smash: { mass: 4 } },
  hay: { collider: { kind: 'circle', r: 0.8, h: 1.5 }, shadow: true, dist: 600, smash: { mass: 60 } },
  barrier: { collider: { kind: 'box', hx: 1.5, hz: 0.28, h: 0.9 }, shadow: false, dist: 500 },
  sign: { collider: { kind: 'circle', r: 0.15, h: 2.2 }, shadow: false, dist: 500, smash: { mass: 15 } },
  xpboard: { collider: { kind: 'box', hx: 1.4, hz: 0.2, h: 3.2 }, shadow: false, dist: 1200, smash: { mass: 30 } },
};

/**
 * Instanced static props split into spatial regions. Smashable instances are
 * hidden on impact and replaced with a flying debris mesh.
 */
export class Props {
  constructor(scene, colliders, hf) {
    this.scene = scene;
    this.colliders = colliders;
    this.hf = hf;
    this.geos = buildPropGeometries();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: '#fff6dd', emissive: '#ffd9a0', emissiveIntensity: 0 });
    this.signTex = makeSignTexture('chevron');
    this.xpTex = makeSignTexture('xp');
    this.items = {};
    this.regions = new Map();
    this.debris = [];
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);
    this._buildSpecialGeos();
  }

  _buildSpecialGeos() {
    // chevron sign: post + board with texture
    const board = new THREE.BoxGeometry(1.2, 0.9, 0.06).translate(0, 1.9, 0);
    const post = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5).translate(0, 0.8, 0);
    this.signGeo = mergeGeometries([board.toNonIndexed(), post.toNonIndexed()].map((g) => {
      if (!g.attributes.uv) return g;
      return g;
    }));
    this.signMat = new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.5 });
    // xp board: two posts + big board
    const b = new THREE.BoxGeometry(2.8, 1.8, 0.1).translate(0, 2.3, 0);
    const p1 = new THREE.BoxGeometry(0.15, 2.0, 0.15).translate(-1.1, 1.0, 0);
    const p2 = new THREE.BoxGeometry(0.15, 2.0, 0.15).translate(1.1, 1.0, 0);
    this.xpGeo = mergeGeometries([b, p1, p2]);
    this.xpMat = new THREE.MeshStandardMaterial({ map: this.xpTex, roughness: 0.4, emissive: '#ff7a00', emissiveIntensity: 0.25 });
  }

  add(type, x, z, rotY = 0, scale = 1, color = null, y = null, extra = null) {
    const def = TYPE_DEFS[type];
    const yy = y ?? this.hf.heightAt(x, z);
    const item = { type, x, y: yy, z, rotY, scale, color, alive: true, extra };
    (this.items[type] = this.items[type] || []).push(item);
    if (def.collider) {
      const cd = def.collider;
      let col;
      if (cd.kind === 'circle') col = this.colliders.addCircle(x, z, cd.r * scale, yy - 1, yy + cd.h * scale, { prop: item });
      else col = this.colliders.addBox(x, z, cd.hx * scale, cd.hz * scale, -rotY, yy - 1, yy + cd.h * scale, { prop: item });
      if (def.smash) col.smash = def.smash;
      item.collider = col;
    }
    return item;
  }

  build() {
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    for (const type in this.items) {
      const def = TYPE_DEFS[type];
      const byRegion = new Map();
      for (const it of this.items[type]) {
        const key = `${Math.floor(it.x / REGION)},${Math.floor(it.z / REGION)}`;
        let l = byRegion.get(key);
        if (!l) byRegion.set(key, (l = []));
        l.push(it);
      }
      for (const [key, list] of byRegion) {
        let geo = this.geos[type], mat = this.material;
        if (type === 'sign') { geo = this.signGeo; mat = this.signMat; }
        if (type === 'xpboard') { geo = this.xpGeo; mat = this.xpMat; }
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        let cx = 0, cz = 0;
        list.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.rotation.set(0, it.rotY, 0);
          dummy.scale.setScalar(it.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (type !== 'sign' && type !== 'xpboard') {
            tint.set(it.color || '#ffffff');
            mesh.setColorAt(i, tint);
          }
          it.mesh = mesh;
          it.index = i;
          cx += it.x; cz += it.z;
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData.center = new THREE.Vector3(cx / list.length, 0, cz / list.length);
        mesh.userData.dist = def.dist;
        this.group.add(mesh);
        if (type === 'lamp') {
          const heads = new THREE.InstancedMesh(this.geos.lampHead, this.lampHeadMat, list.length);
          list.forEach((it, i) => {
            mesh.getMatrixAt(i, dummy.matrix);
            heads.setMatrixAt(i, dummy.matrix);
            it.headMesh = heads;
          });
          heads.computeBoundingSphere();
          heads.userData.center = mesh.userData.center;
          heads.userData.dist = def.dist;
          this.group.add(heads);
        }
        void key;
      }
    }
  }

  /** Shadow-only instanced meshes holding the props near the camera. */
  _buildShadowProxies() {
    this.proxies = [];
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const type in this.items) {
      if (!TYPE_DEFS[type].shadow) continue;
      const m = new THREE.InstancedMesh(this.geos[type], mat, 700);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = -10;
      this.group.add(m);
      this.proxies.push({ type, mesh: m });
    }
    this.proxyTimer = 0;
  }

  _updateShadowProxies(focus) {
    const R2 = 150 * 150;
    const dummy = this._dummy || (this._dummy = new THREE.Object3D());
    for (const p of this.proxies) {
      let n = 0;
      for (const it of this.items[p.type]) {
        if (!it.alive) continue;
        const dx = it.x - focus.x, dz = it.z - focus.z;
        if (dx * dx + dz * dz > R2) continue;
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        p.mesh.setMatrixAt(n++, dummy.matrix);
        if (n >= 700) break;
      }
      p.mesh.count = n;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setNight(amount) {
    this.lampHeadMat.emissiveIntensity = amount * 3;
  }

  update(dt, camPos) {
    if (!this.proxies) this._buildShadowProxies();
    this.proxyTimer -= dt;
    if (this.proxyTimer <= 0) {
      this.proxyTimer = 0.6;
      this._updateShadowProxies(camPos);
    }
    // distance culling per region
    for (const m of this.group.children) {
      const c = m.userData.center;
      if (!c) continue;
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z) - REGION * 0.7;
      m.visible = d < m.userData.dist;
    }
    // debris physics
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 9.81 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.ang.x * dt;
      d.mesh.rotation.y += d.ang.y * dt;
      d.mesh.rotation.z += d.ang.z * dt;
      const gy = this.hf.heightAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < gy) {
        d.mesh.position.y = gy;
        d.vel.y = Math.abs(d.vel.y) * 0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.ang.multiplyScalar(0.6);
      }
      if (d.life < 1) d.mesh.scale.setScalar(Math.max(0.001, d.life) * d.baseScale);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Smash a prop: hide its instance and launch a debris copy. */
  smash(item, impactVel) {
    if (!item.alive) return;
    item.alive = false;
    if (item.collider) item.collider.dead = true;
    const m = new THREE.Matrix4();
    item.mesh.getMatrixAt(item.index, m);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    item.mesh.setMatrixAt(item.index, zero);
    item.mesh.instanceMatrix.needsUpdate = true;
    if (item.headMesh) {
      item.headMesh.setMatrixAt(item.index, zero);
      item.headMesh.instanceMatrix.needsUpdate = true;
    }
    let geo = this.geos[item.type], mat = this.material;
    if (item.type === 'sign') { geo = this.signGeo; mat = this.signMat; }
    if (item.type === 'xpboard') { geo = this.xpGeo; mat = this.xpMat; }
    const mesh = new THREE.Mesh(geo, item.type === 'sign' || item.type === 'xpboard' ? mat : this._debrisMat(item.color));
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.position.y += 0.2;
    mesh.castShadow = true;
    this.scene.add(mesh);
    const speed = impactVel.length();
    const vel = impactVel.clone().multiplyScalar(0.9 + Math.random() * 0.3);
    vel.y = 3 + speed * 0.25 + Math.random() * 3;
    const ang = new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    this.debris.push({ mesh, vel, ang, life: 5, baseScale: mesh.scale.x });
    if (this.debris.length > 40) {
      const old = this.debris.shift();
      this.scene.remove(old.mesh);
    }
  }

  _debrisMat(color) {
    if (!color) return this.material;
    this._mats = this._mats || {};
    if (!this._mats[color]) {
      this._mats[color] = this.material.clone();
      this._mats[color].color.set(color);
    }
    return this._mats[color];
  }

  /** Restore all smashed props (e.g. after a long time or event restart). */
  restoreAll() {
    const dummy = new THREE.Object3D();
    for (const type in this.items) {
      for (const it of this.items[type]) {
        if (it.alive || it.type === 'xpboard') continue;
        it.alive = true;
        if (it.collider) it.collider.dead = false;
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        it.mesh.setMatrixAt(it.index, dummy.matrix);
        it.mesh.instanceMatrix.needsUpdate = true;
        if (it.headMesh) {
          it.headMesh.setMatrixAt(it.index, dummy.matrix);
          it.headMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  setSeasonTint(season) {
    const tint = new THREE.Color();
    for (const m of this.group.children) {
      if (!m.isInstancedMesh || !m.instanceColor) continue;
      const type = this._typeOf(m);
      if (!['pine', 'broadleaf', 'bush'].includes(type)) continue;
      const list = this.items[type].filter((it) => it.mesh === m);
      const r = rng(list.length + 7);
      list.forEach((it) => {
        if (season === 'autumn' && type !== 'pine') tint.setHSL(0.03 + r() * 0.08, 0.75, 0.62 + r() * 0.15);
        else if (season === 'winter') tint.setRGB(1.5, 1.55, 1.65);
        else if (season === 'spring' && type === 'broadleaf' && r() < 0.35) tint.setRGB(1.6, 1.15, 1.3);
        else tint.set(it.color || '#ffffff');
        m.setColorAt(it.index, tint);
      });
      m.instanceColor.needsUpdate = true;
    }
  }

  _typeOf(mesh) {
    for (const t in this.items) if (this.items[t].length && this.items[t].some((it) => it.mesh === mesh)) return t;
    return null;
  }
}
