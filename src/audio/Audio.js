// WebAudio synthesis: engines, tyres, wind, impacts, UI sounds and music.
// Nothing is sampled; every sound is generated at runtime.

import { clamp, lerp } from '../core/utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volumes = { master: 0.8, music: 0.5, sfx: 0.9 };
    this.engines = new Set();
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.noiseBuf = this._noiseBuffer(2);
    // shared reverb-ish delay for music
    this.applyVolumes();
    this.enabled = true;
    this.music = new Music(this);
    this.ambient = new Ambient(this);
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  // ---------- one-shots ----------
  blip(freq = 880, dur = 0.08, type = 'sine', gain = 0.2, slide = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  uiMove() { this.blip(1200, 0.04, 'triangle', 0.08); }
  uiSelect() { this.blip(700, 0.07, 'triangle', 0.14); this.blip(1400, 0.1, 'sine', 0.08); }
  uiBack() { this.blip(500, 0.08, 'triangle', 0.12, -150); }
  checkpoint() { this.blip(1046, 0.12, 'sine', 0.2); setTimeout(() => this.blip(1568, 0.18, 'sine', 0.18), 70); }
  countdown(go) { this.blip(go ? 1320 : 660, go ? 0.5 : 0.22, 'square', 0.12); }
  skill(level = 0) { this.blip(660 + level * 90, 0.09, 'triangle', 0.12); }
  bank() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.12, 'triangle', 0.13), i * 55)); }
  fanfare() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'sawtooth', 0.07), i * 110)); }
  cash() { [1318, 1568, 2093].forEach((f, i) => setTimeout(() => this.blip(f, 0.08, 'square', 0.06), i * 50)); }

  impact(strength) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600 + strength * 120;
    const g = ctx.createGain();
    const v = clamp(strength / 18, 0.08, 1) * 0.9;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + strength * 0.01);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + 0.6);
    // thump
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    og.gain.setValueAtTime(v * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
    // metal scrape ring for big hits
    if (strength > 8) this.blip(180 + Math.random() * 120, 0.4, 'sawtooth', 0.05, -60);
  }

  smash() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + 0.35);
    this.blip(300, 0.12, 'square', 0.06, -150);
  }

  shift() {
    if (!this.enabled) return;
    this.blip(90, 0.06, 'square', 0.08, -30);
  }

  horn(on) {
    if (!this.enabled) return;
    if (on && !this.hornNodes) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0.08;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2200;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = o2.type = 'square';
      o1.frequency.value = 415;
      o2.frequency.value = 523;
      o1.connect(f); o2.connect(f);
      f.connect(g).connect(this.sfx);
      o1.start(); o2.start();
      this.hornNodes = { o1, o2, g };
    } else if (!on && this.hornNodes) {
      const { o1, o2, g } = this.hornNodes;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      o1.stop(this.ctx.currentTime + 0.1);
      o2.stop(this.ctx.currentTime + 0.1);
      this.hornNodes = null;
    }
  }

  createEngine(vehicle, isPlayer) {
    if (!this.enabled) return null;
    const e = new EngineSound(this, vehicle, isPlayer);
    this.engines.add(e);
    return e;
  }

  destroyEngine(e) {
    if (!e) return;
    e.stop();
    this.engines.delete(e);
  }

  setListener(pos, fwd, up) {
    if (!this.enabled) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  suspend(paused) {
    if (!this.ctx) return;
    for (const e of this.engines) e.mute(paused);
    if (this.ambient) this.ambient.mute(paused);
  }
}

function makeDistortion(ctx, amount) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = curve;
  return ws;
}

