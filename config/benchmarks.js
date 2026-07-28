/**
 * Offline FCA / OSC / Barber-Odean benchmark figures for the class-vs-study screen.
 * No network fetches — classroom Wi-Fi may have no internet.
 *
 * type drives rendering:
 *   "percentage"  → paired horizontal bars (class vs study)
 *   "directional" → text verdict / rank blocks (no numeric bar)
 *   "descriptive" → motivation breakdown only
 */

'use strict';

module.exports = {
  round2: {
    label: 'More trading after price alerts',
    source: 'Financial Conduct Authority (2024)',
    type: 'percentage',
    value: 12, // FCA: notifications increased trading ~12%
    secondaryLabel: 'Risky-trade share increase',
    secondaryValue: 8, // FCA: +8% trades in risky assets
    // Class metric: % change in live trades per player, R2 vs R1
    classMetricKey: 'liveTradeFreqChangePct',
  },
  round3: {
    label: 'More trading in the trending name',
    source: 'Ontario Securities Commission',
    type: 'percentage',
    value: 14,
    // Class metric: labelled-ticker live-trade share in R3 minus share in R1 (pp → shown as %)
    classMetricKey: 'labelledTradeShareLiftPct',
  },
  round4: {
    label: 'Frequent traders vs. market return',
    source: 'Barber & Odean (2000); FCA leaderboard testing',
    type: 'directional',
    description:
      'Households that traded most frequently earned significantly lower returns than the market.',
  },
  round5: {
    label: 'Round 5 — Hot asset + rankings',
    source: '',
    type: 'descriptive',
  },
};
