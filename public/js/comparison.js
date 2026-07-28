/**
 * Class-vs-study comparison screen.
 * Paired bars scale per card to max(class, study) — never a shared global axis.
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

  root.innerHTML = `
    <div class="comparison-header">
      <div class="hero-num" style="text-align:center">Our class vs. the studies</div>
    </div>
    ${cardR2(data.round2)}
    ${cardR3(data.round3)}
    ${cardR4(data.round4)}
    ${cardR5(data.round5)}
    <div class="comparison-reset">
      <button type="button" class="btn btn--secondary" id="comparison-reset" style="max-width:200px">Reset</button>
    </div>
  `;

  requestAnimationFrame(() => {
    root.querySelectorAll('[data-w]').forEach((el, i) => {
      setTimeout(() => {
        el.style.width = el.getAttribute('data-w');
      }, i * 100);
    });
  });

  root.querySelector('#comparison-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset the entire game and clear all players?')) return;
    try {
      const demo = new URLSearchParams(location.search).has('demo');
      await fetch('/api/present/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoMode: demo }),
      });
    } catch (e) {
      alert(e.message || 'Reset failed');
    }
  });
}

function verdictChip(v) {
  let cls = 'verdict-chip--na';
  if (v === 'Directionally consistent') cls = 'verdict-chip--ok';
  return `<span class="verdict-chip ${cls}">${esc(v)}</span>`;
}

function sourceLine(source) {
  if (!source) return '';
  return `<span class="comparison-card__source">${esc(source)}</span>`;
}

/** Independent per-card scaling */
function pairedBars(classVal, studyVal, unit = '%') {
  const c = Math.abs(Number(classVal) || 0);
  const s = Math.abs(Number(studyVal) || 0);
  const max = Math.max(c, s, 0.0001);
  const cw = (c / max) * 100;
  const sw = (s / max) * 100;
  const cLabel = `${fmt(classVal)}${unit}`;
  const sLabel = `${fmt(studyVal)}${unit}`;
  return `
    <div class="bar-pair">
      <div class="bar-pair__label">Our class</div>
      <div class="bar-track">
        <div class="bar-fill bar-fill--class" data-w="${cw}%" style="width:0">${cLabel}</div>
      </div>
    </div>
    <div class="bar-pair">
      <div class="bar-pair__label">Study benchmark</div>
      <div class="bar-track">
        <div class="bar-fill bar-fill--study" data-w="${sw}%" style="width:0">${sLabel}</div>
      </div>
    </div>
  `;
}

function cardR2(r) {
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 2</span>
        <span class="lg">${esc(r.label)}</span>
        ${sourceLine(r.source)}
      </div>
      ${pairedBars(r.classValue, r.value)}
      <div class="verdict-row">${verdictChip(r.verdict)}</div>
    </div>
  `;
}

function cardR3(r) {
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 3</span>
        <span class="lg">${esc(r.label)}</span>
        ${sourceLine(r.source)}
      </div>
      ${pairedBars(r.classValue, r.value)}
      <div class="verdict-row">${verdictChip(r.verdict)}</div>
    </div>
  `;
}

function cardR4(r) {
  const most = r.mostActive;
  const least = r.leastActive;
  const block = (title, person) => {
    if (!person) {
      return `<div class="rank-block"><div class="label">${esc(title)}</div><div class="xl" style="margin-top:8px">—</div></div>`;
    }
    const cls = person.returnPct > 0 ? 'up' : person.returnPct < 0 ? 'down' : '';
    return `
      <div class="rank-block">
        <div class="label">${esc(title)}</div>
        <div class="lg" style="margin-top:8px">${esc(person.name)}</div>
        <div class="sm text-2" style="margin-top:8px">${person.trades} trades</div>
        <div class="xl ${cls}" style="margin-top:4px">${fmt(person.returnPct)}%</div>
      </div>
    `;
  };
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 4</span>
        <span class="lg">${esc(r.label)}</span>
        ${sourceLine(r.source)}
      </div>
      <div class="rank-blocks">
        ${block('Most trades', most)}
        ${block('Least trades', least)}
      </div>
      <div class="verdict-row">${verdictChip(r.verdict)}</div>
    </div>
  `;
}

function cardR5(r) {
  const labelled = Number(r.labelledSharePct) || 0;
  const other = Math.max(0, 100 - labelled);
  const buyerTxt =
    (r.nvdaBuyerAvgReturn || 0) >= 0
      ? `gained ${fmt(r.nvdaBuyerAvgReturn)}%`
      : `lost ${fmt(Math.abs(r.nvdaBuyerAvgReturn || 0))}%`;
  const otherTxt =
    (r.otherAvgReturn || 0) >= 0
      ? `gained ${fmt(r.otherAvgReturn)}%`
      : `lost ${fmt(Math.abs(r.otherAvgReturn || 0))}%`;
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 5</span>
        <span class="lg">${esc(r.label || 'Hot asset + rankings')}</span>
      </div>
      ${shareBarHtml(r.labelledTicker || 'NVDA', labelled, 'Other', other)}
      <div class="sm text-2" style="margin-top:16px">
        Chasing the hot name draws engagement — players who bought NVDA ${buyerTxt};
        everyone else ${otherTxt}.
      </div>
    </div>
  `;
}

function shareBarHtml(leftLabel, leftPct, rightLabel, rightPct) {
  const lp = Math.max(0, Number(leftPct) || 0);
  const rp = Math.max(0, Number(rightPct) || 0);
  const total = lp + rp;
  const lShare = total ? (lp / total) * 100 : 50;
  const rShare = total ? (rp / total) * 100 : 50;
  const lPct = total ? Math.round(lShare) : 0;
  const rPct = total ? Math.round(rShare) : 0;
  return `
    <div class="share-chart">
      <div class="share-chart__legend">
        <span><span class="share-dot share-dot--a"></span>${esc(leftLabel)} · ${lPct}%</span>
        <span><span class="share-dot share-dot--b"></span>${esc(rightLabel)} · ${rPct}%</span>
      </div>
      <div class="share-bar">
        <div class="share-bar__seg share-bar__seg--a" style="width:${lShare}%"></div>
        <div class="share-bar__seg share-bar__seg--b" style="width:${rShare}%"></div>
      </div>
    </div>
  `;
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