/** Synthesised engine + tyre + wind for one vehicle. */
class EngineSound {
  constructor(audio, vehicle, isPlayer) {
    this.audio = audio;
    this.v = vehicle;
    this.isPlayer = isPlayer;
    const ctx = audio.ctx;
    const snd = vehicle.p.sound || { cyl: 4, tone: 1, rasp: 0.6 };
    this.snd = snd;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    if (isPlayer) {
      this.out.connect(audio.sfx);
    } else {
      this.panner = ctx.createPanner();
      this.panner.panningModel = 'equalpower';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 6;
      this.panner.maxDistance = 400;
      this.panner.rolloffFactor = 1.4;
      this.out.connect(this.panner).connect(audio.sfx);
    }
    // engine voices
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'square';
    this.o3 = ctx.createOscillator();
    this.o3.type = 'sawtooth';
    this.g1 = ctx.createGain(); this.g1.gain.value = 0.5;
    this.g2 = ctx.createGain(); this.g2.gain.value = 0.35;
    this.g3 = ctx.createGain(); this.g3.gain.value = 0.18;
    this.dist = makeDistortion(ctx, 4 + snd.rasp * 18);
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 2.5;
    this.peak = ctx.createBiquadFilter();
    this.peak.type = 'peaking';
    this.peak.gain.value = 6;
    this.peak.Q.value = 1.2;
    this.engGain = ctx.createGain();
    this.o1.connect(this.g1).connect(this.dist);
    this.o2.connect(this.g2).connect(this.dist);
    this.o3.connect(this.g3).connect(this.dist);
    this.dist.connect(this.lp).connect(this.peak).connect(this.engGain).connect(this.out);
    // intake noise
    this.intake = audio.noise();
    this.intakeF = ctx.createBiquadFilter();
    this.intakeF.type = 'bandpass';
    this.intakeF.Q.value = 1.5;
    this.intakeG = ctx.createGain();
    this.intakeG.gain.value = 0;
    this.intake.connect(this.intakeF).connect(this.intakeG).connect(this.out);
    this.o1.start(); this.o2.start(); this.o3.start(); this.intake.start();
    if (snd.turbo) {
      this.turbo = ctx.createOscillator();
      this.turbo.type = 'sine';
      this.turboG = ctx.createGain();
      this.turboG.gain.value = 0;
      this.turbo.connect(this.turboG).connect(this.out);
      this.turbo.start();
    }
    if (isPlayer) {
      // tyre screech
      this.tyre = audio.noise();
      this.tyreF = ctx.createBiquadFilter();
      this.tyreF.type = 'bandpass';
      this.tyreF.frequency.value = 1100;
      this.tyreF.Q.value = 6;
      this.tyreG = ctx.createGain();
      this.tyreG.gain.value = 0;
      this.tyre.connect(this.tyreF).connect(this.tyreG).connect(this.out);
      this.tyre.start(0, Math.random());
      // gravel / off-road rumble
      this.gravel = audio.noise();
      this.gravelF = ctx.createBiquadFilter();
      this.gravelF.type = 'lowpass';
      this.gravelF.frequency.value = 500;
      this.gravelG = ctx.createGain();
      this.gravelG.gain.value = 0;
      this.gravel.connect(this.gravelF).connect(this.gravelG).connect(this.out);
      this.gravel.start(0, Math.random());
      // wind
      this.wind = audio.noise();
      this.windF = ctx.createBiquadFilter();
      this.windF.type = 'bandpass';
      this.windF.frequency.value = 600;
      this.windF.Q.value = 0.5;
      this.windG = ctx.createGain();
      this.windG.gain.value = 0;
      this.wind.connect(this.windF).connect(this.windG).connect(this.out);
      this.wind.start(0, Math.random());
    }
    this.lastThrottle = 0;
    this.crackleT = 0;
  }

