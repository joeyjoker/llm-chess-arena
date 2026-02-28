import express from 'express';
import dotenv from 'dotenv';
import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data', 'games');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const games = new Map();

function nowISO() {
  return new Date().toISOString();
}

function getEnvProviderConfig(provider) {
  const p = (provider || '').toLowerCase();
  if (p === 'openai') {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  if (p === 'anthropic') {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    };
  }
  if (p === 'gemini') {
    return {
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
    };
  }
  return { apiKey: undefined, baseUrl: undefined, model: undefined };
}

function normalizeSideConfig(side = {}, fallbackProvider = 'mock-random') {
  const provider = (side.provider || fallbackProvider).toLowerCase();
  const envCfg = getEnvProviderConfig(provider);

  return {
    provider,
    model: side.model || envCfg.model || '',
    apiKey: side.apiKey || envCfg.apiKey || '',
    baseUrl: side.baseUrl || envCfg.baseUrl || '',
    temperature: typeof side.temperature === 'number' ? side.temperature : 0.2,
    name: side.name || `${provider}:${side.model || envCfg.model || 'default'}`,
  };
}

function sanitizeGameSummary(game) {
  return {
    id: game.id,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    status: game.status,
    result: game.result,
    white: {
      provider: game.white.provider,
      model: game.white.model,
      name: game.white.name,
    },
    black: {
      provider: game.black.provider,
      model: game.black.model,
      name: game.black.name,
    },
    fen: game.currentFen,
    moveCount: game.moves.length,
    maxPlies: game.maxPlies,
  };
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function persistGame(game) {
  await ensureDirs();
  const file = path.join(DATA_DIR, `${game.id}.json`);
  await fs.writeFile(file, JSON.stringify(game, null, 2), 'utf-8');
}

function buildChessPrompt({ sideColor, fen, pgn, legalUci, legalSan, moveNumber, opponent }) {
  return [
    '你是一个严谨的国际象棋 AI。',
    `你执子：${sideColor === 'w' ? '白方' : '黑方'}。`,
    `当前回合（ply）：${moveNumber}`,
    `当前 FEN：${fen}`,
    `当前 PGN（可能为空）：${pgn || '(开局)'}`,
    `对手模型：${opponent}`,
    `合法 UCI 着法：${legalUci.join(', ')}`,
    `合法 SAN 着法：${legalSan.join(', ')}`,
    '请只输出 JSON，不要输出其它文字：{"move":"<UCI或SAN>"}',
    '示例：{"move":"e2e4"} 或 {"move":"Nf3"}',
  ].join('\n');
}

function tryParseJson(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // 代码块 JSON
  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = blockMatch ? blockMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractMoveToken(rawText) {
  if (!rawText) return '';

  const data = tryParseJson(rawText);
  if (data && typeof data.move === 'string') {
    return data.move.trim();
  }

  const uci = rawText.match(/\b([a-h][1-8][a-h][1-8][qrbn]?)\b/i);
  if (uci) return uci[1].trim();

  const san = rawText.match(/\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)\b/);
  if (san) return san[1].trim();

  return rawText.trim().split(/\s+/)[0] || '';
}

function moveFromToken(token, legalMovesVerbose) {
  if (!token) return null;

  const legalUciMap = new Map();
  const legalSanMap = new Map();
  for (const m of legalMovesVerbose) {
    const uci = `${m.from}${m.to}${m.promotion || ''}`.toLowerCase();
    legalUciMap.set(uci, m);
    legalSanMap.set(m.san.toLowerCase(), m);
  }

  const lower = token.toLowerCase();
  if (legalUciMap.has(lower)) return legalUciMap.get(lower);
  if (legalSanMap.has(lower)) return legalSanMap.get(lower);

  // 去掉常见符号后二次匹配
  const clean = lower.replace(/[+#!?]/g, '');
  if (legalSanMap.has(clean)) return legalSanMap.get(clean);

  return null;
}

async function callOpenAI({ apiKey, baseUrl, model, prompt, temperature = 0.2, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: 'You are a chess move generator. Output only JSON with field move.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`OpenAI error: ${res.status} ${JSON.stringify(data)}`);
    }

    const text = data?.choices?.[0]?.message?.content || '';
    return { rawText: text, rawResponse: data };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic({ apiKey, baseUrl, model, prompt, temperature = 0.2, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 120,
        temperature,
        system: 'You are a chess move generator. Output only JSON: {"move":"..."}',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Anthropic error: ${res.status} ${JSON.stringify(data)}`);
    }

    const text = (data?.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    return { rawText: text, rawResponse: data };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini({ apiKey, baseUrl, model, prompt, temperature = 0.2, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const endpoint = `${baseUrl.replace(/\/$/, '')}/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: 128,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Gemini error: ${res.status} ${JSON.stringify(data)}`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
    return { rawText: text, rawResponse: data };
  } finally {
    clearTimeout(timer);
  }
}

async function requestMoveFromProvider(sideCfg, context) {
  const { provider, model, apiKey, baseUrl, temperature } = sideCfg;

  if (provider === 'mock-random') {
    const randomIdx = Math.floor(Math.random() * context.legalMovesVerbose.length);
    const m = context.legalMovesVerbose[randomIdx];
    return {
      token: `${m.from}${m.to}${m.promotion || ''}`,
      rawText: 'mock-random',
      rawResponse: { provider: 'mock-random' },
      usedFallbackProvider: true,
    };
  }

  if (!apiKey) {
    throw new Error(`${provider} 缺少 API Key。可在 .env 或请求参数中传入。`);
  }

  const prompt = buildChessPrompt(context);

  let response;
  if (provider === 'openai') {
    response = await callOpenAI({ apiKey, baseUrl, model, prompt, temperature, timeoutMs: context.moveTimeLimitMs });
  } else if (provider === 'anthropic') {
    response = await callAnthropic({ apiKey, baseUrl, model, prompt, temperature, timeoutMs: context.moveTimeLimitMs });
  } else if (provider === 'gemini') {
    response = await callGemini({ apiKey, baseUrl, model, prompt, temperature, timeoutMs: context.moveTimeLimitMs });
  } else {
    throw new Error(`不支持的 provider: ${provider}`);
  }

  const token = extractMoveToken(response.rawText);
  return {
    token,
    rawText: response.rawText,
    rawResponse: response.rawResponse,
    usedFallbackProvider: false,
  };
}

function randomLegalMove(legalMovesVerbose) {
  const idx = Math.floor(Math.random() * legalMovesVerbose.length);
  return legalMovesVerbose[idx];
}

function computeResult(chess, lastMoveColor, reason = 'normal') {
  if (chess.isCheckmate()) {
    return {
      winner: lastMoveColor === 'w' ? 'white' : 'black',
      termination: 'checkmate',
      reason,
    };
  }

  if (chess.isStalemate()) {
    return { winner: 'draw', termination: 'stalemate', reason };
  }

  if (chess.isThreefoldRepetition()) {
    return { winner: 'draw', termination: 'threefold_repetition', reason };
  }

  if (chess.isInsufficientMaterial()) {
    return { winner: 'draw', termination: 'insufficient_material', reason };
  }

  if (chess.isDraw()) {
    return { winner: 'draw', termination: 'draw', reason };
  }

  return { winner: 'draw', termination: 'unknown', reason };
}

async function runGame(game) {
  const chess = new Chess();
  game.status = 'running';
  game.startedAt = nowISO();
  game.currentFen = chess.fen();
  game.snapshots.push({ ply: 0, fen: chess.fen(), note: 'initial' });

  try {
    while (!chess.isGameOver() && game.moves.length < game.maxPlies) {
      const turn = chess.turn();
      const sideCfg = turn === 'w' ? game.white : game.black;
      const opponentCfg = turn === 'w' ? game.black : game.white;

      const legalMovesVerbose = chess.moves({ verbose: true });
      const legalUci = legalMovesVerbose.map((m) => `${m.from}${m.to}${m.promotion || ''}`);
      const legalSan = legalMovesVerbose.map((m) => m.san);

      const context = {
        sideColor: turn,
        fen: chess.fen(),
        pgn: chess.pgn(),
        legalUci,
        legalSan,
        legalMovesVerbose,
        moveNumber: game.moves.length + 1,
        opponent: `${opponentCfg.provider}:${opponentCfg.model}`,
        moveTimeLimitMs: game.moveTimeLimitMs,
      };

      const begin = Date.now();
      let moveObj = null;
      let token = '';
      let rawText = '';
      let usedFallback = false;
      let errorText = '';

      for (let attempt = 1; attempt <= game.maxRetries; attempt++) {
        try {
          const response = await requestMoveFromProvider(sideCfg, context);
          token = response.token;
          rawText = response.rawText;
          usedFallback = response.usedFallbackProvider;
          moveObj = moveFromToken(token, legalMovesVerbose);

          if (moveObj) break;
          errorText = `非法着法 token=${token}`;
        } catch (err) {
          errorText = err?.message || String(err);
        }
      }

      if (!moveObj) {
        moveObj = randomLegalMove(legalMovesVerbose);
        usedFallback = true;
        if (!errorText) errorText = '模型返回非法着法，已随机兜底';
      }

      const fenBefore = chess.fen();
      const played = chess.move({ from: moveObj.from, to: moveObj.to, promotion: moveObj.promotion });
      const fenAfter = chess.fen();

      game.moves.push({
        ply: game.moves.length + 1,
        color: turn === 'w' ? 'white' : 'black',
        provider: sideCfg.provider,
        model: sideCfg.model,
        moveUci: `${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`,
        moveSan: played?.san || moveObj.san,
        fenBefore,
        fenAfter,
        legalUci,
        rawModelOutput: rawText,
        extractedToken: token,
        usedFallback,
        fallbackReason: errorText || null,
        latencyMs: Date.now() - begin,
        timestamp: nowISO(),
      });

      game.currentFen = fenAfter;
      game.snapshots.push({
        ply: game.moves.length,
        fen: fenAfter,
        san: played?.san || moveObj.san,
      });
    }

    game.finishedAt = nowISO();
    game.pgn = chess.pgn();

    if (chess.isGameOver()) {
      const lastColor = game.moves.length ? (game.moves[game.moves.length - 1].color === 'white' ? 'w' : 'b') : 'w';
      game.result = computeResult(chess, lastColor, 'game_over');
    } else {
      game.result = {
        winner: 'draw',
        termination: 'max_plies_reached',
        reason: `达到最大步数 ${game.maxPlies}`,
      };
    }

    game.status = 'finished';
  } catch (err) {
    game.finishedAt = nowISO();
    game.status = 'error';
    game.result = {
      winner: 'draw',
      termination: 'engine_error',
      reason: err?.message || String(err),
    };
  } finally {
    await persistGame(game);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: nowISO() });
});

app.post('/api/game/start', async (req, res) => {
  const body = req.body || {};

  const white = normalizeSideConfig(body.white || { provider: 'openai' });
  const black = normalizeSideConfig(body.black || { provider: 'anthropic' });

  const game = {
    id: randomUUID(),
    createdAt: nowISO(),
    startedAt: null,
    finishedAt: null,
    status: 'pending',
    currentFen: null,
    pgn: '',
    white,
    black,
    maxPlies: Math.max(10, Math.min(Number(body.maxPlies || 160), 1000)),
    maxRetries: Math.max(1, Math.min(Number(body.maxRetries || 2), 5)),
    moveTimeLimitMs: Math.max(5000, Math.min(Number(body.moveTimeLimitMs || 30000), 120000)),
    result: null,
    moves: [],
    snapshots: [],
  };

  games.set(game.id, game);

  // 异步运行
  runGame(game).catch((e) => {
    console.error('runGame failed:', e);
  });

  res.json({ ok: true, gameId: game.id, summary: sanitizeGameSummary(game) });
});

app.get('/api/game/:id', async (req, res) => {
  const id = req.params.id;
  const game = games.get(id);
  if (game) {
    return res.json({ ok: true, game: sanitizeGameSummary(game) });
  }

  const file = path.join(DATA_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return res.json({ ok: true, game: sanitizeGameSummary(parsed) });
  } catch {
    return res.status(404).json({ ok: false, message: 'game not found' });
  }
});

app.get('/api/game/:id/replay', async (req, res) => {
  const id = req.params.id;
  const game = games.get(id);
  if (game) {
    return res.json({ ok: true, replay: game });
  }

  const file = path.join(DATA_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return res.json({ ok: true, replay: parsed });
  } catch {
    return res.status(404).json({ ok: false, message: 'game not found' });
  }
});

app.get('/api/games', async (_req, res) => {
  await ensureDirs();
  const files = await fs.readdir(DATA_DIR);
  const entries = [];

  for (const f of files.filter((x) => x.endsWith('.json')).slice(-50)) {
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, f), 'utf-8');
      const parsed = JSON.parse(raw);
      entries.push(sanitizeGameSummary(parsed));
    } catch {
      // ignore bad files
    }
  }

  // include running game in memory
  for (const g of games.values()) {
    if (g.status === 'running' || g.status === 'pending') {
      entries.push(sanitizeGameSummary(g));
    }
  }

  entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ ok: true, games: entries.slice(0, 50) });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = Number(process.env.PORT || 3000);
ensureDirs().then(() => {
  app.listen(port, () => {
    console.log(`LLM Chess Arena listening on http://localhost:${port}`);
  });
});