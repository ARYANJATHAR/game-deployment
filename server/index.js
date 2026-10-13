// Horizon Rush multiplayer server.
// Serves the built game (dist/) and relays player state over WebSockets.
// Rooms hold up to 12 drivers; one public free-roam room plus private rooms by code.
//
//   npm run build && npm start        -> http://localhost:8787
//   PORT=9000 npm start               -> custom port

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const DATA = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const PORT = Number(process.env.PORT) || 8787;
const TICK_MS = 1000 / 15;
const MAX_ROOM = 12;
const MAX_MSG = 4096;
const FINISH_GRACE_MS = 30000;
// Comma-separated list of sites allowed to connect, e.g. "https://my-game.vercel.app,https://*.vercel.app".
// Empty means any origin may connect.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

export function originAllowed(origin, allowed = ALLOWED_ORIGINS) {
  if (!allowed.length) return true;
  if (!origin) return false;
  return allowed.some((a) => {
    if (a === '*') return true;
    if (a.includes('*')) {
      const [pre, post] = a.split('*');
      return origin.startsWith(pre) && origin.endsWith(post) && origin.length >= pre.length + post.length;
    }
    return origin === a;
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---------------- leaderboards (persisted best times per event) ----------------
const LB_FILE = path.join(DATA, 'leaderboards.json');
let leaderboards = {};
try { leaderboards = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch { leaderboards = {}; }
let lbDirty = false;
setInterval(() => {
  if (!lbDirty) return;
  lbDirty = false;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFile(LB_FILE, JSON.stringify(leaderboards), () => {});
}, 5000).unref();

export function submitTime(eventId, name, car, time) {
  if (typeof eventId !== 'string' || eventId.length > 40 || !(time > 1 && time < 3600)) return null;
  const list = (leaderboards[eventId] ||= []);
  const existing = list.find((e) => e.name === name);
  if (existing) {
    if (time >= existing.time) return list;
    Object.assign(existing, { time, car, at: Date.now() });
  } else list.push({ name, car, time, at: Date.now() });
  list.sort((a, b) => a.time - b.time);
  list.length = Math.min(list.length, 50);
  lbDirty = true;
  return list;
}

// ---------------- static file server ----------------
function serveStatic(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
    return;
  }
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.resolve(DIST, '.' + p);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT' && p === '/index.html') {
        // multiplayer-only deployment (game hosted elsewhere, e.g. Vercel)
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Horizon Rush multiplayer server is running. WebSocket endpoint: /ws');
        return;
      }
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? 'Not found.' : 'Server error');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
}

// ---------------- rooms ----------------
const rooms = new Map(); // code -> room
const clients = new Map(); // ws -> client
let nextId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, players: new Map(), host: null, race: null, public: code === 'PUBLIC' };
    rooms.set(code, r);
  }
  return r;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except = null) {
  const s = JSON.stringify(msg);
  for (const c of room.players.values()) if (c.ws !== except && c.ws.readyState === 1) c.ws.send(s);
}

function roomInfo(room) {
  return {
    t: 'room',
    code: room.code,
    host: room.host,
    public: room.public,
    players: [...room.players.values()].map((c) => ({ id: c.id, name: c.name, car: c.car, paint: c.paint })),
    race: room.race ? { eventId: room.race.eventId, state: room.race.state, entrants: [...room.race.entrants] } : null,
  };
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  room.players.delete(c.id);
  c.room = null;
  if (room.race) {
    room.race.entrants.delete(c.id);
    maybeFinishRace(room);
  }
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.host === c.id) room.host = room.players.keys().next().value;
  broadcast(room, { t: 'left', id: c.id });
  broadcast(room, roomInfo(room));
}

function joinRoom(c, code) {
  const room = getRoom(code);
  if (room.players.size >= MAX_ROOM) return send(c.ws, { t: 'error', message: 'Room is full' });
  leaveRoom(c);
  room.players.set(c.id, c);
  c.room = room;
  c.state = null;
  if (!room.host || room.public) room.host = room.host || c.id;
  send(c.ws, roomInfo(room));
  broadcast(room, { t: 'joined', id: c.id, name: c.name }, c.ws);
  broadcast(room, roomInfo(room), c.ws);
}

// ---------------- races ----------------
function startRace(room, c, eventId) {
  if (room.public) return send(c.ws, { t: 'error', message: 'Create a private room to race online' });
  if (room.host !== c.id) return send(c.ws, { t: 'error', message: 'Only the host can start a race' });
  if (room.race && room.race.state !== 'done') return send(c.ws, { t: 'error', message: 'A race is already running' });
  const entrants = new Set(room.players.keys());
  const startAt = Date.now() + 5000;
  room.race = { eventId, state: 'countdown', startAt, entrants, finishes: new Map(), progress: new Map(), firstFinish: 0 };
  const grid = [...entrants];
  broadcast(room, { t: 'raceStart', eventId, startAt, serverNow: Date.now(), grid });
  broadcast(room, roomInfo(room));
}

function maybeFinishRace(room) {
  const r = room.race;
  if (!r || r.state === 'done') return;
  const allIn = [...r.entrants].every((id) => r.finishes.has(id));
  const timedOut = r.firstFinish && Date.now() - r.firstFinish > FINISH_GRACE_MS;
  if (!allIn && !timedOut && r.entrants.size > 0) return;
  r.state = 'done';
  const results = [...r.entrants].map((id) => {
    const p = room.players.get(id);
    const f = r.finishes.get(id);
    return { id, name: p ? p.name : '?', car: p ? p.car : '', time: f ? f.time : null, progress: r.progress.get(id) || 0 };
  });
  results.sort((a, b) => {
    if (a.time !== null && b.time !== null) return a.time - b.time;
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return b.progress - a.progress;
  });
  broadcast(room, { t: 'raceResults', eventId: r.eventId, results });
  broadcast(room, roomInfo(room));
}

