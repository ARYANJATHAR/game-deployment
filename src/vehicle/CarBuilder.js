import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';
import { makePlateTexture, makeCarbonTexture, makeTireTexture } from '../world/Textures.js';
import { mergeByMaterial } from '../core/merge.js';

// Body style profiles. t = 0 at the nose, 1 at the tail.
// top: fraction of total height, bottom: extra height above ride height (fraction of height),
// width: fraction of half width.
const STYLES = {
  hatch: {
    top: [[0, 0.46], [0.05, 0.58], [0.25, 0.65], [0.34, 0.68], [0.9, 0.71], [0.98, 0.68], [1, 0.58]],
    bottom: [[0, 0.14], [0.08, 0.0], [0.92, 0.0], [1, 0.14]],
    width: [[0, 0.82], [0.08, 0.95], [0.5, 1], [0.92, 0.97], [1, 0.86]],
    cabin: { cs: 0.33, ws: 0.5, re: 0.9, ce: 0.97, tumble: 0.78, inset: 0.92 },
    n: 4, roundEnds: 0.1, lights: 'modern',
  },
  roadster: {
    top: [[0, 0.44], [0.06, 0.58], [0.3, 0.65], [0.45, 0.68], [0.95, 0.7], [1, 0.58]],
    bottom: [[0, 0.16], [0.1, 0.0], [0.9, 0.0], [1, 0.16]],
    width: [[0, 0.75], [0.1, 0.93], [0.5, 1], [0.9, 0.95], [1, 0.8]],
    cabin: null, windshield: { t: 0.43, h: 0.3 },
    n: 2.6, roundEnds: 0.16, lights: 'round',
  },
  muscle: {
    top: [[0, 0.55], [0.03, 0.62], [0.35, 0.66], [0.42, 0.67], [0.78, 0.68], [0.97, 0.67], [1, 0.6]],
    bottom: [[0, 0.12], [0.06, 0.0], [0.94, 0.0], [1, 0.12]],
    width: [[0, 0.9], [0.06, 0.97], [0.5, 1], [0.94, 0.98], [1, 0.93]],
    cabin: { cs: 0.42, ws: 0.55, re: 0.72, ce: 0.84, tumble: 0.8, inset: 0.9 },
    n: 5, roundEnds: 0.06, lights: 'round',
  },
  coupe: {
    top: [[0, 0.47], [0.05, 0.56], [0.3, 0.63], [0.38, 0.65], [0.8, 0.69], [0.97, 0.69], [1, 0.62]],
    bottom: [[0, 0.14], [0.07, 0.0], [0.93, 0.0], [1, 0.12]],
    width: [[0, 0.85], [0.07, 0.96], [0.5, 1], [0.93, 0.98], [1, 0.9]],
    cabin: { cs: 0.38, ws: 0.53, re: 0.72, ce: 0.86, tumble: 0.8, inset: 0.9 },
    n: 4, roundEnds: 0.08, lights: 'modern',
  },
  rally: {
    top: [[0, 0.48], [0.05, 0.58], [0.3, 0.64], [0.36, 0.66], [0.8, 0.7], [0.97, 0.71], [1, 0.63]],
    bottom: [[0, 0.14], [0.07, 0.0], [0.93, 0.0], [1, 0.12]],
    width: [[0, 0.86], [0.07, 0.97], [0.5, 1], [0.93, 0.98], [1, 0.9]],
    cabin: { cs: 0.36, ws: 0.5, re: 0.77, ce: 0.87, tumble: 0.8, inset: 0.9 },
    n: 4, roundEnds: 0.08, lights: 'modern', scoop: true,
  },
  truck: {
    top: [[0, 0.5], [0.03, 0.57], [0.28, 0.6], [0.6, 0.6], [1, 0.6]],
    bottom: [[0, 0.06], [0.06, 0.0], [0.94, 0.0], [1, 0.06]],
    width: [[0, 0.92], [0.05, 0.98], [0.5, 1], [1, 0.98]],
    cabin: { cs: 0.29, ws: 0.38, re: 0.6, ce: 0.62, tumble: 0.9, inset: 0.95 },
    n: 6, roundEnds: 0.05, lights: 'truck', bed: [0.635, 0.985],
  },
  sports: {
    top: [[0, 0.42], [0.05, 0.52], [0.3, 0.6], [0.36, 0.62], [0.68, 0.74], [0.95, 0.72], [1, 0.62]],
    bottom: [[0, 0.15], [0.07, 0.0], [0.93, 0.0], [1, 0.12]],
    width: [[0, 0.8], [0.07, 0.94], [0.45, 0.97], [0.82, 1.02], [1, 0.9]],
    cabin: { cs: 0.36, ws: 0.5, re: 0.64, ce: 0.92, tumble: 0.74, inset: 0.86 },
    n: 3.2, roundEnds: 0.12, lights: 'round',
  },
  supercar: {
    top: [[0, 0.36], [0.05, 0.48], [0.28, 0.58], [0.32, 0.6], [0.7, 0.78], [0.95, 0.78], [1, 0.7]],
    bottom: [[0, 0.14], [0.08, 0.0], [0.92, 0.0], [1, 0.1]],
    width: [[0, 0.82], [0.07, 0.95], [0.4, 0.96], [0.75, 1.02], [1, 0.95]],
    cabin: { cs: 0.3, ws: 0.47, re: 0.6, ce: 0.8, tumble: 0.68, inset: 0.82 },
    n: 3.4, roundEnds: 0.1, lights: 'slim',
  },
  hyper: {
    top: [[0, 0.34], [0.06, 0.46], [0.28, 0.56], [0.32, 0.58], [0.72, 0.8], [0.96, 0.8], [1, 0.72]],
    bottom: [[0, 0.14], [0.08, 0.0], [0.92, 0.0], [1, 0.1]],
    width: [[0, 0.8], [0.07, 0.95], [0.4, 0.94], [0.75, 1.03], [1, 0.96]],
    cabin: { cs: 0.31, ws: 0.47, re: 0.58, ce: 0.82, tumble: 0.62, inset: 0.78 },
    n: 3.0, roundEnds: 0.12, lights: 'slim',
  },
  prototype: {
    top: [[0, 0.3], [0.08, 0.44], [0.3, 0.54], [0.5, 0.6], [0.95, 0.66], [1, 0.56]],
    bottom: [[0, 0.1], [0.08, 0.0], [0.92, 0.0], [1, 0.08]],
    width: [[0, 0.9], [0.08, 0.98], [0.5, 0.92], [0.85, 1.0], [1, 0.98]],
    cabin: { cs: 0.3, ws: 0.44, re: 0.58, ce: 0.7, tumble: 0.5, inset: 0.5 },
    n: 3.4, roundEnds: 0.08, lights: 'slim', fin: true,
  },
};

