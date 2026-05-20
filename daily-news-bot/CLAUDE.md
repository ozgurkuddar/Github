# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start      # Production — runs bot via node
npm run dev    # Development — auto-reloads with nodemon on file changes
```

No build step, no test suite.

## Environment Variables

Create a `.env` file in the project root:

```
TELEGRAM_BOT_TOKEN=   # from @BotFather
TELEGRAM_CHAT_ID=     # authorized recipient chat ID
GEMINI_API_KEY=       # from aistudio.google.com/app/apikey (ücretsiz)
```

The bot enforces a strict single-chat authorization: all incoming messages are checked against `TELEGRAM_CHAT_ID` before any action runs.

## Architecture

This is a single-purpose Telegram bot that fetches daily Turkish industry news via the Perplexity AI API and delivers formatted reports. No database — persistence is flat JSON files in `./data/` (auto-created).

**Module responsibilities:**

| File | Role |
|------|------|
| `index.js` | Entry point — polling bot, command routing, callback handling, starts scheduler |
| `scraper.js` | Google News RSS'ten haber çeker (ücretsiz), Gemini API ile Türkçe özetler; kategori başına 0.5s bekleme |
| `reporter.js` | Formats results into Telegram messages with inline buttons; deduplication logic |
| `scheduler.js` | `sendDailyReport()` fonksiyonunu günde 3 kez çalıştırır: 07:00, 12:00, 18:00 (tz: `Europe/Istanbul`) |
| `db.js` | Read/write helpers for `data/favorites.json`, `data/sources.json`, `data/sent.json` |

**Data flow:** `index.js` → `reporter.js` → `scraper.js` → Perplexity API → formatted messages sent back to Telegram. `db.js` is called by reporter to track sent articles (capped at 500) and persist favorites/sources.

**6 news categories** are defined as an array in `scraper.js` — each has a key, display label, emoji, and 2–3 Turkish/English search queries. To add or modify categories, edit that array only.

**Inline buttons** (favorites, save source) are handled via `callback_query` in `index.js`; the callback data encodes action type and article index.

`index.html` is a standalone GitHub Pages dashboard — it's static and not part of the bot runtime.
