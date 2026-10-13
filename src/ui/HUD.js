import { formatTime, formatNumber, clamp } from '../core/utils.js';
import { classFor } from '../config/cars.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export { el };

/** In-game heads-up display: speedometer, minimap, race info, skills, toasts. */
export class HUD {
  constructor(root) {
    this.root = el('div', 'hud');
    root.appendChild(this.root);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    // speedometer
    this.speedo = el('div', 'speedo');
    this.speedCanvas = el('canvas');
    this.speedo.appendChild(this.speedCanvas);
    this.root.appendChild(this.speedo);

    // minimap
    this.mini = el('div', 'minimap');
    this.miniCanvas = el('canvas');
    this.roadName = el('div', 'road-name');
    this.mini.append(this.miniCanvas, this.roadName);
    this.root.appendChild(this.mini);

    // race box
    this.racebox = el('div', 'racebox hidden');
    this.root.appendChild(this.racebox);
    this.standings = el('div', 'standings hidden');
    this.root.appendChild(this.standings);

    // top right
    this.tr = el('div', 'topright');
    this.creditsEl = el('div', 'credits');
    this.levelEl = el('div', 'level');
    this.xpbar = el('div', 'xpbar', '<div></div>');
    this.tr.append(this.creditsEl, this.levelEl, this.xpbar);
    this.root.appendChild(this.tr);

    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);

    this.skill = el('div', 'skill hidden', '<div class="chain"></div><div class="names"></div><div class="bar"><div></div></div>');
    this.root.appendChild(this.skill);

    this.cd = el('div', 'countdown hidden');
    this.root.appendChild(this.cd);

    this.promptEl = el('div', 'prompt hidden interactive');
    this.root.appendChild(this.promptEl);

    this.activityEl = el('div', 'activity hidden');
    this.root.appendChild(this.activityEl);

    this.rewindEl = el('div', 'rewind hidden', '◀◀ REWIND');
    this.root.appendChild(this.rewindEl);

    this.radioEl = el('div', 'radio hidden');
    this.root.appendChild(this.radioEl);

    this.wrongWay = el('div', 'wrongway hidden', 'WRONG WAY');
    this.root.appendChild(this.wrongWay);

    this.vignette = el('div', 'vignette');
    this.root.appendChild(this.vignette);

    this.netEl = el('div', 'netbadge hidden');
    this.tr.appendChild(this.netEl);
    this.chatEl = el('div', 'chatlog');
    this.root.appendChild(this.chatEl);

