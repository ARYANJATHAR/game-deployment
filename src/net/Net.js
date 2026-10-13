// WebSocket client for the Horizon Rush multiplayer server.

/** Turns "https://host", "host" or "wss://host/ws" into a WebSocket URL ending in /ws. */
export function normalizeServerUrl(u) {
  let url = String(u || '').trim();
  if (!url) return '';
  if (url.startsWith('https://')) url = `wss://${url.slice(8)}`;
  else if (url.startsWith('http://')) url = `ws://${url.slice(7)}`;
  else if (!/^wss?:\/\//.test(url)) url = `wss://${url}`;
  url = url.replace(/\/+$/, '');
  if (!/\/ws$/.test(url)) url += '/ws';
  return url;
}

export function defaultServerUrl() {
  // set VITE_MULTIPLAYER_URL at build time (e.g. in Vercel) to point at the multiplayer server
  const configured = import.meta.env && import.meta.env.VITE_MULTIPLAYER_URL;
  if (configured) return normalizeServerUrl(configured);
  const { protocol, hostname, port, host } = window.location;
  // dev (vite) and preview servers do not host the multiplayer socket: use the game server port
  if (port === '5173' || port === '4173') return `ws://${hostname}:8787/ws`;
  // static hosts cannot run the socket server themselves
  if (protocol === 'file:' || hostname.endsWith('github.io') || hostname.endsWith('vercel.app')) return '';
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null; // last room info message
    this.handlers = new Map();
    this.offset = 0; // server clock - local clock (ms)
    this.rtt = 0;
    this.status = 'offline'; // offline | connecting | online
    this.url = '';
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  _emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(msg); } catch (e) { console.error(e); }
    }
  }

  get online() {
    return this.status === 'online' && this.ws && this.ws.readyState === 1;
  }

  get inRoom() {
    return this.online && this.room && this.room.code;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  connect(url, hello) {
    url = normalizeServerUrl(url);
    this.disconnect(true);
    this.url = url;
    this.status = 'connecting';
    this._emit('status', this.status);
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.status = 'offline';
        this._emit('status', this.status);
        reject(new Error('Invalid server address'));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (this.status === 'connecting') {
          ws.close();
          reject(new Error('Could not reach the server'));
        }
      }, 60000); // free hosting tiers can take up to a minute to wake up
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.id = m.id;
          this.offset = m.now - Date.now();
          this.status = 'online';
          this.send({ t: 'hello', ...hello });
          this._emit('status', this.status);
          this._pingLoop();
          resolve(m);
        } else if (m.t === 'pong') {
          const rtt = Date.now() - m.n;
          this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
          this.offset = m.now + rtt / 2 - Date.now();
        } else if (m.t === 'room') {
          this.room = m.code ? m : null;
        }
        this._emit(m.t, m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.status;
        this.status = 'offline';
        this.room = null;
        this.ws = null;
        clearInterval(this._ping);
        this._emit('status', this.status);
        if (was === 'connecting') reject(new Error('Could not reach the server'));
        else this._emit('disconnected', {});
      };
      ws.onerror = () => {};
    });
  }

  _pingLoop() {
    clearInterval(this._ping);
    this._ping = setInterval(() => this.send({ t: 'ping', n: Date.now() }), 3000);
    this.send({ t: 'ping', n: Date.now() });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  disconnect(silent = false) {
    clearInterval(this._ping);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
    this.room = null;
    if (this.status !== 'offline') {
      this.status = 'offline';
      if (!silent) this._emit('status', this.status);
    }
  }
}
