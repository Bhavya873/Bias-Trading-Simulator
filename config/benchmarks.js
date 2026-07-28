/**
 * Offline FCA / OSC / Barber-Odean benchmark figures for the class-vs-study screen.
 * No network fetches — classroom Wi-Fi may have no internet.
 *
 * type drives rendering:
 *   "percentage"  → paired horizontal bars (class vs study)
 *   "directional" → text verdict / rank blocks (no numeric bar)
 *   "descriptive" → share / buyer-return blocks (Round 5)
 */

'use strict';

module.exports = {
  round2: {
    label: 'More trading after price alerts',
    source: 'Financial Conduct Authority (2024)',
    type: 'percentage',
    value: 12, // FCA: notifications increased trading ~12%
  },
  round3: {
    label: 'More trading in the trending name',
    source: 'Ontario Securities Commission',
    type: 'percentage',
    value: 14,
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
