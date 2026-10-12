import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';
import { effectivePhys } from '../config/cars.js';
import { buildCar, carLayout } from './CarBuilder.js';

const G = 9.81;
const AIR = 1.225;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m3 = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();
const _ground = {};

/**
 * Raycast-suspension vehicle with a slip-based tyre model, engine, gearbox
 * and driver assists. Forward is -Z in local space.
 */
export class Vehicle {
  constructor(carDef, world, opts = {}) {
    this.def = carDef;
    this.world = world;
    this.opts = opts;
    this.upgrades = opts.upgrades || {};
    this.model = opts.headless ? carLayout(carDef) : buildCar(carDef, opts);
    this.root = this.model.root;
    this.isPlayer = !!opts.player;
    this.name = opts.name || carDef.name;

    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);

    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
    this.assists = { abs: true, tcs: true, stm: true, autoGear: true, steerAssist: true, ...(opts.assists || {}) };
    this.applyPhysics();

    this.gear = 1;
    this.rpm = this.p.idle;
    this.shiftTimer = 0;
    this.reverseTimer = 0;
    this.steerAngle = 0;
    this.airTime = 0;
    this.grounded = false;
    this.speed = 0;
    this.driftAngle = 0;
    this.slipstream = 0;
    this.lastImpact = 0;
    this.impactEvents = [];
    this.backfire = 0;
    this.offroad = false;
    this.surface = null;
    this.distance = 0;
    this.collisionCooldown = 0;
    this.frozen = false;
    this.ghost = false;
  }

  applyPhysics() {
    const p = effectivePhys(this.def, this.upgrades);
    this.p = p;
    const D = this.def.dims;
    this.mass = p.mass;
    const L = D.length, W = D.width, H = D.height;
    const Ix = (p.mass / 12) * (H * H + L * L) * 1.15;
    const Iy = (p.mass / 12) * (W * W + L * L) * 1.15;
    const Iz = (p.mass / 12) * (W * W + H * H) * 1.25;
    this.invInertia = new THREE.Vector3(1 / Ix, 1 / Iy, 1 / Iz);
    const m = this.model;
    const wb = D.wheelbase;
    const zCom = m.axleF + (1 - p.weightFront) * wb;
    this.com = new THREE.Vector3(0, p.comY, zCom);
    const susp = p.suspension || {};
    const freq = susp.freq || (p.downforce > 1 ? 2.1 : 1.65);
    const travel = susp.travel || (D.ride > 0.2 ? 0.28 : 0.16);
    const omega = 2 * Math.PI * freq;
    this.wheels = m.wheels.map((w) => {
      const front = w.front;
      const share = (front ? p.weightFront : 1 - p.weightFront) / 2;
      const cornerMass = p.mass * share;
      const k = cornerMass * omega * omega;
      const x0 = (cornerMass * G) / k;
      const mountH = 0.32;
      return {
        vis: w,
        front,
        left: w.x < 0,
        local: new THREE.Vector3(w.x, D.wheelR + mountH - p.comY, w.z - zCom),
        radius: D.wheelR,
        restLen: mountH + x0,
        maxComp: x0 + travel,
        k,
        c: 2 * 0.32 * Math.sqrt(k * cornerMass) * 1.0,
        cornerMass,
        comp: 0,
        prevComp: 0,
        contact: false,
        load: 0,
        spin: 0,
        spinVel: 0,
        slipLat: 0,
        slipLong: 0,
        skid: 0,
        surface: 0,
        grip: 1,
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        driven: p.drive === 'AWD' || (p.drive === 'FWD' ? front : !front),
        locked: false,
        len: mountH,
      };
    });
    this.antiRoll = p.mass * 9;
    this.frontArea = D.width * D.height * 0.85;
    this.halfExt = new THREE.Vector3(D.width / 2, D.height / 2, D.length / 2);
    this.ratios = p.gears;
  }

  place(x, y, z, heading) {
    // heading: yaw angle; forward = (-sin h, 0, -cos h)
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.pos.set(x, y + this.p.comY + 0.05, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.gear = 1;
    this.rpm = this.p.idle;
    this.steerAngle = 0;
    for (const w of this.wheels) { w.comp = w.prevComp = this.wheels[0].maxComp * 0.5; w.spin = 0; }
    this._updateBasis();
    this.syncVisual(0);
  }

  get heading() {
    return Math.atan2(-this.forward.x, -this.forward.z);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  _updateBasis() {
    this.forward.set(0, 0, -1).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
  }

  torqueAt(rpm) {
    const p = this.p;
    const x = rpm / p.peakRpm;
    let f;
    if (x < 1) f = 0.5 + 0.5 * Math.sin((x * Math.PI) / 2);
    else f = 1 - 0.3 * Math.pow((rpm - p.peakRpm) / Math.max(1, p.redline - p.peakRpm), 1.6);
    if (p.sound && p.sound.turbo) f *= x < 0.45 ? 0.8 : 1.05;
    return p.torque * Math.max(0.2, f);
  }

  get gearRatio() {
    if (this.gear === -1) return -3.3;
    if (this.gear === 0) return 0;
    return this.ratios[this.gear - 1];
  }

  /** Fixed-step physics update. */
  step(dt) {
    if (this.frozen) {
      this._engineIdle(dt);
      return;
    }
    const p = this.p;
    const c = this.controls;
    this._updateBasis();
    const fwdSpeed = this.vel.dot(this.forward);
    this.speed = this.vel.length();

    // ----- steering -----
    const v = Math.abs(fwdSpeed);
    const lock = (p.steer * Math.PI) / 180;
    let maxSteer = lock / (1 + (v * v) / 1100);
    let target = c.steer * maxSteer;
    if (this.assists.steerAssist && this.grounded && v > 5) {
      // steering is relative to the direction of travel: when sliding, the
      // wheels are pointed toward the velocity so counter-steer comes naturally
      const latV = this.vel.dot(this.right);
      const slide = Math.atan2(latV, Math.max(2, v));
      target += clamp(slide * 0.85, -lock * 0.8, lock * 0.8) * (1 - Math.abs(c.steer) * 0.35);
    }
    if (c.steerAngle !== undefined) target = c.steerAngle; // direct wheel angle (AI)
    target = clamp(target, -lock, lock);
    const steerRate = 3.2 + (c.steer === 0 ? 2 : 0);
    this.steerAngle += clamp(target - this.steerAngle, -steerRate * dt, steerRate * dt);

    // ----- gearbox -----
    this._gearbox(dt, fwdSpeed);

    // ----- engine -----
    const driven = this.wheels.filter((w) => w.driven);
    let wheelSpeed = 0;
    for (const w of driven) wheelSpeed += w.spinVel * w.radius;
    wheelSpeed /= driven.length;
    const ratio = this.gearRatio;
    const final = p.final;
    let throttle = c.throttle;
    let brake = c.brake;
    if (this.gear === -1) {
      // in reverse, brake pedal drives backwards
      throttle = c.brake;
      brake = c.throttle;
    }
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      throttle *= 0.0;
    }
    const wheelRpm = (Math.abs(wheelSpeed) / this.wheels[0].radius) * (60 / (2 * Math.PI));
    let targetRpm = wheelRpm * Math.abs(ratio) * final;
    const launchRpm = Math.min(p.redline * 0.7, p.peakRpm * 1.05);
    if (this.gear !== 0) {
      // clutch slip at low speed
      const slipRpm = p.idle + throttle * (launchRpm - p.idle);
      if (targetRpm < slipRpm && Math.abs(this.gear) === 1) targetRpm = lerp(targetRpm, slipRpm, clamp(1 - v / 12, 0, 1));
    } else {
      targetRpm = p.idle + throttle * (p.redline - p.idle);
    }
    targetRpm = clamp(targetRpm, p.idle, p.redline + 200);
    this.rpm = lerp(this.rpm, targetRpm, 1 - Math.exp(-dt * (this.grounded ? 18 : 6)));
    let engineTorque = this.torqueAt(this.rpm) * throttle * (this.aiPowerScale || 1);
    if (this.rpm >= p.redline) {
      engineTorque = 0; // limiter
      this.limiter = true;
    } else this.limiter = false;
    const engineBrake = this.gear !== 0 ? 0.16 * p.torque * (this.rpm / p.redline) * (1 - throttle) * Math.abs(ratio) * final * 0.35 : 0;
    const totalWheelTorque = engineTorque * ratio * final * 0.86;
    if (throttle < 0.1 && this.lastThrottle > 0.8 && this.rpm > p.redline * 0.6) this.backfire = 0.35;
    this.lastThrottle = throttle;
    if (this.backfire > 0) this.backfire -= dt;

    // ----- suspension + tyres -----
    const invM = 1 / this.mass;
    const force = _v1.set(0, -G * this.mass, 0);
    const torque = _v2.set(0, 0, 0);
    const R = this.quat;
    let contacts = 0;
    let frontAxleSplit = p.drive === 'AWD' ? (p.awdFront || 0.4) : p.drive === 'FWD' ? 1 : 0;
    const frontDriven = this.wheels.filter((w) => w.driven && w.front).length || 1;
    const rearDriven = this.wheels.filter((w) => w.driven && !w.front).length || 1;
    if (p.drive !== 'AWD') frontAxleSplit = p.drive === 'FWD' ? 1 : 0;

    const downforce = 0.5 * AIR * this.speed * this.speed * p.downforce * 0.55;
    let surfaceGripSum = 0;
    let offroadCount = 0;
    this.slipTotal = 0;

    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const mount = _v3.copy(w.local).applyQuaternion(R).add(this.pos);
      const down = _v4.copy(this.up).negate();
      // ray vs ground (two refinement iterations)
      const world = this.world;
      let gy = world.groundSample(mount.x, mount.z, _ground).y;
      const dy = -down.y;
      let t = (mount.y - gy) / Math.max(0.3, dy);
      for (let it = 0; it < 2; it++) {
        const hx = mount.x + down.x * t, hz = mount.z + down.z * t;
        world.groundSample(hx, hz, _ground);
        t = (mount.y - _ground.y) / Math.max(0.3, dy);
      }
      const dist = t - w.radius;
      w.prevComp = w.comp;
      if (dist < w.restLen && dy > 0.2) {
        w.contact = true;
        w.comp = Math.min(w.restLen - dist, w.maxComp + 0.05);
        w.len = w.restLen - w.comp;
        w.point.set(mount.x + down.x * t, _ground.y, mount.z + down.z * t);
        w.normal.set(_ground.nx, _ground.ny, _ground.nz);
        w.surface = _ground.surface;
        w.road = _ground.road;
        let grip = _ground.grip;
        const offPenalty = 1 - p.offroad;
        if (!_ground.road && _ground.surface !== 7) {
          grip = lerp(grip, Math.min(1, grip + 0.25), p.offroad);
          offroadCount++;
        } else if (_ground.road && _ground.road.type === 'dirt') {
          grip = lerp(grip, 0.95, p.offroad * 0.8);
        }
        if (this.world.weatherGrip) grip *= this.world.weatherGrip;
        w.grip = grip;
        w.drag = _ground.drag * (0.4 + offPenalty * 0.6);
        w.bump = _ground.bump * (1 - p.offroad * 0.6);
        surfaceGripSum += grip;
        contacts++;
      } else {
        w.contact = false;
        w.comp = 0;
        w.len = w.restLen;
        w.load = 0;
        w.skid = 0;
        w.slipLat = 0;
        w.slipLong = 0;
      }
    }
    // anti-roll bars
    const arF = (this.wheels[0].comp - this.wheels[1].comp) * this.antiRoll;
    const arR = (this.wheels[2].comp - this.wheels[3].comp) * this.antiRoll * 0.8;
    const antiRoll = [arF, -arF, arR, -arR];

    const absOn = this.assists.abs;
    const tcsOn = this.assists.tcs;
    let maxSpin = 0;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (!w.contact) {
        // free wheel spin decays / follows engine
        if (w.driven && throttle > 0.1) w.spinVel = lerp(w.spinVel, (this.rpm / (Math.abs(ratio) * final || 1)) * (2 * Math.PI / 60) * Math.sign(ratio || 1), 0.1);
        else w.spinVel *= 0.995;
        if (brake > 0.5 || c.handbrake > 0.5 && !w.front) w.spinVel *= 0.8;
        continue;
      }
      const compVel = (w.comp - w.prevComp) / dt;
      let fz = w.k * w.comp + w.c * compVel + antiRoll[wi];
      // bump stop
      if (w.comp > w.maxComp) fz += (w.comp - w.maxComp) * w.k * 8;
      // surface bumpiness
      if (w.bump > 0 && this.speed > 3) fz *= 1 + (Math.random() - 0.5) * w.bump * Math.min(1, this.speed / 15);
      fz = Math.max(0, fz);
      fz += downforce * (w.front ? 0.45 : 0.55) / 2;
      w.load = fz;

      // contact frame
      const n = w.normal;
      const cs = Math.cos(w.front ? this.steerAngle : 0), sn = Math.sin(w.front ? this.steerAngle : 0);
      // wheel forward = forward*cos + right*(-sin)... steer positive = right turn
      const wf = _v3.copy(this.forward).multiplyScalar(cs).addScaledVector(this.right, sn);
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const wr = _v4.copy(wf).cross(n).normalize(); // right = forward x up

      const rel = new THREE.Vector3().copy(w.point).sub(this.pos);
      const pv = new THREE.Vector3().copy(this.angVel).cross(rel).add(this.vel);
      const vLong = pv.dot(wf);
      const vLat = pv.dot(wr);

      const mu = 1.05 * p.grip * w.grip;
      const fMax = mu * fz;

      // longitudinal: drive & brake
      let drive = 0;
      if (w.driven) {
        const share = w.front ? frontAxleSplit / frontDriven : (1 - frontAxleSplit) / rearDriven;
        drive = (totalWheelTorque * share) / w.radius;
      }
      let brakeF = 0;
      const brakeMax = this.mass * G * 1.25 * p.brake / 4;
      if (brake > 0) brakeF = brake * brakeMax * (w.front ? 1.15 : 0.85);
      let hand = 0;
      if (c.handbrake > 0 && !w.front) hand = c.handbrake * this.mass * G * 0.9 / 2;
      // rolling resistance + off-road drag
      const roll = (0.012 + (w.drag || 0) * 2) * fz + (w.driven ? engineBrake / w.radius / driven.length : 0);
      let fLong = drive;
      const stopForce = (Math.abs(vLong) * w.cornerMass) / dt;
      const resist = Math.min(stopForce, brakeF + hand + roll);
      fLong -= Math.sign(vLong) * resist;
      let locked = false;
      if (!absOn && brakeF > fMax * 1.05 && Math.abs(vLong) > 2) locked = true;
      if (hand > 0 && Math.abs(vLong) > 1) locked = true;
      // traction
      let spin = 0;
      if (Math.abs(fLong) > fMax) {
        if (w.driven && Math.abs(drive) > fMax && !(tcsOn && !locked)) spin = (Math.abs(drive) - fMax) / Math.max(1, fMax);
        fLong = Math.sign(fLong) * fMax * (locked || spin > 0 ? 0.88 : 1);
      }
      if (tcsOn && w.driven) {
        // traction control keeps longitudinal use below the limit, more so when sliding
        const lim = fMax * (Math.abs(vLat) > 1.2 ? 0.6 : 0.88);
        if (Math.abs(drive) > lim && Math.sign(drive) === Math.sign(fLong)) fLong = Math.sign(drive) * Math.min(Math.abs(fLong), lim);
      }
      // lateral
      // friction ellipse: tyres keep some lateral grip even at full drive/brake
      const lr = fLong / Math.max(1, fMax);
      const latCap = fMax * Math.sqrt(Math.max(0, 1 - 0.72 * lr * lr)) * (spin > 0 ? 0.7 : 1) * (locked ? 0.35 : 1);
      const alpha = Math.atan2(vLat, Math.abs(vLong) + 1.5);
      const B = 9.5, C = 1.55;
      const shape = Math.sin(C * Math.atan(B * Math.abs(alpha)));
      let fLat = -Math.sign(vLat) * latCap * shape;
      const latStop = (Math.abs(vLat) * w.cornerMass) / dt;
      if (Math.abs(fLat) > latStop) fLat = -Math.sign(vLat) * latStop;
      // low-speed creep killer
      if (this.speed < 0.6 && throttle < 0.05 && brake < 0.05) {
        fLong = -vLong * w.cornerMass / dt * 0.5;
      }

      w.slipLat = vLat;
      w.slipLong = spin;
      w.locked = locked;
      w.skid = clamp(Math.max(Math.abs(vLat) - 2.2, 0) / 6 + spin * 0.9 + (locked ? 0.8 : 0), 0, 1);
      if (Math.abs(vLong) < 1.5 && spin === 0) w.skid *= Math.abs(vLong) / 1.5;
      this.slipTotal += w.skid;
      maxSpin = Math.max(maxSpin, spin);

      // wheel visual spin velocity
      const rollVel = vLong / w.radius;
      if (locked) w.spinVel = lerp(w.spinVel, 0, 0.5);
      else if (spin > 0) w.spinVel = lerp(w.spinVel, rollVel + Math.sign(drive) * (8 + spin * 25), 0.2);
      else w.spinVel = lerp(w.spinVel, rollVel, 0.5);

      // total force at contact (raised toward roll centre to limit roll-over)
      const F = new THREE.Vector3()
        .addScaledVector(this.up, fz)
        .addScaledVector(wf, fLong)
        .addScaledVector(wr, fLat);
      force.add(F);
      // suspension force at the true contact, tyre forces raised toward the roll centre
      const app = rel.clone().addScaledVector(this.up, this.p.comY * 0.55);
      const Fs = this.up.clone().multiplyScalar(fz);
      const Ft = new THREE.Vector3().addScaledVector(wf, fLong).addScaledVector(wr, fLat);
      torque.add(rel.clone().cross(Fs)).add(app.cross(Ft));
    }
    this.wheelSpin = maxSpin;
    this.grounded = contacts >= 2;
    this.offroad = offroadCount >= 2;
    this.surfaceGrip = contacts ? surfaceGripSum / contacts : 1;

    // aerodynamic drag (reduced when slipstreaming)
    const dragK = 0.5 * AIR * p.drag * this.frontArea * 1.15 * (1 - this.slipstream * 0.35);
    force.addScaledVector(this.vel, -dragK * this.speed);
    // downforce applied at body centre
    force.addScaledVector(this.up, -downforce);

    // stability management: damp excess yaw
    const yawRate = this.angVel.dot(this.up);
    if (this.grounded) {
      if (this.assists.stm && v > 8) {
        const desired = -(fwdSpeed * Math.tan(this.steerAngle)) / this.def.dims.wheelbase;
        // only counteract yaw beyond what the driver asked for (never add yaw)
        let excess;
        if (Math.sign(yawRate) !== Math.sign(desired)) excess = yawRate;
        else excess = Math.sign(yawRate) * Math.max(0, Math.abs(yawRate) - Math.abs(desired));
        const latV = this.vel.dot(this.right);
        const sliding = Math.abs(Math.atan2(latV, v));
        if (sliding > 0.12 && c.handbrake < 0.1) torque.addScaledVector(this.up, -excess * this.mass * 2.2);
      }
      // generic yaw damping & arcade drift sustain
      torque.addScaledVector(this.up, -yawRate * this.mass * 0.25);
    } else {
      // in air: dampen rotation & level out slightly
      this.angVel.multiplyScalar(1 - dt * 0.6);
      const levelAxis = _v3.copy(this.up).cross(new THREE.Vector3(0, 1, 0));
      torque.addScaledVector(levelAxis, this.mass * 2.5);
    }

    // ----- integrate -----
    this.vel.addScaledVector(force, invM * dt);
    // world inverse inertia
    _m4.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_m4);
    const localT = torque.clone().applyMatrix3(_m3.clone().transpose());
    localT.x *= this.invInertia.x;
    localT.y *= this.invInertia.y;
    localT.z *= this.invInertia.z;
    localT.applyMatrix3(_m3);
    this.angVel.addScaledVector(localT, dt);
    // clamp angular velocity
    if (this.angVel.length() > 12) this.angVel.setLength(12);

    this.pos.addScaledVector(this.vel, dt);
    const av = this.angVel;
    _q.set(av.x * dt * 0.5, av.y * dt * 0.5, av.z * dt * 0.5, 0).multiply(this.quat);
    this.quat.x += _q.x; this.quat.y += _q.y; this.quat.z += _q.z; this.quat.w += _q.w;
    this.quat.normalize();

    this._bodyGround(dt);

    // air time / drift tracking
    if (!this.grounded) this.airTime += dt; else this.airTime = 0;
    const latV = this.vel.dot(this.right);
    this.driftAngle = this.speed > 4 ? Math.atan2(latV, Math.abs(this.vel.dot(this.forward))) : 0;
    this.distance += this.speed * dt;
    if (this.collisionCooldown > 0) this.collisionCooldown -= dt;
  }

  _engineIdle(dt) {
    const p = this.p;
    const target = p.idle + this.controls.throttle * (p.redline - p.idle) * 0.92;
    this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt * 8));
    this.speed = 0;
  }

  _gearbox(dt, fwdSpeed) {
    const p = this.p;
    const c = this.controls;
    const n = this.ratios.length;
    if (this.assists.autoGear) {
      const v = fwdSpeed;
      // reverse handling
      if (this.gear >= 1 && v < 0.8 && c.brake > 0.5 && c.throttle < 0.1) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.25) { this.gear = -1; this.reverseTimer = 0; }
      } else if (this.gear === -1 && v > -0.8 && c.throttle > 0.5 && c.brake < 0.1) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.1) { this.gear = 1; this.reverseTimer = 0; }
      } else this.reverseTimer = 0;
      if (this.gear >= 1 && this.shiftTimer <= 0 && this.grounded) {
        if (this.rpm > p.redline * 0.94 && this.gear < n && this.wheelSpin < 0.4) {
          this.gear++;
          this.shiftTimer = p.shiftTime || 0.25;
          this.onShift && this.onShift(1);
        } else if (this.gear > 1) {
          const down = this.rpm * (this.ratios[this.gear - 2] / this.ratios[this.gear - 1]);
          const kick = c.throttle > 0.9 && down < p.redline * 0.82 && this.rpm < p.redline * 0.55;
          if (down < p.redline * 0.72 && (this.rpm < p.redline * 0.42 || kick)) {
            this.gear--;
            this.shiftTimer = (p.shiftTime || 0.25) * 0.7;
            this.onShift && this.onShift(-1);
          }
        }
      }
    } else {
      if (c.shiftUp) {
        c.shiftUp = false;
        if (this.gear < n) { this.gear = this.gear === -1 ? 0 : this.gear + 1; this.shiftTimer = p.shiftTime || 0.25; this.onShift && this.onShift(1); }
      }
      if (c.shiftDown) {
        c.shiftDown = false;
        if (this.gear > -1) { this.gear--; this.shiftTimer = (p.shiftTime || 0.25) * 0.7; this.onShift && this.onShift(-1); }
      }
    }
  }

  _bodyGround(dt) {
    // keep body corners above ground; resolves roll-overs and hard landings
    const he = this.halfExt;
    const pts = [
      [-he.x, -this.p.comY + this.def.dims.ride + 0.05, -he.z], [he.x, -this.p.comY + this.def.dims.ride + 0.05, -he.z],
      [-he.x, -this.p.comY + this.def.dims.ride + 0.05, he.z], [he.x, -this.p.comY + this.def.dims.ride + 0.05, he.z],
      [-he.x * 0.8, this.def.dims.height - this.p.comY, -he.z * 0.3], [he.x * 0.8, this.def.dims.height - this.p.comY, -he.z * 0.3],
      [-he.x * 0.8, this.def.dims.height - this.p.comY, he.z * 0.4], [he.x * 0.8, this.def.dims.height - this.p.comY, he.z * 0.4],
    ];
    for (const [lx, ly, lz] of pts) {
      const wp = _v3.set(lx, ly, lz - this.com.z).applyQuaternion(this.quat).add(this.pos);
      const g = this.world.groundSample(wp.x, wp.z, _ground);
      const pen = g.y - wp.y;
      if (pen > 0) {
        const n = _v4.set(g.nx, g.ny, g.nz);
        const rel = wp.clone().sub(this.pos);
        const pv = this.angVel.clone().cross(rel).add(this.vel);
        const vn = pv.dot(n);
        this.pos.addScaledVector(n, pen * 0.8);
        if (vn < 0) {
          const j = this._impulseMag(rel, n, -(1 + 0.15) * vn);
          this._applyImpulse(rel, n.clone().multiplyScalar(j));
          // friction
          const vt = pv.clone().addScaledVector(n, -vn);
          const vtl = vt.length();
          if (vtl > 0.01) {
            const tdir = vt.multiplyScalar(-1 / vtl);
            const jt = Math.min(this._impulseMag(rel, tdir, vtl), j * 0.6);
            this._applyImpulse(rel, tdir.multiplyScalar(jt));
          }
          if (-vn > 4) this._impact(-vn * 0.6, wp);
        }
      }
    }
  }

  _impulseMag(rel, n, dv) {
    // effective mass along n at offset rel
    const rn = rel.clone().cross(n);
    _m4.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_m4);
    const loc = rn.clone().applyMatrix3(_m3.clone().transpose());
    loc.x *= this.invInertia.x; loc.y *= this.invInertia.y; loc.z *= this.invInertia.z;
    loc.applyMatrix3(_m3);
    const k = 1 / this.mass + loc.cross(rel).dot(n);
    return dv / k;
  }

  _applyImpulse(rel, J) {
    this.vel.addScaledVector(J, 1 / this.mass);
    const t = rel.clone().cross(J);
    _m4.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_m4);
    const loc = t.applyMatrix3(_m3.clone().transpose());
    loc.x *= this.invInertia.x; loc.y *= this.invInertia.y; loc.z *= this.invInertia.z;
    loc.applyMatrix3(_m3);
    this.angVel.add(loc);
  }

  invMassAlong(rel, n) {
    const rn = rel.clone().cross(n);
    _m4.makeRotationFromQuaternion(this.quat);
    _m3.setFromMatrix4(_m4);
    const loc = rn.applyMatrix3(_m3.clone().transpose());
    loc.x *= this.invInertia.x; loc.y *= this.invInertia.y; loc.z *= this.invInertia.z;
    loc.applyMatrix3(_m3);
    return 1 / this.mass + loc.cross(rel).dot(n);
  }

  _impact(strength, point) {
    if (this.collisionCooldown > 0 && strength < 8) return;
    this.collisionCooldown = 0.25;
    this.impactEvents.push({ strength, point: point.clone() });
  }

  /** Update visual model from physics state. */
  syncVisual(dt) {
    const m = this.model;
    const comW = _v1.copy(this.com).applyQuaternion(this.quat);
    this.root.position.copy(this.pos).sub(comW);
    this.root.quaternion.copy(this.quat);
    for (const w of this.wheels) {
      const vis = w.vis;
      vis.pivot.position.y = w.local.y + this.p.comY - w.len;
      vis.pivot.rotation.y = w.front ? -this.steerAngle : 0;
      w.spin += w.spinVel * dt;
      vis.spin.rotation.x = -w.spin;
    }
    // shadow blob stays on the ground
    if (m.blob && m.blob.visible !== undefined) {
      const g = this.world.groundSample(this.pos.x, this.pos.z, _ground);
      const h = this.pos.y - g.y;
      m.blob.visible = h < 6;
      m.blob.material.opacity = clamp(0.85 - h * 0.15, 0, 0.85);
      const local = _v2.set(this.pos.x, g.y + 0.04, this.pos.z);
      this.root.worldToLocal(local);
      m.blob.position.copy(local);
    }
    if (!m.materials) return;
    // brake lights
    const braking = (this.gear === -1 ? this.controls.throttle : this.controls.brake) > 0.1;
    m.materials.tailMat.emissiveIntensity = braking ? 4 : this.lightsOn ? 1.4 : 0.5;
    m.materials.headMat.emissiveIntensity = this.lightsOn ? 6 : 0.6;
  }

  getState() {
    return {
      p: this.pos.toArray(), q: this.quat.toArray(), v: this.vel.toArray(), a: this.angVel.toArray(),
      rpm: this.rpm, gear: this.gear, steer: this.steerAngle,
    };
  }

  setState(s) {
    this.pos.fromArray(s.p);
    this.quat.fromArray(s.q);
    this.vel.fromArray(s.v);
    this.angVel.fromArray(s.a);
    this.rpm = s.rpm;
    this.gear = s.gear;
    this.steerAngle = s.steer;
    this._updateBasis();
  }

  dispose() {
    this.root.parent && this.root.parent.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.dispose && !o.material.userData.shared) {
        // materials of the body are per-car
      }
    });
  }
}
