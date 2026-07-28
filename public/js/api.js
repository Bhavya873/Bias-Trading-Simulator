/**
 * Shared API + WebSocket client.
 * Falls back to 1s polling if the socket drops.
 */

const LS_ID = 'ticker_player_id';
const LS_NAME = 'ticker_player_name';

export function getStoredPlayer() {
  return {
    player_id: localStorage.getItem(LS_ID),
    name: localStorage.getItem(LS_NAME),
  };
}

export function storePlayer(player_id, name) {
  localStorage.setItem(LS_ID, player_id);
  localStorage.setItem(LS_NAME, name);
}

export function clearPlayer() {
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_NAME);
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function connectState(onState) {
  let ws = null;
  let pollTimer = null;
  let closed = false;

  async function pullState() {
    try {
      const res = await fetch('/api/state');
      onState(await res.json());
    } catch (_) {
      /* offline for a moment; next poll retries */
    }
  }

  function startPoll() {
    if (pollTimer) return;
    pullState();
    pollTimer = setInterval(pullState, 1000);
  }

  function stopPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function connectWs() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', stopPoll);
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') onState(msg.payload);
      } catch (_) {
        /* ignore malformed frame */
      }
    });
    ws.addEventListener('close', () => {
      if (closed) return;
      startPoll();
      setTimeout(connectWs, 2000);
    });
    ws.addEventListener('error', () => {
      try {
        ws.close();
      } catch (_) {
        /* already closing */
      }
    });
  }

  connectWs();
  // Safety net if the socket never opens
  setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) startPoll();
  }, 1500);

  return () => {
    closed = true;
    stopPoll();
    if (ws) ws.close();
  };
}
