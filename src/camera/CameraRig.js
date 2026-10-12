import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/utils.js';

export const CAMERA_MODES = ['Chase', 'Far Chase', 'Hood', 'Bumper'];

/** Driving camera with chase / hood / bumper views, free look and shake. */
export class CameraRig {
  constructor(camera, hf) {
    this.camera = camera;
    this.hf = hf;
    this.mode = 0;
    this.yaw = 0;
    this.pitch = 0.18;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.shake = 0;
    this.baseFov = 62;
    this.pos = new THREE.Vector3(0, 50, 0);
    this.target = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.2, dist: 7, target: new THREE.Vector3() };
    this.cinematicT = 0;
    this._snap = true;
  }

  snap() {
    this._snap = true;
  }

  update(dt, car, input, opts = {}) {
    const cam = this.camera;
    const v = car;
    const fwd = v.forward;
    const speed = v.speed;
    // smoothed yaw follows velocity direction when moving forward, else heading
    let desiredYaw = Math.atan2(-fwd.x, -fwd.z);
    if (speed > 4 && v.vel.dot(fwd) > 0) {
      const vy = Math.atan2(-v.vel.x, -v.vel.z);
      desiredYaw = desiredYaw + wrapAngle(vy - desiredYaw) * 0.35;
    }
    if (this._snap) this.yaw = desiredYaw;
    this.yaw += wrapAngle(desiredYaw - this.yaw) * (1 - Math.exp(-dt * (this.mode >= 2 ? 30 : 5.5)));

    // free look
    const m = input.consumeMouse();
    if (input.mouse.down) {
      this.lookYaw -= m.dx * 0.005;
      this.lookPitch = clamp(this.lookPitch + m.dy * 0.003, -0.4, 0.8);
      this.lookTimer = 1.5;
    } else if (Math.abs(input.axes.lookX) > 0 || Math.abs(input.axes.lookY) > 0) {
      this.lookYaw = -input.axes.lookX * Math.PI * 0.9;
      this.lookPitch = input.axes.lookY * 0.4;
      this.lookTimer = 0.2;
    } else {
      this.lookTimer = (this.lookTimer || 0) - dt;
      if (this.lookTimer <= 0) {
        this.lookYaw = damp(this.lookYaw, 0, 4, dt);
        this.lookPitch = damp(this.lookPitch, 0, 4, dt);
      }
    }
    const back = opts.lookBack ? Math.PI : 0;
    const yaw = this.yaw + this.lookYaw + back;

    const carPos = v.root.position;
    const comY = v.pos.y;
    let fov = this.baseFov + clamp((speed - 15) * 0.22, 0, 22);
    if (this.mode <= 1) {
      const far = this.mode === 1;
      const dist = (far ? 8.5 : 5.6) + v.def.dims.length * 0.35 + clamp(speed * 0.012, 0, 0.8);
      const height = (far ? 2.9 : 1.75) + v.def.dims.height * 0.35 + this.lookPitch * 3;
      const desired = new THREE.Vector3(
        carPos.x + Math.sin(yaw) * dist,
        comY + height,
        carPos.z + Math.cos(yaw) * dist,
      );
      // keep above terrain
      const gy = this.hf.heightAt(desired.x, desired.z) + 0.6;
      if (desired.y < gy) desired.y = gy;
      if (this._snap) this.pos.copy(desired);
      const k = 1 - Math.exp(-dt * 12);
      this.pos.x = lerp(this.pos.x, desired.x, k);
      this.pos.z = lerp(this.pos.z, desired.z, k);
      this.pos.y = lerp(this.pos.y, desired.y, 1 - Math.exp(-dt * 6));
      // hard distance constraint to avoid lagging behind at high speed
      const dx = this.pos.x - carPos.x, dz = this.pos.z - carPos.z;
      const d = Math.hypot(dx, dz);
      if (d > dist * 1.25) {
        this.pos.x = carPos.x + (dx / d) * dist * 1.25;
        this.pos.z = carPos.z + (dz / d) * dist * 1.25;
      }
      this.target.set(carPos.x - Math.sin(yaw) * 3, comY + 0.9, carPos.z - Math.cos(yaw) * 3);
      cam.position.copy(this.pos);
      cam.lookAt(this.target);
    } else {
      // hood / bumper cameras rigidly attached to the car
      const local = this.mode === 2
        ? new THREE.Vector3(0, v.def.dims.height * 0.82, -v.def.dims.length * 0.05)
        : new THREE.Vector3(0, v.def.dims.ride + 0.38, -v.def.dims.length * 0.5 - 0.1);
      const p = local.applyQuaternion(v.root.quaternion).add(carPos);
      cam.position.copy(p);
      const look = new THREE.Vector3(Math.sin(this.lookYaw + back) * -10, -0.4 + this.lookPitch * -5, Math.cos(this.lookYaw + back) * -10);
      look.applyQuaternion(v.root.quaternion).add(p);
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
      fov += 6;
    }

    // shake
    const speedShake = clamp((speed - 45) / 60, 0, 1) * 0.015;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = speedShake + this.shake * 0.12;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.5;
    }
    cam.fov = damp(cam.fov, fov, 4, dt);
    cam.updateProjectionMatrix();
    this._snap = false;
  }

  /** Orbit camera around a point (garage, photo mode, menus). */
  updateOrbit(dt, input, target, opts = {}) {
    const o = this.orbit;
    const m = input.consumeMouse();
    if (opts.auto) o.yaw += dt * 0.12;
    if (input.mouse.down || opts.free) {
      o.yaw -= m.dx * 0.006;
      o.pitch = clamp(o.pitch + m.dy * 0.004, -0.1, 1.3);
    }
    o.yaw -= input.axes.lookX * dt * 2;
    o.pitch = clamp(o.pitch + input.axes.lookY * dt, -0.1, 1.3);
    if (m.wheel) o.dist = clamp(o.dist + m.wheel * 0.5, opts.minDist || 3, opts.maxDist || 18);
    o.target.lerp(target, opts.snap ? 1 : 1 - Math.exp(-dt * 8));
    const cam = this.camera;
    cam.position.set(
      o.target.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
    );
    const gy = this.hf ? this.hf.heightAt(cam.position.x, cam.position.z) + 0.3 : -Infinity;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(o.target);
    cam.fov = damp(cam.fov, opts.fov || 45, 5, dt);
    cam.updateProjectionMatrix();
  }

  /** Slow cinematic fly-by used behind menus. */
  updateCinematic(dt, target, carYaw) {
    this.cinematicT += dt;
    const t = this.cinematicT * 0.18;
    const cam = this.camera;
    const r = 7.5 + Math.sin(t * 0.7) * 1.5;
    const a = carYaw + t;
    cam.position.set(target.x + Math.sin(a) * r, target.y + 1.2 + Math.sin(t * 0.5) * 0.6, target.z + Math.cos(a) * r);
    const gy = this.hf.heightAt(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(target.x, target.y + 0.5, target.z);
    cam.fov = damp(cam.fov, 40, 3, dt);
    cam.updateProjectionMatrix();
  }
}
