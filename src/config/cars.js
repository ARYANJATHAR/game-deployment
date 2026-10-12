// Car roster. All names are fictional. Visual profiles drive the procedural
// model builder; physics values drive the vehicle simulation.

export const CLASSES = [
  { id: 'D', max: 500, color: '#3fb0ff' },
  { id: 'C', max: 600, color: '#f5d31d' },
  { id: 'B', max: 700, color: '#ff8a1f' },
  { id: 'A', max: 800, color: '#ff3b3b' },
  { id: 'S1', max: 900, color: '#b04bff' },
  { id: 'S2', max: 998, color: '#2f6bff' },
  { id: 'X', max: 999, color: '#3ee06b' },
];

export function classFor(pi) {
  for (const c of CLASSES) if (pi <= c.max) return c;
  return CLASSES[CLASSES.length - 1];
}

export const PAINTS = [
  '#d0021b', '#ff5a1f', '#ffb000', '#f2e600', '#2ecc71', '#0a8f5a', '#00b8d9', '#1e6bff',
  '#1a2a6c', '#7b2ff7', '#ff2d87', '#ffffff', '#c0c4c8', '#6b7078', '#26282c', '#0b0b0c',
  '#8a5a2b', '#b8a07a', '#3d5a3a', '#7a1020',
];

export const RIM_COLORS = ['#c9ccd1', '#1b1c1f', '#c8a24a', '#e8e8e8', '#5a5e66', '#b5352d'];

