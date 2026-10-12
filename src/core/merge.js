import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collapse all static body meshes into one mesh per material (fewer draw calls). */
export function mergeByMaterial(group, opts = {}) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map();
  const meshes = [];
  const skip = opts.skip || new Set();
  const isSkipped = (o) => { for (let p = o; p && p !== group; p = p.parent) if (skip.has(p)) return true; return false; };
  group.traverse((o) => { if (o.isMesh && !isSkipped(o)) meshes.push(o); });
  const norm = (g) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.clearGroups();
    return geo;
  };
  for (const m of meshes) {
    const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const add = (material, geo) => {
      geo.applyMatrix4(mat);
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push(geo);
    };
    if (Array.isArray(m.material)) {
      const src = m.geometry;
      for (const grp of src.groups) {
        const sub = src.clone();
        sub.setIndex(Array.from(src.index.array.slice(grp.start, grp.start + grp.count)));
        add(m.material[grp.materialIndex], norm(sub));
      }
    } else add(m.material, norm(m.geometry));
    m.parent.remove(m);
  }
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = !!opts.receiveShadow;
    group.add(mesh);
  }
}