    this.skillNames = [];
    this.skillHide = 0;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const s = this.speedo.getBoundingClientRect();
    this.speedCanvas.width = Math.max(10, s.width * this.dpr);
    this.speedCanvas.height = Math.max(10, s.height * this.dpr);
    const m = this.mini.getBoundingClientRect();
    this.miniCanvas.width = Math.max(10, m.width * this.dpr);
    this.miniCanvas.height = Math.max(10, m.height * this.dpr);
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
  }

  setMinimapVisible(v) {
    this.mini.style.display = v ? '' : 'none';
  }

  // ---------------- speedometer ----------------
  drawSpeedo(speedKmh, rpm, redline, gear, units, nitro = 0) {
    const c = this.speedCanvas;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const cx = W / 2, cy = H / 2, R = W * 0.44;
    ctx.clearRect(0, 0, W, H);
    const maxRpm = Math.ceil((redline + 800) / 1000) * 1000;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (r) => a0 + (a1 - a0) * (r / maxRpm);
    // background disc
    const grd = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
    grd.addColorStop(0, 'rgba(8,10,20,0.85)');
    grd.addColorStop(1, 'rgba(8,10,20,0.55)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
    ctx.fill();
    // track
    ctx.lineWidth = R * 0.09;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, a0, a1);
    ctx.stroke();
    // redline zone
    ctx.strokeStyle = 'rgba(255,40,60,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, ang(redline), a1);
    ctx.stroke();
    // rpm fill
    const fr = clamp(rpm, 0, maxRpm);
    const g2 = ctx.createLinearGradient(0, H, W, 0);
    g2.addColorStop(0, '#19d3ff');
    g2.addColorStop(0.7, '#ff2d87');
    g2.addColorStop(1, '#ff2d2d');
    ctx.strokeStyle = rpm > redline * 0.97 ? '#ff3344' : g2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.86, a0, ang(fr));
    ctx.stroke();
    // ticks
    ctx.fillStyle = '#cfd5e6';
    ctx.font = `700 ${Math.round(R * 0.12)}px Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= maxRpm; k += 1000) {
      const a = ang(k);
      ctx.strokeStyle = k >= redline ? '#ff5566' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72);
      ctx.lineTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78);
      ctx.stroke();
      ctx.fillText(String(k / 1000), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
    }
    // needle
    const na = ang(fr);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * R * 0.3, cy + Math.sin(na) * R * 0.3);
    ctx.lineTo(cx + Math.cos(na) * R * 0.95, cy + Math.sin(na) * R * 0.95);
    ctx.stroke();
    // speed
    const sp = units === 'mph' ? speedKmh * 0.621371 : speedKmh;
    ctx.fillStyle = '#fff';
    ctx.font = `800 italic ${Math.round(R * 0.5)}px "Saira Condensed", Rajdhani, sans-serif`;
    ctx.fillText(String(Math.round(sp)), cx, cy + R * 0.05);
    ctx.font = `700 ${Math.round(R * 0.13)}px Rajdhani, sans-serif`;
    ctx.fillStyle = '#9aa3b8';
    ctx.fillText(units === 'mph' ? 'MPH' : 'KM/H', cx, cy + R * 0.36);
    // gear
    const gtxt = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear);
    ctx.fillStyle = rpm > redline * 0.93 ? '#ff2d87' : 'rgba(25,211,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.66, R * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05060a';
    ctx.font = `800 ${Math.round(R * 0.22)}px "Saira Condensed", Rajdhani, sans-serif`;
    ctx.fillText(gtxt, cx, cy + R * 0.67);
    void nitro;
  }

  // ---------------- minimap ----------------
  drawMinimap(mapCanvas, worldSize, player, heading, opts = {}) {
    const c = this.miniCanvas;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const scale = mapCanvas.width / worldSize; // px per metre in map image
    const viewR = opts.zoom || 260; // metres from centre to edge
    const k = (W / 2) / viewR; // canvas px per metre
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#16384a';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(heading);
    const half = worldSize / 2;
    // draw map image region
    const sx = (player.x + half) * scale, sz = (player.z + half) * scale;
    const srcR = viewR * 1.5 * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapCanvas, sx - srcR, sz - srcR, srcR * 2, srcR * 2, -viewR * 1.5 * k, -viewR * 1.5 * k, viewR * 3 * k, viewR * 3 * k);
    const toLocal = (x, z) => [(x - player.x) * k, (z - player.z) * k];
    // route
    if (opts.route && opts.route.length > 1) {
      ctx.strokeStyle = opts.routeColor || '#2fa8ff';
      ctx.lineWidth = 4 * this.dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const p of opts.route) {
        const [x, y] = toLocal(p.x, p.z);
        if (Math.abs(x) > W * 1.5 || Math.abs(y) > H * 1.5) { started = false; continue; }
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // icons
    if (opts.icons) {
      for (const ic of opts.icons) {
        let [x, y] = toLocal(ic.x, ic.z);
        const d = Math.hypot(x, y);
        const lim = W / 2 - 10 * this.dpr;
        let edge = false;
        if (d > lim) {
          if (!ic.pin) continue;
          x = (x / d) * lim; y = (y / d) * lim; edge = true;
        }
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-heading);
        ctx.fillStyle = ic.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * this.dpr;
        const r = (ic.r || 5) * this.dpr * (edge ? 0.8 : 1);
        if (ic.shape === 'car') {
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
          ctx.fill();
        } else if (ic.shape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
    // player arrow (always up)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#ff2d87';
    ctx.lineWidth = 2 * this.dpr;
    const a = 9 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(0, -a * 1.2);
    ctx.lineTo(a * 0.8, a);
    ctx.lineTo(0, a * 0.5);
    ctx.lineTo(-a * 0.8, a);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // compass N
    ctx.save();
    ctx.translate(W / 2, H / 2);
    const na = heading - Math.PI / 2;
    const nr = W / 2 - 12 * this.dpr;
    ctx.fillStyle = '#ff2d87';
    ctx.font = `800 ${12 * this.dpr}px Rajdhani`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', Math.cos(na) * nr, Math.sin(na) * nr);
    ctx.restore();
  }

  setRoadName(n) {
    if (this._road !== n) {
      this._road = n;
      this.roadName.textContent = n || '';
    }
  }

  // ---------------- progression ----------------
  setProgress(credits, level, xpFrac) {
    const t = `${formatNumber(credits)} CR`;
    if (this._cr !== t) { this._cr = t; this.creditsEl.textContent = t; }
    const l = `LEVEL ${level}`;
    if (this._lv !== l) { this._lv = l; this.levelEl.textContent = l; }
    this.xpbar.firstChild.style.width = `${Math.round(xpFrac * 100)}%`;
  }

  showProgress(v) {
    this.tr.style.display = v ? '' : 'none';
  }

  // ---------------- race ----------------
  setRace(info) {
    if (!info) {
      this.racebox.classList.add('hidden');
      this.standings.classList.add('hidden');
      return;
    }
    this.racebox.classList.remove('hidden');
    let html = '';
    if (info.position) html += `<div class="pos">${info.position}<small>/${info.total}</small></div>`;
    if (info.lap) html += `<div class="row"><span>LAP</span><span>${info.lap}/${info.laps}</span></div>`;
    html += `<div class="row"><span>TIME</span><span>${formatTime(info.time)}</span></div>`;
    if (info.best) html += `<div class="row"><span>BEST</span><span>${formatTime(info.best)}</span></div>`;
    if (info.cp) html += `<div class="row"><span>CHECKPOINT</span><span>${info.cp}</span></div>`;
    if (info.extra) html += `<div class="row"><span>${info.extra[0]}</span><span>${info.extra[1]}</span></div>`;
    if (html !== this._raceHtml) { this._raceHtml = html; this.racebox.innerHTML = html; }
    if (info.standings) {
      this.standings.classList.remove('hidden');
      const sh = info.standings.map((s, i) => `<div class="${s.me ? 'me' : ''}"><b>${i + 1}</b>${s.name}</div>`).join('');
      if (sh !== this._stHtml) { this._stHtml = sh; this.standings.innerHTML = sh; }
    } else this.standings.classList.add('hidden');
  }

  countdown(text) {
    this.cd.classList.remove('hidden', 'anim');
    void this.cd.offsetWidth;
    this.cd.textContent = text;
    this.cd.classList.add('anim');
    clearTimeout(this._cdT);
    this._cdT = setTimeout(() => this.cd.classList.add('hidden'), 900);
  }

  // ---------------- toasts ----------------
  toast(title, sub = '', style = '', ms = 2800) {
    const t = el('div', `toast ${style}`, `${title}${sub ? `<small>${sub}</small>` : ''}`);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 450);
  }

  // ---------------- skills ----------------
  skillUpdate(chain, mult, names, pendingName, bankTimer) {
    const s = this.skill;
    if (chain <= 0 && !pendingName) {
      if (!s.classList.contains('bank') && !s.classList.contains('broken')) s.classList.add('hidden');
      return;
    }
    s.classList.remove('hidden', 'bank', 'broken');
    clearTimeout(this._skT);
    s.querySelector('.chain').innerHTML = `${formatNumber(chain)}<span class="mult">x${mult}</span>`;
    s.querySelector('.names').textContent = pendingName ? `${pendingName}…` : names;
    s.querySelector('.bar > div').style.width = `${clamp(bankTimer / 3.2, 0, 1) * 100}%`;
  }

  skillBank(total) {
    const s = this.skill;
    s.classList.remove('hidden', 'broken');
    s.classList.add('bank');
    s.querySelector('.chain').innerHTML = `+${formatNumber(total)}`;
    s.querySelector('.names').textContent = 'SKILL CHAIN BANKED';
    s.querySelector('.bar > div').style.width = '0%';
    clearTimeout(this._skT);
    this._skT = setTimeout(() => s.classList.add('hidden'), 1800);
  }

  skillBroken(lost) {
    const s = this.skill;
    s.classList.remove('hidden', 'bank');
    s.classList.add('broken');
    s.querySelector('.chain').innerHTML = `${formatNumber(lost)}`;
    s.querySelector('.names').textContent = 'CHAIN BROKEN';
    clearTimeout(this._skT);
    this._skT = setTimeout(() => { s.classList.add('hidden'); s.classList.remove('broken'); }, 1500);
  }

  // ---------------- prompt ----------------
  prompt(title, sub, key = 'ENTER', onClick = null) {
    const html = `<span class="key">${key}</span><div><div class="ttl">${title}</div><div class="sub">${sub}</div></div>`;
    if (this._pr !== html) {
      this._pr = html;
      this.promptEl.innerHTML = html;
    }
    this.promptEl.onclick = onClick;
    this.promptEl.classList.remove('hidden');
  }

  clearPrompt() {
    if (this._pr) {
      this._pr = null;
      this.promptEl.classList.add('hidden');
    }
  }

  activity(label, value, color = '#19d3ff') {
    if (!label) {
      this.activityEl.classList.add('hidden');
      return;
    }
    this.activityEl.classList.remove('hidden');
    this.activityEl.style.borderLeftColor = color;
    const html = `<div class="k">${label}</div><div class="v">${value}</div>`;
    if (this._act !== html) { this._act = html; this.activityEl.innerHTML = html; }
  }

  setRewind(on) {
    this.rewindEl.classList.toggle('hidden', !on);
  }

  radio(name, genre) {
    this.radioEl.innerHTML = `<div class="k">NOW PLAYING</div><div class="v">${name}</div><div class="k">${genre}</div>`;
    this.radioEl.classList.remove('hidden');
    clearTimeout(this._rT);
    this._rT = setTimeout(() => this.radioEl.classList.add('hidden'), 2600);
  }

  setWrongWay(on) {
    this.wrongWay.classList.toggle('hidden', !on);
  }

  setNet(text) {
    if (!text) { this.netEl.classList.add('hidden'); return; }
    this.netEl.classList.remove('hidden');
    if (this._net !== text) { this._net = text; this.netEl.textContent = text; }
  }

  chat(name, text, color = '#19d3ff') {
    const line = el('div', 'chatline');
    const n = el('b', '', '');
    n.textContent = `${name}: `;
    n.style.color = color;
    const t = el('span', '', '');
    t.textContent = text;
    line.append(n, t);
    this.chatEl.appendChild(line);
    while (this.chatEl.children.length > 6) this.chatEl.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }

  setVignette(x) {
    this.vignette.style.opacity = x;
  }
}

export function piBadge(pi) {
  const c = classFor(pi);
  return `<span class="pi"><span class="c" style="background:${c.color}">${c.id}</span><span class="v">${pi}</span></span>`;
}
