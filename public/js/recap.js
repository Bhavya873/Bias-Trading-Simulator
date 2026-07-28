import { connectState, getStoredPlayer } from './api.js';
import { fmtPct } from './format.js';

const app = document.getElementById('app');
const { player_id } = getStoredPlayer();
let showAvg = false;
let recap = null;

if (!player_id) {
  app.innerHTML = `<div class="centered"><div class="xl">Join a game first</div><a class="btn btn--primary" style="margin-top:24px;max-width:240px" href="/">Go to join</a></div>`;
} else {
  load();
  let lastPhase = null;
  connectState((s) => {
    // A new round means the player left the recap — send them back to the game
    if (s.phase === 'buyin' || s.phase === 'live') {
      location.href = '/';
      return;
    }
    // Only refetch when the phase actually changes, not on every broadcast
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      load();
    }
  });
}

async function load() {
  try {
    recap = await fetch(`/api/recap/${player_id}`).then((r) => r.json());
    render();
  } catch (e) {
    app.innerHTML = `<div class="xl">Results unavailable yet</div><div class="sm text-2" style="margin-top:8px">${e.message || ''}</div>`;
  }
}

function render() {
  if (!recap) return;
  const cards = (recap.rounds || [])
    .map((r) => {
      const cls = r.returnPct > 0 ? 'up' : r.returnPct < 0 ? 'down' : 'text-3';
      const mult =
        r.round === 1 || r.vsR1 == null
          ? ''
          : `<div class="sm" style="margin-top:4px"><span class="${r.vsR1 >= 1.5 ? 'hot-mult' : 'text-2'}">${Number(r.vsR1).toFixed(1)}× your Round 1 trade count</span></div>`;
      const avg = showAvg && recap.classAvg?.[r.round]
        ? `<div class="sm text-3" style="margin-top:8px">Class avg return ${fmtPct(recap.classAvg[r.round].meanReturnPct)} · avg trades ${recap.classAvg[r.round].liveTradesPerPlayer.toFixed(1)}</div>`
        : '';
      return `
        <div class="recap-card">
          <div class="label">Round ${r.round} · ${esc(r.concept)}</div>
          <div class="xl ${cls}" style="margin-top:8px">${fmtPct(r.returnPct)}</div>
          <div class="sm text-2" style="margin-top:4px">${r.liveTrades} trades</div>
          ${mult}
          ${avg}
        </div>
      `;
    })
    .join('');

  const callouts = (recap.callouts || [])
    .map((c) => `<div class="callout">${esc(c)}</div>`)
    .join('');

  app.innerHTML = `
    <div class="hero-num">Your results</div>
    <div class="text-2" style="margin-top:8px">You finished #${recap.rank} of ${recap.n} by total return</div>
    <div class="recap-strip">${cards}</div>
    ${callouts}
    <div class="toggle-row">
      <span class="sm">Compare to class average</span>
      <button type="button" class="toggle ${showAvg ? 'is-on' : ''}" id="avg-toggle" aria-label="Toggle class average"></button>
    </div>
  `;

  app.querySelector('#avg-toggle')?.addEventListener('click', () => {
    showAvg = !showAvg;
    render();
  });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
