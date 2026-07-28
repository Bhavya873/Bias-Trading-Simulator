import { connectState, getStoredPlayer } from './api.js';
import { fmtPct } from './format.js';

const app = document.getElementById('app');
const { player_id } = getStoredPlayer();
let recap = null;

if (!player_id) {
  app.innerHTML = `<div class="centered"><div class="xl">Join a game first</div><a class="btn btn--primary" style="margin-top:24px;max-width:240px" href="/">Go to join</a></div>`;
} else {
  load();
  let lastPhase = null;
  connectState((s) => {
    if (s.phase === 'buyin' || s.phase === 'live') {
      location.href = '/';
      return;
    }
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
      return `
        <div class="recap-card">
          <div class="label">Round ${r.round}</div>
          <div class="xl ${cls}" style="margin-top:8px">${fmtPct(r.returnPct)}</div>
          <div class="sm text-2" style="margin-top:4px">${r.liveTrades} trades</div>
        </div>
      `;
    })
    .join('');

  const pump = recap.pumpLine
    ? `<div class="callout">${esc(recap.pumpLine)}</div>`
    : '';

  app.innerHTML = `
    <div class="hero-num">Your results</div>
    <div class="recap-strip">${cards}</div>
    ${pump}
  `;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
