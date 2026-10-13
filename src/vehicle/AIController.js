import { clamp, lerp } from '../core/utils.js';

export const DIFFICULTY = {
  easy: { pace: 0.8, aggression: 0.3, rubber: 0.08 },
  medium: { pace: 0.88, aggression: 0.5, rubber: 0.06 },
  hard: { pace: 0.95, aggression: 0.7, rubber: 0.04 },
  unbeatable: { pace: 1.0, aggression: 0.9, rubber: 0.03 },
};

/**
 * Drives a vehicle along a Route: pure-pursuit steering on the racing line,
 * speed from a curvature/braking profile, simple overtaking and recovery.
 */
export class AIController {
  constructor(vehicle, route, opts = {}) {
    this.v = vehicle;
    this.route = route;
    this.skill = opts.skill ?? 1;
    this.diff = DIFFICULTY[opts.difficulty || 'medium'];
    this.cruise = opts.cruise || null; // m/s cap for ambient traffic
    this.laneOffset = opts.laneOffset ?? null; // fixed lateral offset (traffic keeps right)
    vehicle.assists.steerAssist = false;
    this.hint = -1;
    this.lateral = 0;
    this.targetLateral = 0;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.rubber = 1;
    this.s = 0;
    this.onRespawn = null;
    this._buildProfile();
  }

  _buildProfile() {
    const p = this.v.p;
    const grip = 0.9 * p.grip + Math.min(0.3, p.downforce * 0.05);
    const pace = this.cruise ? 0.7 : this.diff.pace * this.skill;
    this.profile = this.route.speedProfile(grip * pace, 0.85 * p.brake * (0.85 + p.grip * 0.15), this.cruise || 120, p.offroad);
    this.gripG = grip;
  }

  setRoute(route) {
    this.route = route;
    this.hint = -1;
    this._buildProfile();
  }

  update(dt, others = []) {
    const v = this.v;
    const r = this.route;
    const c = v.controls;
    const proj = r.project(v.pos.x, v.pos.z, this.hint, 40);
    this.hint = proj.i;
    this.s = proj.s;
    const speed = v.speed;

    // recovery from crashes / getting stuck
    if (speed < 1.5 && !v.frozen) this.stuckTime += dt; else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    if (proj.dist > 30 || v.up.y < 0.2 || this.stuckTime > 6) {
      this.lastReason = proj.dist > 30 ? 'offroute' : v.up.y < 0.2 ? 'flipped' : 'stuck';
      this.respawn();
      return;
    }
    if (this.stuckTime > 2.5 && this.reverseTime <= 0) this.reverseTime = 1.4;
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.steer = -Math.sign(proj.lat) * 0.8;
      c.steerAngle = c.steer * 0.5;
      c.handbrake = 0;
      if (this.reverseTime <= 0) this.stuckTime = 0;
      return;
    }

