# Ticker — Behavioural Finance Trading Game

Classroom demo: 3–6 students join from their phones, play 5 short trading rounds on a calm Wealthsimple-style UI, and see class results beside published FCA/OSC benchmarks on the presenter screen.

**Within-subject design:** everyone plays all 5 rounds. Round 1 is the neutral baseline. Each later round adds **exactly one** gamification mechanic.

## Quick start

```bash
npm install
npm start
```

Open the URLs printed in the terminal:

| Role | URL |
|------|-----|
| Presenter (project this) | `http://<LAN-IP>:3000/present` |
| Players (QR / phones) | `http://<LAN-IP>:3000/` |

Phones must be on the **same network** as the laptop. Campus Wi‑Fi often blocks device-to-device traffic — if joins fail, share a **hotspot from the presenter laptop**.

### Ports

If port 3000 is busy, the server automatically tries 3001, 3002, … up to 3010 and prints the port it settled on. The QR code always encodes the live port, so just scan whatever is on screen.

To pin a specific port:

```bash
PORT=4000 npm start        # macOS / Linux / WSL
$env:PORT=4000; npm start  # PowerShell
```

With `PORT` set explicitly the server will **not** fall back — it fails loudly so you don't hand out the wrong URL.

### Windows + WSL

Run the server from **either** Windows PowerShell or WSL, not both. With WSL's mirrored networking they share a port space, which is what produces `EADDRINUSE`. Running from Windows generally gives phones a reachable LAN IP; a WSL-only IP often isn't reachable from other devices.

### Rehearsal (solo)

- Open `/present?demo=1`, or check **Allow 1 player (rehearsal)** on the lobby screen.
- Start Round 1 with a single browser tab as the player.

## Trading

- Holdings are **whole shares**. Each `+` / `−` on a stock row buys or sells exactly 1 share.
- Share counts are always visible between the buttons and summarised under portfolio value.
- Cash is validated client-side (disabled buttons) and server-side.
- Round 5 prediction contracts work the same way: each tap buys 1 contract at the quoted cents, with a live position line showing stake and payout.

Sparklines of the **current round's** price history sit beside every ticker in all five rounds. Tick counts are shown only on the presenter view — players see a buy-in countdown, then `Live`.

## Round mechanics

| Round | Concept | Flag | What changes |
|------|---------|------|----------------|
| 1 | Deliberate decisions | _(none)_ | Baseline |
| 2 | Real-time information | `realTimeAlert` | NVDA alert + flash each tick; MU silent twin |
| 3 | What everyone else is doing | `trendingTag` | Static "TRENDING" pill on labelled ticker |
| 4 | Social ranking | `leaderboard` | Live leaderboard only |
| 5 | Odds and payouts | `predictionContract` | Yes/No contract + motivation prompt |

## Editing the experiment

### Price paths, timings, labelled ticker

Edit [`config/rounds.js`](config/rounds.js):

- `timings.buyInMs` — buy-in length (default **10000** = 10 seconds)
- `timings.tickMs` — interval between ticks (default 5000)
- `timings.tickCount` — live ticks (default 10)
- `rounds[n].prices` — 11 values per asset (tick 0…10)
- `rounds[3].labelledTicker` — Round 3 trending tag target (default `MSFT`)
- `rounds[5].targetTicker` / `oddsYesCents` — prediction contract

On startup the server **validates**:

- Round 2: NVDA and MU % moves match within 0.2pp each tick
- Round 3: labelled ticker finishes below at least two other assets
- All rounds matched on mean return and volatility

### Benchmarks (offline)

Edit [`config/benchmarks.js`](config/benchmarks.js). No network calls — the comparison screen works without internet.

### Design tokens

All colours and type live in [`public/css/theme.css`](public/css/theme.css). Components should not hard-code colours.

## Presenter flow

1. Lobby — QR + LAN URL + player grid → **Start Round 1**
2. During a round — averages + control bar (Next Tick / End / Next / Reset). Tick counters stay on this screen only.
3. Between rounds — summary vs Round 1 + round-specific panel → **Next Round**
4. After Round 5 — **Our class vs. the studies** (paired bars, per-card scaling)

Players land on a **personal recap** on their phones (`/recap`). Individual performance is never projected except the Round 4 leaderboard.

## Tests

With the server running (`npm start`) in another terminal:

```bash
npm test              # verdict logic, CSS audit, full 5-round e2e, websocket sync
npm run test:timing   # real-time buy-in and auto-tick check (~20s with 10s buy-in)
```

`npm test` walks a complete game with 4 players: joins, whole-share buy/sell, all five mechanics, contract settlement, motivation prompt, comparison verdicts, and recap.

## Data

- State is **in memory**
- On each round end, a snapshot is written to `./data/game-<timestamp>.json`
- Buy-in trades are tagged `phase:"buyin"` and excluded from frequency metrics; live trades use `phase:"live"`

## Stack

Node.js + Express + WebSocket (`ws`), vanilla JS frontend, no build step. QR codes are generated on the server (`/api/qr`) so nothing depends on an external API.

## Limitations (say these out loud)

- n is small (≈6) — verdicts bias toward **Inconclusive**; this is illustrative, not an inferential test
- Round 3 tag is **config-static**, not live volume
- Round 2 NVDA/MU paths are deliberately matched; the alert asymmetry is the manipulation
- Sparklines appear in every round (not Round-1-only), so the baseline is no longer chart-free
