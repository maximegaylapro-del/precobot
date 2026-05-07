# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OP-TCG Preorder Monitor — a Node.js bot that polls French TCG retailers for One Piece Card Game preorder availability and sends Discord/email notifications.

## Commands

```bash
npm install          # Install dependencies (Node >=18 required)
npm start            # Continuous polling mode
npm run dev          # Watch mode (auto-restart on changes)
npm run scan:once    # Single scan cycle then exit (cron/CI mode)
npm run dashboard    # Run dashboard server only (port 3000)
```

No linting or test framework is configured. Config is validated at startup via `config.validateConfig()` — runtime errors will surface there.

To test a single scraper, comment out others in [scrapers/index.js](scrapers/index.js) and run `npm run scan:once`.

## Architecture

### Data Flow

```
index.js (startup)
  → Scheduler loops every SCAN_INTERVAL_SECONDS (default 180s)
    → Run all scrapers in parallel (pLimit=2 concurrency)
    → detection.processBatch() → filter + compare to storage → emit events
    → notifier.notify(events) → Discord webhooks + email fallback
    → storage.markNotified()
  → Dashboard auto-refreshes every 5s from /api/products
```

### Core Layers

**Scrapers** (`scrapers/`)
- `base.js` — Abstract base with two fetch modes:
  - **Static** (axios + cheerio): for server-rendered HTML, fast, low RAM
  - **Dynamic** (Puppeteer + stealth plugin): for JS-heavy or anti-bot sites
- Both modes include retry with exponential backoff (3 attempts, 2s/4s), User-Agent rotation, and per-scraper deduplication by product ID
- `index.js` — Registry: `buildScrapers()` instantiates all enabled scrapers
- All scrapers return: `{ id, title, price, url, image?, status?, availability?, description?, category? }`

**Detection** (`services/detection.js`)
- Three-tier filtering: blacklist → keyword filter → status inference
- `TARGET_KEYWORDS` (if set) overrides `ONEPIECE_KEYWORDS` entirely
- Status inference reads product.status, title, availability, description, statusText
- Events emitted: `new_preorder`, `became_preorder`, `back_in_stock`
- `scan:once` force mode: re-emits ALL preorder/in_stock regardless of prior history

**Storage** (`services/storage.js`)
- Single atomic JSON file: `data/products.json` (temp+rename pattern to avoid corruption)
- In-memory cache + write-lock queue to serialize concurrent updates
- Tracks `firstSeenAt`, `lastSeenAt`, `notifiedAt` per product
- `upsert()` returns `{ kind: 'new'|'status'|'seen', product, previousStatus? }`
- Auto-backs-up and resets corrupted files

**Matcher** (`services/matcher.js`)
- Case-insensitive, accent-insensitive, dash/space/underscore-insensitive
- "OP16" matches "op-16", "OP-16", "Op 16", "op 16"

**Notifier** (`services/notifier.js`)
- Discord webhook embeds (primary): color-coded (yellow=new, orange=became, green=restocked), batched up to 10 per message
- Email via Nodemailer (fallback when Discord fails)
- Only marks `notifiedAt` if Discord request succeeds

**Scheduler** (`services/scheduler.js`)
- Respects optional active hours window (e.g., `SCAN_ACTIVE_HOURS=08:00-22:00`)
- Tracks per-cycle stats (cycle count, errors, last run time)

**Dashboard** (`dashboard/`)
- Express.js server with routes: `GET /api/products`, `GET /api/stats`, `POST /api/scan` (manual trigger)
- Static HTML frontend at `dashboard/public/index.html` with 5s auto-refresh

**Logger** (`services/logger.js`)
- Pino: console (pretty-printed) + file (`logs/monitor.log`, JSON format, all debug+ messages)
- Child loggers: `child('scheduler')` adds `{scope: "scheduler"}` to all messages

### Adding a New Scraper

1. Create `scrapers/myboutique.js` extending `BaseScraper` with `name`, `baseUrl`, `mode` (`'static'`|`'dynamic'`), and `urls` array. Implement `async parse({ $, html, url, page? })` returning the product array.
2. Register in `scrapers/index.js` inside `buildScrapers()`.

Scheduler, detection, storage, and notifications all work automatically — no other changes needed.

### Key Configuration (`.env`)

```
DISCORD_WEBHOOK_URL          # Required for alerts
SCAN_INTERVAL_SECONDS        # Polling frequency (min 15s enforced)
SCAN_ACTIVE_HOURS            # Optional window, e.g. "08:00-22:00"
MAX_CONCURRENT_SCRAPERS      # Parallel scraper limit (default 2)
TARGET_KEYWORDS              # If set, overrides ONEPIECE_KEYWORDS entirely
ONEPIECE_KEYWORDS            # Product inclusion filter
BLACKLIST_KEYWORDS           # Always excluded regardless of other filters
PREORDER_KEYWORDS            # Terms used for preorder status detection
HEADLESS                     # Puppeteer headless mode (true/false)
PROXY_URL                    # Optional proxy for all requests
DASHBOARD_ENABLED            # Enable Express UI (default true)
DASHBOARD_PORT               # Default 3000
```

Copy `.env.example` to `.env` before first run.
