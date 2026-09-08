/**
 * Multiplayer hub.
 *
 * This process is deliberately NOT a simulator. It never runs physics, never
 * corrects a player, and never decides where anybody is. Each client simulates
 * its own car locally at 60 Hz so steering has zero network latency; the hub
 * only orders, stores and relays the resulting pose samples, and hands a new
 * arrival the current roster. Adding authority here would put the lag straight
 * back into the steering, which is the one thing this design exists to avoid.
 *
 * It also serves the built client from dist/ so one process is the whole game.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
/** Broadcast rate. Clients interpolate between these, so more often buys nothing but bandwidth. */
const TICK_MS = 50;
/** A sample this old means the client stopped talking; the socket is closed on the next sweep. */
const TIMEOUT_MS = 15000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 64);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

/**
 * Names reach every other player's screen, so they are reduced to a strict allowlist
 * here rather than escaped later. Markup characters never enter the system at all,
 * which keeps a name safe no matter how a future client chooses to render it.
 */
function cleanName(value) {
  const text = String(value ?? '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return text || `PLAYER${Math.floor(Math.random() * 900 + 100)}`;
}
/**
 * A skin is either a game character id or a VRM filename on the shared asset host,
 * which is case sensitive and carries a dot — so unlike a car id it cannot be
 * lowercased or stripped of dots. It stays a bare filename: no slashes, no scheme.
 */
const cleanSkin = (value, fallback) => {
  const text = String(value ?? '').replace(/[^A-Za-z0-9_.-]/g, '').replace(/\.{2,}/g, '.').slice(0, 64);
  return text || fallback;
};
const cleanId = (value, fallback) => {
  const text = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return text || fallback;
};
const finite = (value) => (Number.isFinite(value) ? Number(value) : 0);

/**
 * Validate a pose sample. A client is trusted with its own position — that is the
 * whole point of local simulation — but never with the shape of the packet, which
 * is relayed verbatim to everyone else.
 */
function cleanSample(raw) {
  if (!Array.isArray(raw) || raw.length < 13) return null;
  const numbers = raw.slice(0, 10).map(finite);
  if (numbers.some((n) => Math.abs(n) > 1e6)) return null;
  return [
    ...numbers,
    raw[10] ? 1 : 0,
    String(raw[11] ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40),
    cleanId(raw[12], 'famil_v'),
  ];
}

const players = new Map();
let nextId = 1;

const server = createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, players: players.size, uptime: Math.round(process.uptime()) }));
    return;
  }
  // Everything else is the static client. Unknown paths fall back to index.html.
  const requested = decodeURIComponent((request.url || '/').split('?')[0]);
  let path = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  try {
    if (!path.startsWith(ROOT)) throw new Error('outside root');
    const info = await stat(path).catch(() => null);
    if (!info || info.isDirectory()) path = join(ROOT, 'index.html');
    const body = await readFile(path);
    const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found. Run npm run build first.');
  }
});

const sockets = new WebSocketServer({ server });

const send = (socket, message) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};
function broadcast(message, except) {
  const text = JSON.stringify(message);
  for (const player of players.values()) {
    if (player.id === except) continue;
    if (player.socket.readyState === player.socket.OPEN) player.socket.send(text);
  }
}
const describe = (player) => ({ id: player.id, name: player.name, level: player.level, car: player.car, skin: player.skin });

sockets.on('connection', (socket) => {
  if (players.size >= MAX_PLAYERS) { send(socket, { t: 'full' }); socket.close(); return; }
  const id = String(nextId++);
  const player = { id, socket, name: '', level: 1, car: 'famil_v', skin: 'SchizoAxe.vrm', sample: null, seen: Date.now(), joined: false };
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  socket.on('message', (data) => {
    let message;
    try { message = JSON.parse(String(data)); } catch { return; }
    player.seen = Date.now();
    if (message.t === 'hi') {
      if (player.joined) return;
      player.name = cleanName(message.name);
      player.level = Math.min(7, Math.max(1, Math.round(finite(message.level)) || 1));
      player.car = cleanId(message.car, 'famil_v');
      player.skin = cleanSkin(message.skin, 'SchizoAxe.vrm');
      player.joined = true;
      players.set(id, player);
      send(socket, { t: 'welcome', id, now: Date.now(), players: [...players.values()].map(describe) });
      broadcast({ t: 'join', ...describe(player) }, id);
      console.log(`[hub] ${player.name} (${id}) joined level ${player.level} · ${players.size} online`);
    } else if (message.t === 's') {
      if (!player.joined) return;
      const sample = cleanSample(message.d);
      if (sample) player.sample = sample;
    } else if (message.t === 'lv') {
      if (!player.joined) return;
      player.level = Math.min(7, Math.max(1, Math.round(finite(message.level)) || player.level));
      player.car = cleanId(message.car, player.car);
      player.skin = cleanSkin(message.skin, player.skin);
      // The pose is stale the moment the level changes; drop it so nobody sees a ghost.
      player.sample = null;
      broadcast({ t: 'info', ...describe(player) }, id);
    }
  });

  const drop = () => {
    if (!players.delete(id)) return;
    broadcast({ t: 'bye', id });
    console.log(`[hub] ${player.name} (${id}) left · ${players.size} online`);
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

// One batched frame per client per tick, carrying only the players who share their level.
setInterval(() => {
  const now = Date.now();
  for (const player of players.values()) {
    const others = [];
    for (const other of players.values()) {
      if (other.id === player.id || !other.sample || other.level !== player.level) continue;
      others.push([other.id, ...other.sample]);
    }
    if (others.length) send(player.socket, { t: 'f', now, s: others });
  }
}, TICK_MS);

// Sweep dead sockets: a browser tab that is closed abruptly does not always send a close frame.
setInterval(() => {
  const now = Date.now();
  for (const client of sockets.clients) {
    if (client.isAlive === false) { client.terminate(); continue; }
    client.isAlive = false;
    client.ping();
  }
  for (const player of players.values()) if (now - player.seen > TIMEOUT_MS) player.socket.terminate();
}, 5000);

server.listen(PORT, () => console.log(`[hub] Schizo Hit and Run listening on :${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { console.log(`[hub] ${signal} — closing`); server.close(); process.exit(0); });
}
