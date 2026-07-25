# 🍦 Froyo Line Tracker

Live line tracking for NYC's trendiest froyo spots — MYKA, Mimi's, and more.

Every shop card shows a **time-of-day estimate** by default and flips to a
**LIVE** status the moment someone standing in line taps in a report. It's a
crowdsourced tracker: the data is only as good (and as current) as the people
on the ground, so reports fade out after 45 minutes. Each card also has a
**👀 Peek the street cam** button that pulls the nearest live NYC DOT traffic
camera so you can eyeball the block yourself.

<p align="center">
  <em>Pink, mobile-first, and refreshes itself every 15 seconds.</em>
</p>

## 🚀 Put it live (free)

This is a real Node app with a shared database, so **GitHub Pages can't host it**
(Pages only serves static files — no server, no shared reports, no camera proxy).
The easiest free home is **Render**, and there's a blueprint (`render.yaml`) so
it's basically one click:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/maxfoo260/FROYOLineTracker)

1. Click the button (or go to <https://render.com> → **New → Blueprint**).
2. Sign in with GitHub and pick the `FROYOLineTracker` repo.
3. Render reads `render.yaml`, builds, and deploys. In ~2 minutes you'll get a
   live URL like `https://froyo-line-tracker.onrender.com`.

That URL is a **real shared tracker** — everyone sees everyone's reports, and the
street cams work.

**Free-tier notes (all fine for this app):**
- The service sleeps after ~15 min idle, so the *first* visit after a nap takes
  ~50 s to wake. It's snappy after that.
- The free tier has no persistent disk, so the SQLite file resets on restart.
  That's a non-issue here — line reports expire after 45 minutes anyway. Want
  durable history? Add a Render disk (paid) or point `DB_PATH` at a hosted
  Postgres.

Prefer a different host? It's a plain `npm start` server, so **Railway**,
**Fly.io**, or any VPS work too — see [Deploying](#deploying) below.

## Why it works this way

There is **no official public API** that reports real-time wait times or line
lengths for individual froyo shops. Google Maps' "Live busyness" is not exposed
in Google's official API, and scraping it is fragile and against their terms.

So this app blends two honest sources:

1. **Time-of-day estimate** — a demand model per shop (quiet mornings, busy
   weekend evenings), scaled by how trendy the spot is. Always available, but
   it's an *estimate*.
2. **Live crowdsourced reports** — anyone can tap the current line level
   (*No line → Out the door*) plus an optional wait time. Recent reports
   override the estimate; the card shows a `LIVE` badge and how long ago the
   last report came in.

The two are blended with **recency weighting**: a single fresh report nudges the
number, and more/newer reports pull it fully toward the live truth.

### Street cams (NYC DOT)

On top of that, each shop is mapped to its **nearest online NYC DOT traffic
camera** (the same public feed the *Traffic Cam Photobooth* project uses — ~970
cameras citywide). Tap **Peek the street cam** and the card shows a live frame,
refreshed every few seconds.

Honest caveat: these cameras sit at intersections and are low-res, so they show
the general block, not a headcount at the shop's door — but you can often spot a
crowd. The server proxies and briefly caches each image (`/api/cameras/:id/image`)
so many viewers refreshing at once share a single upstream fetch, and a flaky
feed never breaks the app.

## Run it locally

```bash
npm install
npm start
# open http://localhost:3000
```

That's it — the SQLite database and shop seed data are created automatically on
first boot.

## Project layout

| File | What it does |
| --- | --- |
| `server.js` | Express server + JSON API |
| `db.js` | SQLite data layer (swap for Postgres later without touching the app) |
| `lib/status.js` | The busyness model — estimate + live-report blend |
| `lib/cameras.js` | NYC DOT camera directory + nearest-cam matching + image proxy |
| `data/shops.json` | Shop list. **Edit this to add/remove spots** |
| `public/` | Frontend (vanilla HTML/CSS/JS, no build step) |

### Add or edit a shop

Edit `data/shops.json` and restart (or run `npm run seed`). Fields:

```json
{
  "id": "myka",                 // unique slug
  "name": "MYKA",
  "neighborhood": "Nolita",
  "borough": "Manhattan",
  "blurb": "The froyo that broke the internet.",
  "popularity": 1.5,            // ~0.8 sleepy … 1.5 mob scene (affects the estimate)
  "emoji": "🍦",
  "lat": 40.7222,               // used to pick the nearest street cam
  "lng": -73.9955
}
```

> **Note:** shop names/neighborhoods here are a starter seed — double-check
> details before treating them as authoritative. Map links are generated from
> the shop name so they always resolve to a Google Maps search.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/shops` | All shops with current status, shortest line first |
| `GET` | `/api/shops/:id` | One shop's detail + status |
| `GET` | `/api/levels` | Line-level definitions (for the report UI) |
| `POST` | `/api/shops/:id/report` | Submit a live report `{ lineLevel: 0-4, waitMinutes?: number }` |
| `GET` | `/api/cameras/:id/image` | Cached proxy for a NYC DOT camera's current frame |
| `GET` | `/api/health` | Health check |

There's a light 30-second per-shop, per-IP cooldown on reports to curb spam.

## Deploying

It's a plain Node server, so it runs on any host that runs `npm start`
(Render, Railway, Fly.io, a VPS…). Set `PORT` and optionally `DB_PATH`.

**Heads up on data durability:** live line reports are inherently short-lived
(they expire after 45 min), so an ephemeral filesystem is usually fine. If you
want reports to survive redeploys, point `DB_PATH` at a persistent volume, or
swap `db.js` for a hosted Postgres.

## Ideas for next

- Map view with pins (needs verified coordinates per shop)
- Push/subscribe: "ping me when MYKA drops below a 10-minute wait"
- History sparkline: today's line over time
- Photo attach on a report

---

MIT. Built for froyo lovers. 🍧
