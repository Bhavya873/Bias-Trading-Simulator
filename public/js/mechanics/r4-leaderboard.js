/** Round 4 — leaderboard cue */

import { fmtPct } from '../format.js';

export function renderLeaderboard(container, state, myId) {
  if (!state.flags?.leaderboard) {
    container.innerHTML = '';
    return;
  }
  const rows = (state.leaderboard || [])
    .map((r) => {
      const isYou = r.id === myId;
      const cls = r.returnPct > 0 ? 'up' : r.returnPct < 0 ? 'down' : 'text-3';
      return `
        <div class="leaderboard__row ${isYou ? 'is-you' : ''}" data-id="${r.id}">
          <span class="leaderboard__rank">${r.rank}</span>
          <span class="leaderboard__name">${escapeHtml(r.name)}${isYou ? '' : ''}</span>
          <span class="leaderboard__return ${cls}">${fmtPct(r.returnPct)}</span>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="leaderboard">
      <div class="label" style="margin-bottom:8px">Leaderboard</div>
      ${rows || '<div class="sm text-2">Waiting for players…</div>'}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