export const CARS = [
  {
    id: 'vela',
    pi: 452,
    name: 'Vela GTi',
    make: 'Vela',
    year: 2008,
    price: 18000,
    style: 'hatch',
    desc: 'Nimble front-drive hot hatch. Forgiving, cheap and cheerful.',
    dims: { length: 4.05, width: 1.76, height: 1.45, wheelbase: 2.55, track: 1.52, wheelR: 0.31, wheelW: 0.22, ride: 0.16 },
    paint: '#d0021b',
    rim: '#c9ccd1',
    phys: {
      mass: 1250, drive: 'FWD', torque: 300, peakRpm: 4200, redline: 6800, idle: 900,
      gears: [3.4, 2.1, 1.48, 1.12, 0.9, 0.76], final: 3.9, grip: 1.0, brake: 1.0,
      downforce: 0.0, drag: 0.34, steer: 34, weightFront: 0.61, comY: 0.5, offroad: 0.35,
      sound: { cyl: 4, tone: 0.9, rasp: 0.5 },
    },
  },
  {
    id: 'mira',
    pi: 418,
    name: 'Mira Spider',
    make: 'Mira',
    year: 1967,
    price: 24000,
    style: 'roadster',
    desc: 'Classic open-top roadster. Light, playful, rear-wheel drive.',
    dims: { length: 3.95, width: 1.62, height: 1.22, wheelbase: 2.3, track: 1.36, wheelR: 0.3, wheelW: 0.18, ride: 0.15 },
    paint: '#0a8f5a',
    rim: '#e8e8e8',
    phys: {
      mass: 960, drive: 'RWD', torque: 205, peakRpm: 4800, redline: 7200, idle: 850,
      gears: [3.3, 2.0, 1.4, 1.0, 0.82], final: 4.1, grip: 0.92, brake: 0.85,
      downforce: 0.0, drag: 0.4, steer: 36, weightFront: 0.52, comY: 0.45, offroad: 0.3,
      sound: { cyl: 4, tone: 1.0, rasp: 0.8 },
    },
  },
  {
    id: 'stallion',
    pi: 548,
    name: 'Stallion GT 500',
    make: 'Stallion',
    year: 1969,
    price: 48000,
    style: 'muscle',
    desc: 'Big-block V8 muscle. Huge torque, loves to slide.',
    dims: { length: 4.75, width: 1.88, height: 1.32, wheelbase: 2.75, track: 1.58, wheelR: 0.34, wheelW: 0.26, ride: 0.17 },
    paint: '#1e6bff',
    rim: '#c9ccd1',
    stripes: true,
    phys: {
      mass: 1560, drive: 'RWD', torque: 640, peakRpm: 3600, redline: 6200, idle: 750,
      gears: [2.8, 1.85, 1.35, 1.0, 0.8], final: 3.5, grip: 0.95, brake: 0.9,
      downforce: 0.0, drag: 0.42, steer: 32, weightFront: 0.56, comY: 0.52, offroad: 0.3,
      sound: { cyl: 8, tone: 0.55, rasp: 0.9 },
    },
  },
  {
    id: 'raiden',
    pi: 641,
    name: 'Raiden RS',
    make: 'Raiden',
    year: 1999,
    price: 56000,
    style: 'coupe',
    desc: 'Turbo inline-six coupe. A legendary drift machine.',
    dims: { length: 4.5, width: 1.79, height: 1.33, wheelbase: 2.67, track: 1.5, wheelR: 0.32, wheelW: 0.24, ride: 0.14 },
    paint: '#ffffff',
    rim: '#1b1c1f',
    spoiler: 'wing',
    phys: {
      mass: 1360, drive: 'RWD', torque: 470, peakRpm: 4600, redline: 7800, idle: 900,
      gears: [3.25, 2.0, 1.45, 1.1, 0.9, 0.75], final: 3.7, grip: 1.03, brake: 1.0,
      downforce: 0.4, drag: 0.33, steer: 40, weightFront: 0.53, comY: 0.47, offroad: 0.3,
      sound: { cyl: 6, tone: 0.8, rasp: 0.7, turbo: true },
    },
  },
  {
    id: 'kaito',
    pi: 662,
    name: 'Kaito Rally Evo',
    make: 'Kaito',
    year: 2006,
    price: 65000,
    style: 'rally',
    desc: 'All-wheel-drive rally hero. Sublime on dirt and tarmac.',
    dims: { length: 4.45, width: 1.77, height: 1.45, wheelbase: 2.62, track: 1.53, wheelR: 0.32, wheelW: 0.22, ride: 0.2 },
    paint: '#1a2a6c',
    rim: '#c8a24a',
    spoiler: 'wing',
    phys: {
      mass: 1340, drive: 'AWD', awdFront: 0.42, torque: 480, peakRpm: 4000, redline: 7400, idle: 900,
      gears: [3.1, 2.05, 1.5, 1.15, 0.92, 0.78], final: 4.0, grip: 1.04, brake: 1.0,
      downforce: 0.3, drag: 0.36, steer: 36, weightFront: 0.58, comY: 0.5, offroad: 0.8,
      sound: { cyl: 4, tone: 0.75, rasp: 0.85, turbo: true },
    },
  },
  {
    id: 'titan',
    pi: 523,
    name: 'Titan Trail 4x4',
    make: 'Titan',
    year: 2021,
    price: 52000,
    style: 'truck',
    desc: 'Lifted off-road pickup. Goes anywhere, fast.',
    dims: { length: 5.3, width: 2.05, height: 1.95, wheelbase: 3.3, track: 1.75, wheelR: 0.43, wheelW: 0.32, ride: 0.32 },
    paint: '#ff5a1f',
    rim: '#1b1c1f',
    phys: {
      mass: 2350, drive: 'AWD', awdFront: 0.45, torque: 700, peakRpm: 3800, redline: 6000, idle: 700,
      gears: [3.6, 2.2, 1.55, 1.15, 0.87, 0.69], final: 3.7, grip: 0.92, brake: 0.95,
      downforce: 0.0, drag: 0.55, steer: 32, weightFront: 0.55, comY: 0.78, offroad: 1.0,
      suspension: { freq: 1.25, travel: 0.32 },
      sound: { cyl: 8, tone: 0.5, rasp: 0.7, turbo: true },
    },
  },
  {
    id: 'vanta',
    pi: 758,
    name: 'Vanta S',
    make: 'Vanta',
    year: 2019,
    price: 125000,
    style: 'sports',
    desc: 'Rear-engined precision sports car. Fast, sharp, rewarding.',
    dims: { length: 4.5, width: 1.85, height: 1.29, wheelbase: 2.45, track: 1.58, wheelR: 0.34, wheelW: 0.27, ride: 0.12 },
    paint: '#ffb000',
    rim: '#5a5e66',
    spoiler: 'ducktail',
    phys: {
      mass: 1450, drive: 'RWD', torque: 650, peakRpm: 5000, redline: 7500, idle: 900,
      gears: [3.9, 2.3, 1.65, 1.3, 1.08, 0.88, 0.72], final: 3.4, grip: 1.12, brake: 1.15,
      downforce: 0.9, drag: 0.32, steer: 36, weightFront: 0.4, comY: 0.44, offroad: 0.2,
      sound: { cyl: 6, tone: 0.95, rasp: 0.6, turbo: true },
    },
  },
  {
    id: 'falco',
    pi: 866,
    name: 'Falco V12',
    make: 'Falco',
    year: 2022,
    price: 290000,
    style: 'supercar',
    desc: 'Mid-engine V12 supercar with all-wheel drive. Screams to 9000 rpm.',
    dims: { length: 4.75, width: 2.03, height: 1.14, wheelbase: 2.7, track: 1.7, wheelR: 0.35, wheelW: 0.3, ride: 0.1 },
    paint: '#7b2ff7',
    rim: '#1b1c1f',
    spoiler: 'wing',
    phys: {
      mass: 1550, drive: 'AWD', awdFront: 0.3, torque: 720, peakRpm: 6500, redline: 9000, idle: 1000,
      gears: [3.5, 2.4, 1.85, 1.48, 1.22, 1.02, 0.84], final: 3.1, grip: 1.2, brake: 1.3,
      downforce: 1.6, drag: 0.33, steer: 34, weightFront: 0.43, comY: 0.4, offroad: 0.15,
      sound: { cyl: 12, tone: 1.25, rasp: 0.55 },
    },
  },
  {
    id: 'zenith',
    pi: 957,
    name: 'Zenith Hyper-R',
    make: 'Zenith',
    year: 2024,
    price: 1200000,
    style: 'hyper',
    desc: 'Twin-turbo hypercar. Over 1200 hp of pure velocity.',
    dims: { length: 4.65, width: 2.05, height: 1.1, wheelbase: 2.72, track: 1.72, wheelR: 0.36, wheelW: 0.33, ride: 0.09 },
    paint: '#26282c',
    rim: '#c9ccd1',
    spoiler: 'wing',
    phys: {
      mass: 1400, drive: 'RWD', torque: 1350, peakRpm: 5200, redline: 8500, idle: 1000,
      gears: [3.2, 2.25, 1.75, 1.42, 1.17, 0.98, 0.82], final: 3.0, grip: 1.25, brake: 1.4,
      downforce: 2.2, drag: 0.3, steer: 32, weightFront: 0.42, comY: 0.38, offroad: 0.1,
      sound: { cyl: 8, tone: 1.05, rasp: 0.65, turbo: true },
    },
  },
  {
    id: 'apex',
    pi: 999,
    name: 'Apex LMP-X',
    make: 'Apex',
    year: 2025,
    price: 2500000,
    style: 'prototype',
    desc: 'Le Mans prototype for the road. Absurd downforce and grip.',
    dims: { length: 4.9, width: 2.0, height: 1.06, wheelbase: 3.0, track: 1.68, wheelR: 0.36, wheelW: 0.33, ride: 0.08 },
    paint: '#f2e600',
    rim: '#1b1c1f',
    spoiler: 'lmp',
    phys: {
      mass: 1050, drive: 'RWD', torque: 900, peakRpm: 7200, redline: 9500, idle: 1200,
      gears: [3.1, 2.3, 1.8, 1.47, 1.22, 1.02, 0.87], final: 3.1, grip: 1.35, brake: 1.6,
      downforce: 3.6, drag: 0.38, steer: 28, weightFront: 0.44, comY: 0.34, offroad: 0.05,
      sound: { cyl: 10, tone: 1.35, rasp: 0.5 },
    },
  },
];

