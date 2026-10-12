import { clamp, formatNumber, formatTime } from '../core/utils.js';
import { EVENTS } from '../config/events.js';
import { POI } from '../world/WorldConfig.js';

/** Full-screen interactive world map. */
export class MapView {
  constructor(game) {
    this.game = game;
    this.zoom = 1;
    this.cx = 0;
    this.cz = 0;
    this.sel = null;
  }

  attach(canvas, infoEl, screen) {
    const g = this.game;
    this.canvas = canvas;
    this.info = infoEl;
    this.screen = screen;
    const p = g.player ? g.player.pos : { x: 0, z: 0 };
    this.cx = p.x;
    this.cz = p.z;
    this.zoom = Math.min(window.innerWidth, window.innerHeight) / 2600;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._resize();
    let drag = null;
    canvas.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false }; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove = (e) => {
      if (!drag) { this.hover = this._pick(e.clientX, e.clientY); return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      this.cx = drag.cx - dx / this.zoom;
      this.cz = drag.cz - dy / this.zoom;
    };
    canvas.onpointerup = (e) => {
      if (drag && !drag.moved) this._click(e.clientX, e.clientY);
      drag = null;
    };
    canvas.onwheel = (e) => {
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const before = this._toWorld(e.clientX, e.clientY);
      this.zoom = clamp(this.zoom * f, 0.12, 4);
      const after = this._toWorld(e.clientX, e.clientY);
      this.cx += before.x - after.x;
      this.cz += before.z - after.z;
      e.preventDefault();
    };
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this.active = true;
    // keyboard/gamepad: cycle events with arrows
    screen.handle = (input) => {
      const ev = this.game.activities.events;
      if (input.pressed('navRight') || input.pressed('down')) this._cycle(1, ev);
      if (input.pressed('navLeft') || input.pressed('up')) this._cycle(-1, ev);
      if (input.pressed('confirm') && this.sel && this.sel.kind === 'event') this.game.travelToEvent(this.sel.data.ev.id);
      if (input.pressed('back') || input.pressed('map')) screen.onBack();
      const lx = input.axes.lookX, ly = input.axes.lookY;
      if (lx || ly) { this.cx += lx * 20 / this.zoom; this.cz += ly * 20 / this.zoom; }
    };
    this._renderInfo();
  }

  _cycle(d, evs) {
    let i = this.sel && this.sel.kind === 'event' ? evs.indexOf(this.sel.data) : -1;
    i = (i + d + evs.length) % evs.length;
    this.sel = { kind: 'event', data: evs[i] };
    this.cx = evs[i].x;
    this.cz = evs[i].z;
    this._renderInfo();
  }

  detach() {
    this.active = false;
    window.removeEventListener('resize', this._onResize);
  }

  _resize() {
    const c = this.canvas;
    c.width = window.innerWidth * this.dpr;
    c.height = window.innerHeight * this.dpr;
  }

  _toWorld(sx, sy) {
    return { x: this.cx + (sx - window.innerWidth / 2) / this.zoom, z: this.cz + (sy - window.innerHeight / 2) / this.zoom };
  }

  _toScreen(x, z) {
    return [(x - this.cx) * this.zoom + window.innerWidth / 2, (z - this.cz) * this.zoom + window.innerHeight / 2];
  }

  _items() {
    const g = this.game;
    const items = [];
    for (const e of g.activities.events) items.push({ kind: 'event', x: e.x, z: e.z, color: e.color, data: e, r: 9 });
    for (const a of g.activities.list) {
      const color = a.type === 'trap' ? '#2f8bff' : a.type === 'zone' ? '#19d3ff' : '#b14bff';
      items.push({ kind: 'activity', x: a.x, z: a.z, color, data: a, r: 6 });
    }
    for (const j of g.activities.jumps) items.push({ kind: 'jump', x: j.x, z: j.z, color: '#ffcc00', data: j, r: 6 });
    const smashed = new Set(g.save.progress.boards);
    for (const b of g.world.scenery.xpBoards) if (!smashed.has(b.id)) items.push({ kind: 'board', x: b.x, z: b.z, color: '#ff8a1f', data: b, r: 4 });
    return items;
  }