  update(dt, camPos) {
    const ctx = this.audio.ctx;
    const t = ctx.currentTime;
    const v = this.v;
    const p = v.p;
    const snd = this.snd;
    const rpm = v.rpm;
    const thr = v.gear === -1 ? v.controls.brake : v.controls.throttle;
    const load = v.shiftTimer > 0 ? 0.2 : thr;
    const fire = (rpm / 60) * (snd.cyl / 2);
    const base = fire * 0.5 * (snd.tone || 1);
    const r = rpm / p.redline;
    this.o1.frequency.setTargetAtTime(base, t, 0.015);
    this.o2.frequency.setTargetAtTime(base * 0.5, t, 0.015);
    this.o3.frequency.setTargetAtTime(base * 2.01, t, 0.015);
    this.lp.frequency.setTargetAtTime(300 + r * 2400 + load * 2200, t, 0.03);
    this.peak.frequency.setTargetAtTime(base * 2, t, 0.03);
    const engVol = (0.22 + load * 0.45 + r * 0.25) * (this.isPlayer ? 1 : 0.9);
    this.engGain.gain.setTargetAtTime(engVol * (v.limiter && Math.random() < 0.5 ? 0.4 : 1), t, 0.02);
    this.intakeF.frequency.setTargetAtTime(500 + r * 2500, t, 0.05);
    this.intakeG.gain.setTargetAtTime(load * r * 0.25, t, 0.05);
    if (this.turbo) {
      this.turbo.frequency.setTargetAtTime(1800 + r * 5000, t, 0.1);
      this.turboG.gain.setTargetAtTime(load * r * r * 0.025, t, 0.15);
      if (this.lastThrottle > 0.7 && thr < 0.2 && r > 0.5) this._blowOff();
    }
    // crackles on overrun
    if (thr < 0.1 && r > 0.45 && v.speed > 10) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) {
        this.crackleT = 0.04 + Math.random() * 0.12;
        if (Math.random() < 0.55) this._pop(0.25 + Math.random() * 0.4);
      }
    }
    this.lastThrottle = thr;
    let vol = 1;
    if (!this.isPlayer) {
      const pp = this.panner;
      if (pp.positionX) {
        pp.positionX.setTargetAtTime(v.pos.x, t, 0.03);
        pp.positionY.setTargetAtTime(v.pos.y, t, 0.03);
        pp.positionZ.setTargetAtTime(v.pos.z, t, 0.03);
      } else pp.setPosition(v.pos.x, v.pos.y, v.pos.z);
      const d = camPos.distanceTo(v.pos);
      vol = d > 350 ? 0 : 0.8;
    }
    if (!this.muted) this.out.gain.setTargetAtTime(vol * 0.55, t, 0.05);
    if (this.isPlayer) {
      let skid = 0;
      let off = 0;
      for (const w of v.wheels) {
        if (!w.contact) continue;
        const hard = !w.road ? false : w.road.type !== 'dirt';
        if (hard || w.surface === 7) skid += w.skid;
        else off += 1;
      }
      skid = clamp(skid / 2, 0, 1);
      this.tyreG.gain.setTargetAtTime(skid * 0.35, t, 0.05);
      this.tyreF.frequency.setTargetAtTime(900 + skid * 500 + Math.sin(t * 13) * 60, t, 0.05);
      this.gravelG.gain.setTargetAtTime(off > 1 ? clamp(v.speed / 30, 0, 1) * 0.3 : 0, t, 0.08);
      const s = v.speed;
      this.windG.gain.setTargetAtTime(clamp((s * s) / 6000, 0, 0.35), t, 0.1);
      this.windF.frequency.setTargetAtTime(300 + s * 12, t, 0.1);
    }
  }

  _pop(gain) {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const s = this.audio.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + Math.random() * 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * (this.isPlayer ? 0.6 : 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + 0.08);
  }

  _blowOff() {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const s = this.audio.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random());
    s.stop(t + 0.45);
  }

  mute(m) {
    this.muted = m;
    if (m) this.out.gain.setTargetAtTime(0, this.audio.ctx.currentTime, 0.05);
  }

  stop() {
    const t = this.audio.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.03);
    const nodes = [this.o1, this.o2, this.o3, this.intake, this.turbo, this.tyre, this.gravel, this.wind];
    for (const n of nodes) if (n) try { n.stop(t + 0.2); } catch (e) { /* already stopped */ }
    setTimeout(() => { try { this.out.disconnect(); } catch (e) { /* ignore */ } }, 400);
  }
}