function curve(points, t) {
  // Catmull-Rom interpolation over keypoints [[t, v], ...]
  if (t <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (t >= last[0]) return last[1];
  let k = 0;
  while (k < points.length - 2 && t > points[k + 1][0]) k++;
  const p0 = points[Math.max(0, k - 1)], p1 = points[k], p2 = points[k + 1], p3 = points[Math.min(points.length - 1, k + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  const m1 = ((p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0])) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0])) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
}

const shared = {};
function sharedMaterials() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({
    color: '#0c1218', metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6,
  });
  shared.trim = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.55, metalness: 0.2 });
  shared.under = new THREE.MeshStandardMaterial({ color: '#0d0d0f', roughness: 0.9 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.12, metalness: 1 });
  shared.rubber = new THREE.MeshStandardMaterial({ color: '#202022', roughness: 0.92, map: makeTireTexture() });
  shared.carbon = new THREE.MeshStandardMaterial({ color: '#ffffff', map: makeCarbonTexture(), roughness: 0.3, metalness: 0.4 });
  shared.interior = new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.8 });
  shared.disc = new THREE.MeshStandardMaterial({ color: '#6d6f73', roughness: 0.45, metalness: 0.8 });
  shared.lens = new THREE.MeshPhysicalMaterial({ color: '#dfe8f0', roughness: 0.05, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.55 });
  return shared;
}

export function makePaintMaterial(color, finish = 'gloss') {
  const m = new THREE.MeshPhysicalMaterial({ color });
  setPaintFinish(m, finish);
  return m;
}

export function setPaintFinish(m, finish) {
  const f = {
    gloss: { metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04 },
    metallic: { metalness: 0.65, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 },
    matte: { metalness: 0.1, roughness: 0.72, clearcoat: 0, clearcoatRoughness: 0.5 },
    chrome: { metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 },
    pearl: { metalness: 0.4, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.6 },
  }[finish] || {};
  Object.assign(m, { iridescence: 0 }, f);
  m.needsUpdate = true;
}

/**
 * Builds a car model. Returns { root, wheels[], materials, dims }.
 * Local frame: forward is -Z, right is +X, ground at y = 0 (wheels resting).
 */