  _pick(sx, sy) {
    let best = null, bd = 16;
    for (const it of this._items()) {
      const [x, y] = this._toScreen(it.x, it.z);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  _click(sx, sy) {
    const it = this._pick(sx, sy);
    if (it) {
      this.sel = it;
    } else {
      const w = this._toWorld(sx, sy);
      this.sel = { kind: 'waypoint', x: w.x, z: w.z };
      this.game.setWaypoint(w.x, w.z);
    }
    this._renderInfo();
  }

  _renderInfo() {
    const g = this.game;
    const s = this.sel;
    const info = this.info;
    if (!s) {
      info.innerHTML = `<div class="panel"><h2 style="font-size:28px">Island of Solano</h2><div class="desc">Select an event marker to see details, travel there or set a GPS route. Click anywhere to place a waypoint.</div></div>`;
      return;
    }
    if (s.kind === 'event') {
      const ev = s.data.ev;
      const rec = g.save.progress.events[ev.id];
      info.innerHTML = `<div class="panel" style="border-top:5px solid ${s.data.color}"><div style="color:${s.data.color};font-weight:800;letter-spacing:2px">${ev.discipline.toUpperCase()}</div><h2 style="font-size:30px">${ev.name}</h2>
        <div class="desc">${ev.desc}</div><div class="spec"><div><span>Length</span>${(s.data.route.length / 1000).toFixed(1)} km</div><div><span>Reward</span>${formatNumber(ev.reward)} CR</div>
        <div><span>Best</span>${rec ? formatTime(rec.best) : '--'}</div><div><span>Result</span>${rec ? `P${rec.position}` : '--'}</div></div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn small primary travel"><span>Fast Travel</span></button><button class="btn small route"><span>Set Route</span></button></div></div>`;
      info.querySelector('.travel').onclick = () => g.travelToEvent(ev.id);
      info.querySelector('.route').onclick = () => { g.setWaypoint(s.data.x, s.data.z); this.screen.onBack(); };
    } else if (s.kind === 'activity') {
      const a = s.data;
      const rec = g.save.progress.activities[a.id];
      const unit = a.type === 'drift' ? 'pts' : 'km/h';
      info.innerHTML = `<div class="panel" style="border-top:5px solid ${a.color}"><div style="color:${a.color};font-weight:800;letter-spacing:2px">${a.type === 'trap' ? 'SPEED TRAP' : a.type === 'zone' ? 'SPEED ZONE' : 'DRIFT ZONE'}</div>
        <h2 style="font-size:28px">${a.name}</h2><div class="desc">3 stars: ${formatNumber(a.stars[2])} ${unit}<br>Your best: ${rec ? `${formatNumber(rec.best)} ${unit}` : '--'}</div>
        <div style="margin-top:12px"><button class="btn small route"><span>Set Route</span></button></div></div>`;
      info.querySelector('.route').onclick = () => { g.setWaypoint(a.x, a.z); this.screen.onBack(); };
    } else if (s.kind === 'jump') {
      info.innerHTML = `<div class="panel" style="border-top:5px solid #ffcc00"><div style="color:#ffcc00;font-weight:800;letter-spacing:2px">DANGER SIGN</div><h2 style="font-size:28px">${s.data.name}</h2><div class="desc">Hit the ramp at speed. 3 stars: ${s.data.stars ? s.data.stars[2] : 80} m</div>
        <div style="margin-top:12px"><button class="btn small route"><span>Set Route</span></button></div></div>`;
      info.querySelector('.route').onclick = () => { g.setWaypoint(s.data.x, s.data.z); this.screen.onBack(); };
    } else if (s.kind === 'board') {
      info.innerHTML = `<div class="panel" style="border-top:5px solid #ff8a1f"><div style="color:#ff8a1f;font-weight:800;letter-spacing:2px">XP BOARD</div><h2 style="font-size:28px">Smash it!</h2><div class="desc">Drive through XP boards for bonus XP.</div>
        <div style="margin-top:12px"><button class="btn small route"><span>Set Route</span></button></div></div>`;
      info.querySelector('.route').onclick = () => { g.setWaypoint(s.data.x, s.data.z); this.screen.onBack(); };
    } else {
      info.innerHTML = `<div class="panel"><h2 style="font-size:28px">Waypoint set</h2><div class="desc">Follow the blue GPS arrows.</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn small primary drive"><span>Drive</span></button><button class="btn small clear"><span>Clear</span></button></div></div>`;
      info.querySelector('.drive').onclick = () => this.screen.onBack();
      info.querySelector('.clear').onclick = () => { g.setWaypoint(null); this.sel = null; this._renderInfo(); };
    }
  }

  draw() {
    if (!this.active) return;
    const g = this.game;
    const c = this.canvas;
    const ctx = c.getContext('2d');
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d3a52';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = g.mapImage;
    const ws = 4096;
    const [x0, y0] = this._toScreen(-ws / 2, -ws / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, x0, y0, ws * this.zoom, ws * this.zoom);
    // labels
    ctx.font = '700 14px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    for (const k of ['festival', 'town', 'lake', 'mountain', 'forest', 'fields']) {
      const p = POI[k];
      const [x, y] = this._toScreen(p.x, p.z);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(p.name.toUpperCase(), x + 1, y + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name.toUpperCase(), x, y);
    }
    // GPS route
    if (g.gpsPath && g.gpsPath.length > 1) {
      ctx.strokeStyle = '#2fa8ff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      g.gpsPath.forEach((p, i) => {
        const [x, y] = this._toScreen(p.x, p.z);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    // items
    for (const it of this._items()) {
      const [x, y] = this._toScreen(it.x, it.z);
      if (x < -20 || y < -20 || x > window.innerWidth + 20 || y > window.innerHeight + 20) continue;
      const sel = this.sel && this.sel.data === it.data;
      const hov = this.hover && this.hover.data === it.data;
      ctx.fillStyle = it.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = sel || hov ? 3 : 1.5;
      const r = it.r * (sel || hov ? 1.4 : 1);
      ctx.beginPath();
      if (it.kind === 'event') {
        ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      } else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (it.kind === 'event' && (this.zoom > 0.35 || sel || hov)) {
        ctx.font = '700 13px Rajdhani, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(it.data.ev.name, x, y - r - 6);
      }
    }
    // barn find rumours (unfound) and found barns
    const found = new Set(g.save.progress.barns || []);
    for (const b of g.world.scenery.barns || []) {
      const [x, y] = this._toScreen(b.x, b.z);
      if (found.has(b.id)) {
        ctx.fillStyle = '#8e2a20';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      } else {
        // rumour circle offset from the real location so it must be searched for
        const ox = Math.sin(b.x) * 60, oz = Math.cos(b.z) * 60;
        const [rx, ry] = this._toScreen(b.x + ox, b.z + oz);
        ctx.strokeStyle = 'rgba(255,210,26,0.9)';
        ctx.fillStyle = 'rgba(255,210,26,0.12)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, 150 * this.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd21a';
        ctx.font = '800 16px Rajdhani, sans-serif';
        ctx.fillText('BARN FIND?', rx, ry + 5);
      }
    }
    // waypoint
    if (g.waypoint) {
      const [x, y] = this._toScreen(g.waypoint.x, g.waypoint.z);
      ctx.fillStyle = '#2fa8ff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y - 18, 8, Math.PI * 0.8, Math.PI * 2.2);
      ctx.closePath();
      ctx.fill();
    }
    // player
    if (g.player) {
      const [x, y] = this._toScreen(g.player.pos.x, g.player.pos.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-g.player.heading);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#ff2d87';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    void EVENTS;
  }
}
