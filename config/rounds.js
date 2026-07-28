/**
 * Single source of truth for prices, timings, and per-round flags.
 * Exactly one mechanic flag per round (Round 1 has none).
 *
 * Tickers: GOOG, MSFT, NVDA, MU, SPCX
 * Each price array: 11 values (tick 0 … tick 10). Tick-0 in $10–$40.
 */

'use strict';

const ASSETS = ['GOOG', 'MSFT', 'NVDA', 'MU', 'SPCX'];

const timings = {
  buyInMs: 10000,
  tickMs: 5000,
  tickCount: 10,
};

/**
 * Helper: build a path from tick-0 price and successive % returns.
 * returnsPct has length 10 (moves into ticks 1..10).
 */
function pathFromReturns(p0, returnsPct) {
  const prices = [r2(p0)];
  let p = p0;
  for (const r of returnsPct) {
    p = p * (1 + r / 100);
    prices.push(r2(p));
  }
  return prices;
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Round 1 — Deliberate decisions (baseline)
 * Intended: moderate vol ~1–3%/tick, basket total return roughly flat-to-mild +.
 * No mechanic flags. Full history chart available on client.
 */
const round1 = {
  concept: 'Deliberate decisions',
  flags: {},
  prices: {
    // ~+4.2% over round, mild zig-zag
    GOOG: pathFromReturns(28.0, [1.2, -0.8, 1.5, -1.0, 0.9, 1.1, -0.6, 0.7, -0.5, 0.8]),
    MSFT: pathFromReturns(32.0, [0.8, 1.0, -1.2, 0.6, 1.3, -0.9, 0.5, 1.0, -0.4, 0.7]),
    NVDA: pathFromReturns(22.0, [2.0, -1.5, 1.8, -1.2, 1.0, 1.4, -0.8, 0.9, -1.0, 1.2]),
    MU: pathFromReturns(18.0, [1.5, -1.0, 0.8, 1.2, -1.4, 0.7, 1.1, -0.9, 0.6, 0.5]),
    // Speculative name, mild path for baseline weight tracking
    SPCX: pathFromReturns(14.0, [2.5, -2.0, 1.5, -1.8, 2.0, -1.5, 1.2, -1.0, 0.8, -0.5]),
  },
};

/**
 * Round 2 — Availability heuristic / real-time alerts
 * Intended: matched vol & similar basket return to R1.
 * HARD REQUIREMENT: NVDA and MU move by identical % each tick (within 0.2pp).
 * Alert + flash fire for NVDA only; MU is the silent twin.
 */
const matchedMoves = [2.1, -1.4, 1.8, -1.1, 0.9, 1.5, -0.8, 1.0, -1.2, 0.7];

const round2 = {
  concept: 'Real-time information',
  flags: { realTimeAlert: true },
  prices: {
    GOOG: pathFromReturns(28.0, [1.0, -0.7, 1.3, -0.9, 0.8, 1.0, -0.5, 0.6, -0.4, 0.7]),
    MSFT: pathFromReturns(32.0, [0.7, 0.9, -1.0, 0.5, 1.2, -0.8, 0.4, 0.9, -0.3, 0.6]),
    // Identical % path — salience test depends on this
    NVDA: pathFromReturns(22.0, matchedMoves),
    MU: pathFromReturns(18.0, matchedMoves),
    SPCX: pathFromReturns(14.0, [2.2, -1.8, 1.4, -1.6, 1.8, -1.3, 1.0, -0.9, 0.7, -0.4]),
  },
};

/**
 * Round 3 — Herd mentality / trending tag
 * Intended: mean return +2.8%, mean absolute tick move 1.09pp (matched to R1/R2/R4/R5).
 * labelledTicker (MSFT) finishes negative and below every unlabelled asset,
 * so following the crowd is measurably costly. Tag is config-static.
 */
const round3 = {
  concept: 'What everyone else is doing',
  flags: { trendingTag: true },
  labelledTicker: 'MSFT', // boring name; underperformance is in the path, not the ticker
  prices: {
    GOOG: pathFromReturns(28.0, [1.5, -0.7, 1.6, -0.8, 1.4, -0.6, 1.3, -0.5, 1.2, 0.9]), // +5.4%
    // Labelled: swings as much as the others but ends down — costly herding
    MSFT: pathFromReturns(32.0, [1.2, -1.5, 1.1, -1.4, 1.3, -1.5, 1.0, -1.3, 0.9, -1.0]), // -1.3%
    NVDA: pathFromReturns(22.0, [1.9, -0.8, 1.7, -0.7, 1.5, -0.6, 1.4, 0.7, 1.1, 0.7]), // +7.1%
    MU: pathFromReturns(18.0, [1.1, -1.0, 1.0, -0.9, 1.2, -1.1, 0.9, -0.8, 0.8, 0.2]), // +1.4%
    SPCX: pathFromReturns(14.0, [1.6, -1.3, 1.4, -1.2, 1.5, -1.3, 1.1, -1.0, 0.9, -0.3]), // +1.4%
  },
};

/**
 * Round 4 — Overconfidence / leaderboard
 * Intended: matched vol & return profile. No price special-casing — ranking is the mechanic.
 */
const round4 = {
  concept: 'Social ranking',
  flags: { leaderboard: true },
  prices: {
    GOOG: pathFromReturns(28.0, [1.1, -0.9, 1.4, -0.8, 0.7, 1.2, -0.6, 0.8, -0.5, 0.6]),
    MSFT: pathFromReturns(32.0, [0.9, 0.7, -1.1, 0.8, 1.0, -0.7, 0.6, 0.9, -0.5, 0.5]),
    NVDA: pathFromReturns(22.0, [1.9, -1.3, 1.6, -1.0, 1.1, 1.3, -0.9, 0.8, -0.7, 1.0]),
    MU: pathFromReturns(18.0, [1.3, -0.9, 0.7, 1.0, -1.2, 0.8, 0.9, -0.8, 0.5, 0.6]),
    SPCX: pathFromReturns(14.0, [2.3, -1.9, 1.3, -1.5, 1.7, -1.4, 1.1, -0.8, 0.6, -0.4]),
  },
};

/**
 * Round 5 — Investing vs speculation vs gambling / prediction contract
 * Intended: matched equity vol. targetTicker odds path drives contract cents.
 * Contract settles 100 or 0 on final tick based on whether target closed up vs tick 0.
 */
const round5 = {
  concept: 'Odds and payouts',
  flags: { predictionContract: true },
  targetTicker: 'NVDA',
  /**
   * Per-tick implied P(up) for the next move, used as YES price in cents (0–100).
   * Index 0 unused during buy-in; indices 1..10 map to live ticks.
   * Length 11 to align with tick indices.
   */
  oddsYesCents: [55, 62, 48, 70, 40, 65, 35, 58, 45, 72, 50],
  prices: {
    GOOG: pathFromReturns(28.0, [1.0, -0.8, 1.2, -0.7, 0.9, 0.8, -0.5, 0.7, -0.4, 0.5]),
    MSFT: pathFromReturns(32.0, [0.8, 0.6, -1.0, 0.7, 1.1, -0.6, 0.5, 0.8, -0.4, 0.4]),
    // Closes up vs tick 0 so YES settles at 100 in the default path
    NVDA: pathFromReturns(22.0, [1.5, -1.8, 2.2, -1.5, 1.8, -2.0, 2.5, -1.2, 1.0, 0.8]),
    MU: pathFromReturns(18.0, [1.2, -1.0, 0.9, 0.8, -1.1, 0.7, 1.0, -0.7, 0.4, 0.5]),
    SPCX: pathFromReturns(14.0, [2.0, -1.7, 1.2, -1.4, 1.6, -1.2, 0.9, -0.7, 0.5, -0.3]),
  },
};

const rounds = [null, round1, round2, round3, round4, round5];

function totalReturnPct(path) {
  return ((path[path.length - 1] - path[0]) / path[0]) * 100;
}

/** Mean absolute tick-over-tick move, used as the volatility proxy. */
function meanAbsMovePct(path) {
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    sum += Math.abs(((path[i] - path[i - 1]) / path[i - 1]) * 100);
  }
  return sum / (path.length - 1);
}