export function buildCar(car, opts = {}) {
  const S = STYLES[car.style];
  const D = car.dims;
  const M = sharedMaterials();
  const paint = makePaintMaterial(opts.paint || car.paint, opts.finish || 'gloss');
  const stripeMat = makePaintMaterial(opts.stripe || (car.stripes ? '#ffffff' : null) || '#ffffff', 'gloss');
  const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e0', emissiveIntensity: 0.6, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#5a0000', emissive: '#ff1a1a', emissiveIntensity: 0.6, roughness: 0.3 });
  const rimMat = new THREE.MeshStandardMaterial({ color: opts.rim || car.rim, metalness: 0.9, roughness: 0.28 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: opts.caliper || '#d11a1a', roughness: 0.4, metalness: 0.3 });

  const L = D.length, W = D.width, H = D.height, R = D.wheelR;
  const hw = W / 2;
  const ride = D.ride;
  const axleF = -D.wheelbase / 2 - (car.axleShift || 0);
  const axleR = D.wheelbase / 2 - (car.axleShift || 0);
  const innerX = D.track / 2 - D.wheelW / 2;
  const archR = R + 0.06;
  const zOf = (t) => -L / 2 + t * L;

  const root = new THREE.Group();
  root.name = car.id;
  const body = new THREE.Group();
  root.add(body);

  // ---------- body loft ----------
  const STN = 56, RING = 36;
  const n = S.n;
  const ringU = [];
  for (let k = 0; k < RING; k++) {
    const a = (k / RING) * Math.PI * 2 - Math.PI / 2; // start at bottom centre
    const c = Math.cos(a), s = Math.sin(a);
    ringU.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / n), Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
  }
  const archTopAt = (z) => {
    let best = -Infinity;
    for (const az of [axleF, axleR]) {
      const dz = Math.abs(z - az);
      const reach = archR + 0.25;
      if (dz < reach) {
        const inner = dz < archR ? Math.sqrt(archR * archR - dz * dz) : 0;
        const fall = smoothstep(reach, archR * 0.7, dz);
        best = Math.max(best, R + inner * fall + 0.05 * fall);
      }
    }
    return best;
  };
  const archBottomAt = (z) => {
    let b = -Infinity;
    for (const az of [axleF, axleR]) {
      const dz = Math.abs(z - az);
      if (dz < archR) b = Math.max(b, R + Math.sqrt(archR * archR - dz * dz));
    }
    return b;
  };
  const stationT = [];
  for (let k = 0; k < STN; k++) stationT.push(0.5 - 0.5 * Math.cos((Math.PI * k) / (STN - 1)));
  const bodyTop = (t) => curve(S.top, t) * H;
  const bodyBottom = (t) => ride + curve(S.bottom, t) * H;
  const bodyHW = (t) => curve(S.width, t) * hw;

  const pos = [];
  const uvs = [];
  const idx = [];
  const ringPts = [];
  for (let k = 0; k < STN; k++) {
    const t = stationT[k];
    const z = zOf(t);
    let top = bodyTop(t);
    let bot = bodyBottom(t);
    let w = bodyHW(t);
    // rounded nose/tail in plan & profile
    const re = S.roundEnds;
    const dEnd = Math.min(t, 1 - t) * L;
    if (dEnd < re * L * 0.35) {
      const f = Math.sqrt(1 - Math.pow(1 - dEnd / (re * L * 0.35), 2));
      const mid = (top + bot) / 2;
      top = mid + (top - mid) * (0.55 + 0.45 * f);
      bot = mid + (bot - mid) * (0.55 + 0.45 * f);
      w *= 0.7 + 0.3 * f;
    }
    const aTop = archTopAt(z);
    const aBot = archBottomAt(z);
    // wheel arch cut-out raises the bottom of the whole section
    if (aBot > -Infinity) bot = Math.max(bot, Math.min(aBot, top - 0.1));
    const ring = [];
    for (let r = 0; r < RING; r++) {
      const [ux, uy] = ringU[r];
      const f = (uy + 1) / 2;
      let x = ux * w * lerp(1, 0.94, f * f);
      let y = lerp(bot, top, f);
      // fender bulges over the wheels
      if (aTop > -Infinity && uy > 0.15) {
        const lat = smoothstep(innerX - 0.25, innerX + 0.02, Math.abs(x));
        const want = aTop + 0.05;
        if (y < want) y = lerp(y, want, lat * smoothstep(0.15, 0.6, uy));
      }
      ring.push([x, y, z]);
      pos.push(x, y, z);
      uvs.push(ux * 0.5 + 0.5, t);
    }
    ringPts.push(ring);
  }
  for (let k = 0; k < STN - 1; k++) {
    for (let r = 0; r < RING; r++) {
      const a = k * RING + r, b = k * RING + ((r + 1) % RING);
      const c = (k + 1) * RING + r, d = (k + 1) * RING + ((r + 1) % RING);
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const capStart = idx.length;
  for (const [k, flip] of [[0, true], [STN - 1, false]]) {
    const ring = ringPts[k];
    let cx = 0, cy = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; }
    cx /= RING; cy /= RING;
    const base = pos.length / 3;
    for (const p of ring) { pos.push(p[0], p[1], p[2]); uvs.push(0.5, k ? 1 : 0); }
    const center = pos.length / 3;
    pos.push(cx, cy, ring[0][2]);
    uvs.push(0.5, k ? 1 : 0);
    for (let r = 0; r < RING; r++) {
      const a = base + r, b = base + ((r + 1) % RING);
      if (flip) idx.push(center, b, a); else idx.push(center, a, b);
    }
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  fixWinding(bodyGeo, new THREE.Vector3(0, (ride + H * 0.6) / 2, 0));
  // caps must face forward (nose) and backward (tail)
  {
    const ia = bodyGeo.index.array;
    const pa = bodyGeo.attributes.position;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const half = (ia.length - capStart) / 2;
    for (let t = capStart; t < ia.length; t += 3) {
      a.fromBufferAttribute(pa, ia[t]); b.fromBufferAttribute(pa, ia[t + 1]); c.fromBufferAttribute(pa, ia[t + 2]);
      const nz = b.sub(a).cross(c.sub(a)).z;
      const front = t - capStart < half;
      if ((front && nz > 0) || (!front && nz < 0)) {
        const tmp = ia[t + 1];
        ia[t + 1] = ia[t + 2];
        ia[t + 2] = tmp;
      }
    }
    bodyGeo.computeVertexNormals();
  }
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);

  bodyMesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const findSurface = (tx, ty, facing) => {
    // cast toward the body from in front (facing -1) or behind (facing +1)
    ray.set(new THREE.Vector3(tx, ty, facing * L), new THREE.Vector3(0, 0, -facing));
    const hits = ray.intersectObject(bodyMesh, false);
    if (!hits.length) return null;
    const h = hits[0];
    const n = h.face.normal.clone().transformDirection(bodyMesh.matrixWorld).normalize();
    return { p: h.point.clone(), n };
  };
  const decal = (geo, mat, hit, out = 0.004) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(hit.p).addScaledVector(hit.n, out);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.n);
    body.add(m);
    return m;
  };

  // ---------- racing stripes ----------
  if (car.stripes || opts.stripes) {
    const sp = [], si = [];
    for (const off of [-0.24, 0.1]) {
      for (let k = 0; k < STN; k++) {
        const t = stationT[k];
        if (t < 0.02 || t > 0.98) continue;
        const top = bodyTop(t);
        const z = zOf(t);
        const inCab = S.cabin && t > S.cabin.cs && t < S.cabin.ce;
        const y = inCab ? top : top;
        sp.push(off, y + 0.006, z, off + 0.14, y + 0.006, z);
      }
      void si;
    }
    const geo = new THREE.BufferGeometry();
    const arr = [];
    const cols = sp.length / 6;
    const half = cols / 2;
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < half - 1; k++) {
        const a = (s * half + k) * 2, b = a + 1, c = a + 2, d = a + 3;
        arr.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    geo.setIndex(arr);
    geo.computeVertexNormals();
    fixWindingUp(geo);
    const stripes = new THREE.Mesh(geo, stripeMat);
    body.add(stripes);
  }

  // ---------- cabin / greenhouse ----------
  if (S.cabin) {
    const C = S.cabin;
    const CST = 30, CR = 28;
    const cpos = [], cidx = [], roofIdx = [];
    const roofY = H;
    const cRing = [];
    for (let k = 0; k < CR; k++) {
      // only upper half of a superellipse (sides + roof), closed at the bottom by the body
      const a = (k / (CR - 1)) * Math.PI; // 0..PI
      const c = Math.cos(a), s = Math.sin(a);
      cRing.push([Math.sign(c) * Math.pow(Math.abs(c), 2 / 3.5), Math.pow(Math.abs(s), 2 / 3.5)]);
    }
    for (let k = 0; k < CST; k++) {
      const t = lerp(C.cs, C.ce, k / (CST - 1));
      const z = zOf(t);
      const base = bodyTop(t) - 0.03;
      let topY;
      if (t < C.ws) {
        const u = (t - C.cs) / (C.ws - C.cs);
        topY = lerp(bodyTop(C.cs), roofY, 1 - Math.pow(1 - u, 1.7));
      } else if (t > C.re) {
        const u = (t - C.re) / (C.ce - C.re);
        topY = lerp(roofY, bodyTop(C.ce), Math.pow(u, 1.5));
      } else {
        const u = (t - C.ws) / (C.re - C.ws);
        topY = roofY - 0.02 * Math.pow(2 * u - 1, 2);
      }
      const h = Math.max(0.001, topY - base);
      const wBase = bodyHW(t) * C.inset;
      for (let r = 0; r < CR; r++) {
        const [ux, uy] = cRing[r];
        const wy = lerp(wBase, wBase * C.tumble, uy);
        cpos.push(ux * wy, base + uy * h, z);
      }
    }
    for (let k = 0; k < CST - 1; k++) {
      const tMid = lerp(C.cs, C.ce, (k + 0.5) / (CST - 1));
      for (let r = 0; r < CR - 1; r++) {
        const a = k * CR + r, b = a + 1, c = a + CR, d = c + 1;
        const uy = (cRing[r][1] + cRing[r + 1][1]) / 2;
        const ux = Math.abs((cRing[r][0] + cRing[r + 1][0]) / 2);
        const isRoof = tMid > C.ws + 0.01 && tMid < C.re - 0.005 && uy > 0.86;
        const aPillar = (tMid < C.ws + 0.01 || tMid > C.re - 0.005) && ux > 0.6 && ux < 0.97 && uy > 0.3;
        const bPillar = Math.abs(tMid - (C.ws + C.re) / 2 - 0.02) < 0.01 && ux > 0.8 && C.re - C.ws > 0.15;
        const pillar = aPillar || bPillar;
        (isRoof || pillar ? roofIdx : cidx).push(a, c, b, b, c, d);
      }
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setIndex([...cidx, ...roofIdx]);
    cgeo.addGroup(0, cidx.length, 0);
    cgeo.addGroup(cidx.length, roofIdx.length, 1);
    cgeo.computeVertexNormals();
    fixWinding(cgeo, new THREE.Vector3(0, H * 0.5, zOf((C.cs + C.ce) / 2)));
    const cab = new THREE.Mesh(cgeo, [M.glass, paint]);
    cab.castShadow = true;
    body.add(cab);
    // side mirrors
    for (const sx of [-1, 1]) {
      const t = C.cs + 0.04;
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.13), paint);
      mirror.position.set(sx * (bodyHW(t) * C.inset + 0.06), bodyTop(t) + 0.09, zOf(t));
      body.add(mirror);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.05), M.trim);
      stalk.position.set(sx * (bodyHW(t) * C.inset - 0.01), bodyTop(t) + 0.06, zOf(t));
      body.add(stalk);
    }
    if (S.scoop) {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.3), paint);
      scoop.position.set(0, H + 0.02, zOf((C.ws + C.re) / 2));
      body.add(scoop);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), M.trim);
      hood.position.set(0, bodyTop(0.2) + 0.02, zOf(0.2));
      body.add(hood);
    }
  } else if (S.windshield) {
    // roadster: windscreen, interior and roll hoops
    const ws = S.windshield;
    const t = ws.t, z = zOf(t), top = bodyTop(t);
    const w = bodyHW(t) * 0.88;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, ws.h * H * 1.1), M.glass);
    glass.material = M.glass;
    glass.position.set(0, top + ws.h * H * 0.45, z + 0.12);
    glass.rotation.x = -0.45;
    body.add(glass);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.04, 0.04, 0.04), M.chrome);
    frame.position.set(0, top + ws.h * H * 0.95, z + 0.27);
    body.add(frame);
    // interior tub
    const tub = new THREE.Mesh(new THREE.BoxGeometry(w * 1.8, 0.2, L * 0.28), M.interior);
    tub.position.set(0, top - 0.05, zOf(0.6));
    body.add(tub);
    for (const sx of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.12), M.interior);
      seat.position.set(sx * 0.32, top + 0.18, zOf(0.66));
      seat.rotation.x = 0.15;
      body.add(seat);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 18), M.trim);
    wheel.position.set(-0.32, top + 0.2, zOf(0.5));
    wheel.rotation.x = -0.4;
    body.add(wheel);
  }

  // ---------- pickup bed ----------
  if (S.bed) {
    const [b0, b1] = S.bed;
    const z0 = zOf(b0), z1 = zOf(b1);
    const top = bodyTop((b0 + b1) / 2);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, z1 - z0 - 0.1), M.trim);
    inner.position.set(0, top + 0.002, (z0 + z1) / 2);
    body.add(inner);
    // bed rails
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, z1 - z0), paint);
      rail.position.set(sx * W * 0.45, top + 0.06, (z0 + z1) / 2);
      body.add(rail);
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.12, 0.06), paint);
    gate.position.set(0, top + 0.06, z1 - 0.03);
    body.add(gate);
    // light bar + roof rack
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.12), M.trim);
    bar.position.set(0, H + 0.08, zOf(S.cabin.ws + 0.02));
    body.add(bar);
    for (let k = 0; k < 6; k++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.02), headMat);
      l.position.set(-0.5 + k * 0.2, H + 0.08, zOf(S.cabin.ws + 0.02) - 0.065);
      body.add(l);
    }
    // bull bar
    const bb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.08, 0.08), M.trim);
    bb.position.set(0, ride + 0.35, -L / 2 - 0.08);
    body.add(bb);
    const bb2 = bb.clone();
    bb2.position.y = ride + 0.65;
    body.add(bb2);
  }

  // ---------- lights / grille / plates ----------
  const lightStyle = S.lights;
  const frontT = 0.035;
  const fTop = bodyTop(frontT), fBot = bodyBottom(frontT);
  const fy = lerp(fBot, fTop, lightStyle === 'truck' ? 0.72 : 0.68);
  for (const sx of [-1, 1]) {
    const hit = findSurface(sx * bodyHW(frontT) * 0.66, fy, -1);
    if (hit) {
      let geo;
      if (lightStyle === 'round') geo = new THREE.CircleGeometry(0.095, 20);
      else if (lightStyle === 'slim') geo = new THREE.CircleGeometry(0.1, 20).scale(2.2, 0.45, 1);
      else if (lightStyle === 'truck') geo = new THREE.PlaneGeometry(0.34, 0.16);
      else geo = new THREE.CircleGeometry(0.1, 20).scale(1.7, 0.75, 1);
      decal(geo, headMat, hit, 0.006);
      decal(geo.clone().scale(1.15, 1.25, 1), M.trim, hit, 0.002);
    }
  }
  // grille
  {
    const gy = lerp(fBot, fTop, 0.32);
    const hit = findSurface(0, gy, -1);
    if (hit) {
      const gw = lightStyle === 'truck' ? W * 0.62 : W * 0.42;
      const gh = lightStyle === 'truck' ? 0.36 : 0.16;
      const g = new THREE.PlaneGeometry(gw, gh);
      decal(g, M.trim, hit, 0.006);
      const plate = makePlateTexture(car.make.toUpperCase().slice(0, 7));
      const pm = new THREE.MeshStandardMaterial({ map: plate, roughness: 0.5 });
      const ph = findSurface(0, lerp(fBot, fTop, 0.12), -1);
      if (ph) decal(new THREE.PlaneGeometry(0.42, 0.11), pm, ph, 0.012);
    }
  }
  // tail lights
  {
    const rearT = 0.975;
    const rTop = bodyTop(rearT), rBot = bodyBottom(rearT);
    const ty = lerp(rBot, rTop, 0.64);
    if (lightStyle === 'slim' || lightStyle === 'modern') {
      const hit = findSurface(0, ty, 1);
      if (hit) decal(new THREE.PlaneGeometry(W * (lightStyle === 'slim' ? 0.55 : 0.68), 0.04), tailMat, hit, 0.006);
    }
    for (const sx of [-1, 1]) {
      const hit = findSurface(sx * bodyHW(rearT) * 0.68, ty, 1);
      if (!hit) continue;
      const g = lightStyle === 'round' ? new THREE.CircleGeometry(0.1, 18) : lightStyle === 'slim' ? new THREE.PlaneGeometry(0.3, 0.07) : new THREE.PlaneGeometry(0.36, 0.13);
      decal(g, tailMat, hit, 0.008);
      if (lightStyle === 'round') {
        const h2 = findSurface(sx * bodyHW(rearT) * 0.45, ty, 1);
        if (h2) decal(new THREE.CircleGeometry(0.1, 18), tailMat, h2, 0.008);
      }
    }
    const ph = findSurface(0, lerp(rBot, rTop, lightStyle === 'slim' ? 0.5 : 0.35), 1);
    if (ph) {
      const pm = new THREE.MeshStandardMaterial({ map: makePlateTexture('HR ' + String(car.year).slice(2) + '-' + car.id.slice(0, 3).toUpperCase()), roughness: 0.5 });
      decal(new THREE.PlaneGeometry(0.42, 0.11), pm, ph, 0.012);
    }
    // diffuser
    const dif = new THREE.Mesh(new THREE.BoxGeometry(W * 0.55, 0.06, 0.18), M.carbon);
    dif.position.set(0, ride + 0.04, L / 2 - 0.15);
    body.add(dif);
  }
  // exhausts
  const exhausts = [];
  {
    const central = car.style === 'supercar' || car.style === 'hyper' || car.style === 'prototype';
    const xs = central ? [-0.12, 0.12] : car.style === 'muscle' ? [-0.55, 0.55] : [-0.4, 0.4];
    for (const x of xs) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.25, 12, 1, true).rotateX(Math.PI / 2), M.chrome);
      ex.material = M.chrome;
      const y = central ? lerp(bodyBottom(0.98), bodyTop(0.98), 0.18) : ride + 0.12;
      ex.position.set(x, y, L / 2 - 0.05);
      body.add(ex);
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), M.under);
      inner.position.set(x, y, L / 2 + 0.06);
      body.add(inner);
      exhausts.push(new THREE.Vector3(x, y, L / 2 + 0.1));
    }
  }

  // ---------- spoilers ----------
  const spoiler = opts.spoiler !== undefined ? opts.spoiler : car.spoiler;
  if (spoiler === 'wing' || spoiler === 'lmp') {
    const big = spoiler === 'lmp';
    const t = 0.93;
    const y = bodyTop(t) + (big ? 0.38 : 0.22);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * (big ? 0.95 : 0.86), 0.04, big ? 0.42 : 0.3), big ? M.carbon : paint);
    wing.position.set(0, y, zOf(t) + 0.05);
    wing.rotation.x = -0.12;
    body.add(wing);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, y - bodyTop(t) + 0.04, 0.16), M.trim);
      post.position.set(sx * W * 0.28, (y + bodyTop(t)) / 2, zOf(t) + 0.05);
      body.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, big ? 0.5 : 0.36), big ? M.carbon : paint);
      plate.position.set(sx * W * (big ? 0.475 : 0.43), y - 0.04, zOf(t) + 0.05);
      body.add(plate);
    }
  } else if (spoiler === 'ducktail') {
    const t = 0.94;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.05, 0.22), paint);
    lip.position.set(0, bodyTop(t) + 0.04, zOf(t));
    lip.rotation.x = -0.25;
    body.add(lip);
  }
  if (S.fin) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.32, L * 0.35), paint);
    fin.position.set(0, bodyTop(0.75) + 0.12, zOf(0.75));
    body.add(fin);
  }
  // splitter + side skirts
  {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.03, 0.2), M.carbon);
    sp.position.set(0, ride + 0.02, -L / 2 + 0.12);
    body.add(sp);
  }

  // underbody fill (prevents seeing through the arch cut-outs)
  {
    const ubH = Math.max(0.16, H * 0.22);
    const ub = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, innerX * 2 - 0.12), ubH, (axleR - axleF) + R * 1.2), M.under);
    ub.position.set(0, ride + 0.02 + ubH / 2, (axleF + axleR) / 2);
    body.add(ub);
    // inner arch liners
    for (const az of [axleF, axleR]) {
      for (const sx of [-1, 1]) {
        const liner = new THREE.Mesh(new THREE.CylinderGeometry(archR, archR, 0.04, 20).rotateZ(Math.PI / 2), M.under);
        liner.position.set(sx * (innerX - 0.06), R, az);
        body.add(liner);
      }
    }
  }

  mergeByMaterial(body);

  // ---------- wheels ----------
  const wheels = [];
  const tireGeo = makeTireGeometry(R, D.wheelW);
  const rimGeo = makeRimGeometry(R * 0.66, D.wheelW, car.rimStyle || (car.year < 1990 ? 'classic' : 'spokes'));
  const discGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 20).rotateZ(Math.PI / 2);
  const calGeo = new THREE.BoxGeometry(0.06, R * 0.38, R * 0.22);
  const wheelPos = [
    [-D.track / 2, axleF, true], [D.track / 2, axleF, true],
    [-D.track / 2, axleR, false], [D.track / 2, axleR, false],
  ];
  for (const [x, z, front] of wheelPos) {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, M.rubber);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const side = Math.sign(x);
    rim.scale.x = side; // face outward
    tire.castShadow = rim.castShadow = true;
    spin.add(tire, rim);
    const disc = new THREE.Mesh(discGeo, M.disc);
    disc.position.x = -side * 0.03;
    const cal = new THREE.Mesh(calGeo, caliperMat);
    cal.position.set(-side * 0.0, R * 0.32, front ? -R * 0.2 : R * 0.2);
    pivot.add(spin, disc, cal);
    root.add(pivot);
    wheels.push({ pivot, spin, front, x, z, baseY: R });
  }

  // contact shadow blob
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.25, L * 1.12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.85, color: '#000' }),
  );
  blob.position.y = 0.03;
  blob.renderOrder = 3;
  root.add(blob);

  return {
    root, body, wheels, blob,
    materials: { paint, headMat, tailMat, rimMat, caliperMat, stripeMat },
    exhausts,
    dims: D,
    axleF, axleR,
  };
}

