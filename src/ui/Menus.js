import { el, piBadge } from './HUD.js';
import { CARS, PAINTS, RIM_COLORS, UPGRADES, carStats, classFor } from '../config/cars.js';
import { EVENTS, ACTIVITIES } from '../config/events.js';
import { ACCOLADES } from '../config/accolades.js';
import { defaultServerUrl } from '../net/Net.js';
import { formatNumber, formatTime } from '../core/utils.js';
import { xpForLevel } from '../core/Save.js';
import { STATIONS } from '../audio/Audio.js';
import { CAMERA_MODES } from '../camera/CameraRig.js';

const STAT_NAMES = [['speed', 'Speed'], ['handling', 'Handling'], ['accel', 'Acceleration'], ['launch', 'Launch'], ['braking', 'Braking'], ['offroad', 'Offroad']];

function starsHtml(n, max = 3) {
  let s = '<span class="stars">';
  for (let i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s + '</span>';
}

/**
 * Screen with keyboard/gamepad focus navigation over `.nav` elements.
 */
class Screen {
  constructor(ui, root) {
    this.ui = ui;
    this.root = root;
    this.focus = 0;
    this.onBack = null;
  }

  items() {
    return [...this.root.querySelectorAll('.nav')].filter((e) => e.offsetParent !== null && !e.disabled);
  }

  setFocus(i) {
    const it = this.items();
    if (!it.length) return;
    this.focus = (i + it.length) % it.length;
    it.forEach((e, k) => e.classList.toggle('focus', k === this.focus));
    const f = it[this.focus];
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }

  handle(input) {
    const it = this.items();
    if (!it.length) {
      if (input.pressed('back') && this.onBack) this.onBack();
      return;
    }
    if (this.focus >= it.length) this.focus = 0;
    const cur = it[this.focus];
    const grid = cur && cur.closest('.gridnav');
    const step = grid ? Math.max(1, Math.round(grid.clientWidth / (cur.offsetWidth + 8))) : 1;
    if (input.pressed('down')) { this.setFocus(this.focus + step); this.ui.sfx('move'); }
    if (input.pressed('up')) { this.setFocus(this.focus - step); this.ui.sfx('move'); }
    if (input.pressed('navRight')) {
      if (cur && cur.dataset.right) cur.dispatchEvent(new Event('navright'));
      else if (grid || cur.classList.contains('tab')) { this.setFocus(this.focus + 1); this.ui.sfx('move'); }
    }
    if (input.pressed('navLeft')) {
      if (cur && cur.dataset.left) cur.dispatchEvent(new Event('navleft'));
      else if (grid || cur.classList.contains('tab')) { this.setFocus(this.focus - 1); this.ui.sfx('move'); }
    }
    if (input.pressed('confirm') && cur) {
      this.ui.sfx('select');
      cur.click();
    }
    if (input.pressed('back') && this.onBack) {
      this.ui.sfx('back');
      this.onBack();
    }
  }
}

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.stack = [];
    this.layer = el('div', '');
    this.layer.style.cssText = 'position:absolute;inset:0;z-index:40;';
    this.layer.classList.add('interactive');
    root.appendChild(this.layer);
    this.fadeEl = el('div', 'fade');
    root.appendChild(this.fadeEl);
  }

  sfx(kind) {
    const a = this.game.audio;
    if (!a || !a.enabled) return;
    if (kind === 'move') a.uiMove();
    else if (kind === 'select') a.uiSelect();
    else a.uiBack();
  }

  get open() {
    return this.stack.length > 0;
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  push(node, onBack, opts = {}) {
    if (!opts.keep && this.top) this.top.root.style.display = 'none';
    this.layer.appendChild(node);
    const sc = new Screen(this, node);
    sc.onBack = onBack;
    sc.name = opts.name;
    this.stack.push(sc);
    setTimeout(() => sc.setFocus(opts.focus || 0), 0);
    return sc;
  }

  pop() {
    const s = this.stack.pop();
    if (s) s.root.remove();
    if (this.top) {
      this.top.root.style.display = '';
      if (this.top.refresh) this.top.refresh();
      this.top.setFocus(this.top.focus);
    }
  }

  closeAll() {
    while (this.stack.length) this.stack.pop().root.remove();
  }

  update(input) {
    if (this.top && !this.top.passive) this.top.handle(input);
  }

  fade(on) {
    this.fadeEl.classList.toggle('on', on);
  }

  // ---------------- title ----------------
  title() {
    const g = this.game;
    const hasSave = g.save.progress.garage.length > 0;
    const node = el('div', 'title', `
      <div class="logo"><div class="l1">HORIZON RUSH</div><div class="l2">OPEN WORLD FESTIVAL</div></div>
      <div class="menu-list"></div>
      <div class="version">v1.0 · WASD / Arrows / Gamepad · Esc for menu</div>`);
    const list = node.querySelector('.menu-list');
    const add = (label, fn, cls = '') => {
      const b = el('button', `btn nav ${cls}`, `<span>${label}</span>`);
      b.onclick = fn;
      list.appendChild(b);
      return b;
    };
    if (hasSave) add('Continue', () => g.continueGame(), 'primary');
    add(hasSave ? 'New Game' : 'Start Festival', () => {
      if (hasSave && !window.confirm('Start over? Your current progress will be lost.')) return;
      g.newGame();
    }, hasSave ? '' : 'primary');
    add('Settings', () => this.settings());
    add('How to Play', () => this.controls());
    this.push(node, null, { name: 'title' });
  }

  // ---------------- starter car ----------------
  starter() {
    const g = this.game;
    const picks = ['vela', 'mira', 'stallion'];
    const node = el('div', 'overlay', `
      <div class="topbar"><h1>CHOOSE YOUR FIRST CAR</h1></div>
      <div class="body"><p class="desc" style="max-width:700px">Welcome to the Horizon Rush Festival! Pick a car to start your journey across the island. You can buy more cars and upgrades with credits earned from races, skills and activities.</p>
      <div class="tiles gridnav" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))"></div></div>
      <div class="hint-bar"><span><b>ENTER</b>Choose</span><span><b>←→</b>Browse</span></div>`);
    const tiles = node.querySelector('.tiles');
    for (const id of picks) {
      const c = CARS.find((x) => x.id === id);
      const st = carStats(c);
      const t = el('div', 'tile nav', `<div class="ico">${piBadge(st.pi)}</div><div class="t">${c.name}</div><div class="s">${c.year} · ${c.phys.drive} · ${c.desc}</div>`);
      t.style.height = '170px';
      t.onclick = () => g.chooseStarter(id);
      t.onmouseenter = () => g.previewCar(c, {});
      t.addEventListener('focusin', () => g.previewCar(c, {}));
      tiles.appendChild(t);
    }
    const sc = this.push(node, null, { name: 'starter' });
    const orig = sc.setFocus.bind(sc);
    sc.setFocus = (i) => {
      orig(i);
      const c = CARS.find((x) => x.id === picks[sc.focus]);
      if (c) g.previewCar(c, {});
    };
  }

  // ---------------- pause ----------------
  pause() {
    const g = this.game;
    const inEvent = !!g.race || !!g.activeActivity;
    const p = g.save.progress;
    const node = el('div', 'overlay', `
      <div class="topbar"><h1>${inEvent ? g.race ? g.race.ev.name.toUpperCase() : 'PAUSED' : 'HORIZON RUSH FESTIVAL'}</h1>
        <div class="wallet"><span class="cr">${formatNumber(p.credits)} CR</span><span class="lvl"><span class="badge">LVL ${p.level}</span>${formatNumber(p.xp)} / ${formatNumber(xpForLevel(p.level))} XP</span></div></div>
      <div class="body"><div class="tiles gridnav"></div></div>
      <div class="hint-bar"><span><b>ENTER</b>Select</span><span><b>ESC</b>Resume</span><span><b>M</b>Map</span></div>`);
    const tiles = node.querySelector('.tiles');
    const tile = (t, s, ico, fn, big = false) => {
      const d = el('div', `tile nav ${big ? 'big' : ''}`, `<div class="ico">${ico}</div><div class="t">${t}</div><div class="s">${s}</div>`);
      d.onclick = fn;
      tiles.appendChild(d);
    };
    tile('Resume', 'Back to the road', '▶', () => g.resume(), true);
    if (g.race) {
      if (!g.race.online) tile('Restart Event', g.race.ev.name, '↻', () => g.restartEvent());
      tile('Quit Event', 'Return to free roam', '✕', () => g.quitEvent());
    }
    tile('World Map', 'Events, activities, fast travel', '🗺', () => g.openMap());
    tile('Online', g.net.inRoom ? `Room ${g.net.room.public ? 'PUBLIC' : g.net.room.code} · ${g.net.room.players.length} drivers` : g.net.online ? 'Connected' : 'Multiplayer races & free roam', '🌐', () => this.online());
    if (!g.race) {
      tile('My Cars', `${p.garage.length} car${p.garage.length === 1 ? '' : 's'} owned`, '🚗', () => this.garage('garage'));
      tile('Autoshow', 'Buy new cars', '🏷', () => this.garage('autoshow'));
      tile('Upgrades', 'Engine, tyres, aero and more', '🔧', () => this.garage('upgrade'));
      tile('Paint Shop', 'Colours, finishes, rims', '🎨', () => this.garage('paint'));
      tile('Wheelspin', `${p.wheelspins} available`, '🎰', () => this.wheelspin());
    }
    tile('Events', `${Object.keys(p.events).length}/${EVENTS.length} completed`, '🏁', () => this.eventList());
    tile('Photo Mode', 'Capture the moment', '📷', () => g.enterPhoto());
    tile('Settings', 'Graphics, audio, assists', '⚙', () => this.settings());
    tile('How to Play', 'Controls and tips', '?', () => this.controls());
    tile('Accolades', `${(p.accolades || []).length}/${ACCOLADES.length} unlocked`, '🏆', () => this.accolades());
    tile('Statistics', 'Your festival career', '📊', () => this.stats());
    tile('Quit to Title', 'Progress is saved', '⏏', () => g.toTitle());
    this.push(node, () => g.resume(), { name: 'pause' });
  }

  // ---------------- event list ----------------
  eventList() {
    const g = this.game;
    const p = g.save.progress;
    const node = el('div', 'overlay', `<div class="topbar"><h1>EVENTS</h1></div><div class="body"><div class="tiles gridnav"></div>
      <div class="section-title" style="margin-top:26px">Activities</div><div class="tiles acts" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))"></div></div>
      <div class="hint-bar"><span><b>ENTER</b>Travel to event</span><span><b>ESC</b>Back</span></div>`);
    const tiles = node.querySelector('.tiles');
    for (const ev of EVENTS) {
      const rec = p.events[ev.id];
      const d = el('div', 'tile nav', `<div class="ico">${rec ? starsHtml(rec.position === 1 ? 3 : rec.position <= 3 ? 2 : 1) : ''}</div>
        <div class="t" style="font-size:22px">${ev.name}</div><div class="s">${ev.discipline} · ${formatNumber(ev.reward)} CR${rec ? ` · Best ${formatTime(rec.best)}` : ''}</div>`);
      d.onclick = () => { this.closeAll(); g.travelToEvent(ev.id); };
      tiles.appendChild(d);
    }
    const acts = node.querySelector('.acts');
    for (const a of ACTIVITIES) {
      const rec = p.activities[a.id];
      const unit = a.type === 'drift' ? 'pts' : 'km/h';
      const d = el('div', 'tile', `<div class="ico">${starsHtml(rec ? rec.stars : 0)}</div><div class="t" style="font-size:19px">${a.name}</div><div class="s">${rec ? `Best ${formatNumber(rec.best)} ${unit}` : `Target ${formatNumber(a.stars[2])} ${unit}`}</div>`);
      d.style.height = '96px';
      acts.appendChild(d);
    }
    this.push(node, () => this.pop(), { name: 'events' });
  }

  // ---------------- garage ----------------
  garage(mode) {
    const g = this.game;
    const save = g.save;
    const node = el('div', 'overlay clear', `
      <div class="topbar"><h1></h1><div class="tabs"></div><div class="wallet"><span class="cr"></span></div></div>
      <div class="body"><div class="garage"><div class="carlist"></div><div></div><div class="panel info"></div></div></div>
      <div class="hint-bar"><span><b>ENTER</b>Select</span><span><b>ESC</b>Back</span><span><b>DRAG</b>Rotate view</span></div>`);
    node.style.background = 'linear-gradient(90deg, rgba(4,6,14,0.85) 0%, rgba(4,6,14,0.1) 35%, rgba(4,6,14,0.1) 65%, rgba(4,6,14,0.85) 100%)';
    const listEl = node.querySelector('.carlist');
    const info = node.querySelector('.info');
    const h1 = node.querySelector('h1');
    const tabs = node.querySelector('.tabs');
    const crEl = node.querySelector('.cr');
    const modes = [['garage', 'My Cars'], ['autoshow', 'Autoshow'], ['upgrade', 'Upgrades'], ['paint', 'Paint']];
    let selected = null;
    const sc = this.push(node, () => { g.endPreview(); this.pop(); }, { name: 'garage' });
    const render = () => {
      crEl.textContent = `${formatNumber(save.progress.credits)} CR`;
      h1.textContent = modes.find((m) => m[0] === mode)[1].toUpperCase();
      tabs.innerHTML = '';
      for (const [m, label] of modes) {
        const t = el('button', `tab nav ${m === mode ? 'active' : ''}`, label);
        t.onclick = () => { mode = m; selected = null; render(); sc.setFocus(modes.findIndex((x) => x[0] === m)); };
        tabs.appendChild(t);
      }
      listEl.innerHTML = '';
      info.innerHTML = '';
      if (mode === 'autoshow') renderAutoshow();
      else if (mode === 'garage') renderOwned();
      else if (mode === 'upgrade') renderUpgrade();
      else renderPaint();
    };
    const statBlock = (car, upg, compareUpg) => {
      const st = carStats(car, upg);
      const cmp = compareUpg ? carStats(car, compareUpg) : null;
      let h = '';
      for (const [k, n] of STAT_NAMES) {
        const v = st[k];
        const c = cmp ? cmp[k] : v;
        h += `<div class="stat"><span>${n}</span><div class="bar"><div style="width:${Math.min(v, c) * 10}%"></div>${c > v ? `<div class="up" style="left:${v * 10}%;width:${(c - v) * 10}%"></div>` : ''}</div><span>${(cmp ? c : v).toFixed(1)}</span></div>`;
      }
      return h;
    };
    const specs = (car, upg) => {
      const st = carStats(car, upg);
      const p = car.phys;
      return `<div class="spec"><div><span>Power</span>${Math.round(st.kw * 1.341)} hp</div><div><span>Weight</span>${Math.round(p.mass * (upg && upg.weight ? UPGRADES.weight.mass[upg.weight] : 1))} kg</div>
        <div><span>Drivetrain</span>${p.drive}</div><div><span>Gears</span>${p.gears.length}-speed</div></div>`;
    };
    const renderAutoshow = () => {
      const owned = new Set(save.progress.garage.map((c) => c.id));
      const sorted = [...CARS].sort((a, b) => a.pi - b.pi);
      sorted.forEach((car) => {
        const st = carStats(car);
        const r = el('div', `carrow nav ${selected === car.id ? 'sel' : ''}`, `${piBadge(st.pi)}<div class="nm">${car.name}<small>${car.year} · ${formatNumber(car.price)} CR${owned.has(car.id) ? ' · OWNED' : ''}</small></div>`);
        r.onclick = () => { selected = car.id; showBuy(car); listEl.querySelectorAll('.carrow').forEach((x) => x.classList.remove('sel')); r.classList.add('sel'); };
        r.onmouseenter = () => { if (!selected) showBuy(car, true); };
        listEl.appendChild(r);
      });
      showBuy(CARS.find((c) => c.id === selected) || sorted[0], true);
    };
    let paintPick = null;
    const showBuy = (car, previewOnly = false) => {
      paintPick = paintPick && selected === car.id ? paintPick : car.paint;
      g.previewCar(car, { paint: paintPick });
      const st = carStats(car);
      const afford = save.progress.credits >= car.price;
      info.innerHTML = `<div>${piBadge(st.pi)} <b style="color:var(--muted)">${car.make.toUpperCase()} · ${car.year}</b></div><h2>${car.name}</h2>
        <div class="desc">${car.desc}</div>${specs(car)}<h3>Performance</h3>${statBlock(car)}
        <h3>Colour</h3><div class="swatches"></div>
        <div class="price">${formatNumber(car.price)} CR</div>
        <button class="btn primary nav buy" ${afford ? '' : 'disabled'}><span>${afford ? 'Buy & Drive' : 'Not enough credits'}</span></button>`;
      const sw = info.querySelector('.swatches');
      for (const col of PAINTS) {
        const s = el('div', `sw nav ${col === paintPick ? 'sel' : ''}`);
        s.style.background = col;
        s.onclick = () => { paintPick = col; selected = car.id; showBuy(car); };
        sw.appendChild(s);
      }
      info.querySelector('.buy').onclick = () => {
        if (g.buyCar(car.id, paintPick)) { mode = 'garage'; selected = null; render(); }
      };
      void previewOnly;
    };
    const renderOwned = () => {
      const cur = save.currentCar;
      save.progress.garage.forEach((entry) => {
        const car = CARS.find((c) => c.id === entry.id);
        const st = carStats(car, entry.upgrades);
        const r = el('div', `carrow nav ${cur && cur.uid === entry.uid ? 'sel' : ''}`, `${piBadge(st.pi)}<div class="nm">${car.name}<small>${car.year}${cur && cur.uid === entry.uid ? ' · CURRENT' : ''}</small></div><span class="sw" style="width:18px;height:18px;background:${entry.paint}"></span>`);
        r.onclick = () => { g.selectCar(entry.uid); render(); };
        r.onmouseenter = () => showOwned(entry);
        listEl.appendChild(r);
      });
      if (cur) showOwned(cur);
    };
    const showOwned = (entry) => {
      const car = CARS.find((c) => c.id === entry.id);
      g.previewCar(car, entry);
      const st = carStats(car, entry.upgrades);
      const cur = save.currentCar;
      info.innerHTML = `<div>${piBadge(st.pi)} <b style="color:var(--muted)">${car.make.toUpperCase()} · ${car.year}</b></div><h2>${car.name}</h2>
        <div class="desc">${car.desc}</div>${specs(car, entry.upgrades)}<h3>Performance</h3>${statBlock(car, entry.upgrades)}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        ${cur && cur.uid === entry.uid ? '<b style="color:var(--cyan)">CURRENT CAR</b>' : '<button class="btn primary nav drive"><span>Drive this car</span></button>'}
        ${save.progress.garage.length > 1 ? `<button class="btn small nav sell"><span>Sell (${formatNumber(Math.round(car.price * 0.5))} CR)</span></button>` : ''}</div>`;
      const d = info.querySelector('.drive');
      if (d) d.onclick = () => { g.selectCar(entry.uid); render(); };
      const s = info.querySelector('.sell');
      if (s) s.onclick = () => { if (window.confirm(`Sell ${car.name}?`)) { g.sellCar(entry.uid); render(); } };
    };
    const renderUpgrade = () => {
      const entry = save.currentCar;
      if (!entry) return;
      const car = CARS.find((c) => c.id === entry.id);
      g.previewCar(car, entry);
      const st = carStats(car, entry.upgrades);
      listEl.innerHTML = `<div class="panel"><div>${piBadge(st.pi)}</div><h2 style="font-size:26px">${car.name}</h2>${specs(car, entry.upgrades)}<h3>Performance</h3><div class="stats">${statBlock(car, entry.upgrades)}</div></div>`;
      const statsEl = listEl.querySelector('.stats');
      info.innerHTML = '<h2>Upgrades</h2>';
      for (const [cat, U] of Object.entries(UPGRADES)) {
        const lvl = entry.upgrades[cat] || 0;
        const row = el('div', 'upg');
        let lv = '';
        for (let i = 1; i < U.levels.length; i++) lv += `<i class="${i <= lvl ? 'on' : ''}"></i>`;
        row.innerHTML = `<div><b>${U.name}</b> <span style="color:var(--muted)">${U.levels[lvl]}</span><div class="lv">${lv}</div></div>`;
        const next = lvl + 1;
        if (next < U.levels.length) {
          const cost = U.cost[next];
          const b = el('button', 'btn small nav', `<span>${U.levels[next]} · ${formatNumber(cost)}</span>`);
          b.disabled = save.progress.credits < cost;
          b.onclick = () => { if (g.buyUpgrade(cat, next)) render(); };
          b.onmouseenter = () => {
            const prev = { ...entry.upgrades, [cat]: next };
            statsEl.innerHTML = statBlock(car, entry.upgrades, prev);
            const np = carStats(car, prev).pi;
            listEl.querySelector('.panel > div').innerHTML = `${piBadge(st.pi)} → ${piBadge(np)}`;
          };
          b.onmouseleave = () => { statsEl.innerHTML = statBlock(car, entry.upgrades); listEl.querySelector('.panel > div').innerHTML = piBadge(st.pi); };
          row.appendChild(b);
        } else row.appendChild(el('b', '', '<span style="color:var(--cyan)">MAX</span>'));
        if (lvl > 0) {
          const r = el('button', 'btn small nav', '<span>Reset</span>');
          r.onclick = () => { g.buyUpgrade(cat, 0); render(); };
          row.appendChild(r);
        }
        info.appendChild(row);
      }
    };
    const renderPaint = () => {
      const entry = save.currentCar;
      if (!entry) return;
      const car = CARS.find((c) => c.id === entry.id);
      g.previewCar(car, entry);
      info.innerHTML = `<h2>Paint Shop</h2><h3>Body colour</h3><div class="swatches body"></div>
        <h3>Finish</h3><div class="chips finish"></div><h3>Rims</h3><div class="swatches rims"></div>
        <h3>Racing stripes</h3><div class="chips stripes"></div><h3>Brake calipers</h3><div class="swatches cal"></div>`;
      const apply = (patch) => { g.setPaint(patch); renderPaint(); };
      const body = info.querySelector('.body');
      for (const col of PAINTS) {
        const s = el('div', `sw nav ${entry.paint === col ? 'sel' : ''}`);
        s.style.background = col;
        s.onclick = () => apply({ paint: col });
        body.appendChild(s);
      }
      const fin = info.querySelector('.finish');
      for (const f of ['gloss', 'metallic', 'matte', 'pearl', 'chrome']) {
        const c = el('button', `chip nav ${(entry.finish || 'gloss') === f ? 'sel' : ''}`, f.toUpperCase());
        c.onclick = () => apply({ finish: f });
        fin.appendChild(c);
      }
      const rims = info.querySelector('.rims');
      for (const col of RIM_COLORS) {
        const s = el('div', `sw nav ${(entry.rim || car.rim) === col ? 'sel' : ''}`);
        s.style.background = col;
        s.onclick = () => apply({ rim: col });
        rims.appendChild(s);
      }
      const str = info.querySelector('.stripes');
      for (const [v, n] of [[null, 'None'], ['#ffffff', 'White'], ['#111111', 'Black'], ['#ff2d87', 'Pink'], ['#ffd21a', 'Gold']]) {
        const on = (entry.stripe || null) === v;
        const c = el('button', `chip nav ${on ? 'sel' : ''}`, n.toUpperCase());
        c.onclick = () => apply({ stripe: v });
        str.appendChild(c);
      }
      const cal = info.querySelector('.cal');
      for (const col of ['#d11a1a', '#ffd21a', '#19d3ff', '#111111', '#ffffff', '#2ecc71']) {
        const s = el('div', `sw nav ${(entry.caliper || '#d11a1a') === col ? 'sel' : ''}`);
        s.style.background = col;
        s.onclick = () => apply({ caliper: col });
        cal.appendChild(s);
      }
      listEl.innerHTML = `<div class="panel"><h2 style="font-size:26px">${car.name}</h2><div class="desc">Customise your car. Changes are free and saved instantly.</div></div>`;
    };
    sc.refresh = render;
    render();
  }

  // ---------------- settings ----------------
  settings() {
    const g = this.game;
    const S = g.save.settings;
    const node = el('div', 'overlay', `<div class="topbar"><h1>SETTINGS</h1></div><div class="body"><div class="settings"></div></div>
      <div class="hint-bar"><span><b>←→</b>Change</span><span><b>ESC</b>Back</span></div>`);
    const box = node.querySelector('.settings');
    const section = (t) => box.appendChild(el('div', 'section-title', t));
    const seg = (label, sub, options, get, set) => {
      const row = el('div', 'setrow nav', `<label>${label}<small>${sub}</small></label><div class="seg"></div>`);
      row.dataset.left = row.dataset.right = '1';
      const segEl = row.querySelector('.seg');
      const draw = () => {
        segEl.innerHTML = '';
        for (const [v, n] of options) {
          const b = el('button', get() === v ? 'on' : '', n);
          b.onclick = (e) => { e.stopPropagation(); set(v); draw(); g.applySettings(); };
          segEl.appendChild(b);
        }
      };
      const cycle = (d) => {
        const i = options.findIndex((o) => o[0] === get());
        set(options[(i + d + options.length) % options.length][0]);
        draw();
        g.applySettings();
      };
      row.addEventListener('navright', () => cycle(1));
      row.addEventListener('navleft', () => cycle(-1));
      row.onclick = () => cycle(1);
      draw();
      box.appendChild(row);
    };
    const slider = (label, sub, min, max, step, get, set) => {
      const row = el('div', 'setrow nav', `<label>${label}<small>${sub}</small></label><input type="range" min="${min}" max="${max}" step="${step}">`);
      row.dataset.left = row.dataset.right = '1';
      const inp = row.querySelector('input');
      inp.value = get();
      inp.oninput = () => { set(+inp.value); g.applySettings(); };
      row.addEventListener('navright', () => { inp.value = Math.min(max, +inp.value + step); inp.oninput(); });
      row.addEventListener('navleft', () => { inp.value = Math.max(min, +inp.value - step); inp.oninput(); });
      box.appendChild(row);
    };
    const onoff = [[true, 'On'], [false, 'Off']];
    section('Graphics');
    seg('Quality', 'Draw distance, resolution and effects', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], () => S.quality, (v) => { S.quality = v; });
    seg('Shadows', 'Sun shadow resolution', [['off', 'Off'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']], () => S.shadows, (v) => { S.shadows = v; });
    seg('Bloom', 'Glow on lights and highlights', onoff, () => S.bloom, (v) => { S.bloom = v; });
    seg('Speed effects', 'Blur, vignette and camera shake at speed', onoff, () => S.motionBlur, (v) => { S.motionBlur = v; });
    seg('Dynamic resolution', 'Lowers resolution automatically to keep the frame rate smooth', onoff, () => S.dynamicRes !== false, (v) => { S.dynamicRes = v; });
    seg('Show FPS', '', onoff, () => !!S.showFps, (v) => { S.showFps = v; });
    slider('Field of view', 'Chase camera FOV', 50, 80, 1, () => S.fov, (v) => { S.fov = v; });
    seg('Camera', 'Default driving view (C to cycle)', CAMERA_MODES.map((m, i) => [i, m]), () => S.camera, (v) => { S.camera = v; });
    section('World');
    seg('Time of day', 'Freeze or run the day/night cycle', [[true, 'Cycle'], [false, 'Fixed']], () => S.timeCycle, (v) => { S.timeCycle = v; });
    slider('Hour', 'Current time of day', 0, 24, 0.25, () => g.world.env.time, (v) => { S.timeOfDay = v; g.world.env.time = v; });
    seg('Weather', 'Dynamic weather changes over time', [['dynamic', 'Dynamic'], ['clear', 'Clear'], ['rain', 'Rain'], ['fog', 'Fog'], ['storm', 'Storm']], () => S.weather, (v) => { S.weather = v; });
    seg('Season', 'Changes the look and grip of the island', [['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter'], ['spring', 'Spring']], () => S.season, (v) => { S.season = v; });
    seg('Traffic', 'Drivatars roaming the island', onoff, () => S.traffic, (v) => { S.traffic = v; });
    seg('Minimap', '', onoff, () => S.showMinimap, (v) => { S.showMinimap = v; });
    seg('Units', '', [['kmh', 'KM/H'], ['mph', 'MPH']], () => S.units, (v) => { S.units = v; });
    section('Driving');
    seg('Difficulty', 'Drivatar skill level (higher = bigger rewards)', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['unbeatable', 'Unbeatable']], () => S.difficulty, (v) => { S.difficulty = v; });
    seg('Gearbox', '', [[true, 'Automatic'], [false, 'Manual']], () => S.assists.autoGear, (v) => { S.assists.autoGear = v; });
    seg('Steering assist', 'Automatic counter-steer', onoff, () => S.assists.steerAssist, (v) => { S.assists.steerAssist = v; });
    seg('Traction control', 'TCS', onoff, () => S.assists.tcs, (v) => { S.assists.tcs = v; });
    seg('Stability control', 'STM', onoff, () => S.assists.stm, (v) => { S.assists.stm = v; });
    seg('ABS', 'Anti-lock brakes', onoff, () => S.assists.abs, (v) => { S.assists.abs = v; });
    seg('Rival ghost', 'Race against a replay of your best run', onoff, () => S.ghost !== false, (v) => { S.ghost = v; });
    seg('Driving line', 'Racing line arrows in events', [['full', 'Full'], ['braking', 'Braking'], ['off', 'Off']], () => S.assists.brakingLine, (v) => { S.assists.brakingLine = v; });
    section('Audio');
    slider('Master volume', '', 0, 1, 0.05, () => S.masterVolume, (v) => { S.masterVolume = v; });
    slider('Music volume', 'Radio: N to change station', 0, 1, 0.05, () => S.musicVolume, (v) => { S.musicVolume = v; });
    slider('Effects volume', '', 0, 1, 0.05, () => S.sfxVolume, (v) => { S.sfxVolume = v; });
    section('Data');
    const reset = el('div', 'setrow nav', '<label>Reset progress<small>Delete your save and start over</small></label><div class="seg"><button>RESET</button></div>');
    reset.onclick = () => { if (window.confirm('Delete all progress?')) { g.save.reset(); window.location.reload(); } };
    box.appendChild(reset);
    this.push(node, () => { g.save.save(); this.pop(); }, { name: 'settings' });
  }

  controls() {
    const node = el('div', 'overlay', `<div class="topbar"><h1>HOW TO PLAY</h1></div><div class="body"><div class="settings">
      <div class="section-title">Driving</div>
      ${[['Throttle / Brake & Reverse', 'W / S · ↑ / ↓ · RT / LT'], ['Steer', 'A / D · ← / → · Left stick'], ['Handbrake', 'Space · A'], ['Shift up / down (manual)', 'E / Q · B / X'],
        ['Rewind', 'Hold R · Y'], ['Reset to road', 'T'], ['Change camera', 'C · RB'], ['Look back', 'B · LB'], ['Free look', 'Drag mouse · Right stick'], ['Horn', 'H'], ['Headlights', 'L'], ['Radio station', 'N']]
        .map(([a, b]) => `<div class="setrow"><label>${a}</label><div style="text-align:right;font-weight:700">${b}</div></div>`).join('')}
      <div class="section-title">Menus</div>
      ${[['Pause menu', 'Esc · Start'], ['World map', 'M · Tab · View'], ['Start event', 'Enter at a glowing marker'], ['Photo mode', 'F'], ['Toggle HUD', 'U']]
        .map(([a, b]) => `<div class="setrow"><label>${a}</label><div style="text-align:right;font-weight:700">${b}</div></div>`).join('')}
      <div class="section-title">Tips</div>
      <div class="setrow"><label style="font-weight:500;font-size:16px;line-height:1.4">Drive into the glowing beams to start races. Drifts, jumps, near misses and top speed build Skill Chains — keep chaining without crashing to multiply the score. Smash orange XP boards hidden around the island, beat speed traps, speed zones and drift zones for stars, and spend credits on new cars and upgrades. Level up to earn Wheelspins!</label></div>
      </div></div><div class="hint-bar"><span><b>ESC</b>Back</span></div>`);
    this.push(node, () => this.pop(), { name: 'controls' });
  }

  accolades() {
    const p = this.game.save.progress;
    const got = new Set(p.accolades || []);
    const rows = ACCOLADES.map((a) => {
      const done = got.has(a.id);
      let prog = '';
      if (!done && a.progress) {
        const [c, t] = a.progress(p, p.stats);
        prog = `<div class="stat" style="grid-template-columns:1fr 70px"><div class="bar"><div style="width:${Math.min(100, (c / t) * 100)}%"></div></div><span>${formatNumber(Math.min(c, t))}/${formatNumber(t)}</span></div>`;
      }
      return `<div class="setrow" style="${done ? 'background:rgba(255,210,26,0.14)' : ''}"><label>${done ? '🏆 ' : ''}${a.name}<small>${a.desc}</small>${prog}</label>
        <div style="text-align:right;font-weight:700;color:${done ? 'var(--yellow)' : 'var(--muted)'}">${done ? 'UNLOCKED' : `${formatNumber(a.cr)} CR · ${formatNumber(a.xp)} XP`}</div></div>`;
    }).join('');
    const node = el('div', 'overlay', `<div class="topbar"><h1>ACCOLADES</h1><div class="wallet"><span>${got.size} / ${ACCOLADES.length}</span></div></div><div class="body"><div class="settings">${rows}</div></div><div class="hint-bar"><span><b>ESC</b>Back</span></div>`);
    this.push(node, () => this.pop(), { name: 'accolades' });
  }

  refreshIf(name, what = 'all') {
    const t = this.top;
    if (!t || t.name !== name) return;
    if (what === 'chat' && t.refreshChat) t.refreshChat();
    else if (t.refresh) t.refresh();
  }

  // ---------------- online ----------------
  online() {
    const g = this.game;
    const net = g.net;
    const S = g.save.settings;
    const node = el('div', 'overlay', `<div class="topbar"><h1>ONLINE</h1><div class="wallet"><span class="st"></span></div></div>
      <div class="body"><div class="online"></div></div><div class="hint-bar"><span><b>ESC</b>Back</span><span><b>Y</b>Chat while driving</span></div>`);
    const box = node.querySelector('.online');
    const st = node.querySelector('.st');
    const sc = this.push(node, () => this.pop(), { name: 'online' });
    let error = '';
    const button = (label, fn, cls = '') => {
      const b = el('button', `btn small nav ${cls}`, `<span>${label}</span>`);
      b.onclick = fn;
      return b;
    };
    const renderChat = () => {
      const log = box.querySelector('.olog');
      if (!log) return;
      log.innerHTML = '';
      for (const c of g.chatLog) {
        const d = el('div');
        const b = el('b');
        b.textContent = `${c.name}: `;
        b.style.color = c.color;
        const t = el('span');
        t.textContent = c.text;
        d.append(b, t);
        log.appendChild(d);
      }
      log.scrollTop = log.scrollHeight;
    };
    const render = () => {
      box.innerHTML = '';
      st.innerHTML = net.online ? `<span style="color:#7dffb0">● ONLINE</span> ${net.rtt ? `${Math.round(net.rtt)} ms` : ''}` : net.status === 'connecting' ? 'CONNECTING…' : '<span style="color:var(--muted)">○ OFFLINE</span>';
      const left = el('div', 'panel');
      const right = el('div', 'panel');
      box.append(left, right);
      if (!net.online) {
        left.innerHTML = `<h2>Connect</h2><div class="desc">Race and cruise with friends. Everyone connects to the same Horizon Rush server.</div>
          <h3>Driver name</h3><input type="text" class="name" maxlength="18"><h3>Server address</h3><input type="text" class="url" placeholder="ws://your-server:8787/ws">
          <div class="desc err" style="color:#ff6b6b"></div>`;
        left.querySelector('.name').value = g.playerName();
        left.querySelector('.url').value = S.serverUrl || defaultServerUrl();
        left.querySelector('.err').textContent = error;
        const go = button(net.status === 'connecting' ? 'Connecting…' : 'Connect', async () => {
          S.playerName = left.querySelector('.name').value.trim().slice(0, 18);
          S.serverUrl = left.querySelector('.url').value.trim();
          g.save.save();
          error = '';
          try {
            await g.connectOnline(S.serverUrl);
          } catch (e) {
            error = `${e.message}. Check the address, and that the server is running (npm start).`;
          }
          render();
        }, 'primary');
        left.appendChild(go);
        right.innerHTML = `<h2>How it works</h2><div class="desc">Run the game server with <b>npm run build</b> then <b>npm start</b> on any computer, then open
          <b>http://that-computer:8787</b> on each device (same Wi-Fi works). Or deploy the server to a Node host and share its address.
          <br><br>In a room you see other drivers live, can chat, and the host can start any event as an online race.</div>`;
      } else if (!net.inRoom) {
        left.innerHTML = '<h2>Play online</h2><div class="desc">Join everyone in public free roam, or make a private room for a race with friends.</div>';
        left.appendChild(button('Join public free roam', () => net.send({ t: 'join', code: 'PUBLIC' }), 'primary'));
        left.appendChild(button('Create private room', () => net.send({ t: 'create' })));
        const row = el('div', 'row');
        const code = el('input');
        code.type = 'text';
        code.placeholder = 'ROOM CODE';
        code.maxLength = 5;
        code.style.minWidth = '140px';
        row.append(code, button('Join room', () => net.send({ t: 'join', code: code.value.trim().toUpperCase() })));
        left.appendChild(row);
        right.innerHTML = `<h2>${g.playerName()}</h2><div class="desc">Connected to ${net.url}</div>`;
        right.appendChild(button('Disconnect', () => { g.disconnectOnline(); render(); }));
      } else {
        const room = net.room;
        const isHost = room.host === net.id;
        left.innerHTML = room.public
          ? '<h3>Room</h3><div class="roomcode" style="font-size:32px;letter-spacing:2px">PUBLIC FREE ROAM</div>'
          : `<h3>Room code — share it with friends</h3><div class="roomcode">${room.code}</div>`;
        const pl = el('div', 'plist');
        for (const p of room.players) {
          const d = el('div');
          const sw = el('i');
          sw.style.background = p.paint;
          const n = el('span');
          n.textContent = `${p.name}${p.id === net.id ? ' (you)' : ''}${p.id === room.host && !room.public ? ' ★ host' : ''}`;
          const c = el('small');
          c.style.cssText = 'margin-left:auto;color:var(--muted)';
          c.textContent = (CARS.find((x) => x.id === p.car) || {}).name || '';
          d.append(sw, n, c);
          pl.appendChild(d);
        }
        left.appendChild(el('h3', '', `Drivers (${room.players.length}/12)`));
        left.appendChild(pl);
        const row = el('div', 'row');
        row.append(button('Back to the road', () => { this.closeAll(); g.resume(); }, 'primary'), button('Leave room', () => net.send({ t: 'leave' })), button('Disconnect', () => { g.disconnectOnline(); render(); }));
        left.appendChild(row);
        if (!room.public) {
          right.appendChild(el('h2', '', 'Online race'));
          if (room.race && room.race.state !== 'done') {
            right.appendChild(el('div', 'desc', 'A race is in progress.'));
          } else if (isHost) {
            right.appendChild(el('div', 'desc', 'Pick an event. Everyone in the room is put on the grid and the countdown starts after 5 seconds.'));
            const chips = el('div', 'chips');
            let pick = g.onlinePick || 'festival-circuit';
            for (const ev of EVENTS) {
              const c = el('button', `chip nav ${ev.id === pick ? 'sel' : ''}`, ev.name);
              c.onclick = () => { g.onlinePick = ev.id; render(); };
              chips.appendChild(c);
            }
            right.appendChild(chips);
            right.appendChild(button(`Start: ${EVENTS.find((e) => e.id === pick).name}`, () => net.send({ t: 'startRace', eventId: pick }), 'primary'));
          } else right.appendChild(el('div', 'desc', 'Waiting for the host to start a race…'));
        }
        right.appendChild(el('h3', '', 'Chat'));
        right.appendChild(el('div', 'olog'));
        const crow = el('div', 'row');
        const input = el('input');
        input.type = 'text';
        input.maxLength = 120;
        input.placeholder = 'Say something…';
        input.style.flex = '1';
        const sendChat = () => { if (input.value.trim()) { net.send({ t: 'chat', text: input.value }); input.value = ''; } };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); e.stopPropagation(); });
        crow.append(input, button('Send', sendChat));
        right.appendChild(crow);
        renderChat();
      }
      sc.setFocus(0);
    };
    sc.refresh = render;
    sc.refreshChat = renderChat;
    render();
  }

  stats() {
    const p = this.game.save.progress;
    const s = p.stats;
    const rows = [
      ['Distance driven', `${(s.distance / 1000).toFixed(1)} km`], ['Top speed', `${Math.round(s.topSpeed)} km/h`], ['Races entered', s.races], ['Wins', s.wins],
      ['Drift points', formatNumber(s.drifts)], ['Air time', `${s.airtime.toFixed(1)} s`], ['Objects smashed', s.smashed], ['XP boards', `${p.boards.length} / 40`],
      ['Cars owned', p.garage.length], ['Level', p.level],
    ];
    const node = el('div', 'overlay', `<div class="topbar"><h1>STATISTICS</h1></div><div class="body"><div class="settings">${rows.map(([a, b]) => `<div class="setrow"><label>${a}</label><div style="text-align:right;font-weight:800;font-size:20px">${b}</div></div>`).join('')}</div></div><div class="hint-bar"><span><b>ESC</b>Back</span></div>`);
    this.push(node, () => this.pop(), { name: 'stats' });
  }

  // ---------------- event card ----------------
  eventCard(ev, info) {
    const g = this.game;
    const rec = g.save.progress.events[ev.id];
    const node = el('div', 'overlay', `<div class="eventcard" style="border-top-color:${info.color}">
      <div class="disc" style="color:${info.color}">${ev.discipline}</div><h2>${ev.name}</h2><div class="desc">${ev.desc}</div>
      <div class="facts"><div><span>TYPE</span>${ev.type === 'circuit' ? `${ev.laps} Lap${ev.laps > 1 ? 's' : ''}` : ev.type === 'showcase' ? 'Showcase' : ev.type === 'drag' ? 'Drag' : ev.type === 'drift' ? 'Drift Score' : 'Sprint'}</div>
      <div><span>LENGTH</span>${(info.length / 1000).toFixed(1)} km</div><div><span>REWARD</span>${formatNumber(ev.reward)}</div>
      <div><span>${ev.type === 'drift' ? '3 STARS' : 'DRIVATARS'}</span>${ev.type === 'showcase' ? 'Jet' : ev.type === 'drift' ? formatNumber(ev.stars[2]) : ev.opponents || 7}</div><div><span>DIFFICULTY</span>${g.save.settings.difficulty.toUpperCase()}</div><div><span>BEST</span>${rec ? formatTime(rec.best) : '--'}</div></div>
      <div class="actions"><button class="btn primary nav go"><span>Start Event</span></button><button class="btn nav cancel"><span>Cancel</span></button></div>
      <div class="lb"></div></div>`);
    const lbEl = node.querySelector('.lb');
    const drawLb = () => {
      const list = g.leaderboards[ev.id];
      if (!g.net.online) { lbEl.innerHTML = ''; return; }
      if (!list) { lbEl.innerHTML = '<h3 style="margin:0;color:var(--muted)">ONLINE TOP TIMES · loading…</h3>'; return; }
      lbEl.innerHTML = '<h3 style="margin:0 0 4px;color:var(--muted);letter-spacing:2px;font-size:13px">ONLINE TOP TIMES</h3>' +
        (list.length ? '' : '<div class="desc">No times yet — be the first!</div>');
      list.slice(0, 5).forEach((e, i) => {
        const d = el('div');
        const a = el('span'); a.textContent = String(i + 1);
        const b = el('span'); b.textContent = `${e.name} · ${(CARS.find((c) => c.id === e.car) || {}).name || ''}`;
        const c = el('span'); c.textContent = formatTime(e.time);
        d.append(a, b, c);
        lbEl.appendChild(d);
      });
    };
    if (g.net.online) g.net.send({ t: 'leaderboard', eventId: ev.id });
    drawLb();
    g.onLeaderboard = (id) => { if (id === ev.id) drawLb(); };
    node.querySelector('.go').onclick = () => { this.pop(); g.startEvent(ev.id); };
    node.querySelector('.cancel').onclick = () => { this.pop(); g.resume(true); };
    this.push(node, () => { this.pop(); g.resume(true); }, { name: 'eventcard' });
  }

  // ---------------- results ----------------
  results(data) {
    const g = this.game;
    const rows = data.rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.car}</td><td style="text-align:right">${r.dnf ? 'DNF' : formatTime(r.time)}</td></tr>`).join('');
    const node = el('div', 'overlay', `<div class="results">
      <div style="color:var(--pink);font-weight:800;letter-spacing:3px">${data.event.discipline.toUpperCase()} · ${data.event.name.toUpperCase()}</div>
      <h2>${data.title}</h2>
      <table>${rows}</table>
      <div class="rewards"><span class="cr">+${formatNumber(data.credits)} CR</span><span class="xp">+${formatNumber(data.xp)} XP</span>${data.record ? '<span style="color:var(--yellow)">NEW PERSONAL BEST</span>' : ''}</div>
      <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary nav cont"><span>Continue</span></button><button class="btn nav again"><span>Restart</span></button></div></div>`);
    node.querySelector('.cont').onclick = () => { this.pop(); g.finishResults(); };
    if (g.race && g.race.online) node.querySelector('.again').remove();
    else node.querySelector('.again').onclick = () => { this.pop(); g.restartEvent(); };
    this.push(node, () => { this.pop(); g.finishResults(); }, { name: 'results' });
  }

  // ---------------- wheelspin ----------------
  wheelspin() {
    const g = this.game;
    const p = g.save.progress;
    const node = el('div', 'overlay', `<div class="wheelspin"><h2>WHEELSPIN</h2><div class="reel"><div class="strip"></div></div>
      <p class="desc">${p.wheelspins} spin${p.wheelspins === 1 ? '' : 's'} available</p>
      <div style="display:flex;gap:10px;justify-content:center"><button class="btn primary nav spin"><span>Spin</span></button><button class="btn nav close"><span>Back</span></button></div></div>`);
    const strip = node.querySelector('.strip');
    const spinBtn = node.querySelector('.spin');
    spinBtn.disabled = p.wheelspins <= 0;
    node.querySelector('.close').onclick = () => this.pop();
    spinBtn.onclick = () => {
      if (p.wheelspins <= 0 || this._spinning) return;
      this._spinning = true;
      const prize = g.rollWheelspin();
      const fillers = ['5,000 CR', '25,000 CR', 'Vela GTi', '10,000 CR', 'Raiden RS', '50,000 CR', 'Falco V12', '15,000 CR', 'Kaito Rally Evo', '100,000 CR'];
      const items = [];
      for (let i = 0; i < 30; i++) items.push(fillers[i % fillers.length]);
      items.push(prize.label);
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      strip.innerHTML = items.map((t, i) => `<div class="item" style="color:${i === items.length - 1 ? (prize.rare ? '#ffd21a' : '#fff') : '#fff'}">${t}</div>`).join('');
      void strip.offsetWidth;
      strip.style.transition = '';
      strip.style.transform = `translateY(-${(items.length - 1) * 120}px)`;
      g.audio.enabled && g.audio.blip(400, 3, 'triangle', 0.02, 800);
      setTimeout(() => {
        this._spinning = false;
        g.claimWheelspin(prize);
        node.querySelector('.desc').textContent = `You won: ${prize.label}! · ${p.wheelspins} spin${p.wheelspins === 1 ? '' : 's'} left`;
        spinBtn.disabled = p.wheelspins <= 0;
      }, 3300);
    };
    this.push(node, () => this.pop(), { name: 'wheelspin' });
  }

  // ---------------- photo mode ----------------
  photo() {
    const g = this.game;
    const node = el('div', 'overlay clear', `<div class="photo interactive"><h3>PHOTO MODE</h3>
      <div class="row">Drag to orbit · Wheel to zoom</div>
      <div class="row">Exposure <input type="range" min="0.3" max="2" step="0.05" value="1" class="exp"></div>
      <div class="row">Saturation <input type="range" min="0" max="2" step="0.05" value="1" class="sat"></div>
      <div class="row">Time of day <input type="range" min="0" max="24" step="0.1" value="${g.world.env.time}" class="tod"></div>
      <div class="row">FOV <input type="range" min="15" max="90" step="1" value="45" class="fov"></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn small primary nav shot"><span>Capture</span></button><button class="btn small nav out"><span>Exit</span></button></div></div>`);
    const canvas = g.renderer.domElement;
    const filt = () => { canvas.style.filter = `brightness(${node.querySelector('.exp').value}) saturate(${node.querySelector('.sat').value})`; };
    node.querySelector('.exp').oninput = filt;
    node.querySelector('.sat').oninput = filt;
    node.querySelector('.tod').oninput = (e) => { g.world.env.time = +e.target.value; };
    node.querySelector('.fov').oninput = (e) => { g.photoFov = +e.target.value; };
    node.querySelector('.shot').onclick = () => g.capturePhoto();
    const exit = () => { canvas.style.filter = ''; this.pop(); g.exitPhoto(); };
    node.querySelector('.out').onclick = exit;
    this.push(node, exit, { name: 'photo' });
  }

  // ---------------- map ----------------
  map(mapView) {
    const g = this.game;
    const node = el('div', 'mapwrap', `<canvas></canvas>
      <div class="topbar"><h1>WORLD MAP</h1><div class="tabs filters"></div><div class="wallet"><span class="cr">${formatNumber(g.save.progress.credits)} CR</span></div></div>
      <div class="mapinfo"></div>
      <div class="legend"><div><i style="background:#ff2d87"></i>Road racing</div><div><i style="background:#c87533"></i>Dirt racing</div><div><i style="background:#ffb000"></i>Street racing</div>
      <div><i style="background:#19d3ff"></i>Drag / Speed zone</div><div><i style="background:#b14bff"></i>Showcase / Drift zone</div><div><i style="background:#2f8bff"></i>Speed trap</div><div><i style="background:#ff8a1f"></i>XP board</div>
      <div style="margin-top:6px;color:var(--muted)">Click to set waypoint · Drag to pan · Wheel to zoom · Esc close</div></div>`);
    node.classList.add('interactive');
    const canvas = node.querySelector('canvas');
    const sc = this.push(node, () => { mapView.detach(); this.pop(); g.closeMap(); }, { name: 'map' });
    sc.passive = false;
    mapView.attach(canvas, node.querySelector('.mapinfo'), sc);
  }
}

export { starsHtml, classFor };
