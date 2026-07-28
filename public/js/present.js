import { api, connectState, getPresenterHeaders } from './api.js';
import { fmtMoney } from './format.js';
import { shareBar, valueBar } from './charts.js';
import { renderLeaderboard } from './mechanics/r4-leaderboard.js';
import { renderComparisonView } from './comparison.js';

const app = document.getElementById('app');
let state = null;
let comparison = null;

const params = new URLSearchParams(location.search);
const demoFromUrl = params.has('demo');

connectState(async (s) => {
  state = s;
  if (demoFromUrl && !s.demoMode) {
    try {
      await api('/api/present/demo', {
        method: 'POST',
        body: { on: true },
        headers: getPresenterHeaders(),
      });
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
    await api(path, { method: 'POST', body, headers: getPresenterHeaders() });
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
    (state.round === 4 || state.round === 5)
  ) {
    const el = document.getElementById('lb');
    if (el) renderLeaderboard(el, state, null);
  }
  if (state.round === 4 && state.phase === 'between') {
    const el = document.getElementById('lb-between');
    if (el) renderLeaderboard(el, state, null);
  }
}

function controlBar() {
  const canStart = state.phase === 'lobby' || state.phase === 'buyin' || state.phase === 'live';
  return `
    <div class="present-control">
      <span class="round-pill">Round ${state.round || '—'}</span>
      <span class="sm tabular">${phaseText()}</span>
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
  if (state.phase === 'between') return '';
  return '';
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
  if (state.phase === 'between') return betweenPanel();
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
    ${state.round === 4 || state.round === 5 ? '<div id="lb"></div>' : ''}
  `;
}

function betweenPanel() {
  const s = state.betweenSummary;
  if (!s) {
    return `<div class="xl">Round ${state.round} complete</div>`;
  }
  const a = s.averages || {};
  const sp = s.specific;

  let visual = '';
  if (state.round === 1) {
    const trades = a.liveTradesPerPlayer || 0;
    const ret = a.meanReturnPct || 0;
    visual = `
      <div class="between-visual">
        <div class="label" style="margin-bottom:12px">Class baseline</div>
        ${valueBar('Avg live trades', trades, Math.max(trades, 4))}
        ${valueBar('Mean return', ret, Math.max(Math.abs(ret), 5), '%')}
      </div>
    `;
  } else if (state.round === 2 && sp) {
    visual = `
      <div class="between-visual">
        <div class="label" style="margin-bottom:12px">Live trades — alerted vs silent twin</div>
        ${shareBar('NVDA', sp.nvdaTrades, 'SPCX', sp.spcxTrades)}
      </div>
    `;
  } else if (state.round === 3 && sp) {
    const labelled = Number(sp.labelledSharePct) || 0;
    const other = Math.max(0, 100 - labelled);
    visual = `
      <div class="between-visual">
        <div class="label" style="margin-bottom:12px">Live trade share</div>
        ${shareBar(sp.labelledTicker || 'SPCX', labelled, 'Other', other)}
      </div>
    `;
  } else if (state.round === 4) {
    visual = `<div id="lb-between" class="between-visual"></div>`;
  } else if (state.round === 5 && sp) {
    const labelled = Number(sp.labelledSharePct) || 0;
    const other = Math.max(0, 100 - labelled);
    const buyerTxt =
      sp.nvdaBuyerAvgReturn >= 0
        ? `gained ${Number(sp.nvdaBuyerAvgReturn).toFixed(1)}%`
        : `lost ${Math.abs(Number(sp.nvdaBuyerAvgReturn) || 0).toFixed(1)}%`;
    const otherTxt =
      sp.otherAvgReturn >= 0
        ? `gained ${Number(sp.otherAvgReturn).toFixed(1)}%`
        : `lost ${Math.abs(Number(sp.otherAvgReturn) || 0).toFixed(1)}%`;
    visual = `
      <div class="between-visual">
        <div class="label" style="margin-bottom:12px">Live trade share</div>
        ${shareBar(sp.labelledTicker || 'NVDA', labelled, 'Other', other)}
        <div class="lg" style="margin-top:16px">Players who bought NVDA ${buyerTxt}. Everyone else ${otherTxt}.</div>
      </div>
    `;
  }

  return `
    <div class="xl" style="margin-bottom:24px">Round ${state.round} complete</div>
    ${visual}
    <div style="margin-top:32px">
      <button type="button" class="btn btn--primary" data-act="next" style="max-width:320px">
        ${state.round >= 5 ? 'Show class vs studies' : 'Next Round'}
      </button>
    </div>
  `;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