/** Ambient bed: birds by day, crickets at night, rain. */
class Ambient {
  constructor(audio) {
    this.audio = audio;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0;
    this.out.connect(audio.sfx);
    this.rain = audio.noise();
    this.rainF = ctx.createBiquadFilter();
    this.rainF.type = 'highpass';
    this.rainF.frequency.value = 1200;
    this.rainG = ctx.createGain();
    this.rainG.gain.value = 0;
    this.rain.connect(this.rainF).connect(this.rainG).connect(this.out);
    this.rain.start();
    this.timer = 0;
    this.out.gain.value = 1;
  }

  update(dt, env, insideCar) {
    const t = this.audio.ctx.currentTime;
    this.rainG.gain.setTargetAtTime(env.rain * 0.12, t, 0.3);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.6 + Math.random() * 2.5;
      if (env.nightAmount > 0.6) this._cricket();
      else if (env.rain < 0.3 && Math.random() < 0.6) this._bird();
    }
    void insideCar;
  }

  _bird() {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 2500 + Math.random() * 2000;
    o.frequency.setValueAtTime(f0, t);
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      o.frequency.linearRampToValueAtTime(f0 * (1 + (Math.random() - 0.3) * 0.4), t + 0.05 + i * 0.09);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.015, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + n * 0.09 + 0.05);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + n * 0.1 + 0.1);
  }

  _cricket() {
    const ctx = this.audio.ctx, t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 4200 + Math.random() * 300;
      const s = t + i * 0.07;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.008, s + 0.01);
      g.gain.linearRampToValueAtTime(0, s + 0.05);
      o.connect(g).connect(this.out);
      o.start(s);
      o.stop(s + 0.06);
    }
  }

  mute(m) {
    this.out.gain.setTargetAtTime(m ? 0 : 1, this.audio.ctx.currentTime, 0.1);
  }
}

// ---------------- Music ----------------

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  {
    name: 'Horizon Pulse', genre: 'Electro House', bpm: 124, root: 45, // A
    chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-2, 2, 5]],
    kick: 'four', hat: 'off', bass: 'pump', lead: 'arp', color: '#ff2d87',
  },
  {
    name: 'Neon Drive', genre: 'Synthwave', bpm: 100, root: 40, // E
    chords: [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-7, -3, 0]],
    kick: 'four', hat: 'eighth', bass: 'octave', lead: 'melody', color: '#7b5cff',
  },
  {
    name: 'Coastline FM', genre: 'Chill Beats', bpm: 84, root: 50, // D
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    kick: 'boom', hat: 'swing', bass: 'soft', lead: 'keys', color: '#19d3ff',
  },
];

