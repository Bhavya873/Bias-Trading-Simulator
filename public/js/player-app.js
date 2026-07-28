import {
  api,
  connectState,
  getStoredPlayer,
  storePlayer,
} from './api.js';
import { fmtMoney, fmtPct, fmtChange, pctMove, sparklineSvg } from './format.js';
import { renderAlertCue, flashNvdaPrice } from './mechanics/r2-alert.js';
import { trendingPill } from './mechanics/r3-trending.js';
import { renderLeaderboard } from './mechanics/r4-leaderboard.js';
import { renderContract, renderMotivation } from './mechanics/r5-contract.js';

const app = document.getElementById('app');

let state = null;
let playerId = getStoredPlayer().player_id;
let playerName = getStoredPlayer().name;
let screen = 'boot';
let lastAlertId = null;
let motivationShown = false;
let rulesOpen = false;
let countdownTimer = null;
let lastRoundKey = '';
/** In-flight trade requests — used only to recover on error, not to lock the UI */
let pendingTrades = 0;

connectState((s) => {
  // Don't clobber a newer optimistic local state with a slightly stale broadcast
  // while we still have unconfirmed taps — merge our player if pending.
  if (
    pendingTrades > 0 &&
    state?.players?.[playerId] &&
    s?.players?.[playerId] &&
    screen === 'round'
  ) {
    const local = state.players[playerId];
    const remote = s.players[playerId];
    // Prefer whichever has more recent cash movement in the optimistic direction
    // by keeping local holdings/cash until the server catches up.
    s.players[playerId] = {
      ...remote,
      cash: local.cash,
      holdings: { ...local.holdings },
      contract: local.contract ? { ...local.contract } : remote.contract,
      portfolioValue: local.portfolioValue,
      returnPct: local.returnPct,
    };
  }
  state = s;
  route();
});

(async function bootRejoin() {
  const stored = getStoredPlayer();
  if (!stored.player_id) return;
  try {
    const res = await api('/api/join', {
      method: 'POST',
      body: { name: stored.name || 'Player', player_id: stored.player_id },
    });
    playerId = res.player_id;
    playerName = res.name;
    storePlayer(playerId, playerName);
  } catch (_) {
    playerId = null;
    playerName = null;
    localStorage.removeItem('ticker_player_id');
    localStorage.removeItem('ticker_player_name');
  }
})();

function route() {
  if (!state) return;

  if (!playerId) {
    renderJoin();
    return;
  }

  if (state.phase === 'lobby') {
    if (!state.players[playerId]) {
      playerId = null;
      playerName = null;
      localStorage.removeItem('ticker_player_id');
      localStorage.removeItem('ticker_player_name');
      renderJoin();
      return;
    }
    motivationShown = false;
    lastRoundKey = '';
    renderLobby();
    return;
  }

  if (state.phase === 'motivation') {
    if (!motivationShown) {
      motivationShown = true;
      lastRoundKey = '';
      renderMotivationOverlay();
    }
    return;
  }

  if (state.phase === 'between') {
    motivationShown = false;
    lastRoundKey = '';
    renderBetween();
    return;
  }

  if (state.phase === 'comparison') {
    location.href = '/recap';
    return;
  }

  if (state.phase === 'buyin' || state.phase === 'live') {
    motivationShown = false;
    const me = state.players[playerId];
    const holdingsKey = me
      ? Object.entries(me.holdings || {})
          .map(([t, n]) => `${t}:${n}`)
          .join(',')
      : '';
    const key = [
      state.phase,
      state.round,
      state.tick,
      state.pendingAlert?.alert_id || '',
      (state.leaderboard || []).map((r) => r.id + r.returnPct).join(','),
      me?.cash,
      holdingsKey,
      me?.contract?.shares || 0,
      me?.contract?.side || '',
    ].join('|');

    if (key === lastRoundKey && screen === 'round') {
      patchRoundChrome();
      return;
    }
    lastRoundKey = key;
    renderRound();
    return;
  }

  renderLobby();
}

