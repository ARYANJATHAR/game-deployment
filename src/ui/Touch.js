import { el } from './HUD.js';

/** On-screen controls for touch devices: steering pad, pedals and buttons. */
export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.enabled = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.root = el('div', `touch interactive ${this.enabled ? 'on' : ''}`);
    root.insertBefore(this.root, root.firstChild);
    this.steer = el('div', 'tsteer', '<div class="knob"></div>');
    this.root.appendChild(this.steer);
    const knob = this.steer.querySelector('.knob');
    let sid = null;
    const setSteer = (x) => {
      const r = this.steer.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, ((x - r.left) / r.width) * 2 - 1));
      input.touch.steer = Math.abs(v) < 0.08 ? 0 : v;
      knob.style.left = `${(v * 0.5 + 0.5) * (r.width - 70)}px`;
    };
    this.steer.addEventListener('pointerdown', (e) => { sid = e.pointerId; this.steer.setPointerCapture(sid); setSteer(e.clientX); });
    this.steer.addEventListener('pointermove', (e) => { if (e.pointerId === sid) setSteer(e.clientX); });
    const end = (e) => { if (e.pointerId === sid) { sid = null; input.touch.steer = 0; knob.style.left = '65px'; } };
    this.steer.addEventListener('pointerup', end);
    this.steer.addEventListener('pointercancel', end);
    const btn = (label, style, onDown, onUp) => {
      const b = el('div', 'tbtn', label);
      Object.assign(b.style, style);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); b.setPointerCapture(e.pointerId); onDown(); });
      const up = () => { b.classList.remove('on'); onUp(); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      this.root.appendChild(b);
      return b;
    };
    const bottom = 'calc(30px + env(safe-area-inset-bottom, 0px))';
    btn('GAS', { right: '24px', bottom, width: '92px', height: '120px', borderRadius: '18px' }, () => { input.touch.throttle = 1; }, () => { input.touch.throttle = 0; });
    btn('BRAKE', { right: '130px', bottom, width: '86px', height: '90px', borderRadius: '18px' }, () => { input.touch.brake = 1; }, () => { input.touch.brake = 0; });
    btn('E-BRAKE', { right: '130px', bottom: 'calc(132px + env(safe-area-inset-bottom, 0px))', width: '86px', height: '56px', borderRadius: '14px', fontSize: '12px' }, () => { input.touch.buttons.handbrake = true; }, () => { input.touch.buttons.handbrake = false; });
    btn('⏪', { right: '24px', bottom: 'calc(162px + env(safe-area-inset-bottom, 0px))', width: '60px', height: '60px' }, () => { input.touch.buttons.rewind = true; }, () => { input.touch.buttons.rewind = false; });
    btn('II', { right: '18px', top: '18px', width: '52px', height: '52px' }, () => { input.touch.buttons.pause = true; }, () => { input.touch.buttons.pause = false; });
    btn('CAM', { right: '80px', top: '18px', width: '52px', height: '52px', fontSize: '11px' }, () => { input.touch.buttons.camera = true; }, () => { input.touch.buttons.camera = false; });
    btn('GO', { left: '50%', bottom: 'calc(140px + env(safe-area-inset-bottom, 0px))', width: '64px', height: '64px', marginLeft: '-32px', display: 'none' }, () => { input.touch.buttons.confirm = true; }, () => { input.touch.buttons.confirm = false; });
    window.addEventListener('touchstart', () => {
      if (!this.enabled) { this.enabled = true; this.root.classList.add('on'); }
    }, { passive: true });
  }

  setVisible(v) {
    this.root.style.display = v && this.enabled ? '' : 'none';
  }

  update() {}
}
