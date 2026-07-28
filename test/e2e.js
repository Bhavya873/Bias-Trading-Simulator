/**
 * End-to-end validation of the full 5-round flow.
 * Run with the server already listening:  node test/e2e.js [baseUrl]
 */

'use strict';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
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

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: ${res.statusText}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function buy(playerId, ticker, shares = 1) {
  return post('/api/trade', {
    player_id: playerId,
    ticker,
    side: 'buy',
    shares,
  });
}

async function sell(playerId, ticker, shares = 1) {
  return post('/api/trade', {
    player_id: playerId,
    ticker,
    side: 'sell',
    shares,
  });
}

async function main() {
  console.log(`\nTicker E2E — ${BASE}\n`);

  // ---- Reset & lobby ----
  console.log('Lobby');
  await post('/api/present/reset', { demoMode: false });
  let s = await get('/api/state');
  check('resets to lobby', s.phase === 'lobby' && s.round === 0);
  check('no players after reset', Object.keys(s.players).length === 0);
  check('buy-in is 10s', s.config.timings.buyInMs === 10000, String(s.config.timings.buyInMs));
  check('lobby code present', typeof s.lobbyCode === 'string' && s.lobbyCode.length === 4);
  const code = s.lobbyCode;

  let rejected = false;
  try {
    await post('/api/join', { name: 'X', code });
  } catch (_) {
    rejected = true;
  }
  check('rejects 1-character name', rejected);

  let badCode = false;
  try {
    await post('/api/join', { name: 'Ada', code: 'ZZZZ' === code ? 'YYYY' : 'ZZZZ' });
  } catch (_) {
    badCode = true;
  }
  check('rejects wrong lobby code', badCode);

  const names = ['Ada', 'Bo', 'Cy', 'Dee'];
  const players = [];
  for (const n of names) players.push(await post('/api/join', { name: n, code }));
  check('4 players joined', players.length === 4);

  const rejoin = await post('/api/join', {
    name: 'Ada',
    player_id: players[0].player_id,
  });
  check('rejoin keeps same player_id', rejoin.player_id === players[0].player_id);

  s = await get('/api/state');
  check('roster still 4 after rejoin', Object.keys(s.players).length === 4);

  let startBlocked = false;
  try {
    await post('/api/present/start-round', { round: 9 });
  } catch (_) {
    startBlocked = true;
  }
  check('rejects invalid round number', startBlocked);

  // ---- Round 1 baseline ----
  console.log('\nRound 1 — baseline');
  await post('/api/present/start-round', { round: 1 });
  s = await get('/api/state');
  check('R1 buy-in phase', s.phase === 'buyin');
  check('R1 has no mechanic flags', Object.keys(s.flags).length === 0, JSON.stringify(s.flags));
  check('everyone starts with $100', Object.values(s.players).every((p) => p.cash === 100));
  check('everyone starts flat', Object.values(s.players).every((p) => p.portfolioValue === 100));
  check('R1 exposes price history', !!s.priceHistory);
  check(
    'history does not leak future prices',
    Object.values(s.priceHistory).every((a) => a.length === s.tick + 1),
    'expected ' + (s.tick + 1) + ' points'
  );

  const nvdaPrice = s.prices.NVDA;
  // Buy-in: each player buys 1 NVDA
  for (const p of players) {
    await buy(p.player_id, 'NVDA', 1);
  }
  s = await get('/api/state');
  const expectedCash = Math.round((100 - nvdaPrice) * 100) / 100;
  check(
    'buy-in trade reduces cash by 1 share',
    Math.abs(s.players[players[0].player_id].cash - expectedCash) < 0.02,
    `cash=${s.players[players[0].player_id].cash} expected≈${expectedCash}`
  );
  check(
    'holdings are whole shares',
    s.players[players[0].player_id].holdings.NVDA === 1
  );
  check('buy-in trades excluded from live count', s.liveTradesAvg === 0);

  let overspend = false;
  try {
    await buy(players[0].player_id, 'BOND', 100);
  } catch (_) {
    overspend = true;
  }
  check('rejects buying beyond cash', overspend);

  let oversell = false;
  try {
    await sell(players[0].player_id, 'BOND', 1);
  } catch (_) {
    oversell = true;
  }
  check('rejects selling unheld shares', oversell);

  let fracRejected = false;
  try {
    await post('/api/trade', {
      player_id: players[0].player_id,
      ticker: 'BOND',
      side: 'buy',
      shares: 1.5,
    });
  } catch (_) {
    fracRejected = true;
  }
  check('rejects fractional shares', fracRejected);

  // Go live
  await post('/api/present/next-tick');
  s = await get('/api/state');
  check('enters live phase', s.phase === 'live');

  const r1Prices0 = { ...s.prices };
  check('no prev prices at tick 0', s.prevPrices === null);

  await post('/api/present/next-tick');
  s = await get('/api/state');
  check('tick advances to 1', s.tick === 1);
  check('prices moved on tick', s.prices.NVDA !== r1Prices0.NVDA);
  check('history grew with tick', s.priceHistory.NVDA.length === 2);
  check('prev prices match previous tick', s.prevPrices.NVDA === r1Prices0.NVDA);

  // Ada buys 1 BOND — regression: prev prices must survive
  await buy(players[0].player_id, 'BOND', 1);
  const afterTradeState = await get('/api/state');
  check(
    'prev prices survive a trade',
    afterTradeState.prevPrices.NVDA === r1Prices0.NVDA,
    'tick change would render as 0% otherwise'
  );
  check(
    'integer BOND holding after buy',
    afterTradeState.players[players[0].player_id].holdings.BOND === 1
  );

  // Sell to zero
  await sell(players[0].player_id, 'BOND', 1);
  s = await get('/api/state');
  check('sell-to-zero clears holding', s.players[players[0].player_id].holdings.BOND === 0);

  // live trades after BOND buy+sell: Ada has 2 live so far; add cheap SPCX volume
  // Plan: Ada 2 more SPCX (=4 live total), Bo 2, Cy 1, Dee 1
  const r1Plan = [2, 2, 1, 1];
  for (let i = 0; i < players.length; i++) {
    for (let k = 0; k < r1Plan[i]; k++) {
      await buy(players[i].player_id, 'SPCX', 1);
    }
  }
  s = await get('/api/state');
  check(
    'live trade count per player tracked',
    s.players[players[0].player_id].liveTradesThisRound === 4,
    String(s.players[players[0].player_id].liveTradesThisRound)
  );
  check('avg live trades = 2.0', s.liveTradesAvg === 2, String(s.liveTradesAvg));

  await post('/api/present/end-round');
  s = await get('/api/state');
  check('R1 ends in between phase', s.phase === 'between');
  check('between summary present', !!s.betweenSummary);
  check(
    'summary avg live trades = 2.0',
    Math.abs(s.betweenSummary.averages.liveTradesPerPlayer - 2) < 1e-9
  );

  let tradeAfterEnd = false;
  try {
    await buy(players[0].player_id, 'SPCX', 1);
  } catch (_) {
    tradeAfterEnd = true;
  }
  check('trading closed between rounds', tradeAfterEnd);

  // ---- Round 2 ----
  console.log('\nRound 2 — realTimeAlert');
  await post('/api/present/next-round');
  s = await get('/api/state');
  check('R2 started', s.round === 2 && s.phase === 'buyin');
  check('R2 flag is realTimeAlert only', s.flags.realTimeAlert === true && Object.keys(s.flags).length === 1);
  check('$100 reset carried nothing over', Object.values(s.players).every((p) => p.cash === 100));
  check('holdings cleared between rounds', Object.values(s.players).every((p) => p.holdings.NVDA === 0));
  check('sparklines available in R2', !!s.priceHistory && !!s.priceHistory.NVDA);

  await post('/api/present/next-tick');
  const nvdaSeries = [];
  const spcxSeries = [];
  s = await get('/api/state');
  nvdaSeries.push(s.prices.NVDA);
  spcxSeries.push(s.prices.SPCX);

  for (let t = 1; t <= 3; t++) {
    await post('/api/present/next-tick');
    s = await get('/api/state');
    nvdaSeries.push(s.prices.NVDA);
    spcxSeries.push(s.prices.SPCX);
  }

  let maxGap = 0;
  for (let i = 1; i < nvdaSeries.length; i++) {
    const dn = ((nvdaSeries[i] - nvdaSeries[i - 1]) / nvdaSeries[i - 1]) * 100;
    const ds = ((spcxSeries[i] - spcxSeries[i - 1]) / spcxSeries[i - 1]) * 100;
    maxGap = Math.max(maxGap, Math.abs(dn - ds));
  }
  check('NVDA and SPCX move within 0.2pp', maxGap <= 0.2, `max gap ${maxGap.toFixed(3)}pp`);

  await new Promise((r) => setTimeout(r, 400));
  s = await get('/api/state');
  check('alert log has entries', s.alertLog.length > 0, `${s.alertLog.length} alerts`);
  check('alerts are NVDA only', s.alertLog.every((a) => a.ticker === 'NVDA'));

  for (let i = 0; i < players.length; i++) {
    await buy(players[i].player_id, 'NVDA', 1);
  }
  await buy(players[0].player_id, 'NVDA', 1);
  await post('/api/present/end-round');
  s = await get('/api/state');
  check('R2 specific panel counts NVDA trades', s.betweenSummary.specific.nvdaTrades === 5);
  check('R2 specific panel has SPCX twin count', s.betweenSummary.specific.spcxTrades === 0);

  // ---- Round 3 ----
  console.log('\nRound 3 — trendingTag');
  await post('/api/present/next-round');
  s = await get('/api/state');
  check('R3 flag is trendingTag only', s.flags.trendingTag === true && Object.keys(s.flags).length === 1);
  check('labelled ticker exposed', !!s.labelledTicker);
  const labelled = s.labelledTicker;
  check('sparklines available in R3', !!s.priceHistory);

  await post('/api/present/next-tick');
  for (const p of players) {
    await buy(p.player_id, labelled, 1);
  }
  await post('/api/present/end-round');
  s = await get('/api/state');
  check(
    'labelled share = 100% when all trade it',
    Math.abs(s.betweenSummary.specific.labelledSharePct - 100) < 1e-6,
    String(s.betweenSummary.specific.labelledSharePct)
  );

  // ---- Round 4 ----
  console.log('\nRound 4 — leaderboard');
  await post('/api/present/next-round');
  s = await get('/api/state');
  check('R4 flag is leaderboard only', s.flags.leaderboard === true && Object.keys(s.flags).length === 1);
  check('leaderboard has every player', s.leaderboard.length === 4);
  check('leaderboard ranks are 1..n', s.leaderboard.every((r, i) => r.rank === i + 1));

  await post('/api/present/next-tick');
  for (let k = 0; k < 3; k++) {
    await buy(players[0].player_id, 'SPCX', 1);
  }
  await buy(players[1].player_id, 'BOND', 1);
  s = await get('/api/state');
  check('leaderboard sorted by value', isSortedDesc(s.leaderboard.map((r) => r.portfolioValue)));
  check('Ada holds 3 SPCX', s.players[players[0].player_id].holdings.SPCX === 3);

  await post('/api/present/end-round');

  // ---- Round 5 ----
  console.log('\nRound 5 — thePump');
  await post('/api/present/next-round');
  s = await get('/api/state');
  check('R5 flag is thePump only', s.flags.thePump === true && Object.keys(s.flags).length === 1);
  check('pump state exposed', !!s.pump && s.pump.asset === 'NVDA');
  check('no contract on R5', s.contract == null);
  check('sparklines available in R5', !!s.priceHistory);

  // Flat ticks then spike buys to create peakBuyTick
  await post('/api/present/next-tick'); // buy-in → live tick 0
  // Advance through pre-spike with light volume so peak lands in the spike window
  await post('/api/trade', {
    player_id: players[0].player_id,
    ticker: 'NVDA',
    side: 'buy',
    shares: 1,
    motive: "I think it's undervalued",
  });
  s = await get('/api/state');
  check('NVDA buy deducts cash', s.players[players[0].player_id].cash < 100);
  check('pump points awarded', s.players[players[0].player_id].pumpPoints >= 10);

  for (let i = 0; i < 4; i++) await post('/api/present/next-tick');
  s = await get('/api/state');
  check('reached spike tick 4', s.tick === 4, `tick=${s.tick}`);
  check('push fires at tick 4', s.pump.pushActive === true);

  const priceBeforePileIn = s.prices.NVDA;
  for (const p of players) {
    await post('/api/trade', {
      player_id: p.player_id,
      ticker: 'NVDA',
      side: 'buy',
      shares: 1,
      motive: 'Everyone else is buying',
    });
  }
  await post('/api/present/next-tick');
  s = await get('/api/state');
  check('peak buy tick recorded', s.pump.peakBuyTick != null, String(s.pump.peakBuyTick));
  check(
    'dynamic crash after peak',
    s.prices.NVDA < priceBeforePileIn * 0.7,
    `price=${s.prices.NVDA} before=${priceBeforePileIn} peak=${s.pump.peakBuyTick}`
  );

  let badMotive = false;
  try {
    await post('/api/motivation', { player_id: players[0].player_id, answer: 'nonsense' });
  } catch (_) {
    badMotive = true;
  }
  check('rejects invalid pump motive', badMotive);

  await post('/api/present/end-round');
  s = await get('/api/state');
  check('R5 ends in between (no motivation phase)', s.phase === 'between');
  check('pump between panel has entry timing', !!s.betweenSummary?.specific?.entryTiming);
  check('pump between panel has motives', !!s.betweenSummary?.specific?.motives);

  // ---- Comparison ----
  console.log('\nComparison screen');
  await post('/api/present/comparison');
  s = await get('/api/state');
  check('presenter in comparison phase', s.phase === 'comparison');

  const c = await get('/api/comparison');
  check('comparison n matches players', c.n === 4);
  check('R2 benchmark is FCA 12%', c.round2.value === 12);
  check('R3 benchmark is OSC 14%', c.round3.value === 14);
  check('R2 class value computed', typeof c.round2.classValue === 'number');
  check('R3 lift positive (all traded labelled)', c.round3.classValue > 0, String(c.round3.classValue));
  const verdicts = ['Directionally consistent', 'Inconclusive (n too small)'];
  check('R2 verdict valid', verdicts.includes(c.round2.verdict), c.round2.verdict);
  check('R3 verdict valid', verdicts.includes(c.round3.verdict), c.round3.verdict);
  check('R4 mostActive has trades', c.round4.mostActive?.trades >= 0);
  check('R4 leastActive has return', typeof c.round4.leastActive?.returnPct === 'number');
  check('R4 is directional type', c.round4.type === 'directional');
  check('R5 is descriptive type', c.round5.type === 'descriptive');
  check('R5 source is empty', !c.round5.source);
  check('R5 motive split present', c.round5.motives?.speculation >= 0);
  check('R5 peakBuyTick in comparison', c.round5.peakBuyTick != null || c.round5.buyerCount > 0);
  check('baselines exist for all 5 rounds', [1, 2, 3, 4, 5].every((r) => c.baselines[r]));

  // ---- Recap ----
  console.log('\nPlayer recap');
  const recap = await get(`/api/recap/${players[0].player_id}`);
  check('recap has 5 rounds', recap.rounds.length === 5);
  check('recap is personal (no rank)', recap.rank == null);
  check('recap R1 trade count = 4', recap.rounds[0].liveTrades === 4);
  check('recap has pump line', typeof recap.pumpLine === 'string' && recap.pumpLine.includes('NVDA'));
  check('recap has no classAvg', recap.classAvg == null);

  // ---- Export routes removed ----
  console.log('\nExports removed');
  const csvRes = await fetch(BASE + '/api/export/csv');
  const jsonRes = await fetch(BASE + '/api/export/json');
  check('csv export route gone', csvRes.status === 404);
  check('json export route gone', jsonRes.status === 404);

  // ---- Static assets ----
  console.log('\nStatic routes');
  for (const p of [
    '/',
    '/present',
    '/recap',
    '/css/theme.css',
    '/js/player-app.js',
    '/js/present.js',
    '/js/comparison.js',
    '/js/recap.js',
    '/js/api.js',
    '/js/format.js',
    '/js/charts.js',
    '/js/mechanics/r2-alert.js',
    '/js/mechanics/r3-trending.js',
    '/js/mechanics/r4-leaderboard.js',
    '/js/mechanics/r5-contract.js',
    '/js/mechanics/r5-pump.js',
  ]) {
    const res = await fetch(BASE + p);
    check(`serves ${p}`, res.ok, `status ${res.status}`);
  }
  const qrGone = await fetch(BASE + '/api/qr');
  check('QR endpoint removed', qrGone.status === 404);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

function isSortedDesc(arr) {
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[i - 1] + 1e-9) return false;
  return true;
}

main().catch((e) => {
  console.error('\nE2E crashed:', e.message);
  process.exit(1);
});
