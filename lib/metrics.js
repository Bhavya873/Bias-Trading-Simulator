/**
 * Metrics helpers.
 *
 * Buy-in vs live filtering: only phase === "live" trades count toward
 * frequency, latency, and comparison-screen numerators.
 *
 * Verdict thresholds: "Directionally consistent" requires the class mean
 * to move with the benchmark AND ≥2/3 of individual players to move that
 * way. Bias toward "Inconclusive (n too small)" at small n — do not round
 * in favour of a cleaner story.
 */

'use strict';

const benchmarks = require('../config/benchmarks');
const { ASSETS } = require('../config/rounds');

function liveTrades(trades, roundNum, playerId) {
  return trades.filter(
    (t) =>
      t.round === roundNum &&
      t.phase === 'live' &&
      t.kind !== 'contract' &&
      (!playerId || t.player_id === playerId)
  );
}

function contractTrades(trades, roundNum, playerId) {
  return trades.filter(
    (t) =>
      t.round === roundNum &&
      t.kind === 'contract' &&
      (!playerId || t.player_id === playerId)
  );
}

function portfolioValue(player, prices) {
  let v = player.cash;
  for (const [ticker, shares] of Object.entries(player.holdings || {})) {
    v += (shares || 0) * (prices[ticker] || 0);
  }
  // Contract position marked at current yes/no cents if open
  if (player.contract && player.contract.side && prices.__contractMark != null) {
    v += player.contract.shares * prices.__contractMark;
  }
  return v;
}

