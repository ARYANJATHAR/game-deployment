import * as THREE from 'three';
import { ParticleSystem, SkidMarks } from './Particles.js';
import { SURFACE_PROPS, SURF } from '../world/Heightfield.js';
import { makeGlowTexture } from '../world/Textures.js';

const _p = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Drives smoke, dust, sparks, flames and skid marks for all vehicles. */
export class VehicleFX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticleSystem(scene, 2600, false);
    this.sparks = new ParticleSystem(scene, 600, true, makeGlowTexture());
    this.skids = new SkidMarks(scene, 7000);
    this.quality = 1;
    // player headlights
    this.headlights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.SpotLight('#fff3e0', 0, 90, 0.42, 0.55, 1.2);
      l.castShadow = false;
      scene.add(l);
      scene.add(l.target);
      this.headlights.push(l);
    }
    this.flareMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), color: '#ffe9c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flames = new THREE.SpriteMaterial({ map: makeGlowTexture(), color: '#ff8a2a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flameSprites = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Sprite(this.flames);
      s.scale.setScalar(0.6);
      s.visible = false;
      scene.add(s);
      this.flameSprites.push(s);
    }
  }

  update(dt, vehicles, player, env, camera) {
    this.smoke.setScale(window.innerHeight * 0.9);
    this.sparks.setScale(window.innerHeight * 0.6);
    for (const v of vehicles) {
      const dist = camera.position.distanceTo(v.pos);
      if (dist > 220) continue;
      const near = dist < 90 ? 1 : 0.4;
      for (let wi = 0; wi < v.wheels.length; wi++) {
        const w = v.wheels[wi];
        if (!w.contact) {
          this.skids.add(v.uid + '_' + wi, w.point, v.right, 0.25, 0);
          continue;
        }
        const surf = w.road ? (w.road.type === 'dirt' ? SURF.DIRT : SURF.ASPHALT) : w.surface;
        const isHard = surf === SURF.ASPHALT || surf === SURF.CONCRETE;
        const sp = v.speed;
        // skid marks
        let skid = w.skid;
        const markColor = isHard ? [0.02, 0.02, 0.02] : surf === SURF.SNOW ? [0.6, 0.62, 0.66] : [0.18, 0.13, 0.08];
        if (!isHard) skid = Math.max(skid, sp > 6 ? 0.25 : 0);
        _r.copy(v.right);
        this.skids.add(v.uid + '_' + wi, w.point, _r, v.def.dims.wheelW * 0.9, skid * (isHard ? 1 : 0.6), markColor);
        // particles
        const rate = this.quality * near;
        if (isHard) {
          if (w.skid > 0.25 && Math.random() < w.skid * rate * 0.9) {
            const g = 0.85 + Math.random() * 0.1;
            this.smoke.emit(
              w.point.x + (Math.random() - 0.5) * 0.3, w.point.y + 0.25, w.point.z + (Math.random() - 0.5) * 0.3,
              v.vel.x * 0.15 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), v.vel.z * 0.15 + (Math.random() - 0.5) * 1.5,
              1.2, 2.6 + w.skid * 2.5, 1.8 + Math.random() * 1.4, g, g, g, 0.32 * w.skid + 0.08, 1.2, -0.3,
            );
          }
        } else if (sp > 3) {
          const props = SURFACE_PROPS[surf] || SURFACE_PROPS[0];
          const c = props.dust;
          const amt = Math.min(1, sp / 25) * (0.35 + w.skid);
          if (Math.random() < amt * rate) {
            this.smoke.emit(
              w.point.x, w.point.y + 0.2, w.point.z,
              -v.vel.x * 0.1 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.2, -v.vel.z * 0.1 + (Math.random() - 0.5) * 2,
              1.0, 2.2 + amt * 2, 1.4 + Math.random(), c[0], c[1], c[2], 0.35 * amt + 0.1, 1.5, 0.2,
            );
          }
        }
        // water splash
        if (v.inWater && Math.random() < 0.6) {
          this.smoke.emit(w.point.x, 0.1, w.point.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.6, 1.5, 0.8, 0.85, 0.92, 1, 0.5, 1, 6);
        }
      }
      // impacts -> sparks
      while (v.impactEvents.length) {
        const e = v.impactEvents.shift();
        const n = Math.min(40, Math.floor(e.strength * 3));
        for (let k = 0; k < n; k++) {
          this.sparks.emit(
            e.point.x, e.point.y, e.point.z,
            (Math.random() - 0.5) * 9 + v.vel.x * 0.4, Math.random() * 5, (Math.random() - 0.5) * 9 + v.vel.z * 0.4,
            0.25, -0.2, 0.3 + Math.random() * 0.4, 1, 0.75 + Math.random() * 0.2, 0.35, 1, 0.5, 14,
          );
        }
        if (v.onImpact) v.onImpact(e.strength);
      }
      // exhaust: idle puffs + backfire flames
      if (v === player) {
        const ex = v.model.exhausts;
        for (let k = 0; k < this.flameSprites.length; k++) {
          const s = this.flameSprites[k];
          if (v.backfire > 0 && ex[k] && Math.random() < 0.6) {
            _p.copy(ex[k]).applyMatrix4(v.root.matrixWorld);
            s.position.copy(_p);
            s.scale.setScalar(0.35 + Math.random() * 0.45);
            s.visible = true;
          } else s.visible = false;
        }
      }
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skids.update();

    // headlights for the player at night
    const night = env.nightAmount;
    const on = night > 0.35 || env.rain > 0.5 || env.fog > 0.5;
    if (player) {
      player.lightsOn = on || player.forceLights;
      const L = player.def.dims.length / 2;
      for (let i = 0; i < 2; i++) {
        const l = this.headlights[i];
        l.intensity = player.lightsOn ? 260 : 0;
        const sx = (i ? 1 : -1) * player.def.dims.width * 0.32;
        _p.set(sx, player.def.dims.height * 0.45, -L).applyMatrix4(player.root.matrixWorld);
        l.position.copy(_p);
        _p.set(sx * 1.5, -1.2, -L - 25).applyMatrix4(player.root.matrixWorld);
        l.target.position.copy(_p);
      }
    }
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
  }
}
