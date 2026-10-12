// Unified keyboard / gamepad / touch input with edge detection.

const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['KeyE', 'ShiftLeft'],
  shiftDown: ['KeyQ', 'ControlLeft'],
  rewind: ['KeyR', 'Backspace'],
  reset: ['KeyT'],
  camera: ['KeyC'],
  lookBack: ['KeyB'],
  map: ['KeyM', 'Tab'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  horn: ['KeyH'],
  lights: ['KeyL'],
  radio: ['KeyN'],
  photo: ['KeyF'],
  hud: ['KeyU'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  navLeft: ['ArrowLeft', 'KeyA'],
  navRight: ['ArrowRight', 'KeyD'],
  back: ['Escape', 'Backspace'],
};

const PAD = {
  handbrake: 0, // A
  back: 1, // B
  shiftDown: 2, // X
  rewind: 3, // Y
  lookBack: 4, // LB
  camera: 5, // RB
  map: 8, // View
  pause: 9, // Menu
  confirm: 0,
  horn: 10, // LS click
  lights: 11, // RS click
  up: 12, down: 13, navLeft: 14, navRight: 15,
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set(); // keys pressed since the last update (catches quick taps)
    this.prev = {};
    this.cur = {};
    this.axes = { steer: 0, throttle: 0, brake: 0, lookX: 0, lookY: 0 };
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: 0, buttons: {} };
    this.usingPad = false;
    this.mouse = { dx: 0, dy: 0, down: false, wheel: 0 };
    this.listeners = [];
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      this.keys.add(e.code);
      if (!e.repeat) this.tapped.add(e.code);
      this.usingPad = false;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace'].includes(e.code)) e.preventDefault();
      for (const l of this.listeners) l(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.down) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 2 || e.target.tagName === 'CANVAS') this.mouse.down = true; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
  }

  onKey(fn) {
    this.listeners.push(fn);
  }

  _key(action) {
    const ks = KEYMAP[action];
    if (!ks) return false;
    for (const k of ks) if (this.keys.has(k) || this.tapped.has(k)) return true;
    return false;
  }

  update() {
    this.prev = this.cur;
    this.cur = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;
    let steer = 0, throttle = 0, brake = 0;
    if (this._key('left')) steer -= 1;
    if (this._key('right')) steer += 1;
    if (this._key('throttle')) throttle = 1;
    if (this._key('brake')) brake = 1;
    let lookX = 0, lookY = 0;
    if (pad) {
      const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const ps = dead(pad.axes[0] || 0);
      const pt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const pb = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (Math.abs(ps) > 0 || pt > 0.05 || pb > 0.05) this.usingPad = true;
      if (Math.abs(ps) > Math.abs(steer)) steer = Math.sign(ps) * Math.pow(Math.abs(ps), 1.4);
      throttle = Math.max(throttle, pt);
      brake = Math.max(brake, pb);
      lookX = dead(pad.axes[2] || 0);
      lookY = dead(pad.axes[3] || 0);
    }
    // touch
    if (this.touch.steer) steer = this.touch.steer;
    throttle = Math.max(throttle, this.touch.throttle);
    brake = Math.max(brake, this.touch.brake);
    this.axes.steer = Math.max(-1, Math.min(1, steer));
    this.axes.throttle = throttle;
    this.axes.brake = brake;
    this.axes.lookX = lookX;
    this.axes.lookY = lookY;

    for (const action of Object.keys(KEYMAP)) {
      let v = this._key(action);
      if (pad && PAD[action] !== undefined && pad.buttons[PAD[action]] && pad.buttons[PAD[action]].pressed) v = true;
      if (this.touch.buttons[action]) v = true;
      this.cur[action] = v;
    }
    this.tapped.clear();
    // stick navigation for menus
    if (pad) {
      const y = pad.axes[1] || 0, x = pad.axes[0] || 0;
      if (y < -0.6) this.cur.up = true;
      if (y > 0.6) this.cur.down = true;
      if (x < -0.6) this.cur.navLeft = true;
      if (x > 0.6) this.cur.navRight = true;
      if (pad.buttons[1] && pad.buttons[1].pressed) this.cur.shiftUp = true;
    }
  }

  held(a) {
    return !!this.cur[a];
  }

  pressed(a) {
    return !!this.cur[a] && !this.prev[a];
  }

  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    return m;
  }

  rumble(strong, weak, ms) {
    const p = this.pad;
    if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
      p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    }
  }
}
