/**
 * Shared horizontal share / paired bars for presenter between-round
 * and comparison screens.
 */

/** Two-segment share of a whole (e.g. labelled vs other). */
export function shareBar(leftLabel, leftCount, rightLabel, rightCount) {
  const l = Math.max(0, Number(leftCount) || 0);
  const r = Math.max(0, Number(rightCount) || 0);
  const total = l + r;
  const lp = total ? (l / total) * 100 : 50;
  const rp = total ? (r / total) * 100 : 50;
  const lPct = total ? Math.round(lp) : 0;
  const rPct = total ? Math.round(rp) : 0;

  return `
    <div class="share-chart">
      <div class="share-chart__legend">
        <span><span class="share-dot share-dot--a"></span>${esc(leftLabel)} · ${lPct}%</span>
        <span><span class="share-dot share-dot--b"></span>${esc(rightLabel)} · ${rPct}%</span>
      </div>
      <div class="share-bar" role="img" aria-label="${esc(leftLabel)} ${lPct}%, ${esc(rightLabel)} ${rPct}%">
        <div class="share-bar__seg share-bar__seg--a" style="width:${lp}%"></div>
        <div class="share-bar__seg share-bar__seg--b" style="width:${rp}%"></div>
      </div>
    </div>
  `;
}

/** Single horizontal value bar scaled to maxRef (or value itself). */
export function valueBar(label, value, maxRef, unit = '') {
  const v = Number(value) || 0;
  const max = Math.max(Math.abs(Number(maxRef) || 0), Math.abs(v), 0.0001);
  const w = (Math.abs(v) / max) * 100;
  const display =
    unit === '$'
      ? `$${Math.round(v)}`
      : unit === '%'
        ? `${v.toFixed(1)}%`
        : String(Math.round(v * 10) / 10);

  return `
    <div class="bar-pair">
      <div class="bar-pair__label">${esc(label)}</div>
      <div class="bar-track">
        <div class="bar-fill bar-fill--class-only" data-w="${w}%" style="width:${w}%">${display}</div>
      </div>
    </div>
  `;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
