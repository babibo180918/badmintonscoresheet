# Badminton Score Sheet

A score-keeping web app for badminton umpires.
Offline-first PWA, no framework, no build step — plain HTML/CSS/JS.

## Current features

- Singles **and doubles**, BWF rally scoring (best of 3 × 21, deuce to 30)
- Doubles service tracking: R/L court shown per player, server and receiver
  marked, partners swap courts on a held serve; between games the winning
  side picks its next server and the losing side its receiver (BWF rules)
- Court number field; in the last 20 s of every interval the popup shows the
  umpire's "Court N twenty seconds" call, blinking red
- Optional team/club name per player, shown under the player name on court
- 2-minute warm-up countdown that keeps running from setup into the match screen
- Pre-match umpire announcement popup ("Ladies and gentlemen! On my right…");
  tapping Play closes it and starts the match clock shown in the top bar
- Full undo (restores server, service court, phase — not just the score)
- Official BWF announcement wording shown after every rally
  (service over, interval, change ends, game/match point, game/match won)
- 11-point interval and between-games countdown timers
- End-of-match PDF report (players, clubs, per-game scores, duration, shuttles,
  winner circled) shown in an in-app viewer and downloadable — generated
  offline, no dependencies
- Match state survives app/tab restarts (localStorage)
- Installable as a PWA; works fully offline after first load
- Three languages — English, Tiếng Việt, Dansk — covering both the UI and
  the umpire announcements (add more in `i18n.js`)

## Roadmap

1. ~~Singles scoring + undo + EN announcements~~
2. ~~Vietnamese + Danish translations~~
3. ~~Doubles (server/receiver court tracking)~~
4. Cards (warning/fault), injury timer, match log
5. Match history & export

## Run locally

Double-click `index.html` — everything works except offline install.
For the full PWA experience serve over HTTP:

```
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (free)

Any static host works — the whole app is static files:

- **GitHub Pages**: push this folder to a repo → Settings → Pages → deploy from branch.
- **Cloudflare Pages / Netlify**: drag-and-drop the folder in their dashboard.

After changing any file, bump `CACHE_VERSION` in `sw.js` so installed
clients pick up the update.

## Structure

| File | Role |
|---|---|
| `index.html` | Setup screen + match screen markup |
| `match.js` | Pure match logic (state machine, announcements) — no DOM |
| `report.js` | Hand-built PDF match report (A4, base-14 fonts) — no DOM |
| `app.js` | Rendering, event wiring, localStorage, SW registration |
| `i18n.js` | All user-facing strings; add languages here |
| `style.css` | Tablet-first UI |
| `sw.js`, `manifest.json`, `icon.svg` | PWA offline + install |
