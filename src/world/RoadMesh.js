import * as THREE from 'three';
import { makeRoadTexture, makeRoughnessForRoad } from './Textures.js';

const TEX_PERIOD = 16;

/** Builds road surface meshes and guard rails for the whole network. */
export function buildRoads(hf, scene, colliders) {
  const group = new THREE.Group();
  group.name = 'roads';
  const rough = makeRoughnessForRoad();
  rough.repeat.set(2, 6);
  const materials = {};
  const matFor = (r) => {
    const key = `${r.type}_${r.halfWidth}`;
    if (!materials[key]) {
      const map = makeRoadTexture(r.type, r.halfWidth);
      materials[key] = new THREE.MeshStandardMaterial({
        map,
        roughness: r.type === 'dirt' ? 1 : 0.88,
        roughnessMap: r.type === 'dirt' ? null : rough,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2 - r.style.priority,
        polygonOffsetUnits: -2 - r.style.priority,
      });
    }
    return materials[key];
  };

  for (const r of hf.roads.roads) {
    const n = r.count;
    const rows = r.closed ? n + 1 : n;
    const pos = new Float32Array(rows * 4 * 3);
    const nor = new Float32Array(rows * 4 * 3);
    const uv = new Float32Array(rows * 4 * 2);
    const hw = r.halfWidth;
    const sk = 1.5;
    const lift = 0.04 + r.style.priority * 0.006;
    const totalW = (hw + sk) * 2;
    for (let k = 0; k < rows; k++) {
      const i = k % n;
      const x = r.x[i], z = r.z[i], y = r.y[i] + lift;
      const rx = -r.tz[i], rz = r.tx[i];
      const s = k === n ? r.length : r.s[i];
      const v = s / TEX_PERIOD;
      const offs = [-(hw + sk), -hw, hw, hw + sk];
      const ys = [-0.8, 0, 0, -0.8];
      for (let c = 0; c < 4; c++) {
        const o = (k * 4 + c) * 3;
        pos[o] = x + rx * offs[c];
        pos[o + 1] = y + ys[c];
        pos[o + 2] = z + rz * offs[c];
        nor[o] = 0; nor[o + 1] = 1; nor[o + 2] = 0;
        uv[(k * 4 + c) * 2] = (offs[c] + hw + sk) / totalW;
        uv[(k * 4 + c) * 2 + 1] = v;
      }
    }
    const idx = [];
    for (let k = 0; k < rows - 1; k++) {
      for (let c = 0; c < 3; c++) {
        const a = k * 4 + c, b = a + 1, d = a + 4, e = d + 1;
        // forward along +tangent, right = (-tz, tx); ensure upward facing
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // flip if facing down
    const nrm = g.attributes.normal;
    if (nrm.getY(4 * Math.min(2, rows - 1) + 1) < 0) {
      const ia = g.index.array;
      for (let t = 0; t < ia.length; t += 3) {
        const tmp = ia[t + 1];
        ia[t + 1] = ia[t + 2];
        ia[t + 2] = tmp;
      }
      g.computeVertexNormals();
    }
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, matFor(r));
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = `road_${r.id}`;
    group.add(mesh);
  }

  // Guard rails where the ground falls away or on tight mountain bends
  const railGeo = buildRails(hf, colliders);
  if (railGeo) {
    const mat = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.7, roughness: 0.35 });
    const mesh = new THREE.Mesh(railGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  return { group, materials };
}

export function buildRails(hf, colliders) {
  const positions = [];
  const normals = [];
  const push = (p, n) => {
    positions.push(p.x, p.y, p.z);
    normals.push(n.x, n.y, n.z);
  };
  const quad = (a, b, c, d, n) => {
    push(a, n); push(b, n); push(c, n);
    push(a, n); push(c, n); push(d, n);
  };
  const box = (cx, cy, cz, sx, sy, sz) => {
    const x0 = cx - sx, x1 = cx + sx, y0 = cy - sy, y1 = cy + sy, z0 = cz - sz, z1 = cz + sz;
    const V = THREE.Vector3;
    quad(new V(x0, y0, z1), new V(x1, y0, z1), new V(x1, y1, z1), new V(x0, y1, z1), new V(0, 0, 1));
    quad(new V(x1, y0, z0), new V(x0, y0, z0), new V(x0, y1, z0), new V(x1, y1, z0), new V(0, 0, -1));
    quad(new V(x0, y0, z0), new V(x0, y0, z1), new V(x0, y1, z1), new V(x0, y1, z0), new V(-1, 0, 0));
    quad(new V(x1, y0, z1), new V(x1, y0, z0), new V(x1, y1, z0), new V(x1, y1, z1), new V(1, 0, 0));
    quad(new V(x0, y1, z1), new V(x1, y1, z1), new V(x1, y1, z0), new V(x0, y1, z0), new V(0, 1, 0));
  };
  for (const r of hf.roads.roads) {
    if (r.type === 'street' || r.type === 'runway') continue;
    const n = r.count;
    for (const side of [-1, 1]) {
      const want = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const rx = -r.tz[i] * side, rz = r.tx[i] * side;
        const off = r.halfWidth + 6;
        const nat = hf.terrainHeight(r.x[i] + rx * off, r.z[i] + rz * off);
        const drop = r.y[i] - nat;
        const outer = r.curv[i] * side < -1 / 90; // outside of a tight bend
        if (drop > 3.5 || (r.def.rails && outer) || (r.def.rails && drop > 1.5)) want[i] = 1;
      }
      // dilate and remove near junctions
      const keep = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (!want[i]) continue;
        for (let k = -8; k <= 8; k++) {
          const j = r.closed ? (i + k + n) % n : i + k;
          if (j >= 0 && j < n) keep[j] = 1;
        }
      }
      for (const jn of hf.roads.junctions) {
        if (jn.a !== r && jn.b !== r) continue;
        const ji = jn.a === r ? jn.ia : jn.ib;
        for (let k = -18; k <= 18; k++) {
          const j = r.closed ? (ji + k + n) % n : ji + k;
          if (j >= 0 && j < n) keep[j] = 0;
        }
      }
      const off = r.halfWidth + 0.6;
      let segStart = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && keep[i];
        if (on && segStart < 0) segStart = i;
        if ((!on || i === n) && segStart >= 0) {
          const end = i - 1;
          if (end - segStart >= 3) {
            for (let k = segStart; k < end; k++) {
              const a = k, b = k + 1;
              const ax = r.x[a] + -r.tz[a] * side * off, az = r.z[a] + r.tx[a] * side * off;
              const bx = r.x[b] + -r.tz[b] * side * off, bz = r.z[b] + r.tx[b] * side * off;
              const ay = r.y[a], by = r.y[b];
              // beam: a thin vertical strip both sides
              const nx = -r.tz[a] * side, nz = r.tx[a] * side;
              const t0 = 0.45, t1 = 0.8;
              const V = THREE.Vector3;
              quad(new V(ax, ay + t0, az), new V(bx, by + t0, bz), new V(bx, by + t1, bz), new V(ax, ay + t1, az), new V(-nx, 0, -nz));
              quad(new V(bx, by + t0, bz), new V(ax, ay + t0, az), new V(ax, ay + t1, az), new V(bx, by + t1, bz), new V(nx, 0, nz));
              if (k % 2 === 0) box(ax + nx * 0.08, ay + 0.3, az + nz * 0.08, 0.07, 0.5, 0.07);
              if ((k - segStart) % 3 === 0) {
                const e = Math.min(end, k + 3);
                const ex = r.x[e] + -r.tz[e] * side * off, ez = r.z[e] + r.tx[e] * side * off;
                colliders.addSegment(ax, az, ex, ez, 0.4, Math.min(ay, r.y[e]) - 1, Math.max(ay, r.y[e]) + 0.9, { rail: true });
              }
            }
          }
          segStart = -1;
        }
      }
    }
  }
  if (!positions.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  return g;
}
