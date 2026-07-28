import { api, connectState } from './api.js';
import { fmtMoney } from './format.js';
import { renderLeaderboard } from './mechanics/r4-leaderboard.js';
import { renderComparisonView } from './comparison.js';

const app = document.getElementById('app');
let state = null;
let comparison = null;

const demoFromUrl = new URLSearchParams(location.search).has('demo');

connectState(async (s) => {
  state = s;
  if (demoFromUrl && !s.demoMode) {
    try {
      await api('/api/present/demo', { method: 'POST', body: { on: true } });
    } catch (_) {
      /* ignore */
    }
  }
  if (s.phase === 'comparison') {
    try {
      comparison = await fetch('/api/comparison').then((r) => r.json());
    } catch (_) {
      comparison = null;
    }
    await renderComparisonView(app, comparison);
    return;
  }
  render();
});

async function post(path, body = {}) {
  try {
    await api(path, { method: 'POST', body });
  } catch (e) {
    alert(e.message);
  }
}

function render() {
  if (!state) return;
  if (state.phase === 'lobby') {
    renderLobby();
    return;
  }
  app.innerHTML = controlBar() + mainPanel();
  wireControls();
  if (
    (state.phase === 'buyin' || state.phase === 'live') &&
    state.round === 4
  ) {
    const el = document.getElementById('lb');
    if (el) renderLeaderboard(el, state, null);
  }
  if (state.round === 4 && (state.phase === 'between' || state.phase === 'motivation')) {
    const el = document.getElementById('lb-between');
    if (el) renderLeaderboard(el, state, null);
  }
}

function controlBar() {
  const flags = state.flags || {};
  const flagName = Object.keys(flags).find((k) => flags[k]) || 'none (baseline)';
  const canStart = state.phase === 'lobby' || state.phase === 'buyin' || state.phase === 'live';
  return `
    <div class="present-control">
      <span class="round-pill">Round ${state.round || '—'}</span>
      <span class="sm text-2">${esc(state.concept || 'Lobby')}</span>
      <span class="sm tabular">${phaseText()}</span>
      <span class="mechanic-chip">${esc(flagName)}</span>
      <div style="flex:1"></div>
      <button type="button" class="btn btn--primary" data-act="start" ${canStart && state.phase === 'lobby' ? '' : 'disabled'}>Start Round</button>
      <button type="button" class="btn btn--secondary" data-act="tick">Next Tick</button>
      <button type="button" class="btn btn--secondary" data-act="end">End Round</button>
      <button type="button" class="btn btn--secondary" data-act="next">Next Round</button>
      <button type="button" class="btn btn--secondary" data-act="reset">Reset</button>
    </div>
  `;
}

function phaseText() {
  if (state.phase === 'buyin') {
    const left = state.buyInEndsAt
      ? Math.max(0, Math.ceil((state.buyInEndsAt - Date.now()) / 1000))
      : 0;
    return `Buy-in ${left}s`;
  }
  if (state.phase === 'live') return `Live tick ${state.tick}/${state.tickCount}`;
  if (state.phase === 'motivation') return 'Motivation prompt';
  if (state.phase === 'between') return 'Between rounds';
  return state.phase;
}

function wireControls() {
  const on = (act, handler) => {
    app.querySelectorAll(`[data-act="${act}"]`).forEach((el) => {
      el.addEventListener('click', handler);
    });
  };

  on('start', () => {
    if (state.phase === 'lobby') post('/api/present/start-round', { round: 1 });
  });
  on('tick', () => post('/api/present/next-tick'));
  on('end', () => {
    if (confirm('End the current round now?')) post('/api/present/end-round');
  });
  on('next', () => {
    if (state.round >= 5) post('/api/present/comparison');
    else post('/api/present/next-round');
  });
  on('reset', () => {
    if (confirm('Reset the entire game and clear all players?')) {
      post('/api/present/reset', { demoMode: state.demoMode });
    }
  });
}

function renderLobby() {
  const names = Object.values(state.players || {});
  const minP = state.demoMode ? 1 : 2;
  const canStart = names.length >= minP;
  const code = state.lobbyCode || '————';

  app.innerHTML = `
    <div class="centered centered--present">
      <div class="lobby-code-wrap">
        <div class="label">Lobby code</div>
        <div class="lobby-code" aria-label="Lobby code">${esc(code)}</div>
      </div>
      ${
        names.length
          ? `<div class="player-grid">
              ${names.map((p) => `<div class="player-grid__card">${esc(p.name)}</div>`).join('')}
            </div>`
          : ''
      }
      <button type="button" class="btn btn--primary" id="start1" ${canStart ? '' : 'disabled'} style="max-width:280px;margin-top:8px">
        Start Round 1
      </button>
      <button type="button" class="btn btn--secondary" id="reset" style="max-width:160px;margin-top:16px">Reset</button>
    </div>
  `;

  app.querySelector('#start1')?.addEventListener('click', () =>
    post('/api/present/start-round', { round: 1 })
  );
  app.querySelector('#reset')?.addEventListener('click', () => {
    if (confirm('Reset the entire game and clear all players?')) {
      post('/api/present/reset', { demoMode: state.demoMode });
    }
  });
}

