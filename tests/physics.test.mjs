// Headless physics checks: acceleration, top speed, braking and cornering.
import { Heightfield } from '../src/world/Heightfield.js';
import { Colliders } from '../src/world/Colliders.js';
import { PhysicsWorld } from '../src/vehicle/PhysicsWorld.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { CARS, carStats } from '../src/config/cars.js';

// Flat test world to isolate the car model
const flat = {
  sample(x, z, out) {
    out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.surface = 6; out.grip = 1; out.drag = 0; out.bump = 0; out.road = { type: 'road' };
    return out;
  },
  heightAt() { return 0; },
};
const world = new PhysicsWorld(flat, new Colliders());
const dt = 1 / 120;
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('FAIL', msg); } };

for (const car of CARS) {
  const v = new Vehicle(car, world, { headless: true });
  world.vehicles = [v];
  v.place(0, 0, 0, 0);
  // settle
  for (let i = 0; i < 240; i++) world.step(dt);
  const settleY = v.pos.y;
  // 0-100
  v.controls.throttle = 1;
  let t = 0, t100 = null;
  while (t < 60) {
    world.step(dt); t += dt;
    if (t100 === null && v.speedKmh >= 100) t100 = t;
  }
  const top = v.speedKmh;
  // braking from current speed to 0
  v.controls.throttle = 0; v.controls.brake = 0;
  v.place(0, 0, 0, 0);
  for (let i = 0; i < 120; i++) world.step(dt);
  v.vel.copy(v.forward).multiplyScalar(100 / 3.6);
  v.controls.brake = 1;
  v.speed = v.vel.length();
  let bd = 0; t = 0;
  const start = v.pos.clone();
  while (v.speed > 0.5 && t < 20) { world.step(dt); t += dt; }
  bd = v.pos.distanceTo(start);
  // cornering: steady-state at 80 km/h with full steer
  v.place(0, 0, 0, 0);
  v.controls.brake = 0; v.controls.throttle = 0;
  for (let i = 0; i < 60; i++) world.step(dt);
  v.vel.copy(v.forward).multiplyScalar(80 / 3.6);
  let maxLat = 0, rolled = false;
  for (let i = 0; i < 600; i++) {
    v.controls.steer = 1;
    v.controls.throttle = v.speedKmh < 80 ? 0.6 : 0.2;
    world.step(dt);
    const latAcc = v.speed * Math.abs(v.angVel.y);
    if (i > 240) maxLat = Math.max(maxLat, latAcc);
    if (v.up.y < 0.3) rolled = true;
  }
  const st = carStats(car);
  console.log(`${car.name.padEnd(18)} PI ${st.pi} ${st.cls.id.padEnd(2)} settleY ${settleY.toFixed(2)} 0-100 ${t100 ? t100.toFixed(2) : '---'}s top ${top.toFixed(0)}km/h brake100 ${bd.toFixed(1)}m lat ${(maxLat / 9.81).toFixed(2)}g rolled ${rolled}`);
  check(t100 && t100 < 15, car.name + ' 0-100 too slow');
  check(top > 150, car.name + ' top speed too low');
  check(bd < 60, car.name + ' braking distance too long');
  check(!rolled, car.name + ' rolled over in steady cornering');
  check(Number.isFinite(v.pos.x), car.name + ' NaN');
}

// Real island: drive along the highway briefly to make sure ground queries work
const hf = new Heightfield();
hf.build();
const w2 = new PhysicsWorld(hf, new Colliders());
const v = new Vehicle(CARS[0], w2, { headless: true });
w2.add(v);
const r = hf.roads.roads[0];
v.place(r.x[100], r.y[100], r.z[100], Math.atan2(-r.tx[100], -r.tz[100]));
for (let i = 0; i < 600; i++) { v.controls.throttle = 0.5; w2.step(dt); }
const near = hf.roads.nearest(v.pos.x, v.pos.z, 50);
console.log('island run: speed', v.speedKmh.toFixed(0), 'height above road', (v.pos.y - near.y).toFixed(2), 'dist to centre', near.dist.toFixed(1));
check(Math.abs(v.pos.y - near.y - v.p.comY) < 0.5, 'car not resting on road');
if (failures) { console.log(failures, 'failures'); process.exit(1); }
console.log('all physics checks passed');