/** Light patch for countdown / alerts when holdings haven't changed */
function patchRoundChrome() {
  const phaseEl = document.getElementById('phase-ind');
  if (phaseEl) {
    phaseEl.textContent =
      state.phase === 'buyin' ? buyInCountdownLabel() : 'Live';
  }
  if (state.round === 2) {
    const cue = document.getElementById('cue-zone');
    if (cue) {
      renderAlertCue(cue, state, async () => {
        try {
          await api('/api/alert/dismiss', { method: 'POST', body: {} });
        } catch (_) {
          /* ignore */
        }
      });
    }
    if (state.pendingAlert && state.pendingAlert.alert_id !== lastAlertId) {
      lastAlertId = state.pendingAlert.alert_id;
      flashNvdaPrice(document.querySelector('#row-NVDA'), state.pendingAlert.pct);
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }
  if (state.round === 4) {
    const cue = document.getElementById('cue-zone');
    if (cue) renderLeaderboard(cue, state, playerId);
  }
}

/* ---------- Join ---------- */
function renderJoin() {
  if (screen === 'join') return;
  screen = 'join';
  app.innerHTML = `
    <div class="centered">
      <div class="wordmark">Ticker</div>
      <div class="sm text-2" style="margin-top:8px">Behavioural finance experiment</div>
      <div style="height:48px"></div>
      <div style="width:100%;text-align:left">
        <div class="label" style="margin-bottom:8px">Your name</div>
        <input class="input" id="name" maxlength="20" autocapitalize="words" autocomplete="off" autofocus />
        <div style="height:16px"></div>
        <button class="btn btn--primary" id="join" disabled>Join</button>
      </div>
    </div>
  `;
  const input = app.querySelector('#name');
  const btn = app.querySelector('#join');
  const sync = () => {
    btn.disabled = input.value.trim().length < 2;
  };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });
  btn.addEventListener('click', async () => {
    try {
      const res = await api('/api/join', {
        method: 'POST',
        body: { name: input.value.trim() },
      });
      playerId = res.player_id;
      playerName = res.name;
      storePlayer(playerId, playerName);
      screen = '';
      route();
    } catch (e) {
      alert(e.message);
    }
  });
}

/* ---------- Lobby ---------- */
function renderLobby() {
  screen = 'lobby';
  const names = Object.values(state.players || {});
  const list = names
    .map((p) => {
      const you = p.id === playerId;
      return `<div class="player-list-row ${you ? 'is-you' : ''}">
        <span>${escapeHtml(p.name)}${you ? '<span class="you-tag">(you)</span>' : ''}</span>
      </div>`;
    })
    .join('');

  const buyInSec = Math.round((state.config?.timings?.buyInMs || 10000) / 1000);

  app.innerHTML = `
    <div class="page" style="padding-top:24px;padding-bottom:48px">
      <div class="wordmark wordmark--sm" style="text-align:center">Ticker</div>
      <div style="height:40px"></div>
      <div style="text-align:center">
        <div class="xl">You're in</div>
        <div class="text-2" style="margin-top:8px">${escapeHtml(playerName || '')}</div>
      </div>
      <div style="height:32px"></div>
      <div class="card">
        <div class="label">Players in lobby</div>
        <div style="height:12px"></div>
        ${list || '<div class="sm text-2">Waiting…</div>'}
      </div>
      <div style="height:24px"></div>
      <div class="lobby-status">Waiting for the presenter to start<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
      <div style="height:32px"></div>
      <div class="card">
        <button type="button" class="collapse-header" id="rules-toggle">
          <span>How it works</span>
          <span class="text-3">${rulesOpen ? '▴' : '▾'}</span>
        </button>
        <div class="collapse-body ${rulesOpen ? 'is-open' : ''}" id="rules-body">
          <p>You'll play 5 short rounds.</p>
          <p>Each round starts with $100 and no holdings.</p>
          <p>You get ${buyInSec} seconds to build a portfolio, then 10 price updates.</p>
          <p>Nothing carries between rounds.</p>
        </div>
      </div>
    </div>
  `;
  app.querySelector('#rules-toggle')?.addEventListener('click', () => {
    rulesOpen = !rulesOpen;
    renderLobby();
  });
}