// ---------------- messages ----------------
const clean = (s, n) => String(s ?? '').replace(/[<>]/g, '').slice(0, n).trim();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function onMessage(c, raw) {
  if (raw.length > MAX_MSG) return;
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const room = c.room;
  switch (m.t) {
    case 'hello':
      c.name = clean(m.name, 18) || `Driver${c.id}`;
      c.car = clean(m.car, 16);
      c.paint = /^#[0-9a-fA-F]{6}$/.test(m.paint) ? m.paint : '#ff2d87';
      if (room) broadcast(room, roomInfo(room));
      break;
    case 'join': {
      const code = m.code === 'PUBLIC' ? 'PUBLIC' : clean(m.code, 5).toUpperCase();
      if (!code) return;
      if (code !== 'PUBLIC' && !rooms.has(code) && !m.create) return send(c.ws, { t: 'error', message: `Room ${code} not found` });
      joinRoom(c, code);
      break;
    }
    case 'create':
      joinRoom(c, makeCode());
      break;
    case 'leave':
      leaveRoom(c);
      send(c.ws, { t: 'room', code: null });
      break;
    case 'state':
      if (!room || !Array.isArray(m.p) || !Array.isArray(m.q)) return;
      c.state = {
        p: m.p.slice(0, 3).map(num), q: m.q.slice(0, 4).map(num), v: Array.isArray(m.v) ? m.v.slice(0, 3).map(num) : [0, 0, 0],
        st: num(m.st), rpm: num(m.rpm), g: num(m.g), th: num(m.th), b: m.b ? 1 : 0, l: m.l ? 1 : 0, car: c.car, paint: c.paint,
      };
      if (room.race && room.race.state !== 'done' && typeof m.prog === 'number') room.race.progress.set(c.id, num(m.prog));
      break;
    case 'chat': {
      if (!room) return;
      const text = clean(m.text, 120);
      if (!text) return;
      const now = Date.now();
      if (now - (c.lastChat || 0) < 700) return; // flood control
      c.lastChat = now;
      broadcast(room, { t: 'chat', id: c.id, name: c.name, text });
      break;
    }
    case 'startRace':
      if (room) startRace(room, c, clean(m.eventId, 40));
      break;
    case 'finish': {
      const r = room && room.race;
      if (!r || r.state === 'done' || !r.entrants.has(c.id) || r.finishes.has(c.id)) return;
      const time = num(m.time);
      r.finishes.set(c.id, { time });
      if (!r.firstFinish) r.firstFinish = Date.now();
      broadcast(room, { t: 'finished', id: c.id, time, position: r.finishes.size });
      const lb = submitTime(r.eventId, c.name, c.car, time);
      if (lb) broadcast(room, { t: 'leaderboard', eventId: r.eventId, list: lb.slice(0, 10) });
      maybeFinishRace(room);
      break;
    }
    case 'quitRace': {
      const r = room && room.race;
      if (!r) return;
      r.entrants.delete(c.id);
      maybeFinishRace(room);
      break;
    }
    case 'leaderboard': {
      const id = clean(m.eventId, 40);
      send(c.ws, { t: 'leaderboard', eventId: id, list: (leaderboards[id] || []).slice(0, 10) });
      break;
    }
    case 'submitTime': {
      // solo best times also count toward the online leaderboards
      const list = submitTime(clean(m.eventId, 40), c.name, c.car, num(m.time));
      if (list) send(c.ws, { t: 'leaderboard', eventId: m.eventId, list: list.slice(0, 10) });
      break;
    }
    case 'ping':
      send(c.ws, { t: 'pong', n: m.n, now: Date.now() });
      break;
    default:
  }
}

// ---------------- boot ----------------
export function createServer({ port = PORT, log = true } = {}) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({
    server, path: '/ws', maxPayload: MAX_MSG * 4,
    verifyClient: (info) => originAllowed(info.origin),
  });
  wss.on('connection', (ws) => {
    const c = { id: nextId++, ws, name: `Driver${nextId - 1}`, car: '', paint: '#ff2d87', room: null, state: null, alive: true };
    clients.set(ws, c);
    send(ws, { t: 'welcome', id: c.id, now: Date.now() });
    ws.on('message', (data) => onMessage(c, data.toString()));
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => {
      leaveRoom(c);
      clients.delete(ws);
    });
  });
  // 15 Hz snapshots per room
  const tick = setInterval(() => {
    for (const room of rooms.values()) {
      const players = [];
      for (const c of room.players.values()) if (c.state) players.push({ id: c.id, ...c.state });
      if (players.length) broadcast(room, { t: 'snap', now: Date.now(), players });
      if (room.race && room.race.state === 'countdown' && Date.now() >= room.race.startAt) room.race.state = 'running';
      if (room.race && room.race.state === 'running') {
        maybeFinishRace(room);
        const standings = [...room.race.progress.entries()].map(([id, prog]) => ({ id, prog, fin: room.race.finishes.has(id) }));
        broadcast(room, { t: 'raceProgress', standings });
      }
    }
  }, TICK_MS);
  // drop dead connections
  const heartbeat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, 15000);
  server.on('close', () => { clearInterval(tick); clearInterval(heartbeat); });
  server.listen(port, () => {
    if (log) console.log(`Horizon Rush server on http://localhost:${port} (WebSocket /ws)`);
  });
  return { server, wss };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createServer();
