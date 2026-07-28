# Ticker — Behavioural Finance Trading Game

Classroom demo: 3–6 students join from their phones, play 5 short trading rounds on a calm Wealthsimple-style UI, and see class results beside published FCA/OSC benchmarks on the presenter screen.

**Within-subject design:** everyone plays all 5 rounds. Round 1 is the neutral baseline. Each later round adds **exactly one** gamification mechanic.

## Quick start

### Local (Node.js)

```bash
npm install
npm start
```

### Docker

Requires [Docker](https://docs.docker.com/get-docker/):

```bash
docker compose up --build
# or: docker-compose up --build
```

| Role | URL |
|------|-----|
| Presenter | `http://localhost:3000/present` |
| Players | `http://localhost:3000/` |
| Players (phones on LAN) | `http://<LAN-IP>:3000/` |

```bash
PORT=4000 docker compose up --build
PUBLIC_URL=https://your-app.example.com docker compose up --build
PRESENTER_TOKEN=secret docker compose up --build
```

Snapshots write to `./data`. Health check: `GET /api/health`.

---

Open the URLs printed by `npm start`:

| Role | URL |
|------|-----|
| Presenter | `http://<LAN-IP>:3000/present` |
| Players | `http://<LAN-IP>:3000/` |

Players enter the **lobby code** from the presenter screen. Campus Wi‑Fi often blocks phone→laptop traffic — use a hotspot or set `PUBLIC_URL`.

When `PRESENTER_TOKEN` is set, open the presenter as `/present?token=…` so controls stay authorized.

### Ports

If port 3000 is busy, the server automatically tries 3001, 3002, … up to 3010 and prints the port it settled on. The lobby code and printed URLs always match the live port.

To pin a specific port:

```bash
PORT=4000 npm start        # macOS / Linux / WSL
$env:PORT=4000; npm start  # PowerShell
```

With `PORT` set explicitly the server will **not** fall back — it fails loudly so you don't hand out the wrong URL.

### Windows + WSL

Run the server from **either** Windows PowerShell or WSL, not both. With WSL's mirrored networking they share a port space, which is what produces `EADDRINUSE`. Running from Windows generally gives phones a reachable LAN IP; a WSL-only IP often isn't reachable from other devices.

### Rehearsal (solo)

- Open `/present?demo=1` (enables 1-player mode).
- Start Round 1 with a single browser tab as the player.

## Trading

- Holdings are **whole shares**. Each `+` / `−` on a stock row buys or sells exactly 1 share.

Sparklines of the **current round's** price history sit beside every ticker in all five rounds. Tick counts are shown only on the presenter view — players see a buy-in countdown, then `Live`.

## Round mechanics

| Round | Flag | What changes |
|------|------|----------------|
| 1 | _(none)_ | Baseline — BOND ~$55 calm, NVDA ~$32 medium, SPCX ~$8.50 jumpy |
| 2 | `realTimeAlert` | NVDA alert + flash each tick; SPCX silent twin (matched %) |
| 3 | `trendingTag` | Static "TRENDING" pill on SPCX |
| 4 | `leaderboard` | Live leaderboard only |
| 5 | `trendingTag` + `leaderboard` | NVDA fixed pump-and-dump path + TRENDING pill + live leaderboard |

## Editing the experiment

### Price paths, timings, labelled ticker

Edit [`config/rounds.js`](config/rounds.js):

- `ASSETS` — default `BOND`, `NVDA`, `SPCX`
- `timings.buyInMs` — buy-in length (default **10000** = 10 seconds)
- `timings.tickMs` — interval between ticks (default 5000)
- `timings.tickCount` — live ticks (default 10)
- `rounds[n].prices` — 11 values per asset (tick 0…10)
- `rounds[3].labelledTicker` — Round 3 trending tag target (default `SPCX`)
- `rounds[5].labelledTicker` — Round 5 trending tag (default `NVDA`); fixed NVDA spike→crash path

On startup the server **validates**:

- Round 2: NVDA and SPCX % moves match within 0.2pp each tick
- Round 3: labelled ticker finishes below both other assets
- Rounds 1–4 matched on mean return and volatility (Round 5 NVDA exempt)
- Round 5: both `trendingTag` and `leaderboard` flags, NVDA labelled

### Benchmarks (offline)

Edit [`config/benchmarks.js`](config/benchmarks.js). No network calls — the comparison screen works without internet.

### Design tokens

All colours and type live in [`public/css/theme.css`](public/css/theme.css). Components should not hard-code colours.

## Presenter flow

1. Lobby — big lobby code + player grid → **Start Round 1**
2. During a round — averages + control bar (Next Tick / End / Next / Reset). Tick counters stay on this screen only.
3. Between rounds — visual share/split bars for that round’s story → **Next Round**
4. After Round 5 — **Our class vs. the studies** (paired bars, per-card scaling) with a **Reset** button to return to lobby

Players land on a **personal recap** on their phones (`/recap`). Individual performance is never projected except the Round 4/5 leaderboard.

## Tests

With the server running (`npm start`) in another terminal:

```bash
npm test              # verdict logic, CSS audit, full 5-round e2e, websocket sync
npm run test:timing   # real-time buy-in and auto-tick check (~20s with 10s buy-in)
```

`npm test` walks a complete game with 4 players: joins, whole-share buy/sell, all five rounds' cues, comparison verdicts, and recap.

## Data

- State is **in memory**
- On each round end, a snapshot is written to `./data/game-<timestamp>.json`
- Buy-in trades are tagged `phase:"buyin"` and excluded from frequency metrics; live trades use `phase:"live"`

## Stack

Node.js + Express + WebSocket (`ws`), vanilla JS frontend, no build step. Players join with a short lobby code shown on the presenter screen.

## Limitations (say these out loud)

- n is small (≈6) — verdicts bias toward **Inconclusive**; this is illustrative, not an inferential test
- Round 3 tag is **config-static**, not live volume
- Round 2 NVDA/SPCX paths are deliberately matched; the alert asymmetry is the manipulation
- Round 5 uses a **fixed** NVDA pump-and-dump path (flat → spike → crash) plus dual cues (trending + leaderboard)
- Sparklines appear in every round (not Round-1-only), so the baseline is no longer chart-free