function roundReturnPct(finalValue, start = 100) {
  return ((finalValue - start) / start) * 100;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function spcxWeight(player, prices) {
  const total = portfolioValue(player, prices);
  if (total <= 0) return 0;
  const w = ((player.holdings.SPCX || 0) * (prices.SPCX || 0)) / total;
  return w * 100;
}

function meanTradeSizePct(trades, startCash = 100) {
  const live = trades.filter((t) => t.phase === 'live' && t.kind !== 'contract');
  if (!live.length) return 0;
  return mean(live.map((t) => (t.amount / startCash) * 100));
}

/**
 * Round summary averages for between-round presenter table.
 */
function roundAverages(state, roundNum) {
  const players = Object.values(state.players);
  const n = players.length || 1;
  const prices = state.roundResults?.[roundNum]?.finalPrices;
  const finals = state.roundResults?.[roundNum]?.finalValues || {};

  const liveCounts = players.map(
    (p) => liveTrades(state.trades, roundNum, p.id).length
  );
  const returns = players.map((p) => {
    const fv = finals[p.id] != null ? finals[p.id] : 100;
    return roundReturnPct(fv);
  });
  const weights = players.map((p) => {
    const snap = state.roundResults?.[roundNum]?.holdings?.[p.id];
    if (!prices || !snap) return 0;
    const fake = { cash: snap.cash, holdings: snap.holdings, contract: snap.contract };
    return spcxWeight(fake, prices);
  });
  const tradeSize = meanTradeSizePct(
    state.trades.filter((t) => t.round === roundNum)
  );

  return {
    liveTradesPerPlayer: mean(liveCounts),
    spcxWeightPct: mean(weights),
    meanTradeSizePct: tradeSize,
    meanReturnPct: mean(returns),
    n,
  };
}

function labelledShare(trades, roundNum, labelled, playerId) {
  const live = liveTrades(trades, roundNum, playerId);
  if (!live.length) return 0;
  const inLabel = live.filter((t) => t.ticker === labelled).length;
  return (inLabel / live.length) * 100;
}

/**
 * Comparison payload for /api/comparison and the final presenter screen.
 *
 * R2 class metric: % change in live trades/player (R2 vs R1).
 * R3 class metric: labelled live-trade share in R3 minus share in R1 (pp, shown as %).
 * R4: most/least active by live trade count → their return ranks that round.
 * R5: motivation breakdown + contract vs equity volume.
 */
function buildComparison(state) {
  const players = Object.values(state.players);
  const n = players.length;
  const labelled =
    state.config?.round3?.labelledTicker ||
    require('../config/rounds').rounds[3].labelledTicker;

  // --- R2 frequency change ---
  const r1Counts = players.map((p) => liveTrades(state.trades, 1, p.id).length);
  const r2Counts = players.map((p) => liveTrades(state.trades, 2, p.id).length);
  const r1Mean = mean(r1Counts);
  const r2Mean = mean(r2Counts);
  const freqChangePct = r1Mean === 0 ? (r2Mean > 0 ? 100 : 0) : ((r2Mean - r1Mean) / r1Mean) * 100;
  const r2PlayerDirs = players.map((_, i) => {
    if (r1Counts[i] === 0) return r2Counts[i] > 0 ? 1 : 0;
    return r2Counts[i] > r1Counts[i] ? 1 : r2Counts[i] < r1Counts[i] ? -1 : 0;
  });
  const r2Verdict = verdict(freqChangePct, benchmarks.round2.value, r2PlayerDirs, true);

  // NVDA vs SPCX (between-round panel helper)
  const nvdaTrades = liveTrades(state.trades, 2).filter((t) => t.ticker === 'NVDA').length;
  const spcxTrades = liveTrades(state.trades, 2).filter((t) => t.ticker === 'SPCX').length;
  const alertHits = tradesWithinAlert(state, 2, 10);

  // --- R3 labelled share lift ---
  const r1Shares = players.map((p) => labelledShare(state.trades, 1, labelled, p.id));
  const r3Shares = players.map((p) => labelledShare(state.trades, 3, labelled, p.id));
  const shareLift = mean(r3Shares) - mean(r1Shares);
  const r3PlayerDirs = players.map((_, i) =>
    r3Shares[i] > r1Shares[i] ? 1 : r3Shares[i] < r1Shares[i] ? -1 : 0
  );
  const r3Verdict = verdict(shareLift, benchmarks.round3.value, r3PlayerDirs, true);

  // --- R4 activity vs return rank ---
  const r4Counts = players.map((p) => ({
    id: p.id,
    name: p.name,
    trades: liveTrades(state.trades, 4, p.id).length,
    ret: roundReturnPct(state.roundResults?.[4]?.finalValues?.[p.id] ?? 100),
  }));
  const byTrades = [...r4Counts].sort((a, b) => b.trades - a.trades || a.name.localeCompare(b.name));
  const byReturn = [...r4Counts].sort((a, b) => b.ret - a.ret || a.name.localeCompare(b.name));
  const returnRank = (id) => byReturn.findIndex((x) => x.id === id) + 1;
  const mostActive = byTrades[0] || null;
  const leastActive = byTrades[byTrades.length - 1] || null;
  const mostActiveReturnRank = mostActive ? returnRank(mostActive.id) : null;
  const leastActiveReturnRank = leastActive ? returnRank(leastActive.id) : null;
  // Directional: consistent if most-active finishes in bottom half of return ranks
  let r4Verdict = 'Inconclusive (n too small)';
  if (n >= 2 && mostActiveReturnRank != null) {
    const bottomHalf = mostActiveReturnRank > Math.ceil(n / 2);
    const topHalfLeast = leastActiveReturnRank <= Math.ceil(n / 2);
    if (bottomHalf) r4Verdict = 'Directionally consistent';
    else if (mostActiveReturnRank === 1) r4Verdict = 'Directionally inconsistent';
    else r4Verdict = 'Inconclusive (n too small)';
    void topHalfLeast;
  }

  // --- R5 motivation + volumes ---
  const motivations = { view: 0, exciting: 0, didnt: 0, none: 0 };
  for (const p of players) {
    const a = state.motivations?.[p.id];
    if (a === 'I had a view on the outcome') motivations.view++;
    else if (a === 'It seemed exciting') motivations.exciting++;
    else if (a === "I didn't trade it") motivations.didnt++;
    else motivations.none++;
  }
  const equityVol = liveTrades(state.trades, 5).reduce((s, t) => s + (t.amount || 0), 0);
  const contractVol = contractTrades(state.trades, 5).reduce((s, t) => s + (t.amount || 0), 0);

  return {
    n,
    labelledTicker: labelled,
    round2: {
      ...benchmarks.round2,
      classValue: round1(freqChangePct),
      verdict: r2Verdict,
      detail: { nvdaTrades, spcxTrades, alertHits, r1Mean: round1(r1Mean), r2Mean: round1(r2Mean) },
    },
    round3: {
      ...benchmarks.round3,
      classValue: round1(shareLift),
      verdict: r3Verdict,
      detail: {
        r1Share: round1(mean(r1Shares)),
        r3Share: round1(mean(r3Shares)),
      },
    },
    round4: {
      ...benchmarks.round4,
      verdict: r4Verdict,
      mostActiveReturnRank,
      leastActiveReturnRank,
      n,
      detail: { byTrades, byReturn },
    },
    round5: {
      ...benchmarks.round5,
      motivations,
      equityVol: round1(equityVol),
      contractVol: round1(contractVol),
    },
    baselines: {
      1: roundAverages(state, 1),
      2: roundAverages(state, 2),
      3: roundAverages(state, 3),
      4: roundAverages(state, 4),
      5: roundAverages(state, 5),
    },
  };
}

/**
 * @param {number} classValue - observed lift (positive = same direction as study %)
 * @param {number} benchmark - positive expected lift
 * @param {number[]} playerDirs - per player +1 / -1 / 0
 * @param {boolean} expectPositive
 */
function verdict(classValue, benchmark, playerDirs, expectPositive = true) {
  const meanOk = expectPositive ? classValue > 0 : classValue < 0;
  const meanAgainst = expectPositive ? classValue < 0 : classValue > 0;
  const aligned = playerDirs.filter((d) => (expectPositive ? d > 0 : d < 0)).length;
  const twoThirds = playerDirs.length > 0 && aligned / playerDirs.length >= 2 / 3;

  if (meanAgainst) return 'Directionally inconsistent';
  if (meanOk && twoThirds) return 'Directionally consistent';
  return 'Inconclusive (n too small)';
}

function tradesWithinAlert(state, roundNum, seconds) {
  const alerts = state.roundResults?.[roundNum]?.alertLog || [];
  if (!alerts.length) return 0;
  const live = liveTrades(state.trades, roundNum).filter((t) => t.ticker === 'NVDA');
  let count = 0;
  for (const t of live) {
    const hit = alerts.some(
      (a) => Math.abs(t.ts - a.fired_at) <= seconds * 1000
    );
    if (hit) count++;
  }
  return count;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Per-player recap payload */
function buildRecap(state, playerId) {
  const players = Object.values(state.players);
  const totalReturns = players.map((p) => {
    let sum = 0;
    for (let r = 1; r <= 5; r++) {
      sum += roundReturnPct(state.roundResults?.[r]?.finalValues?.[p.id] ?? 100);
    }
    return { id: p.id, name: p.name, total: sum };
  });
  totalReturns.sort((a, b) => b.total - a.total);
  const rank = totalReturns.findIndex((x) => x.id === playerId) + 1;
  const labelled =
    require('../config/rounds').rounds[3].labelledTicker;

  const rounds = [];
  const r1Live = liveTrades(state.trades, 1, playerId).length;
  for (let r = 1; r <= 5; r++) {
    const cfg = require('../config/rounds').rounds[r];
    const live = liveTrades(state.trades, r, playerId).length;
    const ret = roundReturnPct(state.roundResults?.[r]?.finalValues?.[playerId] ?? 100);
    rounds.push({
      round: r,
      concept: cfg.concept,
      returnPct: round1(ret),
      liveTrades: live,
      // null when the Round 1 baseline is zero — a multiple would be meaningless
      vsR1: r1Live === 0 ? null : live / r1Live,
    });
  }

  const callouts = [];
  const r4 = rounds[3];
  if (r4.vsR1 != null && r4.vsR1 >= 1.5) {
    callouts.push(`You traded ${r4.vsR1.toFixed(1)}× more in Round 4 than in Round 1.`);
  }
  const nvda = liveTrades(state.trades, 2, playerId).filter((t) => t.ticker === 'NVDA').length;
  const spcx = liveTrades(state.trades, 2, playerId).filter((t) => t.ticker === 'SPCX').length;
  if (nvda + spcx >= 2 && nvda !== spcx) {
    callouts.push(
      `You made ${nvda} trades in NVDA and ${spcx} in SPCX — they moved identically.`
    );
  }
  const r3Live = liveTrades(state.trades, 3, playerId);
  if (r3Live.length) {
    const share = (r3Live.filter((t) => t.ticker === labelled).length / r3Live.length) * 100;
    if (share >= 40) {
      callouts.push(
        `${Math.round(share)}% of your Round 3 trades were in the trending asset.`
      );
    }
  }
  const cTrades = contractTrades(state.trades, 5, playerId).length;
  const mot = state.motivations?.[playerId] || 'no response';
  if (cTrades > 0 || mot !== 'no response') {
    callouts.push(
      `You traded the Yes/No contract ${cTrades} times and told us: "${mot}".`
    );
  }

  const classAvg = {};
  for (let r = 1; r <= 5; r++) {
    classAvg[r] = roundAverages(state, r);
  }

  return {
    rank,
    n: players.length,
    rounds,
    callouts,
    classAvg,
    motivation: mot,
  };
}

module.exports = {
  liveTrades,
  contractTrades,
  portfolioValue,
  roundReturnPct,
  mean,
  spcxWeight,
  meanTradeSizePct,
  roundAverages,
  buildComparison,
  buildRecap,
  verdict,
  ASSETS,
};
