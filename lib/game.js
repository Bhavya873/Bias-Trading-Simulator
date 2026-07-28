/**
 * In-memory game state machine.
 *
 * $100 reset: on startRound(n) every player gets cash:100, holdings:{},
 * contract cleared — nothing carries between rounds.
 *
 * Buy-in trades tagged phase:"buyin" (excluded from frequency metrics).
 * Live trades tagged phase:"live" (counted).
 */

'use strict';

const { randomUUID } = require('crypto');
const roundsConfig = require('../config/rounds');
const { writeSnapshot } = require('./snapshot');
const {
  portfolioValue,
  roundAverages,
  buildComparison,
  buildRecap,
  liveTrades,
  buildPumpRoundStats,
} = require('./metrics');

const { ASSETS, timings, rounds, validatePaths } = roundsConfig;

validatePaths();

function emptyHoldings() {
  const h = {};
  for (const t of ASSETS) h[t] = 0;
  return h;
}

/** Short join code — avoids ambiguous 0/O/1/I */
function generateLobbyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function createGame(broadcast) {
  const state = {
    phase: 'lobby', // lobby | buyin | live | motivation | between | comparison
    round: 0,
    tick: 0,
    buyInEndsAt: null,
    tickEndsAt: null,
    players: {},
    trades: [],
    motivations: {},
    alertLog: [], // current round
    pendingAlert: null,
    roundResults: {},
    leaderboard: [],
    lanUrl: '',
    lobbyCode: generateLobbyCode(),
    demoMode: false,
    config: {
      timings,
      assets: ASSETS,
      rounds: rounds.map((r, i) =>
        i === 0
          ? null
          : {
              concept: r.concept,
              flags: r.flags,
              labelledTicker: r.labelledTicker || null,
              pumpAsset: r.pumpAsset || null,
              crowdFloor: r.crowdFloor ?? null,
            }
      ),
    },
  };

  /** Round 5 The Pump runtime (null outside R5) */
  let pump = null;

  let buyInTimer = null;
  let tickTimer = null;
  let alertTimer = null;

  function clearTimers() {
    if (buyInTimer) clearTimeout(buyInTimer);
    if (tickTimer) clearTimeout(tickTimer);
    if (alertTimer) clearTimeout(alertTimer);
    buyInTimer = tickTimer = alertTimer = null;
  }

  function initPump() {
    const base = rounds[5].prices.NVDA.slice();
    pump = {
      buyVolumeByTick: Array(timings.tickCount + 1).fill(0),
      peakBuyTick: null,
      nvdaPath: base,
      buyersThisTick: new Set(),
      points: {},
      streak: {},
      risingStreakTicks: {},
      pushFired: false,
      displayCrowdPct: null,
    };
    for (const id of Object.keys(state.players)) {
      pump.points[id] = 0;
      pump.streak[id] = 0;
    }
  }

  function pumpAsset() {
    return rounds[5]?.pumpAsset || 'NVDA';
  }

  function timingBucket(tick) {
    if (tick <= 3) return 'pre-spike';
    if (tick <= 6) return 'spike';
    return 'post-crash';
  }

  function effectivePath(ticker) {
    if (state.round === 5 && pump && ticker === pumpAsset()) return pump.nvdaPath;
    return rounds[state.round].prices[ticker];
  }

  function currentPrices() {
    if (state.round < 1 || state.round > 5) {
      const p = {};
      for (const t of ASSETS) p[t] = 0;
      return p;
    }
    const idx = Math.min(Math.max(state.tick, 0), timings.tickCount);
    const out = {};
    for (const t of ASSETS) out[t] = effectivePath(t)[idx];
    return out;
  }

  /**
   * Prices at the previous tick, so clients can render the tick-over-tick
   * change without tracking it locally (local tracking breaks on re-render).
   */
  function previousPrices() {
    if (state.round < 1 || state.round > 5) return null;
    if (state.tick < 1) return null;
    const idx = Math.min(state.tick, timings.tickCount) - 1;
    const out = {};
    for (const t of ASSETS) out[t] = effectivePath(t)[idx];
    return out;
  }

  function markPricesForPlayer(player) {
    return currentPrices();
  }

  function playerPublic(p) {
    const prices = markPricesForPlayer(p);
    const value = portfolioValue(p, prices);
    return {
      id: p.id,
      name: p.name,
      cash: round2(p.cash),
      holdings: { ...p.holdings },
      contract: null,
      portfolioValue: round2(value),
      returnPct: round2(((value - 100) / 100) * 100),
      liveTradesThisRound:
        state.round >= 1 ? liveTrades(state.trades, state.round, p.id).length : 0,
      pumpPoints: pump?.points?.[p.id] || 0,
      pumpStreak: pump?.streak?.[p.id] || 0,
    };
  }

  function rebuildLeaderboard() {
    const list = Object.values(state.players).map(playerPublic);
    list.sort((a, b) => b.portfolioValue - a.portfolioValue || a.name.localeCompare(b.name));
    state.leaderboard = list.map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      returnPct: p.returnPct,
      portfolioValue: p.portfolioValue,
    }));
  }

  function crowdPctDisplay() {
    if (!pump || state.round !== 5) return null;
    const n = Object.keys(state.players).length || 1;
    const real = pump.buyersThisTick.size / n;
    const floor = rounds[5].crowdFloor ?? 0.8;
    if (real >= floor) return round2(real * 100);
    // Config-driven 80–90% band when real FOMO is low
    const band = floor * 100 + (state.tick % 11);
    return Math.min(90, Math.max(80, Math.round(band)));
  }

  function finalizePumpTick(tickJustEnded) {
    if (state.round !== 5 || !pump) return;
    if (tickJustEnded < 0) return;
    const vols = pump.buyVolumeByTick;
    const v = vols[tickJustEnded] || 0;
    let maxPrior = 0;
    for (let i = 0; i < tickJustEnded; i++) maxPrior = Math.max(maxPrior, vols[i] || 0);
    // New volume high → move peak (and re-anchor the crash right after it)
    if (v > maxPrior && v > 0) {
      pump.peakBuyTick = tickJustEnded;
      // Restore fallback path then apply crash so earlier overrides don't stick
      const base = rounds[5].prices.NVDA.slice();
      pump.nvdaPath = base;
      const peakPrice = pump.nvdaPath[tickJustEnded];
      const t1 = tickJustEnded + 1;
      const t2 = tickJustEnded + 2;
      if (t1 <= timings.tickCount) pump.nvdaPath[t1] = round2(peakPrice * 0.6);
      if (t2 <= timings.tickCount) pump.nvdaPath[t2] = round2(peakPrice * 0.6 * 0.85);
    }
    // Streak: consecutive rising ticks while holding NVDA
    if (tickJustEnded >= 1) {
      const path = pump.nvdaPath;
      const rose = path[tickJustEnded] > path[tickJustEnded - 1];
      const asset = pumpAsset();
      for (const p of Object.values(state.players)) {
        const held = (p.holdings[asset] || 0) > 0;
        if (held && rose) pump.streak[p.id] = (pump.streak[p.id] || 0) + 1;
        else pump.streak[p.id] = 0;
      }
    }
    pump.buyersThisTick = new Set();
  }

  function publicState() {
    const prices = currentPrices();
    const players = {};
    for (const p of Object.values(state.players)) {
      players[p.id] = playerPublic(p);
    }
    const cfg = state.round >= 1 && state.round <= 5 ? rounds[state.round] : null;
    const historyPaths = cfg
      ? Object.fromEntries(
          ASSETS.map((t) => {
            const path = effectivePath(t);
            return [t, path.slice(0, state.tick + 1)];
          })
        )
      : null;
    return {
      phase: state.phase,
      round: state.round,
      tick: state.tick,
      tickCount: timings.tickCount,
      buyInEndsAt: state.buyInEndsAt,
      tickEndsAt: state.tickEndsAt,
      prices,
      prevPrices: previousPrices(),
      priceHistory: historyPaths,
      contract: null,
      pump:
        state.round === 5 && pump
          ? {
              asset: pumpAsset(),
              crowdPct: crowdPctDisplay(),
              peakBuyTick: pump.peakBuyTick,
              buyVolumeByTick: [...pump.buyVolumeByTick],
              pushActive: pump.pushFired && state.tick >= 4 && state.tick <= 5,
              pushMessage:
                "You're up 40 points — buy now to lock in the lead! 🚀",
            }
          : null,
      players,
      leaderboard: state.leaderboard,
      pendingAlert: state.pendingAlert,
      alertLog: state.alertLog,
      concept: cfg?.concept || null,
      flags: cfg?.flags || {},
      labelledTicker: cfg?.labelledTicker || null,
      pumpAsset: cfg?.pumpAsset || null,
      assets: ASSETS,
      lanUrl: state.lanUrl,
      lobbyCode: state.lobbyCode,
      demoMode: state.demoMode,
      playerCount: Object.keys(state.players).length,
      betweenSummary:
        state.phase === 'between' || state.phase === 'motivation'
          ? {
              round: state.round,
              averages: roundAverages(state, state.round),
              r1: roundAverages(state, 1),
              specific: roundSpecific(state.round),
            }
          : null,
      liveTradesAvg:
        state.round >= 1
          ? (() => {
              const ids = Object.keys(state.players);
              if (!ids.length) return 0;
              const total = ids.reduce(
                (s, id) => s + liveTrades(state.trades, state.round, id).length,
                0
              );
              return Math.round((total / ids.length) * 10) / 10;
            })()
          : 0,
      motivations: state.motivations,
      config: state.config,
    };
  }

  function roundSpecific(roundNum) {
    if (roundNum === 2) {
      const nvda = liveTrades(state.trades, 2).filter((t) => t.ticker === 'NVDA').length;
      const spcx = liveTrades(state.trades, 2).filter((t) => t.ticker === 'SPCX').length;
      return { nvdaTrades: nvda, spcxTrades: spcx };
    }
    if (roundNum === 3) {
      const labelled = rounds[3].labelledTicker;
      const live = liveTrades(state.trades, 3);
      const share = live.length
        ? (live.filter((t) => t.ticker === labelled).length / live.length) * 100
        : 0;
      return { labelledTicker: labelled, labelledSharePct: round2(share) };
    }
    if (roundNum === 4) {
      return { leaderboard: state.leaderboard };
    }
    if (roundNum === 5) {
      return buildPumpRoundStats(state);
    }
    return null;
  }

  function emit() {
    rebuildLeaderboard();
    broadcast({ type: 'state', payload: publicState() });
  }

  function join(name, existingId, code) {
    name = String(name || '').trim().slice(0, 20);

    // Refresh rejoin — same player_id resumes without re-entering lobby rules
    if (existingId && state.players[existingId]) {
      if (name.length >= 2) state.players[existingId].name = name;
      emit();
      return { player_id: existingId, name: state.players[existingId].name };
    }

    const normalized = String(code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (normalized !== state.lobbyCode) {
      throw new Error('Invalid lobby code');
    }

    if (name.length < 2) throw new Error('Name must be at least 2 characters');

    if (state.phase !== 'lobby') {
      throw new Error('Game already started — refresh if you already joined');
    }

    const id = randomUUID();
    state.players[id] = {
      id,
      name,
      cash: 100,
      holdings: emptyHoldings(),
      contract: null,
    };
    emit();
    return { player_id: id, name };
  }

  function resetPlayerRound(p) {
    // $100 reset between rounds — nothing carries over
    p.cash = 100;
    p.holdings = emptyHoldings();
    p.contract = null;
  }

  function startRound(n) {
    n = Number(n);
    if (n < 1 || n > 5) throw new Error('Invalid round');
    const minPlayers = state.demoMode ? 1 : 2;
    if (Object.keys(state.players).length < minPlayers) {
      throw new Error(`Need at least ${minPlayers} players`);
    }

    clearTimers();
    state.round = n;
    state.tick = 0;
    state.alertLog = [];
    state.pendingAlert = null;
    state.phase = 'buyin';
    state.buyInEndsAt = Date.now() + timings.buyInMs;
    state.tickEndsAt = null;

    for (const p of Object.values(state.players)) {
      resetPlayerRound(p);
    }

    if (n === 5) initPump();
    else pump = null;

    buyInTimer = setTimeout(() => beginLive(), timings.buyInMs);
    emit();
  }

  function beginLive() {
    if (state.phase !== 'buyin') return;
    state.phase = 'live';
    state.tick = 0;
    if (state.round === 5 && pump) {
      pump.buyersThisTick = new Set();
    }
    scheduleNextTick();
    maybeScheduleAlert();
    emit();
  }

  function scheduleNextTick() {
    state.tickEndsAt = Date.now() + timings.tickMs;
    tickTimer = setTimeout(() => advanceTick(), timings.tickMs);
  }

  function maybeScheduleAlert() {
    // Fire one NVDA alert at tick+0.2s after each live tick advance (tick >= 1).
    // SPCX never gets an alert or flash — matched-mover salience test.
    if (state.round !== 2 || state.phase !== 'live') return;
    if (state.tick < 1) return;
    if (alertTimer) clearTimeout(alertTimer);
    alertTimer = setTimeout(() => {
      if (state.phase !== 'live' || state.round !== 2) return;
      const path = rounds[2].prices.NVDA;
      const idx = state.tick;
      const pct = ((path[idx] - path[idx - 1]) / path[idx - 1]) * 100;
      const alert = {
        ticker: 'NVDA',
        pct: round2(pct),
        alert_id: randomUUID(),
        fired_at: Date.now(),
        tick: state.tick,
      };
      state.alertLog.push(alert);
      state.pendingAlert = alert;
      emit();
    }, 200);
  }

  function advanceTick() {
    if (state.phase !== 'live') return;
    if (state.tick >= timings.tickCount) {
      endRound();
      return;
    }
    // Finalize buy volume for the tick we are leaving
    finalizePumpTick(state.tick);
    state.tick += 1;
    state.pendingAlert = null;
    if (state.round === 5 && pump && state.tick === 4 && !pump.pushFired) {
      pump.pushFired = true;
    }
    if (state.tick >= timings.tickCount) {
      state.tickEndsAt = Date.now() + timings.tickMs;
      tickTimer = setTimeout(() => endRound(), timings.tickMs);
      maybeScheduleAlert();
      emit();
      return;
    }
    scheduleNextTick();
    maybeScheduleAlert();
    emit();
  }

  function nextTickManual() {
    if (state.phase === 'buyin') {
      clearTimers();
      beginLive();
      return;
    }
    if (state.phase !== 'live') throw new Error('Not in live phase');
    clearTimers();
    advanceTick();
  }

  function snapshotRound() {
    const prices = currentPrices();
    if (state.round >= 1) {
      for (const t of ASSETS) {
        prices[t] = effectivePath(t)[timings.tickCount];
      }
    }
    const finalValues = {};
    const holdings = {};
    for (const p of Object.values(state.players)) {
      finalValues[p.id] = round2(portfolioValue(p, prices));
      holdings[p.id] = {
        cash: p.cash,
        holdings: { ...p.holdings },
        contract: null,
      };
    }
    const pumpSnap =
      state.round === 5 && pump
        ? {
            peakBuyTick: pump.peakBuyTick,
            buyVolumeByTick: [...pump.buyVolumeByTick],
            nvdaPath: [...pump.nvdaPath],
          }
        : null;
    state.roundResults[state.round] = {
      finalPrices: prices,
      finalValues,
      holdings,
      alertLog: [...state.alertLog],
      endedAt: Date.now(),
      pump: pumpSnap,
    };
    writeSnapshot({
      savedAt: new Date().toISOString(),
      round: state.round,
      phase: state.phase,
      players: state.players,
      trades: state.trades,
      roundResults: state.roundResults,
      motivations: state.motivations,
      pump: pumpSnap,
    });
  }

  function endRound() {
    clearTimers();
    if (state.round === 5 && pump) {
      finalizePumpTick(state.tick);
    }
    state.tick = timings.tickCount;
    snapshotRound();
    state.phase = 'between';
    state.pendingAlert = null;
    emit();
  }

  function nextRound() {
    if (state.phase !== 'between' && state.phase !== 'motivation') {
      throw new Error('Not between rounds');
    }
    if (state.round >= 5) {
      state.phase = 'comparison';
      emit();
      return;
    }
    startRound(state.round + 1);
  }

  function goComparison() {
    state.phase = 'comparison';
    emit();
  }

  const PUMP_MOTIVES = [
    "I think it's undervalued",
    'Everyone else is buying',
    'I want to win points',
    "It's exciting, I want in",
    'no response',
  ];

  /**
   * Trades are in WHOLE SHARES. Optional `motive` on Round 5 NVDA buys.
   */
  function trade({ player_id, ticker, side, shares, motive }) {
    if (state.phase !== 'buyin' && state.phase !== 'live') {
      throw new Error('Trading closed');
    }
    const player = state.players[player_id];
    if (!player) throw new Error('Unknown player');
    if (!ASSETS.includes(ticker)) throw new Error('Unknown ticker');
    side = side === 'sell' ? 'sell' : 'buy';

    const qty = Number(shares);
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error('Shares must be a whole number of at least 1');
    }

    const prices = currentPrices();
    const price = prices[ticker];
    if (!(price > 0)) throw new Error('Invalid price');

    const phase = state.phase === 'buyin' ? 'buyin' : 'live';
    const amount = round2(qty * price);

    if (side === 'buy') {
      if (amount > player.cash + 1e-9) throw new Error('Insufficient cash');
      player.cash = round2(player.cash - amount);
      player.holdings[ticker] = (player.holdings[ticker] || 0) + qty;
    } else {
      const held = player.holdings[ticker] || 0;
      if (qty > held) throw new Error('Insufficient shares');
      player.holdings[ticker] = held - qty;
      player.cash = round2(player.cash + amount);
    }

    const rec = {
      id: randomUUID(),
      player_id,
      round: state.round,
      phase,
      kind: 'equity',
      side,
      ticker,
      amount,
      price,
      shares: qty,
      ts: Date.now(),
      tick: state.tick,
    };

    // The Pump — NVDA buy tracking
    if (
      state.round === 5 &&
      pump &&
      side === 'buy' &&
      ticker === pumpAsset()
    ) {
      const tick = Math.min(Math.max(state.tick, 0), timings.tickCount);
      pump.buyVolumeByTick[tick] = (pump.buyVolumeByTick[tick] || 0) + qty;
      pump.buyersThisTick.add(player_id);
      pump.points[player_id] = (pump.points[player_id] || 0) + 10 * qty;
      const allowed = PUMP_MOTIVES;
      const m = allowed.includes(motive) ? motive : 'no response';
      rec.motive = m;
      rec.timing_bucket = timingBucket(tick);
      state.motivations[player_id] = m;
    }

    state.trades.push(rec);
    emit();
    return rec;
  }

  function setMotivation(player_id, answer) {
    if (!state.players[player_id]) throw new Error('Unknown player');
    if (!PUMP_MOTIVES.includes(answer)) throw new Error('Invalid answer');
    state.motivations[player_id] = answer;
    // Attach to most recent NVDA buy without motive if any
    for (let i = state.trades.length - 1; i >= 0; i--) {
      const t = state.trades[i];
      if (
        t.player_id === player_id &&
        t.round === 5 &&
        t.ticker === 'NVDA' &&
        t.side === 'buy' &&
        (!t.motive || t.motive === 'no response')
      ) {
        t.motive = answer;
        break;
      }
    }
    emit();
  }

  function reset(demoMode) {
    clearTimers();
    state.phase = 'lobby';
    state.round = 0;
    state.tick = 0;
    state.buyInEndsAt = null;
    state.tickEndsAt = null;
    state.players = {};
    state.trades = [];
    state.motivations = {};
    state.alertLog = [];
    state.pendingAlert = null;
    state.roundResults = {};
    state.leaderboard = [];
    state.lobbyCode = generateLobbyCode();
    pump = null;
    if (typeof demoMode === 'boolean') state.demoMode = demoMode;
    emit();
  }

  function setDemoMode(on) {
    state.demoMode = !!on;
    emit();
  }

  function setLanUrl(url) {
    state.lanUrl = url;
  }

  function getComparison() {
    return buildComparison(state);
  }

  function getRecap(playerId) {
    return buildRecap(state, playerId);
  }

  function dismissAlert() {
    state.pendingAlert = null;
    emit();
  }

  return {
    join,
    startRound,
    nextTickManual,
    endRound,
    nextRound,
    goComparison,
    trade,
    setMotivation,
    reset,
    setDemoMode,
    setLanUrl,
    publicState,
    getComparison,
    getRecap,
    dismissAlert,
    getState: () => state,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { createGame, ASSETS, timings };
