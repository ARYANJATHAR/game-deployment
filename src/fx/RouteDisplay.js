import * as THREE from 'three';
import { makeChevronTexture } from '../world/Textures.js';

const MAX = 90;
const SPACING = 4.5;

/**
 * Chevron arrows painted on the road ahead: blue for GPS navigation,
 * green/yellow/red braking line in races.
 */
export class RouteDisplay {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      map: makeChevronTexture(), transparent: true, depthWrite: false, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10, fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    const c = new THREE.Color('#fff');
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, c);
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.hint = -1;
  }

  /** mode: 'gps' | 'braking' | 'full'; profile = target speeds (m/s) for braking line */
  update(route, vehicle, mode, profile = null, hf = null) {
    if (!route || mode === 'off') {
      this.mesh.count = 0;
      return;
    }
    const pr = route.project(vehicle.pos.x, vehicle.pos.z, this.hint, 60);
    this.hint = pr.i;
    const startS = pr.s + 6;
    const speed = vehicle.speed;
    let n = 0;
    const useLine = mode !== 'gps';
    const p = {};
    for (let k = 0; k < MAX; k++) {
      const s = startS + k * SPACING;
      if (!route.closed && s > route.length - 2) break;
      route.pointAtS(s, p);
      const x = useLine ? p.lx : p.x;
      const z = useLine ? p.lz : p.z;
      const y = hf ? hf.heightAt(x, z) + 0.07 : p.y + 0.1;
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, Math.atan2(-p.tx, -p.tz), 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      if (mode === 'gps') this.color.set('#2fa8ff');
      else {
        const target = profile ? profile[p.i] : 999;
        // compare with current speed once braking would need to start
        const need = speed - target;
        if (need > 6) this.color.set('#ff2a2a');
        else if (need > 0) this.color.set('#ffd21a');
        else this.color.set('#2bff6a');
        if (mode === 'braking' && need <= 0) { continue; }
      }
      this.mesh.setColorAt(n, this.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.mesh.count = 0;
    this.hint = -1;
  }
}