/* ---------- Round shell ---------- */
function holdingsSummary(me) {
  const parts = (state.assets || [])
    .filter((t) => (me.holdings[t] || 0) > 0)
    .sort()
    .map((t) => `${me.holdings[t]} ${t}`);
  return parts.length ? parts.join(' · ') : 'No holdings yet';
}

function renderRound() {
  screen = 'round';
  const me = state.players[playerId];
  if (!me) {
    app.innerHTML = `<div class="centered"><div class="xl">Reconnecting…</div></div>`;
    return;
  }

  const change = fmtChange(me.portfolioValue - 100, me.returnPct);
  const cueClass = `cue-zone--r${state.round}`;
  // Players never see tick counts — only a countdown in buy-in, or "Live"
  const phaseLabel =
    state.phase === 'buyin' ? buyInCountdownLabel() : 'Live';

  const assets = [...(state.assets || [])].sort();
  const rows = assets
    .map((t) => {
      const price = state.prices[t];
      const prev = state.prevPrices?.[t];
      const move = prev != null ? pctMove(prev, price) : 0;
      const held = Math.round(me.holdings[t] || 0);
      const moveCls = move > 0 ? 'up' : move < 0 ? 'down' : 'text-3';
      const moveTxt = prev != null ? fmtPct(move) : '—';
      const canBuy = me.cash + 1e-9 >= price;
      const canSell = held >= 1;
      const series = state.priceHistory?.[t] || [];
      return `
        <div class="asset-row" id="row-${t}" data-ticker="${t}">
          <div class="asset-row__main">
            <div class="asset-row__left">
              <div class="asset-row__ticker">
                <span style="font-weight:500">${t}</span>
                ${trendingPill(t, state.labelledTicker, state.flags)}
              </div>
              <div class="asset-row__spark">${sparklineSvg(series)}</div>
            </div>
            <div class="asset-row__right">
              <div class="lg num" data-price>${fmtMoney(price)}</div>
              <div class="sm ${moveCls}">${moveTxt}</div>
            </div>
          </div>
          <div class="stepper">
            <button type="button" class="stepper__btn" data-side="sell" data-ticker="${t}" ${canSell ? '' : 'disabled'} aria-label="Sell 1 ${t}">−</button>
            <div class="stepper__count">
              <span class="num" data-shares>${held}</span>
              <span class="sm text-3">${held === 1 ? 'share' : 'shares'}</span>
            </div>
            <button type="button" class="stepper__btn" data-side="buy" data-ticker="${t}" ${canBuy ? '' : 'disabled'} aria-label="Buy 1 ${t}">+</button>
          </div>
          <div class="sm text-3" style="margin-top:4px;padding:0 4px">${fmtMoney(price)} each</div>
        </div>
      `;
    })
    .join('');

  app.innerHTML = `
    <header class="sticky-header">
      <span class="round-pill">Round ${state.round}</span>
      <div class="sticky-header__center">${escapeHtml(state.concept || '')}</div>
      <div class="sticky-header__right ${state.phase === 'buyin' ? '' : 'text-2'}" id="phase-ind">${phaseLabel}</div>
    </header>
    <div class="cue-zone ${cueClass}" id="cue-zone"></div>
    <div class="portfolio">
      <div class="label">Portfolio value</div>
      <div class="hero-num" style="margin-top:8px">${fmtMoney(me.portfolioValue)}</div>
      <div class="portfolio__change ${change.cls}">${change.text}</div>
      <div class="portfolio__cash">Cash ${fmtMoney(me.cash)}</div>
      <div class="portfolio__holdings sm text-2">${holdingsSummary(me)}</div>
    </div>
    <div class="market-label label">Market</div>
    <div id="asset-list">${rows}</div>
    <div id="contract-slot"></div>
    <div id="motivation-root"></div>
  `;

  const cue = app.querySelector('#cue-zone');
  if (state.round === 2) {
    renderAlertCue(cue, state, async () => {
      try {
        await api('/api/alert/dismiss', { method: 'POST', body: {} });
      } catch (_) {
        /* ignore */
      }
    });
    if (state.pendingAlert && state.pendingAlert.alert_id !== lastAlertId) {
      lastAlertId = state.pendingAlert.alert_id;
      flashNvdaPrice(app.querySelector('#row-NVDA'), state.pendingAlert.pct);
      if (navigator.vibrate) navigator.vibrate(30);
    }
  } else if (state.round === 4) {
    renderLeaderboard(cue, state, playerId);
  } else {
    cue.innerHTML = '';
  }

  if (state.round === 5) {
    mountContract();
  }

  app.querySelectorAll('.stepper__btn').forEach((btn) => {
    btn.addEventListener('click', () => onStep(btn));
  });

  startPhaseClock();
}

