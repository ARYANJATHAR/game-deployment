import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { World } from './world/World.js';
import { WORLD, POI } from './world/WorldConfig.js';
import { Input } from './core/Input.js';
import { Save, xpForLevel } from './core/Save.js';
import { clamp, lerp, rng, formatNumber, formatTime } from './core/utils.js';
import { CameraRig } from './camera/CameraRig.js';
import { PhysicsWorld } from './vehicle/PhysicsWorld.js';
import { Vehicle } from './vehicle/Vehicle.js';
import { AIController } from './vehicle/AIController.js';
import { setPaintFinish, buildCar } from './vehicle/CarBuilder.js';
import { CARS, carStats, PAINTS, UPGRADES } from './config/cars.js';
import { EVENTS, POSITION_REWARD } from './config/events.js';
import { ACCOLADES } from './config/accolades.js';
import { VehicleFX } from './fx/VehicleFX.js';
import { RouteDisplay } from './fx/RouteDisplay.js';
import { AudioEngine, STATIONS } from './audio/Audio.js';
import { Route } from './gameplay/Route.js';
import { buildEventRoute } from './gameplay/RouteBuilder.js';
import { Race } from './gameplay/Race.js';
import { Activities } from './gameplay/Activities.js';
import { Skills } from './gameplay/Skills.js';
import { GhostRecorder, GhostPlayer, loadGhost } from './gameplay/Ghost.js';
import { HUD } from './ui/HUD.js';
import { Menus } from './ui/Menus.js';
import { MapView } from './ui/MapView.js';
import { TouchControls } from './ui/Touch.js';
import { Net } from './net/Net.js';
import { RemotePlayers } from './net/RemotePlayers.js';

const STEP = 1 / 120;
const DRIVATARS = ['NitroNomad', 'ApexHunter', 'DriftQueen', 'TurboTom', 'GravelGhost', 'RedlineRita', 'SlipstreamSam', 'Kiko_RS', 'MidnightMax',
  'VelocityVee', 'BoostBaron', 'LaunchLuna', 'TorqueTina', 'CornerCarl', 'SidewaysSid', 'PixelPete', 'HairpinHana', 'ChicaneChen', 'ThrottleTheo', 'BrakeLateBo'];

