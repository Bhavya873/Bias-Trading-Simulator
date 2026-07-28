/**
 * Real-time timer check — verifies the buy-in auto-starts the live phase
 * and ticks auto-advance without presenter intervention.
 * Run against a listening server: node test/timing.js [baseUrl]
 */

'use strict';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

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

const get = (p) => fetch(BASE + p).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, cond, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
}

async function main() {
  console.log(`\nTiming check — ${BASE}\n`);

  await post('/api/present/reset', { demoMode: true });
  const p = await post('/api/join', { name: 'Timer' });

  const cfg = await get('/api/state');
  const buyInMs = cfg.config.timings.buyInMs;
  const tickMs = cfg.config.timings.tickMs;
  console.log(`  config: buy-in ${buyInMs / 1000}s, tick ${tickMs / 1000}s, ${cfg.config.timings.tickCount} ticks\n`);

  const t0 = Date.now();
  await post('/api/present/start-round', { round: 1 });

  let s = await get('/api/state');
  check('starts in buy-in', s.phase === 'buyin');
  check('buy-in deadline is ~10s out', Math.abs(s.buyInEndsAt - Date.now() - buyInMs) < 1500);

  // Trading is open during buy-in — whole shares
  await post('/api/trade', {
    player_id: p.player_id,
    ticker: 'NVDA',
    side: 'buy',
    shares: 1,
  });
  console.log('  buy-in trade accepted');

  // Wait for auto transition to live
  await sleep(buyInMs + 800);
  s = await get('/api/state');
  const liveAt = ((Date.now() - t0) / 1000).toFixed(1);
  check('auto-advances to live phase', s.phase === 'live', `after ${liveAt}s`);
  check('live starts at tick 0', s.tick === 0, `tick ${s.tick}`);

  // Wait for two auto ticks
  await sleep(tickMs + 600);
  s = await get('/api/state');
  check('auto tick 1 fired', s.tick === 1, `tick ${s.tick}`);

  await sleep(300);
  s = await get('/api/state');
  check('R1 fires no alerts', (s.alertLog || []).length === 0);

  await sleep(tickMs);
  s = await get('/api/state');
  check('auto tick 2 fired', s.tick === 2, `tick ${s.tick}`);
  check('prices advanced with ticks', s.priceHistory.NVDA.length === 3);

  // Round 2 alert timing
  await post('/api/present/end-round');
  await post('/api/present/next-round');
  await post('/api/present/next-tick'); // into live
  s = await get('/api/state');
  check('R2 live', s.phase === 'live' && s.round === 2);

  await sleep(tickMs + 700);
  s = await get('/api/state');
  check('R2 auto tick fired', s.tick >= 1, `tick ${s.tick}`);
  check('R2 alert fired automatically', (s.alertLog || []).length >= 1, `${(s.alertLog || []).length} alerts`);
  check('alert is NVDA only', (s.alertLog || []).every((a) => a.ticker === 'NVDA'));
  check('pendingAlert surfaced to clients', !!s.pendingAlert);

  await post('/api/alert/dismiss', {});
  s = await get('/api/state');
  check('alert dismiss clears cue', !s.pendingAlert);

  await post('/api/present/reset', { demoMode: false });
  console.log(`\n${failed ? failed + ' failed' : 'all timing checks passed'}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nTiming test crashed:', e.message);
  process.exit(1);
});
