import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, Simplex2, smoothstep } from '../core/utils.js';
import { POI, WORLD, BARNS } from './WorldConfig.js';
import { SURF } from './Heightfield.js';
import { makeFacade, makeBannerTexture, makeWaterNormal } from './Textures.js';
import { mergeByMaterial } from '../core/merge.js';

/** Places vegetation, buildings, landmarks, water and collectibles. */
export class Scenery {
  constructor(hf, scene, colliders, props) {
    this.hf = hf;
    this.scene = scene;
    this.colliders = colliders;
    this.props = props;
    this.noise = new Simplex2(999);
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);
    this.animated = [];
    this.xpBoards = [];
    this.nightMats = [];
  }

  build() {
    this._water();
    this._vegetation();
    this._roadside();
    this._town();
    this._houses();
    this._festival();
    this._turbines();
    this._lighthouse();
    this._airfield();
    this._xpBoards();
    this._ramps();
    this._barns();
    this.props.build();
  }

  _water() {
    const normal = makeWaterNormal();
    normal.repeat.set(220, 220);
    const geo = new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3, 1, 1).rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: '#1d6a8a',
      roughness: 0.08,
      metalness: 0.1,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.86,
    });
    const water = new THREE.Mesh(geo, this.waterMat);
    water.position.y = WORLD.seaLevel;
    water.receiveShadow = true;
    water.renderOrder = 2;
    this.water = water;
    this.scene.add(water);
    this.animated.push((t) => {
      normal.offset.set(t * 0.004, t * 0.0025);
    });
  }

  _okForProp(x, z, minRoad = 6) {
    const hf = this.hf;
    const gi = Math.round((x + hf.half) / hf.cell), gj = Math.round((z + hf.half) / hf.cell);
    if (gi < 1 || gj < 1 || gi >= hf.N || gj >= hf.N) return false;
    const idx = gj * hf.V + gi;
    if (hf.roadDist[idx] < minRoad) return false;
    if (hf.heights[idx] < 1.5) return false;
    return true;
  }

  _vegetation() {
    const hf = this.hf;
    const r = rng(2024);
    const n = this.noise;
    const step = 9;
    for (let z = -hf.half + 20; z < hf.half - 20; z += step) {
      for (let x = -hf.half + 20; x < hf.half - 20; x += step) {
        const jx = x + (r() - 0.5) * step * 0.9, jz = z + (r() - 0.5) * step * 0.9;
        if (!this._okForProp(jx, jz, 5)) continue;
        const gi = Math.round((jx + hf.half) / hf.cell), gj = Math.round((jz + hf.half) / hf.cell);
        const idx = gj * hf.V + gi;
        const s = hf.surface[idx];
        const h = hf.heights[idx];
        if (s === SURF.CONCRETE || s === SURF.SNOW || s === SURF.DIRT) continue;
        if (Math.hypot(jx - POI.town.x, jz - POI.town.z) < POI.town.r - 30) continue;
        if (Math.hypot(jx - POI.festival.x, jz - POI.festival.z) < POI.festival.r + 10) continue;
        if (jx > POI.airstrip.x0 - 60 && jx < POI.airstrip.x1 + 60 && Math.abs(jz - POI.airstrip.z) < 70) continue;
        const slope = hf.slopeAt(gi, gj);
        // density field
        const forestD = smoothstep(POI.forest.r + 200, POI.forest.r - 200, Math.hypot(jx - POI.forest.x, jz - POI.forest.z));
        const mountD = smoothstep(POI.mountain.r, 300, Math.hypot(jx - POI.mountain.x, jz - POI.mountain.z));
        let dens = n.fbm(jx / 380, jz / 380, 3) * 0.5 + 0.3;
        dens += forestD * 0.75 + mountD * 0.25;
        if (s === SURF.FIELD) dens *= 0.05;
        if (s === SURF.SAND) dens = 0.25;
        if (h > 160) dens *= 0.3;
        if (slope > 0.9) dens *= 0.3;
        if (r() > dens * 0.36) continue;
        let type;
        if (s === SURF.SAND) {
          if (h > 4) continue;
          type = r() < 0.6 ? 'palm' : null;
          if (!type) continue;
        } else if (h > 70 || forestD > 0.4) type = r() < 0.8 ? 'pine' : 'broadleaf';
        else type = r() < 0.3 ? 'pine' : 'broadleaf';
        if (s === SURF.ROCK) type = r() < 0.6 ? 'rock' : 'pine';
        const sc = type === 'rock' ? 0.6 + r() * 1.4 : 0.8 + r() * 0.6;
        const tint = new THREE.Color().setHSL(0.25 + (r() - 0.5) * 0.06, 0.4, 0.45 + r() * 0.12);
        const color = type === 'rock' ? null : `#${tint.clone().multiplyScalar(2.0).getHexString()}`;
        this.props.add(type, jx, jz, r() * Math.PI * 2, sc, type === 'rock' ? null : color);
        if (r() < 0.25 && type !== 'palm') {
          const bx = jx + (r() - 0.5) * 6, bz = jz + (r() - 0.5) * 6;
          if (this._okForProp(bx, bz, 3)) this.props.add('bush', bx, bz, r() * 6, 0.6 + r() * 0.8);
        }
      }
    }
    // scattered rocks in mountains
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * POI.mountain.r;
      const x = POI.mountain.x + Math.cos(a) * d, z = POI.mountain.z + Math.sin(a) * d;
      if (!this._okForProp(x, z, 8)) continue;
      this.props.add('rock', x, z, r() * 6, 0.6 + r() * 2.2);
    }
    // hay bales in fields
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (POI.fields.r - 80);
      const x = POI.fields.x + Math.cos(a) * d, z = POI.fields.z + Math.sin(a) * d;
      if (!this._okForProp(x, z, 10)) continue;
      const idx = Math.round((z + hf.half) / hf.cell) * hf.V + Math.round((x + hf.half) / hf.cell);
      if (hf.surface[idx] !== SURF.FIELD) continue;
      this.props.add('hay', x, z, r() * 6, 1);
    }
  }

  _roadside() {
    const hf = this.hf;
    const r = rng(77);
    for (const road of hf.roads.roads) {
      const n = road.count;
      // chevron signs on tight bends
      if (road.type !== 'street' && road.type !== 'runway') {
        let last = -100;
        for (let i = 0; i < n; i++) {
          const k = road.curv[i];
          if (Math.abs(k) > 1 / 70 && i - last > 12) {
            const side = k > 0 ? -1 : 1; // outside of curve
            const off = road.halfWidth + 2.2;
            const rx = -road.tz[i] * side, rz = road.tx[i] * side;
            const x = road.x[i] + rx * off, z = road.z[i] + rz * off;
            if (!this._nearJunction(road, i, 25)) {
              const ang = Math.atan2(road.tx[i], road.tz[i]);
              this.props.add('sign', x, z, ang + (side > 0 ? Math.PI : 0) + Math.PI, 1, null, road.y[i]);
              last = i;
            }
          }
        }
      }
      // lamp posts on urban roads
      const urban = (x, z) => Math.hypot(x - POI.town.x, z - POI.town.z) < POI.town.r + 60 ||
        Math.hypot(x - POI.festival.x, z - POI.festival.z) < POI.festival.r + 300;
      if (road.type === 'street' || road.type === 'road') {
        for (let i = 0; i < n; i += 15) {
          if (!urban(road.x[i], road.z[i])) continue;
          if (this._nearJunction(road, i, 14)) continue;
          for (const side of [-1, 1]) {
            if ((i / 15 + (side > 0 ? 1 : 0)) % 2) continue;
            const off = road.halfWidth + 1.4;
            const rx = -road.tz[i] * side, rz = road.tx[i] * side;
            const x = road.x[i] + rx * off, z = road.z[i] + rz * off;
            // arm points toward the road: arm is +x in local space
            const ang = Math.atan2(rz, -rx) + Math.PI;
            this.props.add('lamp', x, z, ang, 1, null, road.y[i] - 0.1);
          }
        }
      }
      // white fences along country roads in fields
      if (road.type === 'road' || road.type === 'dirt') {
        for (let i = 0; i < n; i += 2) {
          const x0 = road.x[i], z0 = road.z[i];
          const fd = Math.hypot(x0 - POI.fields.x, z0 - POI.fields.z);
          if (fd > POI.fields.r - 40) continue;
          if (this._nearJunction(road, i, 16)) continue;
          for (const side of [-1, 1]) {
            const off = road.halfWidth + 4.5;
            const rx = -road.tz[i] * side, rz = road.tx[i] * side;
            const x = x0 + rx * off, z = z0 + rz * off;
            const ang = -Math.atan2(road.tz[i], road.tx[i]);
            if (i % 2 === 0) this.props.add('fence', x, z, ang, 1, null);
          }
        }
      }
    }
    void r;
  }

  _nearJunction(road, i, dist) {
    for (const j of this.hf.roads.junctions) {
      if (j.a !== road && j.b !== road) continue;
      const ji = j.a === road ? j.ia : j.ib;
      let d = Math.abs(road.s[ji] - road.s[i]);
      if (road.closed) d = Math.min(d, road.length - d);
      if (d < dist) return true;
    }
    if (!road.closed && (road.s[i] < dist || road.length - road.s[i] < dist)) return true;
    return false;
  }

  _town() {
    const hf = this.hf;
    const r = rng(31);
    const facades = [0, 1, 2, 3].map((k) => makeFacade(100 + k, k));
    const buckets = facades.map(() => []);
    const roofs = [];
    const place = (x, z, w, d, h, ang) => {
      // keep clear of roads
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]];
      const c = Math.cos(ang), s = Math.sin(ang);
      for (const [lx, lz] of corners) {
        const px = x + lx * c - lz * s, pz = z + lx * s + lz * c;
        const near = hf.roads.nearest(px, pz, 30);
        if (near && near.dist < near.road.halfWidth + 3.5) return false;
      }
      const y = hf.terrainHeight(x, z) - 0.5;
      const k = r.int(0, facades.length - 1);
      const g = new THREE.BoxGeometry(w, h, d);
      // scale UVs so windows tile at a fixed size (12m x 25.6m per texture)
      const uv = g.attributes.uv;
      const p = g.attributes.position;
      const nrm = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
        const across = nx > 0.5 ? p.getZ(i) + d / 2 : p.getX(i) + w / 2;
        const up = p.getY(i) + h / 2;
        if (ny > 0.5) uv.setXY(i, 0, 0);
        else uv.setXY(i, across / 12, up / 25.6);
      }
      g.rotateY(-ang);
      g.translate(x, y + h / 2, z);
      buckets[k].push(g);
      const roof = new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4).rotateY(-ang).translate(x, y + h + 0.25, z);
      roofs.push(roof);
      if (r() < 0.5) {
        const ac = new THREE.BoxGeometry(2, 1.2, 1.5).rotateY(-ang).translate(x + (r() - 0.5) * w * 0.5, y + h + 1, z + (r() - 0.5) * d * 0.5);
        roofs.push(ac);
      }
      this.colliders.addBox(x, z, w / 2, d / 2, ang, y, y + h, { building: true });
      return true;
    };
    // blocks between the town grid streets
    const xs = [650, 800, 950], zs = [300, 450, 600];
    for (let bx = 0; bx < 4; bx++) {
      for (let bz = 0; bz < 4; bz++) {
        const x0 = bx === 0 ? 520 : xs[bx - 1], x1 = bx === 3 ? 1080 : xs[bx];
        const z0 = bz === 0 ? 170 : zs[bz - 1], z1 = bz === 3 ? 730 : zs[bz];
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const centreDist = Math.hypot(cx - POI.town.x, cz - POI.town.z);
        const tall = 1 - smoothstep(0, 420, centreDist);
        // ring of buildings around block edge
        for (let k = 0; k < 10; k++) {
          const w = 14 + r() * 14, d = 14 + r() * 12;
          const h = 8 + r() * 14 + tall * r() * 50;
          const x = x0 + 16 + r() * (x1 - x0 - 32);
          const z = z0 + 16 + r() * (z1 - z0 - 32);
          place(x, z, w, d, h, 0);
        }
      }
    }
    facades.forEach((f, k) => {
      if (!buckets[k].length) return;
      const g = mergeGeometries(buckets[k]);
      const mat = new THREE.MeshStandardMaterial({
        map: f.map, emissiveMap: f.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.75,
      });
      this.nightMats.push({ mat, max: 1.2 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
    if (roofs.length) {
      const mesh = new THREE.Mesh(mergeGeometries(roofs.map((g) => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: '#6c6f74', roughness: 0.9 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // marina pier into the sea is skipped (town is inland); add a plaza fountain
    const fountain = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 0.8, 24), new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 0.8 }));
    const water = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.1, 24), new THREE.MeshStandardMaterial({ color: '#4aa3c7', roughness: 0.1, metalness: 0.2 }));
    water.position.y = 0.35;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3, 12), basin.material);
    col.position.y = 1.5;
    fountain.add(basin, water, col);
    const fy = hf.heightAt(875, 525);
    fountain.position.set(875, fy, 525);
    this.group.add(fountain);
    this.colliders.addCircle(875, 525, 6.5, fy - 1, fy + 3);
  }

  _houses() {
    const hf = this.hf;
    const r = rng(55);
    const walls = [], roofs = [];
    const wallColors = ['#efe6d2', '#d9e3e8', '#f2d7c4', '#e3e0c8', '#cfd8c4', '#f5f1ea'];
    const roofColors = ['#8c3b2f', '#4a4f57', '#6b4a33', '#3e5a6e'];
    let count = 0;
    const tryHouse = (x, z, ang) => {
      if (!this._okForProp(x, z, 10)) return;
      const near = hf.roads.nearest(x, z, 26);
      if (!near || near.dist < near.road.halfWidth + 8) return;
      const w = 8 + r() * 5, d = 7 + r() * 4, h = 3.2 + r() * 2.6;
      const y = hf.terrainHeight(x, z) - 0.3;
      // skip steep ground
      const y2 = hf.terrainHeight(x + w / 2, z + d / 2);
      if (Math.abs(y2 - y) > 2.5) return;
      const wc = new THREE.Color(r.pick(wallColors));
      const rc = new THREE.Color(r.pick(roofColors));
      const wall = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      paint(wall, wc);
      // windows darkened stripes via extra boxes
      const win = [];
      for (let k = -1; k <= 1; k += 2) {
        const wg = new THREE.BoxGeometry(1.4, 1.2, d + 0.06).translate(k * w * 0.25, 0.2, 0).toNonIndexed();
        paint(wg, new THREE.Color('#2b3a48'));
        win.push(wg);
      }
      const door = new THREE.BoxGeometry(1.1, 2.1, d + 0.08).translate(0, -h / 2 + 1.05, 0).toNonIndexed();
      paint(door, new THREE.Color('#5a3b28'));
      const roofShape = new THREE.Shape();
      roofShape.moveTo(-w / 2 - 0.5, 0);
      roofShape.lineTo(w / 2 + 0.5, 0);
      roofShape.lineTo(0, 2.6);
      roofShape.lineTo(-w / 2 - 0.5, 0);
      const roof = new THREE.ExtrudeGeometry(roofShape, { depth: d + 1, bevelEnabled: false }).translate(0, h / 2, -(d + 1) / 2).toNonIndexed();
      roof.deleteAttribute('uv');
      paint(roof, rc);
      const all = [wall, ...win, door].map((g) => { g.deleteAttribute('uv'); return g; });
      const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(x, y + h / 2, z);
      for (const g of all) { g.applyMatrix4(m); walls.push(g); }
      roof.applyMatrix4(m);
      roofs.push(roof);
      this.colliders.addBox(x, z, w / 2 + 0.3, d / 2 + 0.3, ang, y, y + h + 2.6, { building: true });
      count++;
    };
    // houses along country roads
    for (const road of hf.roads.roads) {
      if (road.type !== 'road') continue;
      for (let i = 0; i < road.count; i += 40) {
        if (r() < 0.55) continue;
        const side = r() < 0.5 ? -1 : 1;
        const off = road.halfWidth + 16 + r() * 10;
        const rx = -road.tz[i] * side, rz = road.tx[i] * side;
        const x = road.x[i] + rx * off, z = road.z[i] + rz * off;
        const ang = Math.atan2(road.tz[i], road.tx[i]);
        tryHouse(x, z, -ang);
      }
    }
    // suburbs around town
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = POI.town.r + 20 + r() * 220;
      tryHouse(POI.town.x + Math.cos(a) * d, POI.town.z + Math.sin(a) * d, r() * Math.PI);
    }
    if (walls.length) {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      const mesh = new THREE.Mesh(mergeGeometries(walls), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const rmesh = new THREE.Mesh(mergeGeometries(roofs), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
      rmesh.castShadow = true;
      this.group.add(rmesh);
    }
    this.houseCount = count;
  }

  _festival() {
    const hf = this.hf;
    const f = POI.festival;
    const y = hf.heightAt(f.x, f.z);
    const g = new THREE.Group();
    g.position.set(f.x, y, f.z);
    const pink = new THREE.MeshStandardMaterial({ color: '#ff2d87', roughness: 0.4, metalness: 0.2, emissive: '#ff2d87', emissiveIntensity: 0.15 });
    const cyan = new THREE.MeshStandardMaterial({ color: '#19d3ff', roughness: 0.4, metalness: 0.2, emissive: '#19d3ff', emissiveIntensity: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.4, metalness: 0.8 });
    this.nightMats.push({ mat: pink, max: 1.6, base: 0.15 }, { mat: cyan, max: 1.6, base: 0.15 });

    // main stage
    const stage = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 22), steel);
    deck.position.y = 1;
    stage.add(deck);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(50, 1.4, 26), white);
    roof.position.y = 18;
    stage.add(roof);
    for (const sx of [-23, 23]) for (const sz of [-11, 11]) {
      const truss = new THREE.Mesh(new THREE.BoxGeometry(1.2, 17, 1.2), steel);
      truss.position.set(sx, 9.5, sz);
      stage.add(truss);
    }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshBasicMaterial({ map: makeBannerTexture('HORIZON RUSH', '#ff2d87', '#fff', 1024, 340) }));
    screen.position.set(0, 10, -10.8);
    stage.add(screen);
    stage.position.set(0, 0, -90);
    g.add(stage);
    this.colliders.addBox(f.x, f.z - 90, 25, 13, 0, y, y + 20, { building: true });

    // arches with banners at the entrance
    const bannerTex = makeBannerTexture('HORIZON RUSH FESTIVAL', '#ff2d87');
    for (let k = 0; k < 3; k++) {
      const arch = new THREE.Group();
      const legL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 1.4), k % 2 ? cyan : pink);
      legL.position.set(-16, 6, 0);
      const legR = legL.clone();
      legR.position.x = 16;
      const top = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 1.4), k % 2 ? cyan : pink);
      top.position.y = 12.5;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(30, 2.6), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
      banner.position.set(0, 12.5, 0.75);
      arch.add(legL, legR, top, banner);
      arch.position.set(110 + k * 0, 0, -10 + k * 26);
      arch.rotation.y = Math.PI / 2;
      g.add(arch);
    }
    // tents
    const tentMat = [pink, cyan, white];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 1.4 + Math.PI * 0.8;
      const tx = Math.cos(a) * 120, tz = Math.sin(a) * 120 - 10;
      const tent = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 4, 10, 1, true), white);
      base.position.y = 2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(8, 6, 10), tentMat[k % 3]);
      top.position.y = 7;
      tent.add(base, top);
      tent.position.set(tx, 0, tz);
      g.add(tent);
      this.colliders.addCircle(f.x + tx, f.z + tz, 7.5, y, y + 9, { building: true });
    }
    // flag poles
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = Math.cos(a) * 160, pz = Math.sin(a) * 160;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), steel);
      pole.position.set(px, 6, pz);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), k % 2 ? pink : cyan);
      flag.material = flag.material.clone();
      flag.material.side = THREE.DoubleSide;
      flag.position.set(px + 1.5, 10.8, pz);
      g.add(pole, flag);
      this.colliders.addCircle(f.x + px, f.z + pz, 0.3, y, y + 12);
    }
    // ferris wheel
    const wheel = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(20, 0.5, 6, 40), steel);
    wheel.add(ring);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 20, 0.3), steel);
      spoke.position.set(Math.cos(a) * 10, Math.sin(a) * 10, 0);
      spoke.rotation.z = a - Math.PI / 2;
      wheel.add(spoke);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), k % 2 ? pink : cyan);
      cab.position.set(Math.cos(a) * 20, Math.sin(a) * 20, 0);
      wheel.add(cab);
    }
    wheel.position.set(-90, 24, 40);
    const wsupport = new THREE.Mesh(new THREE.BoxGeometry(1, 24, 1), steel);
    wsupport.position.set(-90, 12, 40);
    g.add(wheel, wsupport);
    this.colliders.addCircle(f.x - 90, f.z + 40, 3, y, y + 40);
    mergeByMaterial(wheel);
    this.animated.push((t) => { wheel.rotation.z = t * 0.08; });
    // showroom spotlights (beams)
    const beamMat = new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.festivalBeams = beamMat;
    const beams = new THREE.Group();
    g.add(beams);
    for (let k = 0; k < 4; k++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 4, 160, 12, 1, true), beamMat);
      beam.position.set(-20 + k * 14, 80, -100);
      beams.add(beam);
      this.animated.push((t) => {
        beam.rotation.z = Math.sin(t * 0.5 + k) * 0.35;
        beam.rotation.x = Math.cos(t * 0.4 + k * 2) * 0.25;
      });
    }
    mergeByMaterial(g, { skip: new Set([wheel, beams]), receiveShadow: true });
    beams.traverse((o) => { o.castShadow = false; });
    this.group.add(g);
    // parked showcase cars spots are added by the game
    this.festivalGroup = g;
    // cones marking the plaza
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      this.props.add('cone', f.x + Math.cos(a) * 60, f.z + Math.sin(a) * 60 + 20, 0, 1);
    }
  }

  _turbines() {
    const hf = this.hf;
    const r = rng(8);
    const mat = new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.5 });
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 14; tries++) {
      const x = -400 + r() * 1200, z = -1500 + r() * 600;
      if (!this._okForProp(x, z, 40)) continue;
      const y = hf.terrainHeight(x, z);
      if (y < 25) continue;
      const t = new THREE.Group();
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 60, 10), mat);
      tower.position.y = 30;
      const nac = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 6), mat);
      nac.position.set(0, 61, 0.5);
      const rotor = new THREE.Group();
      rotor.position.set(0, 61, -2.8);
      for (let k = 0; k < 3; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.4, 26, 0.3).translate(0, 13, 0), mat);
        blade.rotation.z = (k / 3) * Math.PI * 2;
        rotor.add(blade);
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), mat);
      rotor.add(hub);
      t.add(tower, nac, rotor);
      t.position.set(x, y, z);
      t.rotation.y = 0.6;
      mergeByMaterial(rotor);
      mergeByMaterial(t, { skip: new Set([rotor]) });
      this.group.add(t);
      this.colliders.addCircle(x, z, 1.8, y, y + 60);
      const sp = 0.6 + r() * 0.4, ph = r() * 6;
      this.animated.push((time) => { rotor.rotation.z = time * sp + ph; });
      placed++;
    }
  }

  _lighthouse() {
    const hf = this.hf;
    const L = POI.lighthouse;
    // find nearest land point near the cape
    let x = L.x, z = L.z;
    for (let k = 0; k < 40 && hf.terrainHeight(x, z) < 2; k++) { x -= 8; z -= 8; }
    const y = hf.terrainHeight(x, z);
    const g = new THREE.Group();
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(3 - (k + 1) * 0.25, 3 - k * 0.25, 4, 16),
        new THREE.MeshStandardMaterial({ color: k % 2 ? '#d22b2b' : '#f7f7f7', roughness: 0.6 }),
      );
      seg.position.y = 2 + k * 4;
      g.add(seg);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.5, 12), new THREE.MeshStandardMaterial({ color: '#fff7c2', emissive: '#ffe680', emissiveIntensity: 0.3 }));
    lamp.position.y = 25.5;
    this.nightMats.push({ mat: lamp.material, max: 4, base: 0.3 });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.5, 12), new THREE.MeshStandardMaterial({ color: '#2b2b2b' }));
    cap.position.y = 28;
    g.add(lamp, cap);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff2b0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 90, 16, 1, true).rotateZ(Math.PI / 2).translate(45, 0, 0), beamMat);
    beam.position.y = 25.5;
    g.add(beam);
    this.lighthouseBeam = beamMat;
    this.animated.push((t) => { beam.rotation.y = t * 0.6; });
    g.position.set(x, y, z);
    const beamPivot = beam;
    g.remove(beam);
    mergeByMaterial(g);
    g.add(beamPivot);
    this.group.add(g);
    this.colliders.addCircle(x, z, 3.2, y, y + 30, { building: true });
  }

  _airfield() {
    const hf = this.hf;
    const a = POI.airstrip;
    // hangars
    const mat = new THREE.MeshStandardMaterial({ color: '#8d98a3', roughness: 0.6, metalness: 0.4 });
    for (let k = 0; k < 3; k++) {
      const x = a.x0 + 200 + k * 70, z = a.z - 62;
      const y = hf.terrainHeight(x, z);
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 40, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), mat);
      shell.position.set(x, y, z);
      shell.castShadow = true;
      shell.receiveShadow = true;
      this.group.add(shell);
      this.colliders.addBox(x, z, 14, 20, 0, y, y + 14, { building: true });
    }
    // control tower
    const tx = a.x1 - 40, tz = a.z + 70;
    const ty = hf.terrainHeight(tx, tz);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 22, 10), new THREE.MeshStandardMaterial({ color: '#e7e3da' }));
    tower.position.set(tx, ty + 11, tz);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 4, 10), new THREE.MeshStandardMaterial({ color: '#30485c', metalness: 0.6, roughness: 0.2 }));
    cab.position.set(tx, ty + 24, tz);
    tower.castShadow = cab.castShadow = true;
    this.group.add(tower, cab);
    this.colliders.addCircle(tx, tz, 3.5, ty, ty + 26, { building: true });
  }

  _xpBoards() {
    const hf = this.hf;
    const r = rng(404);
    const list = [];
    let attempts = 0;
    while (list.length < 40 && attempts++ < 4000) {
      const road = r.pick(hf.roads.roads);
      const i = r.int(0, road.count - 1);
      const side = r() < 0.5 ? -1 : 1;
      const off = road.halfWidth + 4 + r() * 10;
      const x = road.x[i] + -road.tz[i] * side * off, z = road.z[i] + road.tx[i] * side * off;
      if (!this._okForProp(x, z, 3)) continue;
      if (Math.abs(hf.terrainHeight(x, z) - road.y[i]) > 3) continue;
      if (list.some((b) => Math.hypot(b.x - x, b.z - z) < 180)) continue;
      const ang = -Math.atan2(road.tz[i], road.tx[i]) + Math.PI / 2;
      const item = this.props.add('xpboard', x, z, ang, 1);
      item.xp = 1;
      list.push({ x, z, item, id: list.length });
    }
    this.xpBoards = list;
  }

  _ramps() {
    // Danger sign jumps: ramp kickers placed in open ground next to roads
    const hf = this.hf;
    this.jumps = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#c7c2b5', roughness: 0.8 });
    const stripe = new THREE.MeshStandardMaterial({ color: '#ffcc00', roughness: 0.6 });
    const spots = [
      { road: 'canyon', frac: 0.7, len: 16, h: 3.0 },
      { road: 'canyon', frac: 0.35, len: 14, h: 2.6 },
      { road: 'forest', frac: 0.6, len: 14, h: 2.8 },
      { road: 'central', frac: 0.84, len: 16, h: 2.4 },
      { road: 'sunset', frac: 0.25, len: 16, h: 2.6 },
    ];
    for (const sp of spots) {
      const road = hf.roads.roads.find((r) => r.id === sp.road);
      if (!road) continue;
      const i = Math.floor(road.count * sp.frac);
      const ang = Math.atan2(road.tz[i], road.tx[i]);
      const x = road.x[i] - road.tx[i] * sp.len * 0.5, z = road.z[i] - road.tz[i] * sp.len * 0.5;
      const w = Math.min(road.halfWidth * 2 - 2, 7);
      hf.addRamp(x, z, ang, sp.len, sp.h, w);
      const ramp = hf.ramps[hf.ramps.length - 1];
      // ramp mesh (wedge)
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(sp.len, 0);
      shape.lineTo(sp.len, sp.h);
      shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2);
      const mesh = new THREE.Mesh(geo, [mat, stripe]);
      mesh.position.set(x, ramp.y - 0.05, z);
      mesh.rotation.y = -ang;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.jumps.push({ x: x + road.tx[i] * sp.len, z: z + road.tz[i] * sp.len, road, i, ang, name: `${road.name} Jump` });
    }
  }

  _barns() {
    const hf = this.hf;
    this.barns = [];
    const wall = new THREE.MeshStandardMaterial({ color: '#8e2a20', roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: '#efe8dc', roughness: 0.8 });
    const roofM = new THREE.MeshStandardMaterial({ color: '#3b3f45', roughness: 0.7, side: THREE.DoubleSide });
    for (const b of BARNS) {
      // nudge onto dry, gentle, road-free ground
      let x = b.x, z = b.z;
      for (let k = 0; k < 60 && !this._okForProp(x, z, 25); k++) { x += (k % 2 ? 1 : -1) * 15; z += 11; }
      const y = hf.terrainHeight(x, z) - 0.4;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), wall);
      body.position.y = 3.5;
      const shape = new THREE.Shape();
      shape.moveTo(-7.6, 0); shape.lineTo(7.6, 0); shape.lineTo(0, 4.8); shape.lineTo(-7.6, 0);
      const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 11, bevelEnabled: false }).translate(0, 7, -5.5), roofM);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 5.4), trim);
      door.position.set(0, 2.7, 5.02);
      const x1 = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.25, 0.05), trim);
      x1.position.set(0, 2.7, 5.06); x1.rotation.z = 0.83;
      const x2 = x1.clone(); x2.rotation.z = -0.83;
      g.add(body, roof, door, x1, x2);
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(-x, -z);
      mergeByMaterial(g, { receiveShadow: true });
      this.group.add(g);
      this.colliders.addBox(x, z, 7, 5, -g.rotation.y, y, y + 11, { building: true });
      this.barns.push({ ...b, x, z, y });
    }
  }

  setNight(amount) {
    for (const n of this.nightMats) n.mat.emissiveIntensity = (n.base || 0) + amount * n.max;
    if (this.festivalBeams) this.festivalBeams.opacity = amount * 0.12;
    if (this.lighthouseBeam) this.lighthouseBeam.opacity = amount * 0.18;
  }

  update(t) {
    for (const f of this.animated) f(t);
  }
}

function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
