/**
 * Single source of truth for prices, timings, and per-round flags.
 * Exactly one mechanic flag per round (Round 1 has none).
 *
 * Tickers & price character (with $100 starting cash):
 *   BOND  — safe: high unit price (~$55), tiny ±0.1–0.3%/tick moves
 *   NVDA  — medium: mid price (~$32), ±1–2%/tick
 *   SPCX  — risky: cheap (~$8–9), ±2.5–4%/tick swings
 * Each price array: 11 values (tick 0 … tick 10).
 */

'use strict';

const ASSETS = ['BOND', 'NVDA', 'SPCX'];

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

/** Ultra-calm bond drift — looks like a stable fund unit, not a stock. */
const bondMoves = [0.2, -0.1, 0.25, -0.08, 0.18, 0.15, -0.12, 0.2, -0.08, 0.15];

/**
 * Round 1 — baseline
 * BOND calm/high, NVDA medium, SPCX cheap & jumpy. No mechanic flags.
 */
const round1 = {
  concept: 'Deliberate decisions',
  flags: {},
  prices: {
    BOND: pathFromReturns(55.0, bondMoves),
    NVDA: pathFromReturns(32.0, [1.6, -1.1, 1.5, -1.0, 1.2, -0.8, 1.1, 0.7, -0.7, 0.9]),
    SPCX: pathFromReturns(8.5, [3.2, -2.6, 2.9, -2.4, 2.6, -2.1, 2.3, -1.9, 1.6, -1.2]),
  },
};

/**
 * Round 2 — real-time alerts
 * HARD REQUIREMENT: NVDA and SPCX move by identical % each tick (within 0.2pp).
 * Alert + flash fire for NVDA only; SPCX is the silent twin. BOND stays calm.
 */
const matchedMoves = [2.8, -2.2, 2.5, -2.0, 1.5, -1.8, 2.2, -1.6, 1.6, -1.4];

const round2 = {
  concept: 'Real-time information',
  flags: { realTimeAlert: true },
  prices: {
    BOND: pathFromReturns(55.0, [0.18, -0.1, 0.22, -0.08, 0.16, 0.12, -0.1, 0.18, -0.08, 0.14]),
    NVDA: pathFromReturns(32.0, matchedMoves),
    SPCX: pathFromReturns(8.5, matchedMoves),
  },
};

/**
 * Round 3 — trending tag
 * labelledTicker (SPCX) finishes below BOND and NVDA so herding is costly.
 */
const round3 = {
  concept: 'What everyone else is doing',
  flags: { trendingTag: true },
  labelledTicker: 'SPCX',
  prices: {
    BOND: pathFromReturns(55.0, [0.22, -0.1, 0.28, -0.08, 0.2, 0.18, -0.1, 0.22, -0.08, 0.18]),
    NVDA: pathFromReturns(32.0, [1.8, -0.7, 1.6, -0.6, 1.4, -0.5, 1.3, 0.8, 1.0, 0.7]),
    // Labelled: still volatile but ends down — costly herding
    SPCX: pathFromReturns(8.5, [2.2, -2.6, 2.0, -2.5, 2.1, -2.6, 1.8, -2.4, 1.6, -2.2]),
  },
};

/**
 * Round 4 — leaderboard
 * Matched basket difficulty; ranking is the mechanic.
 */
const round4 = {
  concept: 'Social ranking',
  flags: { leaderboard: true },
  prices: {
    BOND: pathFromReturns(55.0, [0.18, -0.12, 0.22, -0.1, 0.18, 0.12, -0.12, 0.16, -0.08, 0.16]),
    NVDA: pathFromReturns(32.0, [1.7, -1.2, 1.5, -1.0, 1.1, 1.2, -0.8, 0.9, -0.7, 1.0]),
    SPCX: pathFromReturns(8.5, [3.0, -2.5, 2.7, -2.3, 2.4, -2.0, 2.1, -1.8, 1.5, -1.1]),
  },
};

/**
 * Round 5 — Hot asset + rankings
 * NVDA gets a fixed pump-and-dump path plus Round 3 trending + Round 4 leaderboard.
 * Path is extreme by design; exempt from cross-round vol matching.
 */
const round5 = {
  concept: 'Hot asset + rankings',
  flags: { trendingTag: true, leaderboard: true },
  labelledTicker: 'NVDA',
  prices: {
    BOND: pathFromReturns(55.0, [0.15, -0.1, 0.2, -0.08, 0.16, 0.12, -0.1, 0.16, -0.08, 0.14]),
    // Flat 0–3, spike 4–6, crash 7–10
    NVDA: [32.0, 32.2, 32.1, 32.4, 46.0, 58.0, 67.0, 38.0, 29.5, 26.0, 25.5],
    SPCX: pathFromReturns(8.5, [2.8, -2.4, 2.5, -2.2, 2.3, -2.0, 2.0, -1.7, 1.4, -1.0]),
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

function roundProfile(roundNum, excludeTickers = []) {
  const prices = rounds[roundNum].prices;
  const assets = ASSETS.filter((t) => !excludeTickers.includes(t));
  const rets = assets.map((t) => totalReturnPct(prices[t]));
  const vols = assets.map((t) => meanAbsMovePct(prices[t]));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { meanReturn: avg(rets), meanVol: avg(vols) };
}

/**
 * Boot-time validation. Fails loudly before class rather than mid-demo:
 *  - R2 NVDA/SPCX matched movers within 0.2pp
 *  - R3 labelled ticker below both unlabelled assets
 *  - Rounds 1–4 structurally matched on return and volatility
 *  - Round 5 NVDA is exempt (deliberate pump-and-dump extremes)
 */
function validatePaths() {
  const errors = [];

  // R2: NVDA vs SPCX percent deltas within 0.2pp
  const nvda = round2.prices.NVDA;
  const twin = round2.prices.SPCX;
  for (let i = 1; i < nvda.length; i++) {
    const dn = ((nvda[i] - nvda[i - 1]) / nvda[i - 1]) * 100;
    const dt = ((twin[i] - twin[i - 1]) / twin[i - 1]) * 100;
    if (Math.abs(dn - dt) > 0.2) {
      errors.push(
        `R2 tick ${i}: NVDA ${dn.toFixed(3)}% vs SPCX ${dt.toFixed(3)}% (Δ>${0.2}pp)`
      );
    }
  }

  // R3: labelled finishes below both unlabelled peers
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

  // Rounds 1–4 matched — Round 5 NVDA is extreme by design and excluded
  const profiles = [1, 2, 3, 4].map((n) => ({ n, ...roundProfile(n) }));
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

  if (!round5.flags?.trendingTag || !round5.flags?.leaderboard) {
    errors.push('Round 5 must set both trendingTag and leaderboard flags');
  }
  if (round5.labelledTicker !== 'NVDA') {
    errors.push('Round 5 labelledTicker must be NVDA');
  }
  if (!Array.isArray(round5.prices.NVDA) || round5.prices.NVDA.length !== 11) {
    errors.push('Round 5 NVDA path must have 11 prices');
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