const DIFF_REWARD = { easy: 0.8, medium: 1, hard: 1.25, unbeatable: 1.5 };

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.save = new Save();
    this.input = new Input();
    this.audio = new AudioEngine();
    this.state = 'loading';
    this.time = 0;
    this.acc = 0;
    this.uid = 0;
    this.traffic = [];
    this.opponents = [];
    this.rewindBuf = [];
    this.rewindTimer = 0;
    this.hudVisible = true;
    this.waypoint = null;
    this.gpsRoute = null;
    this.gpsPath = null;
    this.radioIndex = 0;
    this.weatherTimer = 120;
    this.photoFov = 45;
    this.net = new Net();
    this.chatLog = [];
    this.leaderboards = {};
    this.netSendT = 0;
    this.skillNames = [];
    this.lastStatSave = 0;
  }

  // ======================= setup =======================
  async init(onProgress) {
    const S = this.save.settings;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: S.quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4200);
    this.scene.add(this.camera);

    this.world = new World(renderer, this.scene);
    await this.world.build(onProgress);
    this.hf = this.world.hf;
    this.mapImage = this._drawRoadsOnMap(this.world.mapImage);
    this.physics = new PhysicsWorld(this.hf, this.world.colliders);
    this.physics.onSmash = (prop, v) => this._onSmash(prop, v);
    this.physics.onCollision = (a, b, vn) => this._onCollision(a, b, vn);
    this.rig = new CameraRig(this.camera, this.hf);
    this.fx = new VehicleFX(this.scene);
    this.routeDisplay = new RouteDisplay(this.scene);
    this.skills = new Skills();
    this._hookSkills();

    // event routes
    this.eventRoutes = new Map();
    for (const ev of EVENTS) {
      const r = buildEventRoute(this.hf.roads, ev);
      if (r) this.eventRoutes.set(ev.id, r);
    }
    this.activities = new Activities(this.scene, this.hf, this.world.scenery, this.save);
    this.activities.build(this.eventRoutes);
    // hide boards already smashed
    for (const id of this.save.progress.boards) {
      const b = this.world.scenery.xpBoards.find((x) => x.id === id);
      if (b && b.item.alive) {
        b.item.alive = false;
        b.item.collider.dead = true;
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        b.item.mesh.setMatrixAt(b.item.index, zero);
        b.item.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // UI
    this.hud = new HUD(this.uiRoot);
    this.menus = new Menus(this.uiRoot, this);
    this.mapView = new MapView(this);
    this.touch = new TouchControls(this.uiRoot, this.input);
    this.remotes = new RemotePlayers(this.scene, this.net, this.audio);
    this._hookNet();

    this._setupComposer();
    this.applySettings(true);
    window.addEventListener('resize', () => this._resize());
    this._resize();
    // audio needs a user gesture
    const unlock = () => {
      this.audio.init();
      this.audio.setVolumes({ master: S.masterVolume, music: S.musicVolume, sfx: S.sfxVolume });
      if (this.audio.music && this.audio.music.station < 0) this.audio.music.setStation(this.radioIndex);
      if (this.player && !this.player.engineSound) this.player.engineSound = this.audio.createEngine(this.player, true);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.input.onKey(() => {});

    // title scene: show a car at the festival
    this._spawnTitleCar();
    this.state = 'title';
    this.hud.setVisible(false);
    this.menus.title();
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _drawRoadsOnMap(base) {
    const c = document.createElement('canvas');
    c.width = c.height = base.width;
    const ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const k = base.width / WORLD.size;
    const h = WORLD.half;
    for (const r of this.hf.roads.roads) {
      const w = Math.max(2, r.halfWidth * 2 * k * 1.6);
      ctx.strokeStyle = r.type === 'dirt' ? '#9a7650' : r.type === 'highway' ? '#f4f0e6' : '#d9dde3';
      ctx.lineWidth = w + 2;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#1b1b1b';
      ctx.beginPath();
      for (let i = 0; i < r.count; i++) {
        const x = (r.x[i] + h) * k, y = (r.z[i] + h) * k;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      if (r.closed) ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = r.type === 'dirt' ? '#c79a62' : r.type === 'highway' ? '#ffe9a8' : '#eef0f3';
      ctx.lineWidth = w;
      ctx.stroke();
    }
    // festival marker
    const f = POI.festival;
    ctx.fillStyle = '#ff2d87';
    ctx.beginPath();
    ctx.arc((f.x + h) * k, (f.z + h) * k, 7, 0, Math.PI * 2);
    ctx.fill();
    return c;
  }

  _setupComposer() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.4, 2.4);
    this.composer.addPass(this.bloom);
    // radial blur toward the screen centre at high speed
    this.speedBlur = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, strength: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
        void main() {
          vec2 dir = vUv - vec2(0.5, 0.55);
          float k = smoothstep(0.15, 0.7, length(dir)) * strength;
          vec4 c = vec4(0.0);
          for (int i = 0; i < 8; i++) c += texture2D(tDiffuse, vUv - dir * k * float(i) / 8.0);
          gl_FragColor = c / 8.0;
        }`,
    });
    this.speedBlur.enabled = false;
    this.composer.addPass(this.speedBlur);
    this.composer.addPass(new OutputPass());
  }

  _resize() {
    const S = this.save.settings;
    const w = window.innerWidth, h = window.innerHeight;
    const base = S.quality === 'low' ? Math.min(0.75, window.devicePixelRatio) : S.quality === 'medium' ? Math.min(1.25, window.devicePixelRatio) : Math.min(2, window.devicePixelRatio);
    this.basePixelRatio = base;
    const pr = base * (S.dynamicRes ? (this.resScale || 1) : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud && this.hud._resize();
  }

  applySettings(initial = false) {
    const S = this.save.settings;
    this.world.env.setShadowQuality(S.shadows);
    this.renderer.shadowMap.enabled = S.shadows !== 'off';
    this.camera.far = S.quality === 'low' ? 2200 : S.quality === 'medium' ? 3200 : 4200;
    this.camera.updateProjectionMatrix();
    this.rig.baseFov = S.fov;
    this.rig.mode = S.camera;
    this.world.env.cycle = S.timeCycle;
    if (initial) this.world.env.time = S.timeOfDay;
    if (S.weather !== 'dynamic') this.world.env.setWeather(S.weather);
    if (this.world.terrain.season !== S.season) {
      this.world.setSeason(S.season);
      this.mapImage = this._drawRoadsOnMap(this.world.mapImage);
    }
    this.fx.quality = S.quality === 'low' ? 0.5 : S.quality === 'medium' ? 0.8 : 1;
    this.world.props.distScale = S.quality === 'low' ? 0.6 : S.quality === 'medium' ? 0.85 : 1;
    this.world.terrain.lodScale = S.quality === 'low' ? 0.7 : S.quality === 'medium' ? 0.9 : 1.15;
    this.hud.setMinimapVisible(S.showMinimap);
    if (this.player) {
      Object.assign(this.player.assists, S.assists);
    }
    if (this.audio.enabled) this.audio.setVolumes({ master: S.masterVolume, music: S.musicVolume, sfx: S.sfxVolume });
    if (!S.traffic) this._clearTraffic();
    this._resize();
    if (!initial) this.save.save();
  }

  // ======================= vehicles =======================
  _makeVehicle(def, opts = {}) {
    const v = new Vehicle(def, this.physics, opts);
    v.uid = ++this.uid;
    v.name = opts.name || def.name;
    this.scene.add(v.root);
    this.physics.add(v);
    if (!opts.player) v.assists = { abs: true, tcs: true, stm: true, autoGear: true, steerAssist: false };
    return v;
  }

  _removeVehicle(v) {
    if (!v) return;
    this.physics.remove(v);
    this.scene.remove(v.root);
    if (v.engineSound) this.audio.destroyEngine(v.engineSound);
    v.root.traverse((o) => {
      if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.userData && o.material.userData.own) o.material.dispose();
    });
  }

  _createPlayer(entry, pos = null, heading = 0) {
    const def = CARS.find((c) => c.id === entry.id);
    const old = this.player;
    const v = this._makeVehicle(def, {
      player: true, paint: entry.paint, finish: entry.finish, rim: entry.rim, stripe: entry.stripe, stripes: !!entry.stripe,
      caliper: entry.caliper, upgrades: entry.upgrades, name: 'You', assists: this.save.settings.assists,
    });
    if (old) this._removeVehicle(old);
    this.player = v;
    v.onShift = () => this.audio.shift();
    v.onImpact = (s) => {
      this.rig.shake = Math.min(1, s / 15);
      this.input.rumble(Math.min(1, s / 15), 0.3, 200);
      this.audio.impact(s);
    };
    if (pos) v.place(pos.x, pos.y, pos.z, heading);
    if (this.audio.enabled) v.engineSound = this.audio.createEngine(v, true);
    this.rig.snap();
    return v;
  }

  _spawnTitleCar() {
    // show the player's car (or a hero car) in front of the festival stage
    const entry = this.save.currentCar || { id: 'falco', paint: '#ff2d87', upgrades: {} };
    const f = POI.festival;
    const x = f.x + 40, z = f.z - 40;
    const y = this.hf.heightAt(x, z);
    this._createPlayer(entry, { x, y, z }, 0.6);
    this.player.frozen = true;
  }

  // ======================= game flow =======================
  newGame() {
    this.save.reset();
    this.menus.closeAll();
    this.state = 'starter';
    this.menus.starter();
  }

  chooseStarter(id) {
    const car = CARS.find((c) => c.id === id);
    const e = this.save.addCar(id, car.paint);
    this.save.progress.current = e.uid;
    this.save.progress.intro = true;
    this.save.save();
    this.menus.closeAll();
    this.endPreview();
    this._enterWorld(true);
    this.hud.toast('WELCOME TO HORIZON RUSH', 'Follow the blue GPS arrows to your first race', 'cyan', 6000);
    // guide the player to the opening event
    const first = this.activities.events.find((e) => e.ev.id === 'festival-circuit');
    if (first) this.setWaypoint(first.x, first.z);
    const tip = this.touch.enabled ? 'Tap II for the menu · MAP for the world map' : 'Press ESC for the menu · M for the map';
    setTimeout(() => this.hud.toast('TIP', tip, '', 5000), 2500);
  }

  continueGame() {
    this.menus.closeAll();
    this._enterWorld(false);
  }

  _enterWorld(fresh) {
    const entry = this.save.currentCar;
    let pos, heading;
    const saved = this.save.progress.pos;
    if (!fresh && saved) {
      pos = { x: saved.x, y: this.hf.heightAt(saved.x, saved.z), z: saved.z };
      heading = saved.h;
    } else {
      // start on Central Avenue next to the festival
      const r = this.hf.roads.roads.find((x) => x.id === 'central');
      const i = Math.floor(r.count * 0.45);
      pos = { x: r.x[i], y: r.y[i], z: r.z[i] };
      heading = Math.atan2(-r.tx[i], -r.tz[i]);
    }
    this._createPlayer(entry, pos, heading);
    this.state = 'freeroam';
    this.hud.setVisible(true);
    if (this.audio.enabled && this.audio.music.station < 0) this.audio.music.setStation(this.radioIndex);
    this.rig.snap();
  }

  toTitle() {
    this._persistPosition();
    if (this.race) this.quitEvent(true);
    this.menus.closeAll();
    this._clearTraffic();
    this.state = 'title';
    this.hud.setVisible(false);
    this._spawnTitleCar();
    this.menus.title();
  }

  pause() {
    if (this.state === 'paused') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.audio.suspend(true);
    this.menus.pause();
  }

  resume(fromCard = false) {
    this.menus.closeAll();
    this.endPreview();
    this.state = this.prevState && this.prevState !== 'paused' ? this.prevState : (this.race ? 'race' : 'freeroam');
    if (fromCard) this.state = this.race ? 'race' : 'freeroam';
    this.audio.suspend(false);
    this.rig.snap();
  }

  openMap() {
    if (this.state !== 'paused') {
      this.prevState = this.state;
      this.state = 'paused';
      this.audio.suspend(true);
    }
    this.menus.map(this.mapView);
  }

  closeMap() {
    if (this.menus.open) return; // returned to pause menu
    this.resume();
  }

  // ======================= garage =======================
  previewCar(def, entry) {
    // show the car on the festival turntable and orbit around it
    const key = `${def.id}|${entry.paint || def.paint}|${entry.finish}|${entry.rim}|${entry.stripe}|${entry.caliper}`;
    if (this.preview && this.preview.key === key) return;
    if (this.preview) this.scene.remove(this.preview.model.root);
    const model = buildCar(def, {
      paint: entry.paint || def.paint, finish: entry.finish, rim: entry.rim, stripe: entry.stripe, stripes: !!entry.stripe || def.stripes, caliper: entry.caliper,
    });
    const f = POI.festival;
    const x = f.x - 20, z = f.z + 60;
    const y = this.hf.heightAt(x, z);
    model.root.position.set(x, y, z);
    const first = !this.preview;
    model.root.rotation.y = this.preview ? this.preview.model.root.rotation.y : 0.8;
    this.scene.add(model.root);
    if (first) {
      this.rig.orbit.target.set(x, y + 0.6, z);
      this.rig.orbit.dist = 8;
      this.rig.orbit.pitch = 0.18;
    }
    this.preview = { model, key, pos: new THREE.Vector3(x, y + 0.6, z) };
    if (!this.platform) {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.25, 48), new THREE.MeshStandardMaterial({ color: '#1b1d24', metalness: 0.6, roughness: 0.3 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.06, 6, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff2d87' }));
      ring.position.y = 0.13;
      plat.add(ring);
      plat.position.set(x, y + 0.02, z);
      plat.receiveShadow = true;
      this.scene.add(plat);
      this.platform = plat;
    }
    this.platform.visible = true;
  }

  endPreview() {
    if (this.preview) {
      this.scene.remove(this.preview.model.root);
      this.preview = null;
    }
    if (this.platform) this.platform.visible = false;
  }

  buyCar(id, paint) {
    const car = CARS.find((c) => c.id === id);
    const p = this.save.progress;
    if (p.credits < car.price) return false;
    p.credits -= car.price;
    const e = this.save.addCar(id, paint || car.paint);
    this.audio.cash();
    this.selectCar(e.uid);
    this.hud.toast(`${car.name.toUpperCase()} PURCHASED`, `-${formatNumber(car.price)} CR`, 'gold');
    return true;
  }

  sellCar(uid) {
    const p = this.save.progress;
    const e = p.garage.find((c) => c.uid === uid);
    if (!e || p.garage.length <= 1) return;
    const car = CARS.find((c) => c.id === e.id);
    p.credits += Math.round(car.price * 0.5);
    p.garage = p.garage.filter((c) => c.uid !== uid);
    if (p.current === uid) this.selectCar(p.garage[0].uid);
    this.save.save();
  }

  selectCar(uid) {
    const p = this.save.progress;
    p.current = uid;
    this.save.save();
    if (this.player && (this.state === 'paused' || this.state === 'freeroam')) {
      const pos = this.player.pos.clone();
      const h = this.player.heading;
      const y = this.hf.heightAt(pos.x, pos.z);
      this._createPlayer(this.save.currentCar, { x: pos.x, y, z: pos.z }, h);
    }
  }

  buyUpgrade(cat, level) {
    const e = this.save.currentCar;
    if (!e) return false;
    return this._buyUpgrade(e, cat, level);
  }

  _buyUpgrade(e, cat, level) {
    const cost = level === 0 ? 0 : UPGRADES[cat].cost[level];
    const p = this.save.progress;
    if (p.credits < cost) return false;
    p.credits -= cost;
    e.upgrades = { ...e.upgrades, [cat]: level };
    if (cost) this.audio.cash();
    this.save.save();
    this.selectCar(e.uid);
    return true;
  }

  setPaint(patch) {
    const e = this.save.currentCar;
    Object.assign(e, patch);
    this.save.save();
    if (this.player) {
      const m = this.player.model.materials;
      if (patch.paint) m.paint.color.set(patch.paint);
      if (patch.finish) setPaintFinish(m.paint, patch.finish);
      if (patch.rim) m.rimMat.color.set(patch.rim);
      if (patch.caliper) m.caliperMat.color.set(patch.caliper);
      if ('stripe' in patch) this.selectCar(e.uid);
    }
  }

  // ======================= wheelspin =======================
  rollWheelspin() {
    const r = Math.random();
    if (r < 0.08) {
      const pool = CARS.filter((c) => c.price < 400000);
      const car = pool[Math.floor(Math.random() * pool.length)];
      return { type: 'car', id: car.id, label: car.name, rare: true };
    }
    const amounts = [5000, 10000, 15000, 25000, 50000, 100000];
    const w = [30, 25, 18, 14, 9, 4];
    let x = Math.random() * 100, i = 0;
    while (x > w[i]) { x -= w[i]; i++; }
    return { type: 'cr', amount: amounts[i], label: `${formatNumber(amounts[i])} CR`, rare: amounts[i] >= 50000 };
  }

  claimWheelspin(prize) {
    const p = this.save.progress;
    p.wheelspins = Math.max(0, p.wheelspins - 1);
    if (prize.type === 'car') {
      const car = CARS.find((c) => c.id === prize.id);
      this.save.addCar(car.id, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      this.audio.fanfare();
    } else {
      p.credits += prize.amount;
      this.audio.cash();
    }
    this.save.save();
  }

  // ======================= progression =======================
  addXP(xp, credits = 0) {
    const p = this.save.progress;
    p.xp += Math.round(xp);
    p.credits += Math.round(credits);
    let leveled = false;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      p.wheelspins++;
      p.credits += 5000;
      leveled = true;
    }
    if (leveled) {
      this.hud.toast(`LEVEL UP! LEVEL ${p.level}`, '+1 Wheelspin · +5,000 CR', 'gold', 4000);
      this.audio.fanfare();
    }
  }

  // ======================= events =======================
  travelToEvent(id) {
    const e = this.activities.events.find((x) => x.ev.id === id);
    if (!e) return;
    this.menus.closeAll();
    this.endPreview();
    if (this.race) this.quitEvent(true);
    this.menus.fade(true);
    setTimeout(() => {
      const r = e.route;
      const i = r.indexAtS(r.closed ? r.length - 40 : 0);
      this.player.place(r.x[i], r.y[i], r.z[i], r.heading(i));
      this.state = 'freeroam';
      this.audio.suspend(false);
      this.rig.snap();
      this._clearTraffic();
      this.menus.fade(false);
      this._openEventCard(e);
    }, 380);
  }

  startEvent(id) {
    const ev = EVENTS.find((x) => x.id === id);
    const route = this.eventRoutes.get(id);
    if (!ev || !route) return;
    this.menus.fade(true);
    this.state = 'loading-event';
    setTimeout(() => {
      this._setupRace(ev, route);
      this.menus.fade(false);
    }, 400);
  }

  _setupRace(ev, route) {
    this._clearTraffic();
    this._clearOpponents();
    this.fx.clear();
    this.skills.breakChain('');
    this.activeEventId = ev.id;
    const S = this.save.settings;
    const playerEntry = this.save.currentCar;
    const pDef = CARS.find((c) => c.id === playerEntry.id);
    const pPI = carStats(pDef, playerEntry.upgrades).pi;
    let n = ev.type === 'showcase' || ev.type === 'drift' ? 0 : ev.opponents ?? 7;
    const r = rng(Date.now() & 0xffff);
    // pick opponents near the player's PI
    const pool = [...CARS].sort((a, b) => Math.abs(a.pi - pPI) - Math.abs(b.pi - pPI));
    const near = pool.filter((c) => Math.abs(c.pi - pPI) <= 120);
    const choices = near.length >= 2 ? near : pool.slice(0, 3);
    const names = [...DRIVATARS].sort(() => r() - 0.5);
    const participants = [];
    const playerSlot = ev.type === 'drag' ? 1 : Math.min(n, 5);
    const tmpRace = { p: new Array(n + 1) };
    const race = new Race(this.scene, ev, route, []);
    race.p = tmpRace.p; // placeholder for gridSlot sizing
    for (let k = 0; k <= n; k++) {
      const slot = race.gridSlot(k);
      if (k === playerSlot) {
        this.player.place(slot.x, slot.y, slot.z, slot.heading);
        this.player.frozen = true;
        participants.push({ vehicle: this.player, ai: null, name: 'You', isPlayer: true, car: pDef.name });
        continue;
      }
      const def = choices[Math.floor(r() * choices.length)];
      // light upgrades to match the player's PI
      const v = this._makeVehicle(def, { paint: PAINTS[Math.floor(r() * PAINTS.length)], name: names[k % names.length] });
      v.place(slot.x, slot.y, slot.z, slot.heading);
      v.frozen = true;
      const ai = new AIController(v, route, { difficulty: S.difficulty, skill: 0.97 + r() * 0.06 });
      ai.lateral = slot.lat;
      if (this.audio.enabled) v.engineSound = this.audio.createEngine(v, false);
      this.opponents.push(v);
      participants.push({ vehicle: v, ai, name: v.name, isPlayer: false, car: def.name });
    }
    race.dispose();
    this.race = new Race(this.scene, ev, route, participants);
    this.raceRoute = route;
    this._disposeGhost();
    this.ghostRec = new GhostRecorder();
    const gd = loadGhost(ev.id);
    if (gd && S.ghost !== false) {
      this.ghost = new GhostPlayer(this.scene, gd);
      this.hud.toast('RIVAL GHOST', `Your best: ${formatTime(gd.time)}`, 'cyan', 3000);
    }
    // racing line profile for the player's braking line
    const pp = this.player.p;
    this.playerProfile = route.speedProfile(0.9 * pp.grip + Math.min(0.3, pp.downforce * 0.05), 0.85 * pp.brake, 120, pp.offroad);
    this.state = 'race';
    this.rewindBuf = [];
    this.activities.setVisible(false);
    this.setWaypoint(null);
    this.rig.snap();
    this.save.progress.stats.races++;
    this.hud.toast(ev.name.toUpperCase(), ev.type === 'circuit' ? `${ev.laps} laps · ${(route.length / 1000).toFixed(1)} km` : `${(route.length / 1000).toFixed(1)} km`, 'cyan', 2500);
  }

  _disposeGhost() {
    if (this.ghost) this.ghost.dispose();
    this.ghost = null;
  }

  _clearOpponents() {
    for (const v of this.opponents) this._removeVehicle(v);
    this.opponents = [];
  }

  restartEvent() {
    const id = this.race ? this.race.ev.id : this.lastEventId;
    if (this.race) { this.race.dispose(); this.race = null; }
    this._disposeGhost();
    this.menus.closeAll();
    this.audio.suspend(false);
    if (id) this.startEvent(id);
  }

  quitEvent(silent = false) {
    if (!this.race) return;
    if (this.race.online) this.net.send({ t: 'quitRace' });
    this._disposeGhost();
    this.race.dispose();
    this.race = null;
    this._clearOpponents();
    this.player.frozen = false;
    this.player.ai = null;
    this.menus.closeAll();
    this.audio.suspend(false);
    this.activities.setVisible(true);
    this.state = 'freeroam';
    this.rig.snap();
    if (!silent) this.hud.toast('EVENT ABANDONED', '', '');
  }

  _onRaceEvent(e) {
    const race = this.race;
    switch (e.type) {
      case 'countdown':
        this.hud.countdown(String(e.n));
        this.audio.countdown(false);
        break;
      case 'go':
        this.hud.countdown('GO!');
        this.audio.countdown(true);
        break;
      case 'checkpoint':
        this.audio.checkpoint();
        break;
      case 'lap':
        this.hud.toast(e.lap === e.laps ? 'FINAL LAP' : `LAP ${e.lap}/${e.laps}`, `Lap time ${formatTime(e.time)}`, 'cyan');
        this.audio.checkpoint();
        break;
      case 'jetFinish':
        if (!race.p[0].finished) this.hud.toast('THE JET HAS FINISHED', 'Keep pushing!', '');
        break;
      case 'finish':
        if (e.who.isPlayer) {
          const pos = race.positionOf(e.who);
          this.hud.countdown(pos === 1 ? 'WINNER!' : `P${pos}`);
          this.audio.fanfare();
          // auto-drive after finishing
          this.player.ai = new AIController(this.player, race.route, { cruise: 14 });
          this.finishTimer = race.online ? 40 : 4;
          this.playerFinishPos = pos;
          if (race.online) {
            this.net.send({ t: 'finish', time: race.time });
            this.hud.toast('FINISHED', 'Waiting for the other drivers…', 'cyan', 4000);
          }
        }
        break;
      default:
    }
  }

  _showResults() {
    const race = this.race;
    const ev = race.ev;
    const pl = race.p.find((x) => x.isPlayer);
    const rows = race.standings().map((pp) => ({ name: pp.name, car: pp.car, time: race.estimate(pp), me: pp.isPlayer, dnf: !pp.finished && !pp.isPlayer && pp.progress < race.total * 0.5 }));
    let pos = race.positionOf(pl);
    if (ev.type === 'drift') {
      const score = Math.round(race.driftScore || 0);
      const stars = ev.stars.filter((t) => score >= t).length;
      pos = stars === 3 ? 1 : stars === 2 ? 2 : stars === 1 ? 3 : 4;
      rows.length = 0;
      rows.push({ name: 'You', car: pl.car, time: pl.finishTime, me: true });
      race.resultNote = `${formatNumber(score)} PTS · ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
    }
    if (ev.type === 'showcase') {
      const jetTime = race.jetFinished ? race.jetTime : race.time + (race.route.length - race.jetS) / Math.max(1, race.jetV);
      rows.push({ name: 'Stunt Jet', car: 'Aerobatic Jet', time: jetTime, me: false });
      rows.sort((a, b) => a.time - b.time);
      pos = rows.findIndex((r) => r.me) + 1;
    }
    const diff = DIFF_REWARD[this.save.settings.difficulty] || 1;
    const frac = POSITION_REWARD[Math.min(pos, POSITION_REWARD.length) - 1];
    const credits = Math.round(ev.reward * frac * diff / 100) * 100;
    const xp = Math.round(ev.xp * (0.4 + frac * 0.6) * diff);
    const p = this.save.progress;
    const prev = p.events[ev.id];
    const time = pl.finishTime;
    const record = !prev || time < prev.best;
    p.events[ev.id] = { best: record ? time : prev.best, position: prev ? Math.min(prev.position, pos) : pos };
    if (record && isFinite(time) && this.net.online && !race.online && ev.type !== 'drift') {
      this.net.send({ t: 'submitTime', eventId: ev.id, time });
    }
    if (record && this.ghostRec && isFinite(time)) {
      const entry = this.save.currentCar;
      this.ghostRec.save(ev.id, entry.id, entry.paint, time);
    }
    if (pos === 1) p.stats.wins++;
    this.addXP(xp, credits);
    this.save.save();
    let title = pos === 1 ? 'Victory!' : ev.type === 'showcase' ? 'Beaten by the jet' : `Finished ${pos}${['st', 'nd', 'rd'][pos - 1] || 'th'}`;
    if (ev.type === 'drift') title = race.resultNote;
    this.state = 'results';
    this.menus.results({ event: ev, rows, credits, xp, record, title });
    this.lastEventId = ev.id;
  }

  finishResults() {
    this.menus.fade(true);
    setTimeout(() => {
      const r = this.race;
      if (r) { r.dispose(); this.race = null; }
      this._disposeGhost();
      this._clearOpponents();
      this.player.ai = null;
      this.player.frozen = false;
      this.player.controls.steerAngle = undefined;
      this.activities.setVisible(true);
      this.state = 'freeroam';
      this.rig.snap();
      this.menus.fade(false);
    }, 380);
  }

  // ======================= waypoint / GPS =======================
  setWaypoint(x, z) {
    if (x === null || x === undefined) {
      this.waypoint = null;
      this.gpsRoute = null;
      this.gpsPath = null;
      return;
    }
    this.waypoint = { x, z };
    this._recomputeGps();
  }

  _recomputeGps() {
    if (!this.waypoint || !this.player) return;
    const p = this.player.pos;
    const path = this.hf.roads.route(p.x, p.z, this.waypoint.x, this.waypoint.z);
    if (!path || path.length < 2) return;
    this.gpsPath = path;
    this.gpsRoute = new Route(path, false);
    this.gpsCheck = 0;
  }

  // ======================= traffic =======================
  _clearTraffic() {
    for (const t of this.traffic) this._removeVehicle(t.v);
    this.traffic = [];
  }

  _updateTraffic(dt) {
    if (!this.save.settings.traffic || this.state !== 'freeroam') return;
    const target = this.save.settings.quality === 'low' ? 4 : 7;
    const p = this.player.pos;
    // despawn far away
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      const d = t.v.pos.distanceTo(p);
      if (d > 900 || (t.ai.route && !t.ai.route.closed && t.ai.s > t.ai.route.length - 15)) {
        this._removeVehicle(t.v);
        this.traffic.splice(i, 1);
      }
    }
    this.trafficSpawnT = (this.trafficSpawnT || 0) - dt;
    if (this.traffic.length < target && this.trafficSpawnT <= 0) {
      this.trafficSpawnT = 0.6;
      this._spawnTraffic();
    }
    for (const t of this.traffic) {
      // cars far away are frozen in place to save CPU
      const d = t.v.pos.distanceTo(p);
      t.v.sleeping = d > 650;
    }
  }

  _spawnTraffic() {
    const p = this.player.pos;
    const roads = this.hf.roads;
    const a = Math.random() * Math.PI * 2;
    const d = 250 + Math.random() * 350;
    const q = roads.nearest(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 4000);
    if (!q) return;
    // must be out of view-ish and not too close
    const sp = { x: q.x, z: q.z };
    if (Math.hypot(sp.x - p.x, sp.z - p.z) < 160) return;
    const dest = roads.nodes[Math.floor(Math.random() * roads.nodes.length)];
    const path = roads.route(sp.x, sp.z, dest.x, dest.z);
    if (!path || path.length < 40) return;
    const route = new Route(path, false);
    const cars = CARS.filter((c) => c.price < 500000);
    const def = cars[Math.floor(Math.random() * cars.length)];
    const v = this._makeVehicle(def, { paint: PAINTS[Math.floor(Math.random() * PAINTS.length)], name: DRIVATARS[Math.floor(Math.random() * DRIVATARS.length)] });
    const i0 = 2;
    const lane = Math.min(route.hw[i0] * 0.45, 3.2);
    const rx = -route.tz[i0], rz = route.tx[i0];
    v.place(route.x[i0] + rx * lane, route.y[i0], route.z[i0] + rz * lane, route.heading(i0));
    const type = q.road.type;
    const cruise = { highway: 31, road: 23, street: 13, dirt: 16, runway: 25 }[type] || 20;
    const ai = new AIController(v, route, { cruise: cruise * (0.85 + Math.random() * 0.3), laneOffset: lane, difficulty: 'medium' });
    v.vel.copy(v.forward).multiplyScalar(cruise * 0.7);
    if (this.audio.enabled) v.engineSound = this.audio.createEngine(v, false);
    this.traffic.push({ v, ai });
  }

  // ======================= collisions / smash =======================
  _onSmash(prop, v) {
    if (!prop) return;
    this.world.props.smash(prop, v.vel);
    if (v !== this.player) return;
    this.audio.smash();
    this.save.progress.stats.smashed++;
    if (prop.type === 'xpboard') {
      const b = this.world.scenery.xpBoards.find((x) => x.item === prop);
      if (b && !this.save.progress.boards.includes(b.id)) {
        this.save.progress.boards.push(b.id);
        this.addXP(1500, 0);
        this.hud.toast('XP BOARD SMASHED', `+1,500 XP · ${this.save.progress.boards.length}/${this.world.scenery.xpBoards.length}`, 'gold');
        this.save.save();
      }
    } else {
      this.skills.add('smash', 60, 'WRECKAGE');
    }
  }

  _onCollision(a, b, vn) {
    const pl = this.player;
    if (a !== pl && b !== pl) return;
    const other = a === pl ? b : a;
    if (other) this.skills.notifyCollision(other);
    if (vn > 6) {
      this.skills.breakChain('Crash');
      this.save.progress.stats.crashes++;
    }
  }

  _hookSkills() {
    this.skills.on('skill', (d) => {
      if (d.name === 'near') this.save.progress.stats.nearMisses = (this.save.progress.stats.nearMisses || 0) + 1;
      this.skillNames.unshift(d.label);
      if (this.skillNames.length > 3) this.skillNames.pop();
      this.audio.skill(Math.min(8, d.mult));
    });
    this.skills.on('bank', (d) => {
      const st = this.save.progress.stats;
      st.bestChain = Math.max(st.bestChain || 0, d.total);
      this.hud.skillBank(d.total);
      this.audio.bank();
      this.addXP(d.total * 0.08, d.total * 0.05);
      this.skillNames = [];
    });
    this.skills.on('broken', (d) => {
      if (d.reason) this.hud.skillBroken(d.lost);
      this.skillNames = [];
    });
  }

  // ======================= photo mode =======================
  enterPhoto() {
    this.menus.closeAll();
    this.state = 'photo';
    this.hud.setVisible(false);
    this.rig.orbit.target.copy(this.player.root.position).add(new THREE.Vector3(0, 0.7, 0));
    this.rig.orbit.dist = 7;
    this.menus.photo();
  }

  exitPhoto() {
    this.hud.setVisible(this.hudVisible);
    this.state = this.prevState === 'race' ? 'race' : 'freeroam';
    this.pause();
  }

  capturePhoto() {
    this._render();
    const canvas = this.renderer.domElement;
    // re-render with filter applied via 2D canvas
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const ctx = c.getContext('2d');
    ctx.filter = canvas.style.filter || 'none';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    ctx.font = `800 italic ${Math.round(c.height * 0.035)}px "Saira Condensed", sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('HORIZON RUSH', c.width - 24, c.height - 24);
    const a = document.createElement('a');
    a.download = `horizon-rush-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    this.audio.blip(1800, 0.05, 'square', 0.1);
    this.hud.toast('PHOTO SAVED', '', 'cyan');
  }

  // ======================= persistence =======================
  _persistPosition() {
    if (!this.player || this.state === 'title' || this.race) return;
    this.save.progress.pos = { x: this.player.pos.x, z: this.player.pos.z, h: this.player.heading };
    this.save.save();
  }

  // ======================= main loop =======================
  _frame() {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this._perf(dt);
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.input.update();
    this.touch.update();
    try {
      const n = this.debugTimeScale || 1; // test hook: simulate several steps per rendered frame
      for (let k = 0; k < n; k++) this._update(dt);
    } catch (e) {
      console.error(e);
    }
    const driving = this.state === 'freeroam' || this.state === 'race' || this.state === 'results' || this.state === 'loading-event';
    const showHud = driving && this.hudVisible;
    if (showHud !== this._hudShown) {
      this._hudShown = showHud;
      this.hud.setVisible(showHud);
      this.touch.setVisible(driving);
    }
    this._render();
  }

  /** Frame-time tracking, FPS readout and dynamic resolution. */
  _perf(dt) {
    this.fpsAcc = (this.fpsAcc || 0) + dt;
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (this.fpsAcc < 1.5) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.fps = fps;
    const S = this.save.settings;
    if (S.showFps) {
      if (!this.fpsEl) {
        this.fpsEl = document.createElement('div');
        this.fpsEl.style.cssText = 'position:absolute;left:50%;bottom:6px;transform:translateX(-50%);font:700 13px Rajdhani,sans-serif;color:#9fe;z-index:70;text-shadow:0 1px 2px #000';
        this.uiRoot.appendChild(this.fpsEl);
      }
      this.fpsEl.style.display = '';
      this.fpsEl.textContent = `${Math.round(fps)} FPS · ${Math.round((this.resScale || 1) * 100)}% RES`;
    } else if (this.fpsEl) this.fpsEl.style.display = 'none';
    if (!S.dynamicRes || this.state === 'loading' || document.hidden) return;
    const prev = this.resScale || 1;
    let next = prev;
    if (fps < 40) next = Math.max(0.55, prev - 0.1);
    else if (fps > 57 && prev < 1) next = Math.min(1, prev + 0.05);
    if (next !== prev) {
      this.resScale = next;
      this._resize();
    }
  }

  _update(dt) {
    const input = this.input;
    const st = this.state;
    if (this.menus.open) this.menus.update(input);
    if (this.mapView.active) this.mapView.draw();
    if (this.net.inRoom) this.remotes.update(dt, this.camera.position);

    if (st === 'title' || st === 'starter') {
      this._simulate(dt, false);
      if (this.preview) {
        this.preview.model.root.rotation.y += dt * 0.3;
        this.rig.updateOrbit(dt, input, this.preview.pos, { auto: false, minDist: 5, maxDist: 12 });
      } else {
        this.rig.updateCinematic(dt, this.player.root.position, this.player.heading);
      }
      this.world.update(dt, this.camera.position, this.time);
      return;
    }
    if (st === 'paused' || st === 'results' && this.menus.open && this.menus.top.name !== 'results') {
      if (this.preview) {
        this.preview.model.root.rotation.y += dt * 0.25;
        this.rig.updateOrbit(dt, input, this.preview.pos, { minDist: 5, maxDist: 12 });
      }
      this.world.update(0, this.camera.position, this.time);
      return;
    }
    if (st === 'photo') {
      this.rig.updateOrbit(dt, input, this.rig.orbit.target, { free: input.mouse.down, minDist: 2, maxDist: 40, fov: this.photoFov });
      this.world.update(0, this.camera.position, this.time);
      return;
    }
    if (st === 'loading-event') {
      this.world.update(dt, this.camera.position, this.time);
      return;
    }

    // ---------- driving states: freeroam / race / results ----------
    const pl = this.player;
    if (input.pressed('pause') && st !== 'results') { this.pause(); return; }
    if (input.pressed('map') && st === 'freeroam') { this.openMap(); return; }
    if (input.pressed('photo')) { this.prevState = st; this.enterPhoto(); return; }
    if (input.pressed('hud')) { this.hudVisible = !this.hudVisible; this.hud.setVisible(this.hudVisible); }
    if (input.pressed('camera')) {
      this.rig.mode = (this.rig.mode + 1) % 4;
      this.save.settings.camera = this.rig.mode;
    }
    if (input.pressed('radio') && this.audio.enabled) {
      this.radioIndex = (this.radioIndex + 1) % (STATIONS.length + 1);
      const idx = this.radioIndex < STATIONS.length ? this.radioIndex : -1;
      this.audio.music.setStation(idx);
      if (idx >= 0) this.hud.radio(STATIONS[idx].name, STATIONS[idx].genre); else this.hud.radio('Radio Off', '');
    }
    if (input.pressed('lights')) pl.forceLights = !pl.forceLights;
    if (this.audio.enabled) this.audio.horn(input.held('horn'));

    // rewind
    const rewinding = input.held('rewind') && this.rewindBuf.length > 2 && st !== 'results' && !(this.race && (this.race.state === 'countdown' || this.race.online)) && !this.net.inRoom;
    this.hud.setRewind(rewinding);
    if (rewinding) {
      this._rewindStep();
      this.world.update(dt, this.camera.position, this.time);
      this.rig.update(dt, pl, input, {});
      this._updateHud(dt);
      return;
    }

    // controls
    if (!pl.ai) {
      const c = pl.controls;
      c.throttle = input.axes.throttle;
      c.brake = input.axes.brake;
      c.steer = input.axes.steer;
      c.handbrake = input.held('handbrake') ? 1 : 0;
      c.steerAngle = undefined;
      if (input.pressed('shiftUp')) c.shiftUp = true;
      if (input.pressed('shiftDown')) c.shiftDown = true;
    }
    if (input.pressed('reset')) this._resetToRoad();
    if (input.pressed('chat') && this.net.inRoom) { this._openChat(); return; }

    // event prompt / activation
    if (st === 'freeroam') {
      const near = this.activities.nearestEvent(pl.pos, 14);
      if (near) {
        this.hud.prompt(near.ev.name, `${near.ev.discipline} · press to start`, 'ENTER', () => this._openEventCard(near));
        if (input.pressed('confirm')) { this._openEventCard(near); return; }
      } else this.hud.clearPrompt();
    } else this.hud.clearPrompt();

    this.physics.kinematic = this.net.inRoom ? this.remotes.obstacles() : [];
    this._simulate(dt, true);
    this._netSend(dt);

    // race logic
    if (this.race) {
      const events = [];
      this.race.update(dt, events);
      if (this.race.state === 'running') {
        const me = this.race.p.find((x) => x.isPlayer);
        if (me && !me.finished && this.ghostRec) this.ghostRec.record(this.race.time, pl);
        if (this.ghost) this.ghost.update(this.race.time);
      }
      for (const e of events) this._onRaceEvent(e);
      if (this.finishTimer !== undefined && this.finishTimer > 0 && this.race.online) {
        // online: results come from the server; fall back to local results if it goes quiet
        this.finishTimer -= dt;
        if (this.finishTimer <= 0) { this.finishTimer = undefined; this._showResults(); }
      } else if (this.finishTimer !== undefined && this.finishTimer > 0) {
        this.finishTimer -= dt;
        const allDone = this.race.p.every((x) => x.finished);
        if (this.finishTimer <= 0 || (allDone && this.finishTimer < 2.5)) {
          this.finishTimer = undefined;
          this._showResults();
        }
      }
    }

    // activities
    if (st === 'freeroam') {
      const out = [];
      this.activities.update(dt, this.camera.position, pl, this.skills, out);
      for (const e of out) this._onActivity(e);
    } else this.activities.update(dt, this.camera.position, null, null, []);

    // skills
    const others = [...this.traffic.map((t) => t.v), ...this.opponents];
    this.skills.update(dt, pl, others, {
      onDrift: (pts) => {
        const st = this.save.progress.stats;
        st.drifts += Math.round(pts);
        st.bestDrift = Math.max(st.bestDrift || 0, pts);
      },
      onAir: (t) => {
        const st = this.save.progress.stats;
        st.airtime += t;
        st.bestAir = Math.max(st.bestAir || 0, t);
      },
    });

    this._updateTraffic(dt);
    this._recordRewind(dt);
    this._autoRecover(dt);

    // weather
    if (this.save.settings.weather === 'dynamic') {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        this.weatherTimer = 180 + Math.random() * 240;
        const r = Math.random();
        const w = r < 0.6 ? 'clear' : r < 0.8 ? 'rain' : r < 0.9 ? 'fog' : 'storm';
        if (w !== this.world.env.weather) {
          this.world.env.setWeather(w);
          if (w !== 'clear') this.hud.toast(w === 'rain' ? 'RAIN INCOMING' : w === 'storm' ? 'STORM INCOMING' : 'FOG ROLLING IN', 'Grip will be reduced', 'cyan');
        }
      }
    }
    const env = this.world.env;
    this.physics.weatherGrip = (1 - env.rain * 0.15) * (this.save.settings.season === 'winter' ? 0.9 : 1);
    const wet = env.rain;
    for (const k in this.world.roads.materials) {
      const m = this.world.roads.materials[k];
      if (k.startsWith('dirt')) continue;
      m.roughness = lerp(0.88, 0.32, wet);
      m.envMapIntensity = lerp(1, 2.2, wet);
    }

    // camera
    this.rig.update(dt, pl, input, { lookBack: input.held('lookBack') });
    this.world.update(dt, pl.pos, this.time);
    if (this.audio.enabled) {
      this.audio.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()), this.camera.up);
      for (const e of this.audio.engines) e.update(dt, this.camera.position);
      this.audio.music.update();
      this.audio.ambient.update(dt, env, true);
    }
    this._updateHud(dt);

    // stats
    const ps = this.save.progress.stats;
    ps.distance += pl.speed * dt;
    if (this.world.env.nightAmount > 0.5) ps.nightDistance = (ps.nightDistance || 0) + pl.speed * dt;
    // accolades & barn finds
    this.accTimer = (this.accTimer || 0) - dt;
    if (this.accTimer <= 0) {
      this.accTimer = 1.5;
      this._checkAccolades();
      if (st === 'freeroam') this._checkBarns();
    }
    if (this.race && this.race.ev.type === 'drift' && this.race.state === 'running') {
      const da = Math.abs(pl.driftAngle);
      if (pl.grounded && da > 0.26 && da < 1.6 && pl.speed > 8) this.race.driftScore = (this.race.driftScore || 0) + pl.speed * da * 28 * dt * this.skills.mult;
    }
    ps.topSpeed = Math.max(ps.topSpeed, pl.speedKmh);
    this.lastStatSave += dt;
    if (this.lastStatSave > 20) { this.lastStatSave = 0; this._persistPosition(); }
    // GPS recompute when far off route
    if (this.gpsRoute && st === 'freeroam') {
      this.gpsCheck = (this.gpsCheck || 0) + dt;
      if (this.gpsCheck > 1) {
        this.gpsCheck = 0;
        const pr = this.gpsRoute.project(pl.pos.x, pl.pos.z, -1);
        if (pr.dist > 30) this._recomputeGps();
        if (Math.hypot(pl.pos.x - this.waypoint.x, pl.pos.z - this.waypoint.z) < 25) {
          this.hud.toast('DESTINATION REACHED', '', 'cyan');
          this.setWaypoint(null);
        }
      }
    }
  }

  _openEventCard(near) {
    this.prevState = this.state;
    this.state = 'paused';
    this.audio.suspend(true);
    this.hud.clearPrompt();
    this.menus.eventCard(near.ev, { color: near.color, length: near.route.length });
  }

  _simulate(dt, active) {
    // AI controllers
    if (active) {
      const all = [this.player, ...this.opponents, ...this.traffic.map((t) => t.v)];
      for (const t of this.traffic) if (!t.v.sleeping) t.ai.update(dt, all);
      if (this.race) for (const pp of this.race.p) if (pp.ai && !pp.vehicle.frozen) pp.ai.update(dt, all);
      if (this.player.ai) this.player.ai.update(dt, all);
    }
    this.acc += dt;
    let steps = 0;
    const sleeping = [];
    for (const t of this.traffic) if (t.v.sleeping) { sleeping.push(t.v); t.v.frozen = true; }
    while (this.acc >= STEP && steps < 12) {
      this.physics.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 12) this.acc = 0;
    for (const v of sleeping) v.frozen = false;
    const lightsOn = this.world.env.nightAmount > 0.35 || this.world.env.rain > 0.5 || this.world.env.fog > 0.5;
    for (const v of this.physics.vehicles) {
      if (v !== this.player) v.lightsOn = lightsOn;
      v.root.updateMatrixWorld();
      v.syncVisual(dt);
    }
    this.fx.update(dt, this.physics.vehicles, this.player, this.world.env, this.camera);
  }

  _resetToRoad() {
    const pl = this.player;
    let q = null;
    if (this.race) {
      const pp = this.race.p.find((x) => x.isPlayer);
      const r = this.race.route;
      const i = r.indexAtS(Math.max(0, pp.lastS ?? 0));
      pl.place(r.x[i], r.y[i], r.z[i], r.heading(i));
    } else {
      q = this.hf.roads.nearest(pl.pos.x, pl.pos.z, 4000);
      if (!q) return;
      const fwd = pl.forward;
      let h = Math.atan2(-q.tx, -q.tz);
      if (q.tx * fwd.x + q.tz * fwd.z < 0) h += Math.PI;
      pl.place(q.x, q.y, q.z, h);
    }
    this.fx.skids.last.clear();
    this.rig.snap();
    this.skills.breakChain('');
  }

  _autoRecover(dt) {
    const pl = this.player;
    const bad = pl.up.y < 0.25 && pl.speed < 3;
    const water = pl.inWater && pl.pos.y < -0.2;
    this.recoverTimer = bad || water ? (this.recoverTimer || 0) + dt : 0;
    if (this.recoverTimer > (water ? 1.2 : 2.5)) {
      this.recoverTimer = 0;
      this._resetToRoad();
      this.hud.toast(water ? 'SPLASH!' : 'FLIPPED', 'Car reset to the road', '');
    }
    if (pl.pos.y < -40) this._resetToRoad();
  }

  // ---------- online ----------
  playerName() {
    const S = this.save.settings;
    if (!S.playerName) {
      S.playerName = `Driver${Math.floor(1000 + Math.random() * 9000)}`;
      this.save.save();
    }
    return S.playerName;
  }

  _hello() {
    const e = this.save.currentCar || { id: 'vela', paint: '#ff2d87' };
    return { name: this.playerName(), car: e.id, paint: e.paint };
  }

  async connectOnline(url) {
    if (!url) throw new Error('No server address');
    await this.net.connect(url, this._hello());
    this.hud.toast('CONNECTED', 'Join a room to see other drivers', 'cyan');
  }

  disconnectOnline() {
    if (this.race && this.race.online) this.quitEvent(true);
    this.net.disconnect();
    this.remotes.clear();
    this.physics.kinematic = [];
  }

  _hookNet() {
    const net = this.net;
    const colorOf = (id) => {
      const p = net.room && net.room.players.find((x) => x.id === id);
      return p ? p.paint : '#19d3ff';
    };
    const pushChat = (name, text, color) => {
      this.chatLog.push({ name, text, color });
      if (this.chatLog.length > 40) this.chatLog.shift();
      this.hud.chat(name, text, color);
      this.menus.refreshIf('online', 'chat');
    };
    net.on('room', (m) => {
      this.remotes.syncRoster(m.code ? m.players : []);
      if (!m.code) this.physics.kinematic = [];
      this.menus.refreshIf('online');
      if (m.code && this._lastRoom !== m.code) {
        this._lastRoom = m.code;
        this.hud.toast(m.public ? 'PUBLIC FREE ROAM' : `ROOM ${m.code}`, `${m.players.length} driver${m.players.length > 1 ? 's' : ''} online`, 'cyan');
      }
      if (!m.code) this._lastRoom = null;
    });
    net.on('snap', (m) => this.remotes.onSnapshot(m));
    net.on('joined', (m) => pushChat('●', `${m.name} joined`, '#7dffb0'));
    net.on('left', (m) => {
      const r = this.remotes.players.get(m.id);
      if (r) pushChat('●', `${r.name} left`, '#ff8a8a');
      if (this.race && this.race.online) {
        const pp = this.race.p.find((x) => x.netId === m.id);
        if (pp && !pp.finished) pp.dnf = true;
      }
    });
    net.on('chat', (m) => pushChat(m.name, m.text, colorOf(m.id)));
    net.on('error', (m) => this.hud.toast('ONLINE', m.message, '', 3500));
    net.on('status', () => this.menus.refreshIf('online'));
    net.on('disconnected', () => {
      this.hud.toast('DISCONNECTED', 'Lost connection to the server', '', 4000);
      this.remotes.clear();
      this.physics.kinematic = [];
      if (this.race && this.race.online && this.race.state !== 'done') this.race.online = false;
    });
    net.on('leaderboard', (m) => {
      this.leaderboards[m.eventId] = m.list;
      if (this.onLeaderboard) this.onLeaderboard(m.eventId);
    });
    net.on('raceStart', (m) => this._startOnlineRace(m));
    net.on('raceProgress', (m) => {
      if (!this.race || !this.race.online) return;
      for (const s of m.standings) {
        const pp = this.race.p.find((x) => x.netId === s.id);
        if (pp && pp.remote && !pp.finished) pp.progress = s.prog;
      }
    });
    net.on('finished', (m) => {
      if (!this.race || !this.race.online) return;
      const pp = this.race.p.find((x) => x.netId === m.id);
      if (!pp || !pp.remote || pp.finished) return;
      pp.finished = true;
      pp.finishTime = m.time;
      pp.progress = this.race.total;
      this.race.finishOrder.push(pp);
      this.hud.toast(`${pp.name.toUpperCase()} FINISHED`, `P${m.position} · ${formatTime(m.time)}`, '', 2500);
    });
    net.on('raceResults', (m) => {
      if (!this.race || !this.race.online) return;
      this._showOnlineResults(m);
    });
  }

  _netSend(dt) {
    if (!this.net.inRoom) return;
    this.netSendT -= dt;
    if (this.netSendT > 0) return;
    this.netSendT = 1 / 15;
    const pl = this.player;
    const r = pl.root;
    const msg = {
      t: 'state',
      p: [+r.position.x.toFixed(2), +r.position.y.toFixed(2), +r.position.z.toFixed(2)],
      q: [+r.quaternion.x.toFixed(4), +r.quaternion.y.toFixed(4), +r.quaternion.z.toFixed(4), +r.quaternion.w.toFixed(4)],
      v: [+pl.vel.x.toFixed(2), +pl.vel.y.toFixed(2), +pl.vel.z.toFixed(2)],
      st: +pl.steerAngle.toFixed(3), rpm: Math.round(pl.rpm), g: pl.gear, th: +pl.controls.throttle.toFixed(2),
      b: (pl.gear === -1 ? pl.controls.throttle : pl.controls.brake) > 0.1 ? 1 : 0, l: pl.lightsOn ? 1 : 0,
    };
    if (this.race && this.race.online) {
      const me = this.race.p.find((x) => x.isPlayer);
      if (me) msg.prog = Math.round(me.progress);
    }
    this.net.send(msg);
    // keep the server's car/paint in sync with the garage
    const h = this._hello();
    const key = `${h.car}|${h.paint}|${h.name}`;
    if (key !== this._helloKey) {
      this._helloKey = key;
      this.net.send({ t: 'hello', ...h });
    }
  }

  _openChat() {
    if (this.chatBox) return;
    const box = document.createElement('div');
    box.className = 'chatbox interactive';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 120;
    input.placeholder = 'Chat — Enter to send, Esc to cancel';
    box.appendChild(input);
    this.uiRoot.appendChild(box);
    this.chatBox = box;
    const close = () => { box.remove(); this.chatBox = null; this.input.keys.clear(); };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (input.value.trim()) this.net.send({ t: 'chat', text: input.value });
        close();
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 50));
    setTimeout(() => input.focus(), 0);
  }

  _startOnlineRace(m) {
    const ev = EVENTS.find((x) => x.id === m.eventId);
    const route = this.eventRoutes.get(m.eventId);
    if (!ev || !route || !this.player) return;
    if (!m.grid.includes(this.net.id)) return;
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    this._disposeGhost();
    this._clearOpponents();
    this._clearTraffic();
    this.fx.clear();
    this.menus.closeAll();
    this.endPreview();
    this.audio.suspend(false);
    this.skills.breakChain('');
    const entry = this.save.currentCar;
    const pDef = CARS.find((c) => c.id === entry.id);
    const participants = m.grid.map((id) => {
      if (id === this.net.id) return { vehicle: this.player, ai: null, name: 'You', isPlayer: true, car: pDef.name, netId: id };
      const r = this.remotes.players.get(id);
      const info = this.net.room && this.net.room.players.find((x) => x.id === id);
      const proxy = r ? r.proxy : { pos: new THREE.Vector3(), vel: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), speed: 0 };
      const def = CARS.find((c) => c.id === (info ? info.car : '')) || CARS[0];
      return { vehicle: proxy, ai: null, name: info ? info.name : 'Driver', isPlayer: false, remote: true, car: def.name, netId: id };
    });
    const race = new Race(this.scene, ev, route, participants);
    race.online = true;
    race.countdown = Math.max(1, (m.startAt - this.net.serverNow()) / 1000);
    const slot = race.gridSlot(m.grid.indexOf(this.net.id));
    this.player.place(slot.x, slot.y, slot.z, slot.heading);
    this.player.frozen = true;
    this.player.ai = null;
    this.race = race;
    this.raceRoute = route;
    this.ghostRec = new GhostRecorder();
    const pp = this.player.p;
    this.playerProfile = route.speedProfile(0.9 * pp.grip + Math.min(0.3, pp.downforce * 0.05), 0.85 * pp.brake, 120, pp.offroad);
    this.state = 'race';
    this.rewindBuf = [];
    this.finishTimer = undefined;
    this.activities.setVisible(false);
    this.setWaypoint(null);
    this.rig.snap();
    this.save.progress.stats.races++;
    this.hud.toast(`ONLINE · ${ev.name.toUpperCase()}`, `${m.grid.length} drivers · ${(route.length / 1000).toFixed(1)} km`, 'cyan', 3500);
  }

  _showOnlineResults(m) {
    const race = this.race;
    const ev = race.ev;
    this.finishTimer = undefined;
    const rows = m.results.map((r) => ({
      name: r.id === this.net.id ? 'You' : r.name,
      car: (CARS.find((c) => c.id === r.car) || {}).name || '',
      time: r.time ?? race.time,
      me: r.id === this.net.id,
      dnf: r.time === null,
    }));
    let pos = rows.findIndex((r) => r.me) + 1;
    if (pos <= 0) pos = rows.length + 1;
    const mine = m.results.find((r) => r.id === this.net.id);
    const finished = mine && mine.time !== null;
    const frac = finished ? POSITION_REWARD[Math.min(pos, POSITION_REWARD.length) - 1] : 0.05;
    // online races pay a bonus that grows with the number of real opponents
    const bonus = 1 + Math.min(0.5, (rows.length - 1) * 0.1);
    const credits = Math.round((ev.reward * frac * bonus) / 100) * 100;
    const xp = Math.round(ev.xp * (0.4 + frac * 0.6) * bonus);
    const p = this.save.progress;
    if (finished) {
      const prev = p.events[ev.id];
      const record = !prev || mine.time < prev.best;
      p.events[ev.id] = { best: record ? mine.time : prev.best, position: prev ? Math.min(prev.position, pos) : pos };
      if (record && this.ghostRec) {
        const entry = this.save.currentCar;
        this.ghostRec.save(ev.id, entry.id, entry.paint, mine.time);
      }
    }
    if (pos === 1 && finished) p.stats.wins++;
    this.addXP(xp, credits);
    this.save.save();
    race.state = 'done';
    this.state = 'results';
    const title = !finished ? 'Did not finish' : pos === 1 ? 'Online victory!' : `Finished ${pos}${['st', 'nd', 'rd'][pos - 1] || 'th'} online`;
    this.menus.results({ event: ev, rows, credits, xp, record: false, title });
    this.lastEventId = null;
  }

  // ---------- rewind ----------
  _recordRewind(dt) {
    this.rewindTimer += dt;
    if (this.rewindTimer < 1 / 30) return;
    this.rewindTimer = 0;
    const snap = {
      v: this.physics.vehicles.map((v) => ({ v, s: v.getState() })),
      race: this.race ? this.race.snapshot() : null,
    };
    this.rewindBuf.push(snap);
    if (this.rewindBuf.length > 30 * 12) this.rewindBuf.shift();
  }

  _rewindStep() {
    const snap = this.rewindBuf.pop();
    if (!snap) return;
    if (this.rewindBuf.length) this.rewindBuf.pop(); // 2x speed
    for (const { v, s } of snap.v) {
      if (!this.physics.vehicles.includes(v)) continue;
      v.setState(s);
      v.root.updateMatrixWorld();
      v.syncVisual(1 / 60);
    }
    if (snap.race && this.race) this.race.restore(snap.race);
    for (const pp of this.race ? this.race.p : []) if (pp.ai) pp.ai.hint = -1;
    for (const t of this.traffic) t.ai.hint = -1;
    this.skills.breakChain('');
    this.fx.skids.last.clear();
  }

  // ---------- accolades / barns ----------
  _checkAccolades() {
    const p = this.save.progress;
    p.accolades = p.accolades || [];
    const ctx = { bestDrift: p.stats.bestDrift || 0, bestAir: p.stats.bestAir || 0 };
    for (const a of ACCOLADES) {
      if (p.accolades.includes(a.id)) continue;
      let ok = false;
      try { ok = a.check(p, p.stats, ctx); } catch (e) { ok = false; }
      if (!ok) continue;
      p.accolades.push(a.id);
      this.hud.toast(`ACCOLADE: ${a.name.toUpperCase()}`, `${a.desc} · +${formatNumber(a.cr)} CR`, 'gold', 4500);
      this.audio.fanfare();
      this.addXP(a.xp, a.cr);
      this.save.save();
      break; // one per check keeps toasts readable
    }
  }

  _checkBarns() {
    const p = this.save.progress;
    p.barns = p.barns || [];
    const pl = this.player;
    for (const b of this.world.scenery.barns) {
      if (p.barns.includes(b.id)) continue;
      if (Math.hypot(b.x - pl.pos.x, b.z - pl.pos.z) > 32) continue;
      p.barns.push(b.id);
      const car = CARS.find((c) => c.id === b.car);
      this.save.addCar(car.id, b.paint, { finish: 'matte' });
      this.save.save();
      this.hud.toast('BARN FIND!', `You discovered a ${car.year} ${car.name}. It's been added to your garage.`, 'gold', 6000);
      this.audio.fanfare();
      this.addXP(3000, 0);
    }
  }

  // ---------- activities ----------
  _onActivity(e) {
    const p = this.save.progress;
    const a = e.act;
    if (e.type === 'zoneStart') {
      this.audio.checkpoint();
      this.hud.toast(a.name.toUpperCase(), a.type === 'drift' ? 'Drift to score!' : 'Keep your average speed up!', 'cyan');
      return;
    }
    if (e.type === 'zoneFail') {
      this.hud.toast('ZONE FAILED', 'You left the zone', '');
      return;
    }
    const stars = Activities.starsFor(a, e.value);
    const rec = p.activities[a.id];
    const better = !rec || e.value > rec.best;
    const unit = a.type === 'drift' ? 'PTS' : a.type === 'jump' || e.type === 'jump' ? 'M' : 'KM/H';
    const shown = this.save.settings.units === 'mph' && unit === 'KM/H' ? `${Math.round(e.value * 0.621)} MPH` : `${formatNumber(e.value)} ${unit}`;
    const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    this.hud.toast(`${a.name.toUpperCase()} ${starStr}`, `${shown}${better && rec ? ' · NEW RECORD' : ''}`, stars === 3 ? 'gold' : 'cyan', 3500);
    if (better) {
      const prevStars = rec ? rec.stars : 0;
      p.activities[a.id] = { best: Math.round(e.value), stars: Math.max(stars, prevStars) };
      const gained = Math.max(0, stars - prevStars);
      if (gained > 0) this.addXP(gained * 800, gained * 1500);
      this.save.save();
    }
    this.audio.checkpoint();
  }

  // ---------- HUD ----------
  _updateHud(dt) {
    const pl = this.player;
    const S = this.save.settings;
    const hud = this.hud;
    hud.drawSpeedo(pl.speedKmh, pl.rpm, pl.p.redline, pl.gear, S.units);
    const p = this.save.progress;
    hud.setProgress(p.credits, p.level, p.xp / xpForLevel(p.level));
    hud.showProgress(!this.race);
    if (this.net.inRoom) {
      const r = this.net.room;
      hud.setNet(`● ONLINE · ${r.public ? 'PUBLIC' : `ROOM ${r.code}`} · ${r.players.length} DRIVER${r.players.length > 1 ? 'S' : ''}`);
    } else hud.setNet(this.net.online ? '● ONLINE' : null);
    // minimap
    if (S.showMinimap) {
      const icons = [];
      if (!this.race) {
        for (const e of this.activities.events) icons.push({ x: e.x, z: e.z, color: e.color, shape: 'diamond', r: 6, pin: false });
        for (const a of this.activities.list) icons.push({ x: a.x, z: a.z, color: a.color, r: 4 });
        if (this.waypoint) icons.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#2fa8ff', r: 6, pin: true });
      }
      for (const t of this.traffic) icons.push({ x: t.v.pos.x, z: t.v.pos.z, color: '#cfd6e6', shape: 'car', r: 4 });
      for (const v of this.opponents) icons.push({ x: v.pos.x, z: v.pos.z, color: '#ffb000', shape: 'car', r: 5 });
      for (const r of this.remotes.players.values()) icons.push({ x: r.proxy.pos.x, z: r.proxy.pos.z, color: r.paint, shape: 'diamond', r: 6, pin: true });
      let route = null, routeColor;
      if (this.race) {
        route = this._routeSlice(this.race.route, pl, 900);
        routeColor = '#ff2d87';
      } else if (this.gpsPath) {
        route = this.gpsPath;
        routeColor = '#2fa8ff';
      }
      hud.drawMinimap(this.mapImage, WORLD.size, pl.pos, pl.heading, { icons, route, routeColor, zoom: clamp(220 + pl.speed * 2.5, 220, 420) });
      this.roadNameT = (this.roadNameT || 0) - dt;
      if (this.roadNameT <= 0) {
        this.roadNameT = 0.5;
        const q = this.hf.roads.surfaceAt(pl.pos.x, pl.pos.z);
        hud.setRoadName(q ? q.road.name : '');
      }
    }
    // route arrows
    const lineMode = S.assists.brakingLine;
    if (this.race && this.race.state !== 'done') {
      this.routeDisplay.update(this.race.route, pl, lineMode === 'off' ? 'off' : lineMode, this.playerProfile, this.hf);
    } else if (this.gpsRoute) this.routeDisplay.update(this.gpsRoute, pl, 'gps', null, this.hf);
    else this.routeDisplay.clear();
    // race box
    if (this.race) {
      const r = this.race;
      const me = r.p.find((x) => x.isPlayer);
      const pos = r.positionOf(me);
      const info = { position: pos, total: r.p.length + (r.jet ? 1 : 0), time: r.time };
      if (r.closed) { info.lap = Math.min(r.laps, me.lap + 1); info.laps = r.laps; }
      info.cp = `${Math.min(me.cp, r.checkpoints.length)}/${r.checkpoints.length}`;
      if (r.ev.type === 'showcase') {
        const gap = me.progress - r.jetS;
        info.extra = ['JET', `${gap >= 0 ? '+' : ''}${Math.round(gap)} m`];
      }
      if (r.ev.type === 'drift') {
        info.position = null;
        info.extra = ['SCORE', formatNumber(Math.round(r.driftScore || 0))];
        info.best = null;
      }
      if (r.p.length > 2) info.standings = r.standings().map((x) => ({ name: x.name, me: x.isPlayer }));
      hud.setRace(info);
      // wrong way
      const pr = me.hint >= 0 ? r.route : null;
      if (pr && pl.speed > 5) {
        const i = me.hint;
        const dot = pl.vel.x * r.route.tx[i] + pl.vel.z * r.route.tz[i];
        hud.setWrongWay(dot < -3);
      } else hud.setWrongWay(false);
    } else {
      hud.setRace(null);
      hud.setWrongWay(false);
    }
    // activity readout
    const z = this.activities.activeZone;
    if (z) {
      if (z.type === 'zone') hud.activity(z.act.name, `${Math.round((z.dist / Math.max(0.1, z.t)) * 3.6 * (S.units === 'mph' ? 0.621 : 1))} ${S.units === 'mph' ? 'MPH' : 'KM/H'} AVG`, z.act.color);
      else hud.activity(z.act.name, `${formatNumber(z.score)} PTS`, z.act.color);
    } else hud.activity(null);
    // skills
    const sk = this.skills;
    const pend = sk.pending();
    hud.skillUpdate(Math.round(sk.chain + pend), sk.mult, this.skillNames.join(' + '), sk.activeName(), sk.timer);
    // speed vignette
    if (S.motionBlur) {
      hud.setVignette(clamp((pl.speedKmh - 180) / 160, 0, 0.8));
      const b = clamp((pl.speedKmh - 170) / 180, 0, 1) * 0.06;
      this.speedBlur.uniforms.strength.value = b;
      this.speedBlur.enabled = b > 0.002;
    } else {
      hud.setVignette(0);
      this.speedBlur.enabled = false;
    }
  }

  _routeSlice(route, v, len) {
    const pr = route.project(v.pos.x, v.pos.z, -1);
    const out = [];
    for (let d = -100; d < len; d += 12) {
      const p = route.pointAtS(route.closed ? (pr.s + d + route.length) % route.length : pr.s + d);
      out.push({ x: p.x, z: p.z });
    }
    return out;
  }

  _render() {
    const S = this.save.settings;
    if (S.bloom && S.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