let _blob;
function blobTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 64, 5, 32, 64, 60);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.scale(1, 2);
  ctx.fillStyle = g;
  ctx.translate(0, -32);
  ctx.fillRect(0, 0, 64, 128);
  ctx.restore();
  // rectangular soft shadow
  ctx.clearRect(0, 0, 64, 128);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.06})`;
    const p = i * 1.6;
    roundRect(ctx, 4 + p, 6 + p * 1.6, 56 - p * 2, 116 - p * 3.2, 14);
  }
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function makeTireGeometry(R, w) {
  const pts = [];
  const ri = R * 0.66;
  const hw = w / 2;
  const prof = [
    [ri, -hw * 0.92], [R * 0.86, -hw], [R * 0.97, -hw * 0.92], [R, -hw * 0.6], [R, hw * 0.6], [R * 0.97, hw * 0.92], [R * 0.86, hw], [ri, hw * 0.92],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2); // axis along X
  return g;
}

function makeRimGeometry(r, w, style) {
  const parts = [];
  const barrel = new THREE.CylinderGeometry(r, r, w * 0.84, 24, 1, true).rotateZ(Math.PI / 2).toNonIndexed();
  parts.push(barrel);
  const lip = new THREE.TorusGeometry(r * 0.98, 0.012, 6, 28).rotateY(Math.PI / 2).translate(w * 0.4, 0, 0).toNonIndexed();
  parts.push(lip);
  const face = w * 0.32;
  const hub = new THREE.CylinderGeometry(r * 0.24, r * 0.26, 0.06, 14).rotateZ(Math.PI / 2).translate(face, 0, 0).toNonIndexed();
  parts.push(hub);
  if (style === 'classic') {
    const dish = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.02, 24).rotateZ(Math.PI / 2).translate(face - 0.02, 0, 0).toNonIndexed();
    parts.push(dish);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const hole = new THREE.BoxGeometry(0.03, r * 0.16, r * 0.16).translate(face, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55).toNonIndexed();
      parts.push(hole);
    }
  } else {
    const spokes = 5;
    for (let k = 0; k < spokes * 2; k++) {
      const a = (k / (spokes * 2)) * Math.PI * 2 + (k % 2) * 0.12;
      const sp = new THREE.BoxGeometry(0.045, r * 0.82, r * 0.12);
      sp.translate(0, r * 0.5, 0);
      sp.rotateX(a);
      sp.translate(face, 0, 0);
      parts.push(sp.toNonIndexed());
    }
  }
  for (const p of parts) if (p.attributes.uv) p.deleteAttribute('uv');
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/** Ensure triangles face away from an interior point. */
function fixWinding(geo, center) {
  const p = geo.attributes.position;
  const ia = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), m = new THREE.Vector3();
  let outward = 0, inward = 0;
  for (let t = 0; t < ia.length; t += 3 * 7) {
    a.fromBufferAttribute(p, ia[t]); b.fromBufferAttribute(p, ia[t + 1]); c.fromBufferAttribute(p, ia[t + 2]);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
    if (n.dot(m) > 0) outward++; else inward++;
  }
  if (inward > outward) {
    for (let t = 0; t < ia.length; t += 3) {
      const tmp = ia[t + 1];
      ia[t + 1] = ia[t + 2];
      ia[t + 2] = tmp;
    }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
}

function fixWindingUp(geo) {
  const nrm = geo.attributes.normal;
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) {
    const ia = geo.index.array;
    for (let t = 0; t < ia.length; t += 3) {
      const tmp = ia[t + 1];
      ia[t + 1] = ia[t + 2];
      ia[t + 2] = tmp;
    }
    geo.computeVertexNormals();
  }
}

/** Wheel layout only (no meshes) for headless simulation. */
export function carLayout(car) {
  const D = car.dims;
  const axleF = -D.wheelbase / 2 - (car.axleShift || 0);
  const axleR = D.wheelbase / 2 - (car.axleShift || 0);
  const mk = (x, z, front) => ({
    x, z, front, baseY: D.wheelR,
    pivot: new THREE.Object3D(), spin: new THREE.Object3D(),
  });
  return {
    root: new THREE.Group(),
    wheels: [mk(-D.track / 2, axleF, true), mk(D.track / 2, axleF, true), mk(-D.track / 2, axleR, false), mk(D.track / 2, axleR, false)],
    axleF, axleR, dims: D, exhausts: [], materials: null, blob: null,
  };
}

export function disposeCar(model) {
  model.root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
    }
  });
}

export { STYLES, clamp };
