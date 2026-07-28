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
    else r4Verdict = 'Inconclusive (n too small)';
    void topHalfLeast;
  }

  // --- R5 The Pump ---
  const pumpStats = buildPumpRoundStats(state);

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
      mostActive: mostActive
        ? {
            name: mostActive.name,
            trades: mostActive.trades,
            returnPct: round1(mostActive.ret),
          }
        : null,
      leastActive: leastActive
        ? {
            name: leastActive.name,
            trades: leastActive.trades,
            returnPct: round1(leastActive.ret),
          }
        : null,
      mostActiveReturnRank,
      leastActiveReturnRank,
      n,
      detail: { byTrades, byReturn },
    },
    round5: {
      ...benchmarks.round5,
      ...pumpStats,
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

  // Never surface "Directionally inconsistent" on the presenter — bias to Inconclusive
  if (meanAgainst) return 'Inconclusive (n too small)';
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

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Round 5 The Pump aggregate stats for between-round + comparison screens.
 */
function buildPumpRoundStats(state) {
  const players = Object.values(state.players);
  const n = players.length || 1;
  const buys = state.trades.filter(
    (t) => t.round === 5 && t.ticker === 'NVDA' && t.side === 'buy' && t.kind !== 'contract'
  );

  const buckets = { 'pre-spike': 0, spike: 0, 'post-crash': 0 };
  const motives = {
    undervalued: 0,
    everyone: 0,
    points: 0,
    exciting: 0,
    none: 0,
  };
  const buyerIds = new Set();
  const chaseBuyerIds = new Set();

  for (const t of buys) {
    const bucket = t.timing_bucket || 'pre-spike';
    if (buckets[bucket] != null) buckets[bucket] += 1;
    buyerIds.add(t.player_id);
    if (bucket === 'spike' || bucket === 'post-crash') chaseBuyerIds.add(t.player_id);

    const m = t.motive || state.motivations?.[t.player_id] || 'no response';
    if (m === "I think it's undervalued") motives.undervalued++;
    else if (m === 'Everyone else is buying') motives.everyone++;
    else if (m === 'I want to win points') motives.points++;
    else if (m === "It's exciting, I want in") motives.exciting++;
    else motives.none++;
  }

  const totalBuys = buys.length || 1;
  const spikeBuyPct = round1((buckets.spike / totalBuys) * 100);
  const investing = motives.undervalued;
  const speculation = motives.everyone + motives.points + motives.exciting;
  const motiveTotal = investing + speculation || 1;

  const finals = state.roundResults?.[5]?.finalValues || {};
  const chaseRets = [];
  const otherRets = [];
  for (const p of players) {
    const ret = roundReturnPct(finals[p.id] ?? 100);
    if (chaseBuyerIds.has(p.id)) chaseRets.push(ret);
    else otherRets.push(ret);
  }
  const chaseAvg = chaseRets.length ? mean(chaseRets) : 0;
  const otherAvg = otherRets.length ? mean(otherRets) : 0;

  const r5SpikeBuys = buys.filter((t) => t.timing_bucket === 'spike');
  const r1First = [];
  for (const p of players) {
    const first = liveTrades(state.trades, 1, p.id).sort((a, b) => a.ts - b.ts)[0];
    if (first) r1First.push(first.ts);
  }
  const r1Earliest = r1First.length ? Math.min(...r1First) : null;
  const r1Delays = r1Earliest == null ? [] : r1First.map((ts) => ts - r1Earliest);
  const spikeEarliest = r5SpikeBuys.length
    ? Math.min(...r5SpikeBuys.map((t) => t.ts))
    : null;
  const spikeDelays =
    spikeEarliest == null ? [] : r5SpikeBuys.map((t) => t.ts - spikeEarliest);

  const socialExcitementBuys = buys.filter((t) => {
    const m = t.motive || '';
    return (
      m === 'Everyone else is buying' ||
      m === 'I want to win points' ||
      m === "It's exciting, I want in"
    );
  });
  const atTopPct = round1((socialExcitementBuys.length / totalBuys) * 100);

  return {
    entryTiming: {
      preSpikePct: round1((buckets['pre-spike'] / totalBuys) * 100),
      spikePct: spikeBuyPct,
      postCrashPct: round1((buckets['post-crash'] / totalBuys) * 100),
      counts: buckets,
    },
    motives: {
      investing,
      speculation,
      investingPct: round1((investing / motiveTotal) * 100),
      speculationPct: round1((speculation / motiveTotal) * 100),
      breakdown: motives,
    },
    costOfChasing: {
      chaseAvgReturn: round1(chaseAvg),
      otherAvgReturn: round1(otherAvg),
      chaseN: chaseBuyerIds.size,
      otherN: Math.max(0, n - chaseBuyerIds.size),
    },
    deliberation: {
      medianSpikeBuyMs: median(spikeDelays),
      medianR1FirstTradeMs: median(r1Delays),
    },
    atTopSocialPct: atTopPct,
    atTopAvgReturn: round1(chaseAvg),
    peakBuyTick: state.roundResults?.[5]?.pump?.peakBuyTick ?? null,
    buyVolumeByTick: state.roundResults?.[5]?.pump?.buyVolumeByTick ?? null,
    buyerCount: buyerIds.size,
    spikeBuyPct,
  };
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
    const bucket = first.timing_bucket || 'pre-spike';
    const label =
      bucket === 'pre-spike'
        ? 'pre-spike'
        : bucket === 'spike'
          ? 'during the spike'
          : 'after the crash';
    const motive = first.motive || state.motivations?.[playerId] || 'no response';
    const nvdaRet = roundsOut[4].returnPct;
    pumpLine = `You bought NVDA ${label} and said it was because "${motive}". Your return this round: ${nvdaRet}%.`;
  }

  return {
    rounds: roundsOut,
    pumpLine,
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
  buildPumpRoundStats,
  verdict,
  ASSETS,
};