class Music {
  constructor(audio) {
    this.audio = audio;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(audio.musicBus);
    // simple feedback delay for space
    this.delay = ctx.createDelay(1);
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.32;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.25;
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet).connect(this.out);
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(this.out);
    this.station = -1;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.seed = 1;
  }

  setStation(i) {
    const ctx = this.audio.ctx;
    this.station = i;
    if (i < 0) {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      this.playing = false;
      return;
    }
    const st = STATIONS[i];
    this.st = st;
    this.delay.delayTime.value = (60 / st.bpm) * 0.75;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
    if (!this.playing) {
      this.playing = true;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.1;
    }
    this.seed = Math.floor(Math.random() * 1000);
  }

  setIntensity(x) {
    this.intensity = x;
  }

  update() {
    if (!this.playing || !this.st) return;
    const ctx = this.audio.ctx;
    const st = this.st;
    const spb = 60 / st.bpm / 4; // 16th notes
    while (this.nextTime < ctx.currentTime + 0.2) {
      this._schedule(this.step, this.nextTime, spb);
      this.nextTime += spb * (st.hat === 'swing' && this.step % 2 === 0 ? 1.18 : st.hat === 'swing' ? 0.82 : 1);
      this.step++;
    }
  }

  _rand(n) {
    const x = Math.sin(n * 12.9898 + this.seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  _schedule(step, t, spb) {
    const st = this.st;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = st.chords[bar % st.chords.length];
    const section = Math.floor(bar / 8) % 4; // 0 intro-ish, 1-3 full
    const root = st.root;
    // drums
    if (st.kick === 'four' && s16 % 4 === 0) this._kick(t);
    if (st.kick === 'boom' && (s16 === 0 || s16 === 10)) this._kick(t, 0.8);
    if ((s16 === 4 || s16 === 12) && section > 0) this._snare(t, st.kick === 'boom' ? 0.5 : 0.7);
    if (st.hat === 'off' && s16 % 4 === 2) this._hat(t, 0.5);
    if (st.hat === 'eighth' && s16 % 2 === 0) this._hat(t, s16 % 4 === 2 ? 0.45 : 0.25);
    if (st.hat === 'swing' && s16 % 2 === 0) this._hat(t, 0.25);
    if (st.kick === 'four' && section > 1 && s16 % 2 === 1 && this._rand(step) > 0.6) this._hat(t, 0.15);
    // bass
    const bassNote = root - 12 + chord[0];
    if (st.bass === 'pump' && s16 % 4 === 2) this._bass(t, bassNote, spb * 1.6, 0.5);
    if (st.bass === 'octave' && s16 % 2 === 0) this._bass(t, bassNote + (s16 % 4 === 2 ? 12 : 0), spb * 1.5, 0.45);
    if (st.bass === 'soft' && (s16 === 0 || s16 === 7 || s16 === 10)) this._bass(t, bassNote, spb * 3, 0.5, 'sine');
    // pad on bar start
    if (s16 === 0) this._pad(t, chord.map((c) => root + 12 + c), spb * 16, st.lead === 'keys' ? 0.06 : 0.05);
    // lead
    if (section > 0 || st.lead === 'keys') {
      if (st.lead === 'arp' && s16 % 2 === 0) {
        const n = chord[(s16 / 2) % chord.length] + root + 24 + (s16 >= 8 ? 12 : 0);
        this._lead(t, n, spb * 1.6, 0.05, 'square');
      } else if (st.lead === 'melody' && this._rand(bar * 16 + s16) > 0.55 && s16 % 2 === 0) {
        const scale = [0, 2, 3, 5, 7, 8, 10, 12];
        const n = root + 24 + scale[Math.floor(this._rand(step + 3) * scale.length)];
        this._lead(t, n, spb * 3, 0.06, 'sawtooth');
      } else if (st.lead === 'keys' && (s16 === 0 || s16 === 6 || s16 === 11)) {
        const n = root + 24 + chord[Math.floor(this._rand(step) * chord.length)];
        this._lead(t, n, spb * 5, 0.07, 'triangle');
      }
    }
  }

  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  _kick(t, v = 1) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this._env(g, t, 0.003, 0.9 * v, 0.35);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
    // sidechain duck
    this.duck.gain.setValueAtTime(0.35, t);
    this.duck.gain.linearRampToValueAtTime(1, t + 0.2);
  }

  _snare(t, v) {
    const ctx = this.audio.ctx;
    const s = this.audio.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1500;
    const g = ctx.createGain();
    this._env(g, t, 0.002, 0.35 * v, 0.18);
    s.connect(f).connect(g).connect(this.out);
    s.connect(f);
    g.connect(this.delay);
    s.start(t, Math.random());
    s.stop(t + 0.2);
  }

  _hat(t, v) {
    const ctx = this.audio.ctx;
    const s = this.audio.noise(false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    this._env(g, t, 0.001, 0.18 * v, 0.05);
    s.connect(f).connect(g).connect(this.out);
    s.start(t, Math.random());
    s.stop(t + 0.06);
  }

  _bass(t, note, dur, v, type = 'sawtooth') {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = NOTE(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.005, 0.32 * v, dur);
    o.connect(f).connect(g).connect(this.duck);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _pad(t, notes, dur, v) {
    const ctx = this.audio.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.duck);
    g.connect(this.delay);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  _lead(t, note, dur, v, type) {
    const ctx = this.audio.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = NOTE(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    const g = ctx.createGain();
    this._env(g, t, 0.005, v, dur);
    o.connect(f).connect(g).connect(this.duck);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

export { lerp };
