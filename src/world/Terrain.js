import * as THREE from 'three';
import { SURF } from './Heightfield.js';
import { makeTerrainDetail } from './Textures.js';
import { Simplex2, clamp, lerp } from '../core/utils.js';

const CHUNK = 128; // cells per chunk side
const LOD_STEPS = [1, 2, 4, 8];
const LOD_DIST = [380, 1000, 1900];

const SEASON_PALETTES = {
  summer: {
    grass: [0.30, 0.46, 0.17], grass2: [0.42, 0.52, 0.2], forest: [0.2, 0.34, 0.12],
    field1: [0.82, 0.68, 0.32], field2: [0.5, 0.58, 0.22], sand: [0.86, 0.78, 0.58],
    rock: [0.46, 0.44, 0.42], snow: [0.94, 0.95, 0.98], dirt: [0.5, 0.38, 0.25], concrete: [0.58, 0.58, 0.6],
  },
  autumn: {
    grass: [0.46, 0.44, 0.18], grass2: [0.58, 0.45, 0.2], forest: [0.4, 0.3, 0.14],
    field1: [0.72, 0.52, 0.25], field2: [0.55, 0.42, 0.2], sand: [0.84, 0.76, 0.56],
    rock: [0.46, 0.43, 0.4], snow: [0.94, 0.95, 0.98], dirt: [0.45, 0.33, 0.22], concrete: [0.58, 0.58, 0.6],
  },
  winter: {
    grass: [0.9, 0.92, 0.96], grass2: [0.84, 0.87, 0.93], forest: [0.82, 0.85, 0.9],
    field1: [0.92, 0.93, 0.97], field2: [0.86, 0.88, 0.93], sand: [0.82, 0.8, 0.74],
    rock: [0.52, 0.52, 0.55], snow: [0.97, 0.98, 1.0], dirt: [0.62, 0.6, 0.6], concrete: [0.68, 0.69, 0.72],
  },
  spring: {
    grass: [0.33, 0.55, 0.2], grass2: [0.45, 0.62, 0.25], forest: [0.22, 0.42, 0.16],
    field1: [0.6, 0.66, 0.3], field2: [0.38, 0.6, 0.22], sand: [0.86, 0.78, 0.58],
    rock: [0.46, 0.44, 0.42], snow: [0.94, 0.95, 0.98], dirt: [0.48, 0.36, 0.24], concrete: [0.58, 0.58, 0.6],
  },
};

