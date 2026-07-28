/** Round 3 — trendingTag inline pill */

export function trendingPill(ticker, labelledTicker, flags) {
  if (!flags?.trendingTag || ticker !== labelledTicker) return '';
  return `<span class="trending-tag">🔥 TRENDING</span>`;
}
