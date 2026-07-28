/** Format helpers shared by player/presenter views */

export function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return (
    sign +
    '$' +
    Math.abs(v).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function fmtPct(n, withSign = true) {
  const v = Number(n) || 0;
  const sign = withSign ? (v > 0 ? '+' : '') : '';
  return sign + v.toFixed(1) + '%';
}

export function fmtChange(abs, pct) {
  if (!abs && !pct) return { text: '$0.00 (0.0%)', cls: 'text-3' };
  const cls = abs > 0 ? 'up' : abs < 0 ? 'down' : 'text-3';
  const sign = abs > 0 ? '+' : abs < 0 ? '-' : '';
  const text = `${sign}$${Math.abs(abs).toFixed(2)} (${fmtPct(pct)})`;
  return { text, cls };
}

export function pctMove(prev, curr) {
  if (!prev) return 0;
  return ((curr - prev) / prev) * 100;
}

/**
 * Tiny inline sparkline for asset rows.
 * 64×24, 1px stroke, no fill/axes. Colour follows net direction.
 * Flat baseline until there are at least two points.
 */
export function sparklineSvg(series) {
  const w = 64;
  const h = 24;
  const pad = 2;
  if (!Array.isArray(series) || series.length < 2) {
    const y = h / 2;
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--text-3)" stroke-width="1"/></svg>`;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = pad + (i / (series.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = series[series.length - 1] >= series[0];
  const stroke = up ? 'var(--up)' : 'var(--down)';
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
}
