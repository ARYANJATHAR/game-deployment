import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep, rng } from '../core/utils.js';

/**
 * Sky, sun/moon lights, fog, stars, weather and environment reflections.
 * timeOfDay: 0..24 hours.
 */
export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.time = 15.5;
    this.timeSpeed = 1 / 60; // in-game hours per real second
    this.cycle = true;
    this.weather = 'clear';
    this.rain = 0;
    this.targetRain = 0;

    this.sky = new Sky();
    this.sky.scale.setScalar(40000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3;
    u.rayleigh.value = 2;
    u.mieCoefficient.value = 0.0035;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight('#fff3dd', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
    sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight('#bcd7ff', '#5b5140', 1.0);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog('#bfd3e6', 300, 2600);

    this._stars();
    this._clouds();

    // env map for reflections
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(
      new THREE.SphereGeometry(500, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#3d4a33', side: THREE.BackSide }),
    );
    this.envScene.add(this.envGround);
    this.envRT = null;
    this.lastEnvTime = -100;

    this.sunDir = new THREE.Vector3();
    this.nightAmount = 0;
    this._rainSystem();
    this.update(0, new THREE.Vector3(), true);
  }

  _stars() {
    const r = rng(3);
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * 9000;
      pos[i * 3 + 1] = Math.abs(u) * 9000;
      pos[i * 3 + 2] = Math.sin(a) * s * 9000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  _clouds() {
    this.cloudUniforms = {
      time: { value: 0 },
      coverage: { value: 0.45 },
      night: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#ffffff') },
      brightness: { value: 1.6 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float time, coverage, night, brightness;
        uniform vec3 sunDir, sunColor;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          if (d.y < 0.0) discard;
          vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(time * 0.006, time * 0.0035);
          float n = fbm(uv);
          float c = smoothstep(1.0 - coverage, 1.0 - coverage + 0.32, n);
          float n2 = fbm(uv + sunDir.xz * 0.12);
          float shade = clamp(1.0 - (n2 - n) * 3.0, 0.45, 1.2);
          vec3 base = mix(vec3(0.55, 0.6, 0.7), vec3(1.0), shade);
          vec3 col = base * mix(sunColor, vec3(1.0), 0.35) * brightness;
          col *= mix(1.0, 0.04, night);
          float horizon = smoothstep(0.0, 0.25, d.y);
          gl_FragColor = vec4(col, c * horizon * 0.95);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    this.clouds.renderOrder = -2;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);
    this.cloudTime = 0;
  }

  _rainSystem() {
    const n = 6000;
    const pos = new Float32Array(n * 6);
    const r = rng(12);
    this.rainOffsets = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.rainOffsets[i * 3] = (r() - 0.5) * 80;
      this.rainOffsets[i * 3 + 1] = r() * 40;
      this.rainOffsets[i * 3 + 2] = (r() - 0.5) * 80;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainGeo = g;
    this.rainMat = new THREE.LineBasicMaterial({ color: '#a9c3d9', transparent: true, opacity: 0, depthWrite: false });
    this.rainLines = new THREE.LineSegments(g, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
    this.rainTime = 0;
  }

  setWeather(w) {
    this.weather = w;
    this.targetRain = w === 'rain' ? 1 : w === 'storm' ? 1 : 0;
    this.fogTarget = w === 'fog' ? 1 : w === 'storm' ? 0.6 : w === 'rain' ? 0.35 : 0;
  }

  get daylight() {
    return clamp(this.sunDir.y * 4 + 0.25, 0, 1);
  }

  update(dt, focus, force = false) {
    if (this.cycle) this.time = (this.time + dt * this.timeSpeed) % 24;
    this.rain = lerp(this.rain, this.targetRain, 1 - Math.exp(-dt * 0.4));
    this.fog = lerp(this.fog || 0, this.fogTarget || 0, 1 - Math.exp(-dt * 0.4));

    // sun position: rises at 6, sets at 18
    const t = (this.time - 6) / 12; // 0..1 during day
    const elev = Math.sin(t * Math.PI) * 1.05 - 0.05; // radians-ish
    const az = lerp(-1.9, 1.9, t);
    const phi = Math.PI / 2 - Math.max(-0.5, elev);
    this.sunDir.setFromSphericalCoords(1, phi, az + Math.PI * 0.75);
    const isDay = this.sunDir.y > -0.08;
    const night = 1 - smoothstep(-0.12, 0.08, this.sunDir.y);
    this.nightAmount = night;

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.rayleigh.value = lerp(3.0, 0.35, night) + this.rain * 1.5;
    u.turbidity.value = 2.6 + this.rain * 12 + this.fog * 6;
    const eu = this.envSky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = u[k].value;
    eu.sunPosition.value.copy(this.sunDir);

    // lights
    const sunUp = clamp(this.sunDir.y * 3, 0, 1);
    const golden = 1 - clamp(this.sunDir.y * 2.2, 0, 1);
    const sunColor = new THREE.Color().setRGB(1, lerp(0.96, 0.62, golden), lerp(0.9, 0.38, golden));
    const overcast = 1 - this.rain * 0.65 - this.fog * 0.4;
    if (isDay) {
      this.sun.color.copy(sunColor);
      this.sun.intensity = 3.2 * sunUp * overcast;
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    } else {
      // moon light
      this.sun.color.set('#8ea6d8');
      this.sun.intensity = 0.35;
      const moonDir = this.sunDir.clone().multiplyScalar(-1);
      moonDir.y = Math.max(0.3, moonDir.y);
      moonDir.normalize();
      this.sun.position.copy(focus).addScaledVector(moonDir, 300);
    }
    this.sun.target.position.copy(focus);
    // snap shadow camera to texel grid to reduce shimmering
    this.sun.target.updateMatrixWorld();

    this.hemi.intensity = lerp(1.15, 0.22, night) * lerp(1, 0.75, this.rain);
    this.hemi.color.set(night > 0.5 ? '#4a5a80' : '#bcd7ff');
    this.hemi.groundColor.set(night > 0.5 ? '#151515' : '#5b5140');

    // fog colour approximates horizon colour
    const dayFog = new THREE.Color('#a9c6e4');
    const duskFog = new THREE.Color('#e3a77c');
    const nightFog = new THREE.Color('#0d1424');
    const rainFog = new THREE.Color('#8e9aa6');
    const fogC = dayFog.clone().lerp(duskFog, golden * (1 - night) * 0.7).lerp(nightFog, night).lerp(rainFog.clone().lerp(nightFog, night), this.rain * 0.7);
    this.scene.fog.color.copy(fogC);
    const far = lerp(3400, 1100, this.rain * 0.55 + this.fog * 0.6);
    this.scene.fog.near = lerp(450, 90, this.fog);
    this.scene.fog.far = far;
    this.renderer.toneMappingExposure = lerp(0.66, 0.9, night) * lerp(1, 0.9, this.rain);
    this.starMat.opacity = night * (1 - this.rain);
    this.stars.position.copy(focus);
    // clouds follow the camera and thicken with bad weather
    this.cloudTime += dt;
    const cu = this.cloudUniforms;
    cu.time.value = this.cloudTime;
    cu.coverage.value = lerp(0.42, 0.95, Math.max(this.rain, this.fog * 0.7));
    cu.night.value = night;
    cu.sunDir.value.copy(this.sunDir);
    cu.sunColor.value.copy(sunColor);
    cu.brightness.value = lerp(1.7, 0.7, this.rain) * (0.6 + 0.4 * sunUp + 0.4 * golden * (1 - night));
    this.clouds.position.set(focus.x, 0, focus.z);

    // environment map refresh
    if (force || Math.abs(this.time - this.lastEnvTime) > 0.25 || Math.abs((this._lastRain || 0) - this.rain) > 0.1) {
      this.lastEnvTime = this.time;
      this._lastRain = this.rain;
      this.envGround.material.color.set(night > 0.5 ? '#0b0d10' : '#3d4a33');
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = lerp(1, 0.25, night);
    }

    // rain
    this.rainMat.opacity = this.rain * 0.55;
    this.rainLines.visible = this.rain > 0.02;
    if (this.rainLines.visible) {
      this.rainTime += dt;
      const p = this.rainGeo.attributes.position.array;
      const off = this.rainOffsets;
      const n = off.length / 3;
      const fall = 26;
      for (let i = 0; i < n; i++) {
        const y = ((off[i * 3 + 1] - this.rainTime * fall) % 40 + 40) % 40;
        const x = focus.x + off[i * 3], z = focus.z + off[i * 3 + 2];
        const yy = focus.y - 6 + y;
        p[i * 6] = x; p[i * 6 + 1] = yy; p[i * 6 + 2] = z;
        p[i * 6 + 3] = x + 0.08; p[i * 6 + 4] = yy - 0.9; p[i * 6 + 5] = z;
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }
  }

  setShadowQuality(q) {
    const size = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    this.sun.castShadow = q !== 'off';
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.mapSize.set(size, size);
  }
}