    // overtaking / avoidance: shift lateral target away from cars ahead
    let avoid = 0;
    for (const o of others) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const ahead = dx * v.forward.x + dz * v.forward.z;
      if (ahead < 0 || ahead > 22) continue;
      const side = dx * v.right.x + dz * v.right.z;
      if (Math.abs(side) > 3.2) continue;
      const closing = v.vel.dot(v.forward) - o.vel.dot(v.forward);
      if (closing < 1 && ahead > 8) continue;
      avoid += (side > 0 ? -1 : 1) * (1 - ahead / 22) * 3.2;
    }
    const hw = r.hw[proj.i];
    if (this.laneOffset !== null) {
      this.targetLateral = clamp(this.laneOffset + avoid * 0.5, -hw + 1.2, hw - 1.2);
    } else {
      this.targetLateral = clamp(avoid * this.diff.aggression * 1.4, -hw + 1.5, hw - 1.5);
    }
    this.lateral = lerp(this.lateral, this.targetLateral, 1 - Math.exp(-dt * 1.5));

    // pure pursuit target on racing line (+ lateral offset)
    const look = (8 + speed * 0.75) / (1 + Math.abs(proj.lat - this.lateral) / 8);
    const tp = r.pointAtS(proj.s + look);
    const useLine = this.laneOffset === null;
    let tx = useLine ? tp.lx : tp.x, tz = useLine ? tp.lz : tp.z;
    const rx = -tp.tz, rz = tp.tx;
    tx += rx * this.lateral;
    tz += rz * this.lateral;
    const dx = tx - v.pos.x, dz = tz - v.pos.z;
    const localX = dx * v.right.x + dz * v.right.z;
    const localZ = dx * v.forward.x + dz * v.forward.z;
    // pure pursuit: curvature = 2 * x / L^2
    const ld2 = Math.max(4, localX * localX + localZ * localZ);
    const wb = v.def.dims.wheelbase;
    let delta = Math.atan((2 * wb * localX) / ld2);
    if (localZ < 0) delta = Math.sign(localX || 1) * 1;
    // never ask for more lateral acceleration than the tyres can give
    const aMax = this.gripG * 9.81 * 1.15;
    const gripDelta = Math.atan((wb * aMax) / Math.max(1, speed * speed)) * 4 + 0.02;
    delta = clamp(delta, -gripDelta, gripDelta);
    const lock = (v.p.steer * Math.PI) / 180;
    const maxSteer = lock / (1 + (speed * speed) / 1100);
    // wheel angle: path following within the speed-dependent range, plus counter-steer
    const d = v.driftAngle;
    const counter = Math.sign(d) * Math.max(0, Math.abs(d) - 0.1) * 0.95;
    const angle = clamp(delta, -maxSteer, maxSteer) + clamp(counter, -lock * 0.8, lock * 0.8);
    c.steerAngle = lerp(c.steerAngle ?? 0, angle, 1 - Math.exp(-dt * 12));
    c.steer = clamp(c.steerAngle / Math.max(0.05, maxSteer), -1, 1);

    // speed target: minimum of profile within braking horizon
    let target = Infinity;
    const horizon = 15 + (speed * speed) / (2 * 7);
    const step = 4;
    for (let d = 0; d < horizon; d += step) {
      const i = r.indexAtS(proj.s + d);
      const vt = this.profile[i];
      // allow decelerating to vt over distance d
      const allowed = Math.sqrt(vt * vt + 2 * 7.5 * v.p.brake * d);
      if (allowed < target) target = allowed;
    }
    if (!r.closed && proj.s > r.length - 6) {
      // end of the route: roll to a stop without the gearbox engaging reverse
      c.throttle = 0;
      c.brake = speed > 1.5 ? 0.6 : 0;
      c.handbrake = speed <= 1.5 ? 1 : 0;
      return;
    }
    target *= this.rubber;
    if (this.cruise) target = Math.min(target, this.cruise);
    const err = target - speed;
    c.throttle = clamp(err * 0.4 + 0.25, 0, 1);
    c.brake = clamp(-err * 0.18, 0, 1);
    if (err < -1) c.throttle = 0;
    // traction-aware: ease off when steering hard or sliding
    c.throttle *= 1 - clamp((Math.abs(c.steer) - 0.55) * 1.4, 0, 0.7);
    if (Math.abs(v.driftAngle) > 0.25) c.throttle *= 0.5;
    c.handbrake = 0;
    // avoid running into someone directly ahead in traffic
    if (this.cruise && avoid !== 0 && Math.abs(avoid) > 2) {
      c.throttle *= 0.3;
    }
    // power boost for rubber banding
    v.aiPowerScale = this.rubber;
  }

  respawn() {
    const r = this.route;
    const i = r.indexAtS(this.s - 5);
    const v = this.v;
    v.place(r.x[i], r.y[i], r.z[i], r.heading(i));
    v.vel.set(-Math.sin(r.heading(i)), 0, -Math.cos(r.heading(i))).multiplyScalar(8);
    this.hint = i;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.onRespawn && this.onRespawn();
  }
}
