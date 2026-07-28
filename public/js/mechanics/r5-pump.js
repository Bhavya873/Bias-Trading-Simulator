/**
 * Round 5 — The Pump: hyped NVDA card, motives, points, FOMO push.
 */

import { api } from '../api.js';
import { fmtMoney, fmtChange, sparklineSvg } from '../format.js';

const MOTIVES = [
  "I think it's undervalued",
  'Everyone else is buying',
  'I want to win points',
  "It's exciting, I want in",
];

/**
 * Render pump chrome into the round view: push banner, points, crowd, LB slot.
 * Returns HTML fragments the parent can insert.
 */
export function pumpHeaderBits(state, playerId) {
  if (!state.flags?.thePump) return { pointsPill: '', push: '', streak: '' };
  const me = state.players[playerId];
  const pts = me?.pumpPoints || 0;
  const streak = me?.pumpStreak || 0;
  const pointsPill =
    pts > 0
      ? `<span class="pump-points-pill">${pts} pts</span>`
      : `<span class="pump-points-pill pump-points-pill--idle">0 pts</span>`;
  const push =
    state.pump?.pushActive
      ? `<div class="pump-push" role="status">${esc(state.pump.pushMessage)}</div>`
      : '';
  const streakLine =
    streak > 0
      ? `<div class="sm" style="margin-top:8px;color:var(--gold)">Streak ×${streak} while holding NVDA</div>`
      : '';
  return { pointsPill, push, streak: streakLine };
}

export function crowdLineHtml(state) {
  if (!state.flags?.thePump || state.pump?.crowdPct == null) return '';
  return `<div class="pump-crowd">🔥 ${Math.round(state.pump.crowdPct)}% of players just bought NVDA this tick</div>`;
}

/**
 * Distinct NVDA pump card at top of market list.
 */
export function renderPumpNvdaCard(state, playerId, hooks = {}) {
  const t = state.pumpAsset || 'NVDA';
  const me = state.players[playerId];
  if (!me) return '';
  const price = state.prices[t];
  const prev = state.prevPrices?.[t];
  const held = me.holdings[t] || 0;
  const history = state.priceHistory?.[t] || [price];
  const change = prev != null ? fmtChange(price - prev, ((price - prev) / prev) * 100) : null;
  const canBuy = me.cash + 1e-9 >= price;
  const canSell = held >= 1;

  return `
    <div class="pump-card" id="row-${t}">
      <div class="pump-card__top">
        <div>
          <div class="pump-card__ticker">NVDA 🚀 <span class="trending-tag">🔥 HOT ASSET</span></div>
          <div class="pump-card__price tabular">${fmtMoney(price)}</div>
          ${change ? `<div class="sm ${change.cls}">${change.text}</div>` : ''}
        </div>
        <div>${sparklineSvg(history)}</div>
      </div>
      <div class="pump-card__controls">
        <button type="button" class="btn btn--secondary pump-btn" data-side="sell" data-ticker="${t}" ${canSell ? '' : 'disabled'}>💰 Cash Out</button>
        <div class="pump-card__held"><span class="num">${held}</span> <span class="sm text-3">${held === 1 ? 'share' : 'shares'}</span></div>
        <button type="button" class="btn btn--primary pump-btn" data-side="buy" data-ticker="${t}" ${canBuy ? '' : 'disabled'}>🚀 Ape In</button>
      </div>
      <div class="sm text-3" style="margin-top:8px">${fmtMoney(price)} each</div>
    </div>
  `;
}

export function wirePumpCard(root, state, playerId, hooks = {}) {
  root.querySelectorAll('.pump-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const side = btn.getAttribute('data-side');
      const ticker = btn.getAttribute('data-ticker');
      if (side === 'buy') {
        openMotiveThenTrade(root, state, playerId, ticker, hooks);
      } else {
        doTrade(playerId, ticker, 'sell', null, hooks);
      }
    });
  });
}

function openMotiveThenTrade(root, state, playerId, ticker, hooks) {
  const overlay = document.createElement('div');
  overlay.className = 'motivation-overlay pump-motive-overlay';
  overlay.innerHTML = `
    <div class="xl" style="margin-bottom:8px">Why ape in?</div>
    <div class="sm text-2" style="margin-bottom:24px;max-width:320px">Quick check before this buy</div>
    ${MOTIVES.map(
      (m) =>
        `<button type="button" class="btn btn--secondary" data-motive="${esc(m)}">${esc(m)}</button>`
    ).join('')}
    <div class="sm text-3" style="margin-top:24px">Skips in <span id="pump-mot-sec">8</span>s</div>
  `;
  const host = document.getElementById('motivation-root') || root;
  host.innerHTML = '';
  host.appendChild(overlay);

  let left = 8;
  const sec = overlay.querySelector('#pump-mot-sec');
  const timer = setInterval(() => {
    left -= 1;
    if (sec) sec.textContent = String(left);
    if (left <= 0) {
      clearInterval(timer);
      finish('no response');
    }
  }, 1000);

  async function finish(motive) {
    clearInterval(timer);
    host.innerHTML = '';
    await doTrade(playerId, ticker, 'buy', motive, hooks);
  }

  overlay.querySelectorAll('[data-motive]').forEach((btn) => {
    btn.addEventListener('click', () => finish(btn.getAttribute('data-motive')));
  });
}

async function doTrade(playerId, ticker, side, motive, hooks) {
  const me = hooks.getPlayer?.();
  // Optimistic handled by parent for sell; for buy parent refreshes after
  try {
    await api('/api/trade', {
      method: 'POST',
      body: {
        player_id: playerId,
        ticker,
        side,
        shares: 1,
        ...(motive != null ? { motive } : {}),
      },
    });
    hooks.onDone?.();
  } catch (e) {
    alert(e.message);
    await hooks.onError?.();
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
