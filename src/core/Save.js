// Persistent progress and settings in localStorage.

const KEY = 'horizon-rush-save-v1';

export const DEFAULT_SETTINGS = {
  quality: 'medium', // low | medium | high
  shadows: 'medium',
  bloom: true,
  units: 'kmh',
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.9,
  difficulty: 'medium', // easy | medium | hard | unbeatable
  assists: { abs: true, tcs: true, stm: true, autoGear: true, steerAssist: true, brakingLine: 'braking' },
  camera: 0,
  fov: 62,
  timeCycle: true,
  timeOfDay: 15.5,
  weather: 'dynamic',
  season: 'summer',
  showMinimap: true,
  motionBlur: true,
  traffic: true,
  invertLook: false,
  ghost: true,
};

export function defaultProgress() {
  return {
    credits: 40000,
    xp: 0,
    level: 1,
    skillPoints: 0,
    garage: [], // {uid, id, paint, finish, rim, upgrades}
    current: null, // uid
    events: {}, // id -> {best, stars, position}
    activities: {}, // id -> {best, stars}
    boards: [], // smashed XP board ids
    barns: [], // found barn ids
    accolades: [], // unlocked accolade ids
    discovered: [], // road ids driven
    stats: {
      distance: 0, races: 0, wins: 0, drifts: 0, airtime: 0, topSpeed: 0, smashed: 0, crashes: 0,
      nearMisses: 0, bestChain: 0, nightDistance: 0, bestDrift: 0, bestAir: 0,
    },
    wheelspins: 1,
    intro: false,
    pos: null,
    created: Date.now(),
  };
}

export class Save {
  constructor() {
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.progress = defaultProgress();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.settings = { ...this.settings, ...(d.settings || {}), assists: { ...this.settings.assists, ...((d.settings || {}).assists || {}) } };
      this.progress = { ...defaultProgress(), ...(d.progress || {}) };
      this.progress.stats = { ...defaultProgress().stats, ...(this.progress.stats || {}) };
    } catch (e) {
      console.warn('save load failed', e);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: this.settings, progress: this.progress }));
    } catch (e) {
      /* storage may be unavailable */
    }
  }

  reset() {
    this.progress = defaultProgress();
    this.save();
  }

  get currentCar() {
    return this.progress.garage.find((c) => c.uid === this.progress.current) || this.progress.garage[0] || null;
  }

  addCar(id, paint, extra = {}) {
    const uid = `${id}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;
    const entry = { uid, id, paint, finish: 'gloss', rim: null, upgrades: {}, ...extra };
    this.progress.garage.push(entry);
    return entry;
  }
}

export function xpForLevel(level) {
  return Math.round(1500 * Math.pow(level, 1.35));
}
