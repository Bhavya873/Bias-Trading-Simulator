/**
 * Presenter finale — baseline (R1) vs each gamified round.
 * Side-by-side numbers with proportional tracks; no study benchmarks.
 */

export async function renderComparisonView(root, data) {
  if (!data) {
    root.innerHTML = `<div class="xl">Loading comparison…</div>`;
    try {
      data = await fetch('/api/comparison').then((r) => r.json());
    } catch (e) {
      root.innerHTML = `<div class="xl">Could not load comparison</div>`;
      return;
    }
  }

  const cards = (data.rounds || []).map((r) => roundCard(r)).join('');

  root.innerHTML = `
    <div class="comparison-header">
      <div class="hero-num" style="text-align:center">Baseline vs gamified rounds</div>
    </div>
    ${cards}
    <div class="comparison-reset">
      <button type="button" class="btn btn--secondary" id="comparison-reset" style="max-width:200px">Reset</button>
    </div>
  `;

  requestAnimationFrame(() => {
    root.querySelectorAll('[data-w]').forEach((el, i) => {
      setTimeout(() => {
        el.style.width = el.getAttribute('data-w');
      }, i * 80);
    });
  });

  root.querySelector('#comparison-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset the entire game and clear all players?')) return;
    try {
      const { api, getPresenterHeaders } = await import('./api.js');
      const demo = new URLSearchParams(location.search).has('demo');
      await api('/api/present/reset', {
        method: 'POST',
        body: { demoMode: demo },
        headers: getPresenterHeaders(),
      });
    } catch (e) {
      alert(e.message || 'Reset failed');
    }
  });
}

function roundCard(r) {
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round ${r.round}</span>
        <span class="lg">${esc(r.title)}</span>
        <span class="comparison-card__metric">${esc(r.metric || '')}</span>
      </div>
      ${comparePair(r.baseline, r.value, r.unit || '', r.round)}
    </div>
  `;
}

/** Two large numbers + thin proportional tracks, scaled to max(baseline, value). */
function comparePair(baseline, value, unit, roundNum) {
  const b = Number(baseline) || 0;
  const v = Number(value) || 0;
  const max = Math.max(Math.abs(b), Math.abs(v), 0.0001);
  const bw = (Math.abs(b) / max) * 100;
  const vw = (Math.abs(v) / max) * 100;
  const delta = v - b;
  const deltaTxt = formatDelta(delta, unit);

  return `
    <div class="compare-pair">
      <div class="compare-stat">
        <div class="label">Baseline (R1)</div>
        <div class="compare-stat__value hero-num">${fmt(b)}${unit}</div>
        <div class="compare-track">
          <div class="compare-track__fill compare-track__fill--baseline" data-w="${bw}%" style="width:0"></div>
        </div>
      </div>
      <div class="compare-stat">
        <div class="label">Round ${roundNum}</div>
        <div class="compare-stat__value hero-num">${fmt(v)}${unit}</div>
        <div class="compare-track">
          <div class="compare-track__fill compare-track__fill--round" data-w="${vw}%" style="width:0"></div>
        </div>
      </div>
    </div>
    <div class="compare-delta sm text-2">${esc(deltaTxt)}</div>
  `;
}

function formatDelta(delta, unit) {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const mag = Math.abs(delta);
  if (unit === '%') {
    return `${sign}${fmt(mag)} pp`;
  }
  return `${sign}${fmt(mag)} trades`;
}

function fmt(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(1);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
