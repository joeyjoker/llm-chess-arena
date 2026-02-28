# LLM Chess Arena（Node.js）

一个 Node.js 国际象棋模型对战应用：

- 支持把 **OpenAI / Anthropic / Gemini** 作为黑白双方自动下棋
- 提供 UI 展示棋盘、着法、状态
- 自动记录对局过程（FEN 快照 + SAN/UCI + 模型输出）
- 支持回放（滑块 / 播放 / 上一步 / 下一步）

---

## 1. 安装与启动

```bash
cd llm-chess-arena
npm install
cp .env.example .env
# 填入你的 API Key
npm run dev
```

浏览器访问：`http://localhost:3000`

---

## 2. 配置说明

你可以在 UI 中给每一方设置：

- `provider`: `openai | anthropic | gemini | mock-random`
- `model`: 具体模型名（可留空走 .env 默认）
- `apiKey`: 可选（留空则走服务端 .env）

同时支持：

- 最大总步数（`maxPlies`）
- 单步超时（`moveTimeLimitMs`）
- 非法着法重试次数（`maxRetries`）

---

## 3. 记录与回放

每局会写入：

- `data/games/<gameId>.json`

记录内容包括：

- 双方 provider/model
- 每一步的 SAN/UCI、FEN 前后、耗时、模型原始输出
- 快照数组（用于回放）
- 最终结果与终局原因（checkmate/draw/max_plies 等）

---

## 4. API

- `GET /api/health`
- `POST /api/game/start`
- `GET /api/game/:id`
- `GET /api/game/:id/replay`
- `GET /api/games`

---

## 5. Playwright 调试（可选）

你可以使用 Playwright 做 UI 冒烟测试：

```bash
npx playwright install
npm run test:ui
```

> 本仓库附带了一个最小 smoke test：`tests/ui.spec.js`

---

## 6. 注意事项

1. LLM 可能返回非法着法，服务端会重试，最终用随机合法着法兜底，确保对局可继续。
2. 若不想在前端输入 API Key，请只在 `.env` 配置，前端留空即可。
3. 为了节省 token，提示词中只提供当前局面 FEN + 合法着法列表。

---

## 7. 可扩展建议

- 加入 Elo 评估与多轮联赛
- 增加 opening book / tablebase 对比
- 支持导出 PGN、导入回放
- 支持 WebSocket 实时推送（当前是轮询）