export class Terrain {
  constructor(hf, scene) {
    this.hf = hf;
    this.scene = scene;
    this.noise = new Simplex2(4242);
    this.chunksPerSide = hf.N / CHUNK;
    this.colors = new Uint8Array(hf.V * hf.V * 3);
    this.normals = new Int8Array(hf.V * hf.V * 3);
    this._computeNormals();
    this.season = 'summer';
    this._computeColors();
    this.detail = makeTerrainDetail();
    this.detail.repeat.set(1, 1);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.detail,
      roughness: 0.96,
      metalness: 0,
    });
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.chunks = [];
    for (let cz = 0; cz < this.chunksPerSide; cz++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        const mesh = new THREE.Mesh(undefined, this.material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        const chunk = {
          cx, cz, mesh, lod: -1, geos: [],
          center: new THREE.Vector3((cx + 0.5) * CHUNK * hf.cell - hf.half, 0, (cz + 0.5) * CHUNK * hf.cell - hf.half),
        };
        // approximate height range for culling
        let minY = Infinity, maxY = -Infinity;
        for (let j = 0; j <= CHUNK; j += 8) for (let i = 0; i <= CHUNK; i += 8) {
          const h = hf.heights[(cz * CHUNK + j) * hf.V + cx * CHUNK + i];
          minY = Math.min(minY, h); maxY = Math.max(maxY, h);
        }
        chunk.center.y = (minY + maxY) / 2;
        chunk.minY = minY;
        chunk.maxY = maxY;
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
  }

  _computeNormals() {
    const hf = this.hf, V = hf.V, c = hf.cell;
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(V - 1, i + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(V - 1, j + 1);
        const dx = (hf.heights[j * V + i1] - hf.heights[j * V + i0]) / ((i1 - i0) * c);
        const dz = (hf.heights[j1 * V + i] - hf.heights[j0 * V + i]) / ((j1 - j0) * c);
        const l = Math.hypot(dx, 1, dz);
        const k = (j * V + i) * 3;
        this.normals[k] = (-dx / l) * 127;
        this.normals[k + 1] = (1 / l) * 127;
        this.normals[k + 2] = (-dz / l) * 127;
      }
    }
  }

  _computeColors() {
    const hf = this.hf, V = hf.V, c = hf.cell;
    const P = SEASON_PALETTES[this.season];
    const n = this.noise;
    const col = [0, 0, 0];
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const idx = j * V + i;
        const x = i * c - hf.half, z = j * c - hf.half;
        const s = hf.surface[idx];
        const h = hf.heights[idx];
        const v1 = n.noise(x / 140, z / 140) * 0.5 + 0.5;
        const v2 = n.noise(x / 31, z / 31) * 0.5 + 0.5;
        let base;
        switch (s) {
          case SURF.SAND: base = P.sand; break;
          case SURF.ROCK: base = P.rock; break;
          case SURF.SNOW: base = P.snow; break;
          case SURF.DIRT: base = P.dirt; break;
          case SURF.CONCRETE: base = P.concrete; break;
          case SURF.FIELD: {
            // patchwork of field strips
            const a = Math.floor((x * 0.8 + z * 0.6) / 70 + n.noise(x / 400, z / 400) * 2);
            const t = (Math.sin(a * 12.9898) * 43758.5453) % 1;
            base = Math.abs(t) > 0.5 ? P.field1 : P.field2;
            const stripe = Math.sin((x * 0.6 - z * 0.8) * 1.1) > 0.2 ? 0.94 : 1.0;
            col[0] = base[0] * stripe; col[1] = base[1] * stripe; col[2] = base[2] * stripe;
            base = col.slice();
            break;
          }
          default: {
            const f = clamp(v1 * 1.2 - 0.1, 0, 1);
            base = [lerp(P.grass[0], P.grass2[0], f), lerp(P.grass[1], P.grass2[1], f), lerp(P.grass[2], P.grass2[2], f)];
            // darker under forests / at higher altitude
            const alt = clamp((h - 60) / 120, 0, 1);
            base = [lerp(base[0], P.forest[0], alt * 0.7), lerp(base[1], P.forest[1], alt * 0.7), lerp(base[2], P.forest[2], alt * 0.7)];
          }
        }
        // underwater darkening
        let k = 0.88 + v2 * 0.2;
        if (h < 0) k *= clamp(1 + h / 30, 0.45, 1);
        // wet sand near shoreline
        if (h < 1.2 && h > -2 && s === SURF.SAND) k *= 0.82;
        const o = idx * 3;
        this.colors[o] = clamp(base[0] * k, 0, 1) * 255;
        this.colors[o + 1] = clamp(base[1] * k, 0, 1) * 255;
        this.colors[o + 2] = clamp(base[2] * k, 0, 1) * 255;
      }
    }
  }

  setSeason(season) {
    if (season === this.season || !SEASON_PALETTES[season]) return;
    this.season = season;
    this._computeColors();
    for (const ch of this.chunks) {
      for (const g of ch.geos) if (g) g.dispose();
      ch.geos = [];
      ch.lod = -1;
    }
  }

  _buildGeometry(cx, cz, lod) {
    const hf = this.hf, V = hf.V, cell = hf.cell;
    const step = LOD_STEPS[lod];
    const n = CHUNK / step; // quads per side
    const vs = n + 1;
    const skirt = vs * 4;
    const count = vs * vs + skirt;
    const pos = new Float32Array(count * 3);
    const nor = new Int8Array(count * 3);
    const col = new Uint8Array(count * 3);
    const uv = new Float32Array(count * 2);
    const i0 = cx * CHUNK, j0 = cz * CHUNK;
    let p = 0;
    const put = (gi, gj, drop) => {
      const idx = gj * V + gi;
      const x = gi * cell - hf.half, z = gj * cell - hf.half;
      pos[p * 3] = x;
      pos[p * 3 + 1] = hf.heights[idx] - drop;
      pos[p * 3 + 2] = z;
      nor[p * 3] = this.normals[idx * 3];
      nor[p * 3 + 1] = this.normals[idx * 3 + 1];
      nor[p * 3 + 2] = this.normals[idx * 3 + 2];
      col[p * 3] = this.colors[idx * 3];
      col[p * 3 + 1] = this.colors[idx * 3 + 1];
      col[p * 3 + 2] = this.colors[idx * 3 + 2];
      uv[p * 2] = x / 14;
      uv[p * 2 + 1] = z / 14;
      p++;
    };
    for (let j = 0; j < vs; j++) for (let i = 0; i < vs; i++) put(i0 + i * step, j0 + j * step, 0);
    const indices = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * vs + i, b = a + 1, c = a + vs, d = c + 1;
        // v00=a, v10=b, v01=c, v11=d : (v00,v01,v10), (v10,v01,v11)
        indices.push(a, c, b, b, c, d);
      }
    }
    // skirts
    const drop = 6 * step;
    const edge = (list) => {
      const start = p;
      for (const [gi, gj] of list) put(gi, gj, drop);
      for (let k = 0; k < list.length - 1; k++) {
        const top0 = list[k][2], top1 = list[k + 1][2];
        const b0 = start + k, b1 = start + k + 1;
        // both windings: skirts only fill LOD cracks so facing does not matter
        indices.push(top0, b0, top1, top1, b0, b1);
        indices.push(top0, top1, b0, top1, b1, b0);
      }
    };
    const north = [], south = [], west = [], east = [];
    for (let i = 0; i < vs; i++) {
      north.push([i0 + i * step, j0, i]);
      south.push([i0 + i * step, j0 + CHUNK, n * vs + i]);
      west.push([i0, j0 + i * step, i * vs]);
      east.push([i0 + CHUNK, j0 + i * step, i * vs + n]);
    }
    edge(north);
    edge(south);
    edge(west);
    edge(east);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, p * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, p * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, p * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, p * 2), 2));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  update(camPos, budget = 6) {
    let built = 0;
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.center.x - camPos.x, ch.center.z - camPos.z) - CHUNK * this.hf.cell * 0.5;
      let lod = 3;
      for (let k = 0; k < LOD_DIST.length; k++) if (d < LOD_DIST[k]) { lod = k; break; }
      if (lod !== ch.lod) {
        if (!ch.geos[lod]) {
          if (built >= budget && ch.lod >= 0) continue;
          ch.geos[lod] = this._buildGeometry(ch.cx, ch.cz, lod);
          built++;
        }
        ch.mesh.geometry = ch.geos[lod];
        ch.lod = lod;
      }
    }
  }

  /** Builds every chunk at the coarsest LOD (used during loading). */
  prewarm(camPos) {
    this.update(camPos, 1e9);
  }

  /** 2D colour image of the island for the map / minimap. */
  makeMapImage(size = 1024) {
    const hf = this.hf;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const V = hf.V;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gi = Math.floor((x / size) * (V - 1));
        const gj = Math.floor((y / size) * (V - 1));
        const idx = gj * V + gi;
        const h = hf.heights[idx];
        const o = (y * size + x) * 4;
        if (h < 0.3) {
          const depth = clamp(-h / 25, 0, 1);
          d[o] = lerp(70, 18, depth);
          d[o + 1] = lerp(150, 60, depth);
          d[o + 2] = lerp(190, 110, depth);
        } else {
          // hillshade
          const nx = this.normals[idx * 3] / 127, nz = this.normals[idx * 3 + 2] / 127;
          const shade = clamp(0.85 + (-nx * 0.6 - nz * 0.6) * 0.9, 0.5, 1.25);
          d[o] = clamp(this.colors[idx * 3] * shade, 0, 255);
          d[o + 1] = clamp(this.colors[idx * 3 + 1] * shade, 0, 255);
          d[o + 2] = clamp(this.colors[idx * 3 + 2] * shade, 0, 255);
        }
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