function mountContract() {
  const slot = app.querySelector('#contract-slot');
  if (!slot) return;
  renderContract(slot, state, playerId, {
    onOptimistic: () => {
      recomputeMyPortfolio();
      patchTradeUI();
      syncRoundKey();
      mountContract();
    },
    onError: async () => {
      try {
        state = await fetch('/api/state').then((r) => r.json());
        lastRoundKey = '';
        route();
      } catch (_) {
        /* ignore */
      }
    },
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function recomputeMyPortfolio() {
  const me = state.players[playerId];
  if (!me) return;
  let value = me.cash;
  for (const t of state.assets || []) {
    value += (me.holdings[t] || 0) * (state.prices[t] || 0);
  }
  if (me.contract && state.contract) {
    const px =
      me.contract.side === 'yes'
        ? state.contract.yesCents / 100
        : state.contract.noCents / 100;
    value += me.contract.shares * px;
  }
  me.portfolioValue = round2(value);
  me.returnPct = round2(((value - 100) / 100) * 100);
}

function syncRoundKey() {
  const me = state.players[playerId];
  if (!me) return;
  const holdingsKey = Object.entries(me.holdings || {})
    .map(([t, n]) => `${t}:${n}`)
    .join(',');
  lastRoundKey = [
    state.phase,
    state.round,
    state.tick,
    state.pendingAlert?.alert_id || '',
    (state.leaderboard || []).map((r) => r.id + r.returnPct).join(','),
    me.cash,
    holdingsKey,
    me.contract?.shares || 0,
    me.contract?.side || '',
  ].join('|');
}

/** Patch portfolio + steppers in place — no full re-render, no wait for the server */
function patchTradeUI() {
  const me = state.players[playerId];
  if (!me || screen !== 'round') return;

  const change = fmtChange(me.portfolioValue - 100, me.returnPct);
  const hero = document.querySelector('.portfolio .hero-num');
  const changeEl = document.querySelector('.portfolio__change');
  const cashEl = document.querySelector('.portfolio__cash');
  const holdEl = document.querySelector('.portfolio__holdings');
  if (hero) hero.textContent = fmtMoney(me.portfolioValue);
  if (changeEl) {
    changeEl.className = `portfolio__change ${change.cls}`;
    changeEl.textContent = change.text;
  }
  if (cashEl) cashEl.textContent = `Cash ${fmtMoney(me.cash)}`;
  if (holdEl) holdEl.textContent = holdingsSummary(me);

  for (const t of state.assets || []) {
    const row = document.getElementById(`row-${t}`);
    if (!row) continue;
    const price = state.prices[t];
    const held = Math.round(me.holdings[t] || 0);
    const sharesEl = row.querySelector('[data-shares]');
    const labelEl = row.querySelector('.stepper__count .sm');
    if (sharesEl) sharesEl.textContent = String(held);
    if (labelEl) labelEl.textContent = held === 1 ? 'share' : 'shares';
    const buyBtn = row.querySelector('[data-side="buy"]');
    const sellBtn = row.querySelector('[data-side="sell"]');
    if (buyBtn) buyBtn.disabled = me.cash + 1e-9 < price;
    if (sellBtn) sellBtn.disabled = held < 1;
  }
}

function onStep(btn) {
  if (btn.disabled) return;
  const ticker = btn.getAttribute('data-ticker');
  const side = btn.getAttribute('data-side');
  const me = state.players[playerId];
  const price = state.prices[ticker];
  if (!me || !(price > 0)) return;

  // Optimistic local update — UI responds on the same tap
  if (side === 'buy') {
    if (me.cash + 1e-9 < price) return;
    me.cash = round2(me.cash - price);
    me.holdings[ticker] = (me.holdings[ticker] || 0) + 1;
  } else {
    if ((me.holdings[ticker] || 0) < 1) return;
    me.cash = round2(me.cash + price);
    me.holdings[ticker] -= 1;
  }
  recomputeMyPortfolio();
  patchTradeUI();
  syncRoundKey();

  pendingTrades += 1;
  api('/api/trade', {
    method: 'POST',
    body: { player_id: playerId, ticker, side, shares: 1 },
  })
    .catch(async (e) => {
      try {
        const fresh = await fetch('/api/state').then((r) => r.json());
        state = fresh;
        lastRoundKey = '';
        route();
      } catch (_) {
        /* ignore */
      }
      alert(e.message);
    })
    .finally(() => {
      pendingTrades = Math.max(0, pendingTrades - 1);
    });
}

function buyInCountdownLabel() {
  const fallbackSec = Math.round((state?.config?.timings?.buyInMs || 10000) / 1000);
  if (!state.buyInEndsAt) {
    const m = Math.floor(fallbackSec / 60);
    const s = fallbackSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const left = Math.max(0, Math.ceil((state.buyInEndsAt - Date.now()) / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startPhaseClock() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (state.phase !== 'buyin') return;
  countdownTimer = setInterval(() => {
    const el = document.getElementById('phase-ind');
    if (el && state?.phase === 'buyin') el.textContent = buyInCountdownLabel();
  }, 250);
}

/* ---------- Between ---------- */
function renderBetween() {
  screen = 'between';
  const me = state.players[playerId];
  const fv = me?.portfolioValue ?? 100;
  const ret = me?.returnPct ?? 0;
  const trades = me?.liveTradesThisRound ?? 0;
  const change = fmtChange(fv - 100, ret);

  app.innerHTML = `
    <div class="between">
      <div class="xl">Round ${state.round} complete</div>
      <div class="card">
        <div class="stat-block">
          <div class="label">Final value</div>
          <div class="hero-num" style="margin-top:8px">${fmtMoney(fv)}</div>
        </div>
        <div class="stat-block">
          <div class="label">Return</div>
          <div class="lg ${change.cls}" style="margin-top:8px">${fmtPct(ret)}</div>
        </div>
        <div class="stat-block">
          <div class="label">Trades</div>
          <div class="lg num" style="margin-top:8px">${trades}</div>
        </div>
      </div>
      <div style="height:24px"></div>
      <div class="lobby-status">Waiting for the next round<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
    </div>
  `;
}

function renderMotivationOverlay() {
  screen = 'motivation';
  app.innerHTML = `<div id="motivation-root"></div>`;
  renderMotivation(app.querySelector('#motivation-root'), playerId, () => {
    /* state update will re-route */
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
