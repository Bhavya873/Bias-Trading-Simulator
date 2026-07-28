'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createGame } = require('./lib/game');

const PORT = Number(process.env.PORT) || 3000;
const PRESENTER_TOKEN = String(process.env.PRESENTER_TOKEN || '').trim();

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ws re-emits http server errors; retry logic lives on the http server below
wss.on('error', () => {});

const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

const game = createGame(broadcast);

function lanAddress() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }
  // Prefer common LAN ranges over VirtualBox/Hyper-V host-only adapters
  const preferred = candidates.find(
    (c) =>
      /^(192\.168\.(?!56\.)|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(c.address) &&
      !/Virtual|VMware|Hyper-V|Loopback/i.test(c.name)
  );
  const wifiish = candidates.find((c) =>
    /wi-?fi|wlan|wireless|ethernet|eth|en0|en1/i.test(c.name)
  );
  return (preferred || wifiish || candidates[0] || { address: '127.0.0.1' }).address;
}

const lanIp = lanAddress();

/** Public base URL for join links. Prefer PUBLIC_URL (or platform vars) when hosting. */
function publicBaseUrl(port) {
  const fromEnv =
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : '') ||
    (process.env.FLY_APP_NAME
      ? `https://${process.env.FLY_APP_NAME}.fly.dev`
      : '');
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');
  return `http://${lanIp}:${port}`;
}

function hasPublicUrl() {
  return !!(
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.FLY_APP_NAME
  );
}

let lanUrl = publicBaseUrl(PORT);
game.setLanUrl(lanUrl);

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'state', payload: game.publicState() }));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      if (msg.type === 'getState') {
        ws.send(JSON.stringify({ type: 'state', payload: game.publicState() }));
      }
    } catch (_) {
      /* ignore malformed frames */
    }
  });
});

function ok(res, data) {
  res.json(data);
}
function fail(res, err, code = 400) {
  res.status(code).json({ error: err.message || String(err) });
}

/** Optional gate for presenter controls. Unset = open (classroom LAN default). */
function requirePresenter(req, res, next) {
  if (!PRESENTER_TOKEN) return next();
  const header = String(req.get('x-presenter-token') || '');
  const query = String(req.query.token || '');
  const bodyToken =
    req.body && typeof req.body === 'object' ? String(req.body.token || '') : '';
  if (header === PRESENTER_TOKEN || query === PRESENTER_TOKEN || bodyToken === PRESENTER_TOKEN) {
    return next();
  }
  return fail(res, new Error('Unauthorized'), 401);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', (_req, res) => ok(res, game.publicState()));

app.post('/api/join', (req, res) => {
  try {
    const { name, player_id, code } = req.body || {};
    ok(res, game.join(name, player_id, code));
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/trade', (req, res) => {
  try {
    ok(res, game.trade(req.body || {}));
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/alert/dismiss', (_req, res) => {
  game.dismissAlert();
  ok(res, { ok: true });
});

app.post('/api/present/start-round', requirePresenter, (req, res) => {
  try {
    const n = Number((req.body || {}).round) || 1;
    game.startRound(n);
    ok(res, { ok: true });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/present/next-tick', requirePresenter, (_req, res) => {
  try {
    game.nextTickManual();
    ok(res, { ok: true });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/present/end-round', requirePresenter, (_req, res) => {
  try {
    game.endRound();
    ok(res, { ok: true });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/present/next-round', requirePresenter, (_req, res) => {
  try {
    game.nextRound();
    ok(res, { ok: true });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/present/comparison', requirePresenter, (_req, res) => {
  game.goComparison();
  ok(res, { ok: true });
});

app.post('/api/present/reset', requirePresenter, (req, res) => {
  const demo = !!(req.body || {}).demoMode;
  game.reset(demo);
  ok(res, { ok: true });
});

app.post('/api/present/demo', requirePresenter, (req, res) => {
  game.setDemoMode(!!(req.body || {}).on);
  ok(res, { ok: true, demoMode: !!(req.body || {}).on });
});

app.get('/api/comparison', (_req, res) => ok(res, game.getComparison()));

app.get('/api/recap/:playerId', (req, res) => {
  try {
    ok(res, game.getRecap(req.params.playerId));
  } catch (e) {
    fail(res, e);
  }
});

app.get('/present', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'present.html'));
});

app.get('/recap', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'recap.html'));
});

function banner(port) {
  lanUrl = publicBaseUrl(port);
  game.setLanUrl(lanUrl);

  console.log('');
  console.log('  Ticker — behavioural finance trading game');
  console.log('  -----------------------------------------');
  console.log(`  Local:     http://127.0.0.1:${port}`);
  console.log(`  Public:    ${lanUrl}`);
  console.log(`  Presenter: ${lanUrl}/present`);
  console.log(`  Players:   ${lanUrl}/`);
  console.log(`  Lobby code:${game.publicState().lobbyCode}`);
  if (PRESENTER_TOKEN) {
    console.log('  Presenter token: set (required for /api/present/*)');
  }
  if (!hasPublicUrl()) {
    console.log('');
    console.log('  All IPv4 addresses on this machine:');
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`    http://${iface.address}:${port}  (${name})`);
        }
      }
    }
    console.log('');
    console.log('  Tip: campus Wi-Fi often blocks phones. Host online or use a laptop hotspot.');
    console.log('  For hosting, set PUBLIC_URL=https://your-app.example.com');
  }
  console.log('');
}

const MAX_PORT_TRIES = 10;
let attempt = 0;

function startListening(port) {
  server.listen(port, '0.0.0.0');
}

server.on('listening', () => {
  banner(server.address().port);
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;

  if (process.env.PORT) {
    console.error(
      `\n  Port ${process.env.PORT} is already in use and PORT was set explicitly.` +
        `\n  Stop the other process or run without PORT to auto-pick a free port.\n`
    );
    process.exit(1);
  }

  attempt += 1;
  if (attempt > MAX_PORT_TRIES) {
    console.error(
      `\n  Could not find a free port between ${PORT} and ${PORT + MAX_PORT_TRIES}.\n`
    );
    process.exit(1);
  }

  const nextPort = PORT + attempt;
  console.log(`  Port ${PORT + attempt - 1} in use — trying ${nextPort}…`);
  setTimeout(() => startListening(nextPort), 100);
});

function shutdown(signal) {
  console.log(`\n  Shutting down (${signal})…`);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startListening(PORT);
