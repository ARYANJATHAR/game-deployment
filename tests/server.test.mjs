// Multiplayer server protocol test: rooms, snapshots, chat, races and leaderboards.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-data-'));
const { createServer, originAllowed } = await import('../server/index.js');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const { server } = createServer({ port: PORT, log: false });

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const allow = ['https://horizon-rush.vercel.app', 'https://*.vercel.app'];
check(originAllowed('https://anything', []), 'no origin list allows everyone');
check(originAllowed('https://horizon-rush.vercel.app', allow), 'exact origin allowed');
check(originAllowed('https://horizon-rush-git-dev.vercel.app', allow), 'wildcard origin allowed');
check(!originAllowed('https://evil.example.com', allow) && !originAllowed('https://vercel.app.evil.com', allow) && !originAllowed(undefined, allow), 'other origins rejected');

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const wait = (pred, ms = 3000) => new Promise((res, rej) => {
    const hit = inbox.find(pred);
    if (hit) { inbox.splice(inbox.indexOf(hit), 1); return res(hit); }
    const w = { pred: (m) => { if (pred(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, res };
    waiters.push(w);
    setTimeout(() => rej(new Error(`${name}: timeout waiting`)), ms);
  });
  const send = (m) => ws.send(JSON.stringify(m));
  return new Promise((res) => ws.on('open', () => res({ ws, wait, send, inbox })));
}

try {
  const a = await client('A');
  const b = await client('B');
  const wa = await a.wait((m) => m.t === 'welcome');
  const wb = await b.wait((m) => m.t === 'welcome');
  check(wa.id !== wb.id, 'clients get distinct ids');
  a.send({ t: 'hello', name: 'Alice<script>', car: 'falco', paint: '#ff0000' });
  b.send({ t: 'hello', name: 'Bob', car: 'vela', paint: 'nope' });

  a.send({ t: 'create' });
  const ra = await a.wait((m) => m.t === 'room' && m.code);
  check(/^[A-Z2-9]{5}$/.test(ra.code), `private room created (${ra.code})`);
  check(ra.host === wa.id, 'creator is host');

  b.send({ t: 'join', code: 'ZZZZZ' });
  const err = await b.wait((m) => m.t === 'error');
  check(/not found/.test(err.message), 'joining a missing room is rejected');

  b.send({ t: 'join', code: ra.code.toLowerCase() });
  const rb = await b.wait((m) => m.t === 'room' && m.code === ra.code);
  check(rb.players.length === 2, 'second player joins by code (case-insensitive)');
  check(rb.players.find((p) => p.id === wa.id).name === 'Alicescript', 'names are sanitised');
  check(rb.players.find((p) => p.id === wb.id).paint === '#ff2d87', 'invalid paint falls back to default');

  a.send({ t: 'state', p: [1, 2, 3], q: [0, 0, 0, 1], v: [0, 0, 5], rpm: 3000, g: 2 });
  const snap = await b.wait((m) => m.t === 'snap' && m.players.some((p) => p.id === wa.id));
  const pa = snap.players.find((p) => p.id === wa.id);
  check(pa.p[0] === 1 && pa.car === 'falco', 'state is relayed in snapshots');

  a.send({ t: 'chat', text: 'hi <b>there</b>' });
  const chat = await b.wait((m) => m.t === 'chat');
  check(chat.text === 'hi bthere/b' && chat.name === 'Alicescript', 'chat is relayed and sanitised');

  b.send({ t: 'startRace', eventId: 'port-solano' });
  const e2 = await b.wait((m) => m.t === 'error');
  check(/host/.test(e2.message), 'only the host can start a race');

  a.send({ t: 'startRace', eventId: 'port-solano' });
  const sa = await a.wait((m) => m.t === 'raceStart');
  const sb = await b.wait((m) => m.t === 'raceStart');
  check(sa.eventId === 'port-solano' && sb.startAt === sa.startAt && sa.grid.length === 2, 'race start broadcast with shared start time and grid');

  b.send({ t: 'state', p: [0, 0, 0], q: [0, 0, 0, 1], prog: 500 });
  b.send({ t: 'finish', time: 61.5 });
  const fin = await a.wait((m) => m.t === 'finished' && m.id === wb.id);
  check(fin.position === 1, 'finish order tracked');
  a.send({ t: 'finish', time: 63.25 });
  const res = await a.wait((m) => m.t === 'raceResults');
  check(res.results[0].name === 'Bob' && res.results[1].time === 63.25, 'results ordered by time');

  a.send({ t: 'leaderboard', eventId: 'port-solano' });
  const lb = await a.wait((m) => m.t === 'leaderboard' && m.eventId === 'port-solano' && m.list.length === 2);
  check(lb.list[0].time === 61.5, 'leaderboard keeps best times');

  // public room: anyone can join, no races
  a.send({ t: 'join', code: 'PUBLIC' });
  const pub = await a.wait((m) => m.t === 'room' && m.code === 'PUBLIC');
  check(pub.public === true, 'public free roam room');
  a.send({ t: 'startRace', eventId: 'x' });
  const e3 = await a.wait((m) => m.t === 'error');
  check(/private/.test(e3.message), 'races need a private room');

  // leaving updates the other room
  const left = await b.wait((m) => m.t === 'left' && m.id === wa.id);
  check(!!left, 'other players are told when someone leaves');

  a.ws.close();
  b.ws.close();
} catch (e) {
  failures++;
  console.log('FAIL', e.message);
}
server.close();
if (failures) { console.log(failures, 'server test failures'); process.exit(1); }
console.log('server checks passed');
process.exit(0);
