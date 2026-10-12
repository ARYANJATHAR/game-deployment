import * as THREE from 'three';
import { makeSmokeTexture } from '../world/Textures.js';

const VERT = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
uniform float scale;
#include <fog_pars_vertex>
void main() {
  vColor = pcolor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform sampler2D map;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <fog_fragment>
}`;

/** CPU-simulated point particle system (smoke, dust, sparks, splashes). */
export class ParticleSystem {
  constructor(scene, max = 2500, additive = false, texture = null) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture || makeSmokeTexture() }, scale: { value: 600 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  setScale(h) {
    this.mat.uniforms.scale.value = h;
  }

  emit(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a, drag = 1.5, grav = 0) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.alpha0[i] = a;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap with last
        n--;
        this._copy(n, i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  _copy(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.size[to] = this.size[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.grow[to] = this.grow[from];
    this.alpha0[to] = this.alpha0[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
  }

  clear() {
    this.count = 0;
  }
}

/** Ribbon skid marks laid behind sliding wheels. */
export class SkidMarks {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.head = 0;
    this.used = 0;
    this.last = new Map();
  }

  /** key identifies a wheel; call each frame with the contact point. */
  add(key, p, right, width, intensity, color = [0.03, 0.03, 0.03]) {
    const last = this.last.get(key);
    if (!last || intensity <= 0.02) {
      this.last.set(key, intensity > 0.02 ? { x: p.x, y: p.y, z: p.z, rx: right.x, rz: right.z, a: intensity } : null);
      return;
    }
    const dx = p.x - last.x, dz = p.z - last.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.16) return;
    if (d2 > 25) { this.last.set(key, null); return; }
    const hw = width / 2;
    const y0 = last.y + 0.03, y1 = p.y + 0.03;
    const a0 = Math.min(0.85, last.a), a1 = Math.min(0.85, intensity);
    const quad = [
      [last.x - last.rx * hw, y0, last.z - last.rz * hw, a0],
      [last.x + last.rx * hw, y0, last.z + last.rz * hw, a0],
      [p.x + right.x * hw, y1, p.z + right.z * hw, a1],
      [p.x - right.x * hw, y1, p.z - right.z * hw, a1],
    ];
    const order = [0, 2, 1, 0, 3, 2];
    const base = this.head * 6;
    for (let k = 0; k < 6; k++) {
      const v = quad[order[k]];
      const i = base + k;
      this.pos[i * 3] = v[0]; this.pos[i * 3 + 1] = v[1]; this.pos[i * 3 + 2] = v[2];
      this.col[i * 4] = color[0]; this.col[i * 4 + 1] = color[1]; this.col[i * 4 + 2] = color[2]; this.col[i * 4 + 3] = v[3];
    }
    this.head = (this.head + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    this.dirty = true;
    this.last.set(key, { x: p.x, y: p.y, z: p.z, rx: right.x, rz: right.z, a: intensity });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.geo.setDrawRange(0, this.used * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.used = 0;
    this.head = 0;
    this.last.clear();
    this.geo.setDrawRange(0, 0);
  }
}