export const UPGRADES = {
  engine: { name: 'Engine', levels: ['Stock', 'Street', 'Sport', 'Race'], cost: [0, 6000, 14000, 30000], torque: [1, 1.12, 1.26, 1.42] },
  weight: { name: 'Weight Reduction', levels: ['Stock', 'Street', 'Sport', 'Race'], cost: [0, 3000, 8000, 18000], mass: [1, 0.95, 0.9, 0.84] },
  tires: { name: 'Tires', levels: ['Stock', 'Street', 'Sport', 'Race'], cost: [0, 2500, 6000, 15000], grip: [1, 1.05, 1.11, 1.18], offroad: [1, 1, 0.9, 0.75] },
  aero: { name: 'Aero', levels: ['Stock', 'Sport', 'Race', 'Extreme'], cost: [0, 4000, 9000, 16000], down: [0, 0.6, 1.2, 2.0] },
  gearbox: { name: 'Transmission', levels: ['Stock', 'Street', 'Sport', 'Race'], cost: [0, 3000, 7000, 15000], shift: [0.32, 0.24, 0.16, 0.08] },
  offroad: { name: 'Off-road Kit', levels: ['Stock', 'Rally', 'Trophy'], cost: [0, 7000, 16000], rough: [0, 0.25, 0.5] },
};

