/** Round 5 — prediction contract + motivation prompt */

import { api } from '../api.js';
import { fmtMoney } from '../format.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Whole-contract stepper. Each YES/NO tap buys 1 contract at the quoted cents.
 * Updates optimistically so taps feel instant.
 */
export function renderContract(container, state, playerId, hooks = {}) {
  if (!state.flags?.predictionContract || !state.contract) {
    container.innerHTML = '';
    return;
  }
  const c = state.contract;
  const me = state.players[playerId];
  if (!me) {
    container.innerHTML = '';
    return;
  }

  const pos = me.contract;
  const yesCost = c.yesCents / 100;
  const noCost = c.noCents / 100;
  const canYes = (!pos || pos.side === 'yes') && me.cash + 1e-9 >= yesCost;
  const canNo = (!pos || pos.side === 'no') && me.cash + 1e-9 >= noCost;

  let positionLine = 'No position yet';
  if (pos && pos.shares > 0) {
    const side = pos.side.toUpperCase();
    const payout = pos.shares;
    positionLine = `Your position: ${pos.shares} ${side} · ${fmtMoney(pos.amount)} staked · pays ${fmtMoney(payout)} if ${c.targetTicker} closes ${pos.side === 'yes' ? 'up' : 'down'}`;
  }

  let lockHint = '';
  if (pos?.side === 'yes') lockHint = 'Holding YES — NO is locked this round.';
  if (pos?.side === 'no') lockHint = 'Holding NO — YES is locked this round.';

  container.innerHTML = `
    <div class="contract-card">
      <div class="label" style="margin-bottom:8px">Prediction</div>
      <div class="contract-card__q">Will ${c.targetTicker} close up this round?</div>
      <div class="contract-btns">
        <button type="button" class="btn btn--yes" data-side="yes" ${canYes ? '' : 'disabled'}>
          YES ${c.yesCents}¢
        </button>
        <button type="button" class="btn btn--no" data-side="no" ${canNo ? '' : 'disabled'}>
          NO ${c.noCents}¢
        </button>
      </div>
      <div class="sm" style="margin-top:12px;font-weight:500" id="contract-pos">${positionLine}</div>
      <div class="sm text-3" style="margin-top:4px">${lockHint || 'Each tap buys 1 contract.'}</div>
    </div>
  `;

  container.querySelectorAll('[data-side]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const side = btn.getAttribute('data-side');
      const cost = side === 'yes' ? yesCost : noCost;
      if (me.cash + 1e-9 < cost) return;
      if (me.contract && me.contract.side !== side) return;

      me.cash = round2(me.cash - cost);
      if (me.contract) {
        me.contract.shares += 1;
        me.contract.amount = round2(me.contract.amount + cost);
      } else {
        me.contract = { side, shares: 1, amount: cost };
      }
      hooks.onOptimistic?.();

      api('/api/contract', {
        method: 'POST',
        body: { player_id: playerId, side, contracts: 1 },
      }).catch(async (e) => {
        alert(e.message);
        await hooks.onError?.();
      });
    });
  });
}

export function renderMotivation(overlayRoot, playerId, onDone) {
  overlayRoot.innerHTML = `
    <div class="motivation-overlay">
      <div class="xl" style="margin-bottom:8px">Quick question</div>
      <div class="sm text-2" style="margin-bottom:24px;max-width:320px">Why did you trade the Yes/No contract?</div>
      <button type="button" class="btn btn--primary" data-a="I had a view on the outcome">I had a view on the outcome</button>
      <button type="button" class="btn btn--secondary" data-a="It seemed exciting">It seemed exciting</button>
      <button type="button" class="btn btn--secondary" data-a="I didn't trade it">I didn't trade it</button>
      <div class="sm text-3" style="margin-top:24px">Skips automatically in <span id="mot-sec">10</span>s</div>
    </div>
  `;
  let left = 10;
  const sec = overlayRoot.querySelector('#mot-sec');
  const timer = setInterval(() => {
    left -= 1;
    if (sec) sec.textContent = String(left);
    if (left <= 0) {
      clearInterval(timer);
      submit('no response');
    }
  }, 1000);

  async function submit(answer) {
    clearInterval(timer);
    try {
      await api('/api/motivation', {
        method: 'POST',
        body: { player_id: playerId, answer },
      });
    } catch (_) {
      /* ignore */
    }
    overlayRoot.innerHTML = '';
    if (onDone) onDone();
  }

  overlayRoot.querySelectorAll('[data-a]').forEach((btn) => {
    btn.addEventListener('click', () => submit(btn.getAttribute('data-a')));
  });
}
