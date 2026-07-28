/**
 * WebSocket sync check — verifies clients receive a snapshot on connect
 * and get pushed updates for joins, trades, and phase changes.
 * Run against a listening server: node test/ws.js [baseUrl]
 */

'use strict';

const WebSocket = require('ws');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const WS_URL = BASE.replace(/^http/, 'ws');

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.statusText}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openClient(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const received = [];
    ws.on('message', (raw) => {
      try {
        received.push(JSON.parse(String(raw)));
      } catch (_) {
        /* ignore */
      }
    });
    ws.on('open', () => resolve({ ws, received, label }));
    ws.on('error', reject);
  });
}

async function main() {
  console.log(`\nWebSocket check — ${WS_URL}\n`);

  await post('/api/present/reset', { demoMode: true });

  const phone = await openClient('phone');
  const presenter = await openClient('presenter');
  await sleep(300);

  check('phone gets snapshot on connect', phone.received.length >= 1);
  check('presenter gets snapshot on connect', presenter.received.length >= 1);
  check('snapshot is a state message', phone.received[0]?.type === 'state');
  check('snapshot has phase', phone.received[0]?.payload?.phase === 'lobby');

  const before = phone.received.length;
  const p = await post('/api/join', { name: 'Wsy' });
  await sleep(300);
  check('join broadcasts to phone', phone.received.length > before);
  check('join broadcasts to presenter', presenter.received.length > 1);

  const last = phone.received[phone.received.length - 1].payload;
  check('broadcast includes new player', !!last.players[p.player_id]);

  const beforeStart = presenter.received.length;
  await post('/api/present/start-round', { round: 1 });
  await sleep(300);
  const afterStart = presenter.received[presenter.received.length - 1].payload;
  check('round start broadcasts', presenter.received.length > beforeStart);
  check('broadcast phase is buyin', afterStart.phase === 'buyin');

  const beforeTrade = phone.received.length;
  await post('/api/trade', {
    player_id: p.player_id,
    ticker: 'NVDA',
    side: 'buy',
    shares: 1,
  });
  await sleep(300);
  const afterTrade = phone.received[phone.received.length - 1].payload;
  check('trade broadcasts to all clients', phone.received.length > beforeTrade);
  const cash = afterTrade.players[p.player_id].cash;
  check('broadcast reflects new cash', cash < 100, `cash=${cash}`);
  check('broadcast shows whole-share holding', afterTrade.players[p.player_id].holdings.NVDA === 1);

  // Reconnect behaviour
  phone.ws.close();
  await sleep(300);
  const rejoined = await openClient('phone2');
  await sleep(300);
  check('reconnecting client gets fresh snapshot', rejoined.received[0]?.payload?.round === 1);
  check(
    'reconnected client sees existing trade',
    rejoined.received[0]?.payload?.players[p.player_id]?.holdings?.NVDA === 1
  );

  // getState request over the socket
  rejoined.ws.send(JSON.stringify({ type: 'getState' }));
  await sleep(250);
  check('responds to getState request', rejoined.received.length >= 2);

  rejoined.ws.send(JSON.stringify({ type: 'ping' }));
  await sleep(250);
  check('responds to ping', rejoined.received.some((m) => m.type === 'pong'));

  rejoined.ws.send('not json');
  await sleep(250);
  check('survives malformed frame', rejoined.ws.readyState === WebSocket.OPEN);

  presenter.ws.close();
  rejoined.ws.close();
  await post('/api/present/reset', { demoMode: false });

  console.log(`\n${failed ? failed + ' failed' : 'all websocket checks passed'}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nWS test crashed:', e.message);
  process.exit(1);
});
