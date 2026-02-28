# LLM Chess Arena (Node.js)

A Node.js app for automated **LLM-vs-LLM chess matches** with:

- configurable players for **OpenAI / Anthropic / Gemini / mock-random**
- live board visualization for human spectators
- full move logging (SAN/UCI, FEN snapshots, model raw output, latency)
- replay controls (slider, step, autoplay)

> 中文文档请查看: [README.zh-CN.md](./README.zh-CN.md)

---

## Features

- **Provider-agnostic match setup**
  - White/Black side can independently choose provider + model
  - API key can be passed from UI or loaded from server `.env`
- **Live UI**
  - Real 8x8 board rendering
  - highlights last move (from/to)
  - move table with click-to-jump replay
- **Persistent game records**
  - saved to `data/games/<gameId>.json`
  - includes snapshots and metadata for replay/analysis
- **Safety fallback**
  - invalid model move -> retry
  - still invalid -> random legal move fallback (game continues)

## UI Preview

> Placeholder images are included in `docs/screenshots/`.
> Replace them with real screenshots from your local run when convenient.

### Dashboard

![Dashboard](./docs/screenshots/dashboard.svg)

### Replay

![Replay](./docs/screenshots/replay.svg)

---

## Tech Stack

- Node.js (ESM)
- Express
- chess.js
- Vanilla frontend (no build step)
- Playwright (UI smoke test)

---

## Quick Start

```bash
cd llm-chess-arena
npm install
cp .env.example .env
# fill in your API keys
npm run dev
```

Open: `http://localhost:3000`

> Use `npm run dev` (not `npm dev`).

### One-click start (Windows)

- `start-dev.bat`
- `start-dev.ps1`

Both scripts will:

1. create `.env` from `.env.example` if missing
2. run `npm install`
3. run `npm run dev`

---

## Configuration

You can configure each side with:

- `provider`: `openai | anthropic | gemini | mock-random`
- `model`: model name (optional, defaults from `.env`)
- `apiKey`: optional (if omitted, server-side `.env` is used)

Match-level controls:

- `maxPlies` (max total plies)
- `moveTimeLimitMs` (timeout per move)
- `maxRetries` (retries before fallback)

---

## Environment Variables

See `.env.example`.

Typical keys:

- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`
- `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL`
- `PORT`

---

## API Endpoints

- `GET /api/health`
- `POST /api/game/start`
- `GET /api/game/:id`
- `GET /api/game/:id/replay`
- `GET /api/games`

---

## Replay Data Format

Each game JSON includes:

- game metadata (players, status, result)
- `moves[]` with SAN/UCI, FEN before/after, latency, fallback reason
- `snapshots[]` (for timeline replay)
- final PGN

---

## Playwright UI Test

```bash
npx playwright install
npm run test:ui
```

Included smoke test: `tests/ui.spec.js`

---

## Security Notes

- Do **not** commit `.env`.
- This repo already ignores `.env` in `.gitignore`.
- Prefer server-side key loading over entering secrets in browser UI.

---

## Roadmap Ideas

- tournament mode + Elo estimation
- opening book / tablebase evaluation
- PGN export/import from UI
- WebSocket real-time updates (replace polling)
- side-by-side engine eval integration