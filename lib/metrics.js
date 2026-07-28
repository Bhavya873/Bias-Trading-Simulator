/**
 * Metrics helpers.
 *
 * Buy-in vs live filtering: only phase === "live" trades count toward
 * frequency and comparison-screen numerators.
 *
 * Verdict thresholds (unit-tested, not shown on presenter): "Directionally
 * consistent" requires the class mean to move with a benchmark AND ≥2/3 of
 * individual players to move that way. Bias toward "Inconclusive (n too small)".
 */

'use strict';

const { rounds } = require('../config/rounds');

function liveTrades(trades, roundNum, playerId) {
  return trades.filter(
    (t) =>
      t.round === roundNum &&
      t.phase === 'live' &&
      (!playerId || t.player_id === playerId)
  );
}

function portfolioValue(player, prices) {
  let v = player.cash;
  for (const [ticker, shares] of Object.entries(player.holdings || {})) {
    v += (shares || 0) * (prices[ticker] || 0);
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
  const live = trades.filter((t) => t.phase === 'live');
  if (!live.length) return 0;
  return mean(live.map((t) => (t.amount / startCash) * 100));
}

/** Round summary averages for between-round presenter table. */
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
    const fake = { cash: snap.cash, holdings: snap.holdings };
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

function meanLiveTradesPerPlayer(state, roundNum) {
  const players = Object.values(state.players);
  if (!players.length) return 0;
  return mean(players.map((p) => liveTrades(state.trades, roundNum, p.id).length));
}

function meanLabelledShare(state, roundNum, labelled) {
  const players = Object.values(state.players);
  if (!players.length) return 0;
  return mean(players.map((p) => labelledShare(state.trades, roundNum, labelled, p.id)));
}

function tickerLiveShare(state, roundNum, ticker) {
  const live = liveTrades(state.trades, roundNum);
  if (!live.length) return 0;
  return (live.filter((t) => t.ticker === ticker).length / live.length) * 100;
}

/**
 * Comparison payload for /api/comparison and the final presenter screen.
 * Absolute baseline (R1) vs each gamified round — no study benchmarks.
 */
function buildComparison(state) {
  const n = Object.keys(state.players).length;
  const labelled = rounds[3].labelledTicker;
  const r1Trades = round1(meanLiveTradesPerPlayer(state, 1));
  const r1LabelShare = round1(meanLabelledShare(state, 1, labelled));
  const r1NvdaShare = round1(tickerLiveShare(state, 1, 'NVDA'));

  return {
    n,
    labelledTicker: labelled,
    rounds: [
      {
        round: 2,
        title: 'Price alerts',
        unit: '',
        metric: 'live trades / player',
        baseline: r1Trades,
        value: round1(meanLiveTradesPerPlayer(state, 2)),
      },
      {
        round: 3,
        title: 'Trending tag',
        unit: '%',
        metric: `${labelled} share of live trades`,
        baseline: r1LabelShare,
        value: round1(meanLabelledShare(state, 3, labelled)),
      },
      {
        round: 4,
        title: 'Leaderboard',
        unit: '',
        metric: 'live trades / player',
        baseline: r1Trades,
        value: round1(meanLiveTradesPerPlayer(state, 4)),
      },
      {
        round: 5,
        title: 'Hot asset + rankings',
        unit: '%',
        metric: 'NVDA share of live trades',
        baseline: r1NvdaShare,
        value: round1(tickerLiveShare(state, 5, 'NVDA')),
      },
    ],
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

  if (meanAgainst) return 'Inconclusive (n too small)';
  if (meanOk && twoThirds) return 'Directionally consistent';
  return 'Inconclusive (n too small)';
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Round 5 aggregates: NVDA live-trade share + buyer vs non-buyer returns. */
function buildR5RoundStats(state) {
  const labelled = 'NVDA';
  const live = liveTrades(state.trades, 5);
  const labelledSharePct = live.length
    ? round1((live.filter((t) => t.ticker === labelled).length / live.length) * 100)
    : 0;

  const buys = state.trades.filter(
    (t) => t.round === 5 && t.ticker === 'NVDA' && t.side === 'buy'
  );
  const buyerIds = new Set(buys.map((t) => t.player_id));
  const finals = state.roundResults?.[5]?.finalValues || {};
  const buyerRets = [];
  const otherRets = [];
  for (const p of Object.values(state.players)) {
    const ret = roundReturnPct(finals[p.id] ?? 100);
    if (buyerIds.has(p.id)) buyerRets.push(ret);
    else otherRets.push(ret);
  }

  return {
    labelledTicker: labelled,
    labelledSharePct,
    nvdaBuyerAvgReturn: round1(buyerRets.length ? mean(buyerRets) : 0),
    otherAvgReturn: round1(otherRets.length ? mean(otherRets) : 0),
    buyerCount: buyerIds.size,
  };
}

function timingBucketFromTick(tick) {
  if (tick <= 3) return 'pre-spike';
  if (tick <= 6) return 'spike';
  return 'post-crash';
}

/** Per-player recap payload — personal stats only */
function buildRecap(state, playerId) {
  const roundsOut = [];
  for (let r = 1; r <= 5; r++) {
    const live = liveTrades(state.trades, r, playerId).length;
    const ret = roundReturnPct(state.roundResults?.[r]?.finalValues?.[playerId] ?? 100);
    roundsOut.push({
      round: r,
      returnPct: round1(ret),
      liveTrades: live,
    });
  }

  let pumpLine = null;
  const nvdaBuys = state.trades.filter(
    (t) =>
      t.player_id === playerId &&
      t.round === 5 &&
      t.ticker === 'NVDA' &&
      t.side === 'buy'
  );
  if (nvdaBuys.length) {
    const first = nvdaBuys[0];
    const bucket = first.timing_bucket || timingBucketFromTick(first.tick ?? 0);
    const label =
      bucket === 'pre-spike'
        ? 'before the spike'
        : bucket === 'spike'
          ? 'during the spike'
          : 'after the crash';
    const nvdaRet = roundsOut[4].returnPct;
    pumpLine = `You bought NVDA ${label}. Your return this round: ${nvdaRet}%.`;
  }

  return {
    rounds: roundsOut,
    pumpLine,
  };
}

module.exports = {
  liveTrades,
  portfolioValue,
  roundReturnPct,
  mean,
  spcxWeight,
  meanTradeSizePct,
  roundAverages,
  buildComparison,
  buildRecap,
  buildR5RoundStats,
  verdict,
};