/** Applies upgrades to a car's physics description. */
export function effectivePhys(car, upg = {}) {
  const p = { ...car.phys };
  const u = { engine: 0, weight: 0, tires: 0, aero: 0, gearbox: 0, offroad: 0, ...upg };
  p.torque = car.phys.torque * UPGRADES.engine.torque[u.engine];
  p.mass = car.phys.mass * UPGRADES.weight.mass[u.weight];
  p.grip = car.phys.grip * UPGRADES.tires.grip[u.tires];
  p.offroad = Math.min(1, car.phys.offroad * UPGRADES.tires.offroad[u.tires] + UPGRADES.offroad.rough[u.offroad]);
  p.downforce = car.phys.downforce + UPGRADES.aero.down[u.aero];
  p.shiftTime = UPGRADES.gearbox.shift[u.gearbox];
  return p;
}

function rawScore(car, p) {
  const kw = (p.torque * p.peakRpm * 1.15) / 9549;
  const pw = kw / (p.mass / 1000);
  const vmax = Math.cbrt((kw * 1000) / (0.5 * 1.225 * p.drag * car.dims.width * car.dims.height * 0.85 * 1.15)) * 3.6;
  const gripScore = (p.grip - 0.85) / 0.55 + p.downforce / 7 + (p.drive === 'AWD' ? 0.08 : 0) - (p.mass - 1300) / 6000;
  return { score: 0.5 * Math.pow(pw / 750, 0.7) + 0.32 * gripScore + 0.18 * (vmax / 450), kw, pw, vmax };
}

/** Performance stats 0..10 and PI (base PI per car plus upgrade gains). */
export function carStats(car, upg = {}) {
  const p = effectivePhys(car, upg);
  const stock = rawScore(car, effectivePhys(car, {}));
  const cur = rawScore(car, p);
  const pi = Math.max(100, Math.min(999, Math.round(car.pi + (cur.score - stock.score) * 900)));
  const { kw, pw, vmax } = cur;
  const speed = Math.max(1, Math.min(10, (vmax - 150) / 30));
  const accel = Math.max(1, Math.min(10, pw / 65 + (p.drive === 'AWD' ? 1.2 : 0)));
  const handling = Math.max(1, Math.min(10, (p.grip - 0.8) * 12 + p.downforce * 0.8 - (p.mass - 1300) / 700 + 1.5));
  const launch = Math.max(1, Math.min(10, accel * 0.6 + (p.drive === 'AWD' ? 3 : p.drive === 'FWD' ? 1 : 1.5) + p.grip));
  const braking = Math.max(1, Math.min(10, p.brake * 4.5 + p.downforce * 0.6 + p.grip * 1.5 - (p.mass - 1300) / 900));
  const offroad = Math.max(1, Math.min(10, p.offroad * 10));
  return { speed, accel, handling, launch, braking, offroad, pi, kw, cls: classFor(pi) };
}
