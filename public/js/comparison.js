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
  `;

  requestAnimationFrame(() => {
    root.querySelectorAll('[data-w]').forEach((el, i) => {
      setTimeout(() => {
        el.style.width = el.getAttribute('data-w');
      }, i * 100);
    });
  });
}

function verdictChip(v) {
  let cls = 'verdict-chip--na';
  if (v === 'Directionally consistent') cls = 'verdict-chip--ok';
  if (v === 'Directionally inconsistent') cls = 'verdict-chip--bad';
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
  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 4</span>
        <span class="lg">${esc(r.label)}</span>
        ${sourceLine(r.source)}
      </div>
      <div class="rank-blocks">
        <div class="rank-block">
          <div class="label">Most active</div>
          <div class="xl" style="margin-top:8px">#${r.mostActiveReturnRank ?? '—'} of ${r.n}</div>
        </div>
        <div class="rank-block">
          <div class="label">Least active</div>
          <div class="xl" style="margin-top:8px">#${r.leastActiveReturnRank ?? '—'} of ${r.n}</div>
        </div>
      </div>
      <div class="verdict-row">${verdictChip(r.verdict)}</div>
    </div>
  `;
}

function cardR5(r) {
  const m = r.motivations || {};
  const total = (m.view || 0) + (m.exciting || 0) + (m.didnt || 0) + (m.none || 0) || 1;
  const seg = (count, label) => {
    const pct = (count / total) * 100;
    if (pct <= 0) return '';
    return `<div class="stacked-bar__seg" style="width:${pct}%" title="${label}">${count} · ${Math.round(pct)}%</div>`;
  };

  const eq = Number(r.equityVol) || 0;
  const ct = Number(r.contractVol) || 0;
  const max = Math.max(eq, ct, 0.0001);

  return `
    <div class="comparison-card">
      <div class="comparison-card__top">
        <span class="round-pill">Round 5</span>
        <span class="lg">${esc(r.label)}</span>
      </div>
      <div class="label" style="margin-bottom:8px">Motivation</div>
      <div class="stacked-bar">
        ${seg(m.view, 'View')}
        ${seg(m.exciting, 'Exciting')}
        ${seg(m.didnt, "Didn't trade")}
        ${seg(m.none, 'No response')}
      </div>
      <div class="label" style="margin:16px 0 8px">Contract vs equity volume</div>
      <div class="bar-pair">
        <div class="bar-pair__label">Contract</div>
        <div class="bar-track">
          <div class="bar-fill bar-fill--class-only" data-w="${(ct / max) * 100}%" style="width:0">$${ct.toFixed(0)}</div>
        </div>
      </div>
      <div class="bar-pair">
        <div class="bar-pair__label">Equity</div>
        <div class="bar-track">
          <div class="bar-fill bar-fill--class-only" data-w="${(eq / max) * 100}%" style="width:0">$${eq.toFixed(0)}</div>
        </div>
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
