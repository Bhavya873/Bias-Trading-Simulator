/**
 * In-memory game state machine.
 *
 * $100 reset: on startRound(n) every player gets cash:100, holdings:{} —
 * nothing carries between rounds.
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
  buildR5RoundStats,
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
    phase: 'lobby', // lobby | buyin | live | between | comparison
    round: 0,
    tick: 0,
    buyInEndsAt: null,
    tickEndsAt: null,
    players: {},
    trades: [],
    alertLog: [],
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
            }
      ),
    },
  };

  let buyInTimer = null;
  let tickTimer = null;
  let alertTimer = null;

  function clearTimers() {
    if (buyInTimer) clearTimeout(buyInTimer);
    if (tickTimer) clearTimeout(tickTimer);
    if (alertTimer) clearTimeout(alertTimer);
    buyInTimer = tickTimer = alertTimer = null;
  }

  function currentPrices() {
    if (state.round < 1 || state.round > 5) {
      const p = {};
      for (const t of ASSETS) p[t] = 0;
      return p;
    }
    const idx = Math.min(Math.max(state.tick, 0), timings.tickCount);
    const path = rounds[state.round].prices;
    const out = {};
    for (const t of ASSETS) out[t] = path[t][idx];
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
    const path = rounds[state.round].prices;
    const out = {};
    for (const t of ASSETS) out[t] = path[t][idx];
    return out;
  }

  function playerPublic(p) {
    const prices = currentPrices();
    const value = portfolioValue(p, prices);
    return {
      id: p.id,
      name: p.name,
      cash: round2(p.cash),
      holdings: { ...p.holdings },
      portfolioValue: round2(value),
      returnPct: round2(((value - 100) / 100) * 100),
      liveTradesThisRound:
        state.round >= 1 ? liveTrades(state.trades, state.round, p.id).length : 0,
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

  function publicState() {
    const prices = currentPrices();
    const players = {};
    for (const p of Object.values(state.players)) {
      players[p.id] = playerPublic(p);
    }
    const cfg = state.round >= 1 && state.round <= 5 ? rounds[state.round] : null;
    const historyPaths = cfg
      ? Object.fromEntries(
          ASSETS.map((t) => [t, cfg.prices[t].slice(0, state.tick + 1)])
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
      players,
      leaderboard: state.leaderboard,
      pendingAlert: state.pendingAlert,
      alertLog: state.alertLog,
      concept: cfg?.concept || null,
      flags: cfg?.flags || {},
      labelledTicker: cfg?.labelledTicker || null,
      assets: ASSETS,
      lanUrl: state.lanUrl,
      lobbyCode: state.lobbyCode,
      demoMode: state.demoMode,
      playerCount: Object.keys(state.players).length,
      betweenSummary:
        state.phase === 'between'
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
      return buildR5RoundStats(state);
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
    };
    emit();
    return { player_id: id, name };
  }

  function resetPlayerRound(p) {
    p.cash = 100;
    p.holdings = emptyHoldings();
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

    buyInTimer = setTimeout(() => beginLive(), timings.buyInMs);
    emit();
  }

  function beginLive() {
    if (state.phase !== 'buyin') return;
    state.phase = 'live';
    state.tick = 0;
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
    state.tick += 1;
    state.pendingAlert = null;
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
      const path = rounds[state.round].prices;
      for (const t of ASSETS) {
        prices[t] = path[t][timings.tickCount];
      }
    }
    const finalValues = {};
    const holdings = {};
    for (const p of Object.values(state.players)) {
      finalValues[p.id] = round2(portfolioValue(p, prices));
      holdings[p.id] = {
        cash: p.cash,
        holdings: { ...p.holdings },
      };
    }
    state.roundResults[state.round] = {
      finalPrices: prices,
      finalValues,
      holdings,
      alertLog: [...state.alertLog],
      endedAt: Date.now(),
    };
    writeSnapshot({
      savedAt: new Date().toISOString(),
      round: state.round,
      phase: state.phase,
      players: state.players,
      trades: state.trades,
      roundResults: state.roundResults,
    });
  }

  function endRound() {
    clearTimers();
    state.tick = timings.tickCount;
    snapshotRound();
    state.phase = 'between';
    state.pendingAlert = null;
    emit();
  }

  function nextRound() {
    if (state.phase !== 'between') {
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

  /** Trades are in whole shares. */
  function trade({ player_id, ticker, side, shares }) {
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

    state.trades.push(rec);
    emit();
    return rec;
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
    state.alertLog = [];
    state.pendingAlert = null;
    state.roundResults = {};
    state.leaderboard = [];
    state.lobbyCode = generateLobbyCode();
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
    reset,
    setDemoMode,
    setLanUrl,
    publicState,
    getComparison,
    getRecap,
    dismissAlert,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { createGame };