function roundProfile(roundNum) {
  const prices = rounds[roundNum].prices;
  const rets = ASSETS.map((t) => totalReturnPct(prices[t]));
  const vols = ASSETS.map((t) => meanAbsMovePct(prices[t]));
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { meanReturn: avg(rets), meanVol: avg(vols) };
}

/**
 * Boot-time validation. Fails loudly before class rather than mid-demo:
 *  - R2 NVDA/MU matched movers within 0.2pp
 *  - R3 labelled ticker below at least two unlabelled assets
 *  - all rounds structurally matched on return and volatility
 */
function validatePaths() {
  const errors = [];

  // R2: NVDA vs MU percent deltas within 0.2pp
  const nvda = round2.prices.NVDA;
  const mu = round2.prices.MU;
  for (let i = 1; i < nvda.length; i++) {
    const dn = ((nvda[i] - nvda[i - 1]) / nvda[i - 1]) * 100;
    const dm = ((mu[i] - mu[i - 1]) / mu[i - 1]) * 100;
    if (Math.abs(dn - dm) > 0.2) {
      errors.push(
        `R2 tick ${i}: NVDA ${dn.toFixed(3)}% vs MU ${dm.toFixed(3)}% (Δ>${0.2}pp)`
      );
    }
  }

  // R3: labelled finishes below at least 2 unlabelled
  const labelled = round3.labelledTicker;
  const returns = {};
  for (const t of ASSETS) {
    const p = round3.prices[t];
    returns[t] = (p[p.length - 1] - p[0]) / p[0];
  }
  const labelledRet = returns[labelled];
  const better = ASSETS.filter((t) => t !== labelled && returns[t] > labelledRet);
  if (better.length < 2) {
    errors.push(
      `R3 labelled ${labelled} return ${(labelledRet * 100).toFixed(2)}% is not below ≥2 assets`
    );
  }

  // All rounds structurally matched — comparisons vs Round 1 are only fair
  // if the market itself is roughly the same difficulty each round.
  const profiles = [1, 2, 3, 4, 5].map((n) => ({ n, ...roundProfile(n) }));
  const roundReturns = profiles.map((p) => p.meanReturn);
  const vols = profiles.map((p) => p.meanVol);
  const spread = (a) => Math.max(...a) - Math.min(...a);

  if (spread(roundReturns) > 1.5) {
    errors.push(
      `Round mean returns not matched (spread ${spread(roundReturns).toFixed(2)}pp > 1.5pp): ` +
        profiles.map((p) => `R${p.n} ${p.meanReturn.toFixed(2)}%`).join(', ')
    );
  }
  if (spread(vols) > 0.35) {
    errors.push(
      `Round volatility not matched (spread ${spread(vols).toFixed(2)}pp > 0.35pp): ` +
        profiles.map((p) => `R${p.n} ${p.meanVol.toFixed(2)}pp`).join(', ')
    );
  }

  // R5 contract must be able to settle — target needs a defined direction
  const t5 = rounds[5].prices[rounds[5].targetTicker];
  if (t5[t5.length - 1] === t5[0]) {
    errors.push(`R5 target ${rounds[5].targetTicker} closes exactly flat — contract cannot settle`);
  }

  if (errors.length) {
    throw new Error('Price path validation failed:\n' + errors.join('\n'));
  }
}

module.exports = {
  ASSETS,
  timings,
  rounds,
  validatePaths,
};