function mainPanel() {
  if (state.phase === 'buyin' || state.phase === 'live') return livePanel();
  if (state.phase === 'between' || state.phase === 'motivation') return betweenPanel();
  return `<div class="sm text-2">Phase: ${esc(state.phase)}</div>`;
}

function livePanel() {
  const players = Object.values(state.players || {});
  const n = players.length || 1;
  const avgVal = players.reduce((s, p) => s + p.portfolioValue, 0) / n;
  const avgTrades = state.liveTradesAvg ?? 0;

  return `
    <div class="stat-cards">
      <div class="stat-card">
        <div class="label">Avg portfolio</div>
        <div class="hero-num" style="margin-top:8px">${fmtMoney(avgVal)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg live trades</div>
        <div class="hero-num" style="margin-top:8px">${avgTrades}</div>
      </div>
      <div class="stat-card">
        <div class="label">Tick</div>
        <div class="hero-num" style="margin-top:8px">${state.tick}/${state.tickCount}</div>
      </div>
    </div>
    ${state.round === 4 ? '<div id="lb"></div>' : ''}
    <div class="sm text-3">Group averages only — individual results stay on phones. n=${players.length}</div>
  `;
}

function betweenPanel() {
  const s = state.betweenSummary;
  if (!s) {
    return `<div class="xl">Round ${state.round} complete</div>`;
  }
  const a = s.averages;
  const r1 = s.r1 || {};

  const row = (label, cur, base, mode) => {
    let change = '—';
    if (base != null && cur != null) {
      if (mode === 'pct') {
        change = base === 0 ? (cur > 0 ? '+∞' : '0%') : (((cur - base) / Math.abs(base)) * 100).toFixed(0) + '%';
      } else {
        change = (cur - base).toFixed(1) + ' pp';
      }
    }
    return `<tr>
      <td>${label}</td>
      <td class="tabular">${num(cur)}</td>
      <td class="tabular">${num(base)}</td>
      <td class="tabular">${change}</td>
    </tr>`;
  };

  let specific = '';
  const sp = s.specific;
  if (state.round === 2 && sp) {
    specific = `<div class="card" style="margin-top:16px">
      <div class="label">Round 2 — NVDA vs MU live trades</div>
      <div class="lg" style="margin-top:12px">NVDA ${sp.nvdaTrades} · MU ${sp.muTrades}</div>
    </div>`;
  } else if (state.round === 3 && sp) {
    specific = `<div class="card" style="margin-top:16px">
      <div class="label">Labelled ticker (${sp.labelledTicker}) share of live trades</div>
      <div class="lg" style="margin-top:12px">${Number(sp.labelledSharePct).toFixed(1)}%</div>
    </div>`;
  } else if (state.round === 5 && sp) {
    specific = `<div class="card" style="margin-top:16px">
      <div class="label">Contract vs equity volume</div>
      <div class="lg" style="margin-top:12px">${fmtMoney(sp.contractVol)} vs ${fmtMoney(sp.equityVol)}</div>
    </div>`;
  }

  return `
    <div class="xl" style="margin-bottom:8px">Round ${state.round} complete</div>
    ${
      state.phase === 'motivation'
        ? '<div class="sm text-2" style="margin-bottom:16px">Players are answering the motivation prompt…</div>'
        : ''
    }
    <table class="summary-table">
      <thead>
        <tr><th>Metric</th><th>This round (avg)</th><th>Round 1 (avg)</th><th>Change</th></tr>
      </thead>
      <tbody>
        ${row('Live trades per player', a.liveTradesPerPlayer, r1.liveTradesPerPlayer, 'pct')}
        ${row('SPCX portfolio weight', a.spcxWeightPct, r1.spcxWeightPct, 'pp')}
        ${row('Mean trade size (% of portfolio)', a.meanTradeSizePct, r1.meanTradeSizePct, 'pp')}
        ${row('Mean round return', a.meanReturnPct, r1.meanReturnPct, 'pp')}
      </tbody>
    </table>
    ${specific}
    ${state.round === 4 ? '<div id="lb-between" style="margin-top:16px"></div>' : ''}
    <div style="margin-top:24px">
      <button type="button" class="btn btn--primary" data-act="next" style="max-width:320px">
        ${state.round >= 5 ? 'Show class vs studies' : 'Next Round'}
      </button>
    </div>
  `;
}

function num(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(1);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
