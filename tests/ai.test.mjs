// Headless AI driving check: AI must complete routes without excessive respawns.
import { Heightfield } from '../src/world/Heightfield.js';
import { Colliders } from '../src/world/Colliders.js';
import { PhysicsWorld } from '../src/vehicle/PhysicsWorld.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { AIController } from '../src/vehicle/AIController.js';
import { Route } from '../src/gameplay/Route.js';
import { CARS } from '../src/config/cars.js';
import { buildRails } from '../src/world/RoadMesh.js';

const hf = new Heightfield();
hf.build();
const colliders = new Colliders();
buildRails(hf, colliders);
const world = new PhysicsWorld(hf, colliders);
const dt = 1 / 120;
let fail = 0;
const routes = {
  forest: () => { const r = hf.roads.roads.find((x) => x.id === 'forest'); return new Route(hf.roads.walkDistance(r, 0, r.length, 1), true); },
  pass: () => { const r = hf.roads.roads.find((x) => x.id === 'pass'); return new Route(hf.roads.walkDistance(r, 0, r.length, 1), false); },
  town: () => {
    const wp = [[650, 300], [950, 300], [950, 600], [650, 600]];
    const pts = [];
    for (let k = 0; k < wp.length; k++) {
      const a = wp[k], b = wp[(k + 1) % wp.length];
      const seg = hf.roads.route(a[0], a[1], b[0], b[1]);
      if (pts.length) seg.shift();
      pts.push(...seg);
    }
    return new Route(pts, true);
  },
  highway: () => { const r = hf.roads.roads[0]; return new Route(hf.roads.walkDistance(r, 0, r.length, 1), true); },
};
for (const [name, mk] of Object.entries(routes)) {
  for (const carId of ['vela', 'falco']) {
    const route = mk();
    const v = new Vehicle(CARS.find((c) => c.id === carId), world, { headless: true });
    world.vehicles = [v];
    const ai = new AIController(v, route, { difficulty: 'hard' });
    let respawns = 0;
    const ring = [];
    ai.onRespawn = () => { respawns++; if (process.env.DBG) { console.log('  respawn', ai.lastReason, 's', ai.s.toFixed(0), 'at', v.pos.x.toFixed(0), v.pos.z.toFixed(0), 'kmh', v.speedKmh.toFixed(0)); if (process.env.DBG === '2') console.log(ring.join('\n')); } };
    v.place(route.x[0], route.y[0], route.z[0], route.heading(0));
    let t = 0, dist = 0, maxLat = 0;
    const limit = route.closed ? route.length : route.length - 20;
    let laps = 0, lastS = -1, progress = 0;
    while (t < 400) {
      ai.update(dt, []);
      world.step(dt);
      if (process.env.DBG === '2' && Math.round(t * 120) % 15 === 0) {
        const pr0 = route.project(v.pos.x, v.pos.z, ai.hint, 10);
        ring.push(`    t ${t.toFixed(2)} s ${ai.s.toFixed(0)} kmh ${v.speedKmh.toFixed(0)} lat ${pr0.lat.toFixed(1)} hw ${route.hw[pr0.i]} steer ${v.controls.steer.toFixed(2)} thr ${v.controls.throttle.toFixed(2)} brk ${v.controls.brake.toFixed(2)} drift ${v.driftAngle.toFixed(2)} gr ${v.grounded} prof ${(ai.profile[pr0.i] * 3.6).toFixed(0)} curv ${route.curv[pr0.i].toFixed(4)} upY ${v.up.y.toFixed(2)}`);
        if (ring.length > 16) ring.shift();
      }
      t += dt;
      const s = ai.s;
      if (lastS >= 0) {
        let ds = s - lastS;
        if (route.closed && ds < -route.length / 2) ds += route.length;
        if (route.closed && ds > route.length / 2) ds -= route.length;
        progress += ds;
      }
      lastS = s;
      laps = Math.floor(progress / route.length);
      const pr = route.project(v.pos.x, v.pos.z, ai.hint, 10);
      maxLat = Math.max(maxLat, Math.abs(pr.lat) - route.hw[pr.i]);
      if ((route.closed && laps >= 1) || (!route.closed && s >= limit)) break;
    }
    const done = route.closed ? laps >= 1 : ai.s >= limit;
    const avg = (route.length / t) * 3.6;
    console.log(`${name.padEnd(8)} ${carId.padEnd(6)} len ${route.length.toFixed(0)}m time ${t.toFixed(1)}s avg ${avg.toFixed(0)}km/h respawns ${respawns} maxOffRoad ${maxLat.toFixed(1)}m ${done ? 'OK' : 'DNF'}`);
    if (!done || respawns > 2) fail++;
  }
}
if (fail) { console.log(fail, 'AI failures'); process.exit(1); }
console.log('AI checks passed');
