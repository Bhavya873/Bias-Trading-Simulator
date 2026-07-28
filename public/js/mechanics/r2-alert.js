/** Round 2 — realTimeAlert cue */

export function renderAlertCue(container, state, onDismiss) {
  const alert = state.pendingAlert;
  if (!alert || !state.flags?.realTimeAlert) {
    container.innerHTML = '';
    delete container.dataset.alertId;
    return;
  }

  const sign = alert.pct > 0 ? '+' : '';
  const text = `${alert.ticker} ${sign}${alert.pct.toFixed(1)}% this tick`;

  // Same alert already mounted — update copy only (avoids flicker on trades)
  if (container.dataset.alertId === alert.alert_id) {
    const textEl = container.querySelector('.alert-card__text');
    if (textEl) textEl.textContent = text;
    return;
  }

  container.dataset.alertId = alert.alert_id;
  container.innerHTML = `
    <div class="alert-card" role="status">
      <span class="alert-card__icon">🔔</span>
      <span class="alert-card__text">${text}</span>
      <button type="button" class="alert-card__dismiss" aria-label="Dismiss">×</button>
    </div>
  `;
  container.querySelector('.alert-card__dismiss')?.addEventListener('click', onDismiss);
}

export function flashNvdaPrice(rowEl, pct) {
  if (!rowEl) return;
  const priceEl = rowEl.querySelector('[data-price]');
  if (!priceEl) return;
  priceEl.classList.remove('flash-up', 'flash-down', 'flash-fade');
  void priceEl.offsetWidth;
  priceEl.classList.add(pct >= 0 ? 'flash-up' : 'flash-down');
  setTimeout(() => {
    priceEl.classList.add('flash-fade');
    setTimeout(() => {
      priceEl.classList.remove('flash-up', 'flash-down', 'flash-fade');
    }, 400);
  }, 600);
}
