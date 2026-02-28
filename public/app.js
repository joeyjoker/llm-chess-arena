const form = document.getElementById('battle-form');
const gameIdEl = document.getElementById('game-id');
const statusEl = document.getElementById('game-status');
const resultEl = document.getElementById('game-result');
const boardGridEl = document.getElementById('board-grid');
const boardFenEl = document.getElementById('board-fen');
const boardLastMoveEl = document.getElementById('board-last-move');
const movesTableBody = document.querySelector('#moves-table tbody');
const replaySlider = document.getElementById('replay-slider');
const replayLabel = document.getElementById('replay-label');
const gamesListEl = document.getElementById('games-list');

const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const playBtn = document.getElementById('play-btn');
const refreshListBtn = document.getElementById('refresh-list-btn');

let currentGameId = null;
let pollTimer = null;
let replayData = null;
let replayIndex = 0;
let replayTimer = null;
let lastRenderedMap = new Map();

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE_UNICODE = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

function syncBoardSize() {
  const wrap = boardGridEl.parentElement;
  if (!wrap) return;
  const size = Math.min(wrap.clientWidth, 520);
  boardGridEl.style.width = `${size}px`;
  boardGridEl.style.height = `${size}px`;
}

function initBoardGrid() {
  boardGridEl.innerHTML = '';
  for (let rank = 8; rank >= 1; rank--) {
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const file = FILES[fileIdx];
      const square = `${file}${rank}`;
      const cell = document.createElement('div');
      cell.className = `square ${(fileIdx + rank) % 2 === 0 ? 'light' : 'dark'}`;
      cell.dataset.square = square;

      const piece = document.createElement('span');
      piece.className = 'piece';
      piece.textContent = '';
      cell.appendChild(piece);

      boardGridEl.appendChild(cell);
    }
  }

  syncBoardSize();
}

function parseFenBoard(fen) {
  const board = new Map();
  if (!fen) return board;
  const boardPart = fen.split(' ')[0];
  const rows = boardPart.split('/');

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let fileIndex = 0;
    const rank = 8 - r;

    for (const ch of row) {
      if (/\d/.test(ch)) {
        fileIndex += Number(ch);
      } else {
        const file = FILES[fileIndex];
        board.set(`${file}${rank}`, ch);
        fileIndex += 1;
      }
    }
  }

  return board;
}

function renderBoardFen(fen, lastMoveUci = '') {
  const boardMap = parseFenBoard(fen);
  const fromSq = lastMoveUci?.slice(0, 2) || '';
  const toSq = lastMoveUci?.slice(2, 4) || '';

  document.querySelectorAll('.square').forEach((sq) => {
    sq.classList.remove('highlight-from', 'highlight-to');
    const name = sq.dataset.square;
    const pieceEl = sq.querySelector('.piece');
    const symbol = boardMap.get(name) || '';
    const prev = lastRenderedMap.get(name) || '';

    pieceEl.textContent = PIECE_UNICODE[symbol] || '';

    if (prev !== symbol) {
      pieceEl.classList.remove('piece-changed');
      // reflow
      void pieceEl.offsetWidth;
      pieceEl.classList.add('piece-changed');
    }

    if (name === fromSq) sq.classList.add('highlight-from');
    if (name === toSq) sq.classList.add('highlight-to');
  });

  boardFenEl.textContent = `FEN: ${fen || '-'}`;
  boardLastMoveEl.textContent = `Last move: ${lastMoveUci || '-'}`;
  lastRenderedMap = boardMap;
}

function sideConfig(prefix) {
  const provider = document.getElementById(`${prefix}-provider`).value;
  const model = document.getElementById(`${prefix}-model`).value.trim();
  const apiKey = document.getElementById(`${prefix}-key`).value.trim();
  return { provider, model, apiKey };
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

function renderSummary(summary) {
  gameIdEl.textContent = summary.id;
  statusEl.textContent = summary.status;

  if (summary.result) {
    resultEl.textContent = `${summary.result.winner} / ${summary.result.termination}`;
  } else {
    resultEl.textContent = '-';
  }

  if (summary.fen) {
    renderBoardFen(summary.fen, '');
  }
}

function renderMovesTable(moves = []) {
  movesTableBody.innerHTML = '';
  for (const mv of moves) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.title = '点击跳转到该步';
    tr.innerHTML = `
      <td>${mv.ply}</td>
      <td>${mv.color}</td>
      <td>${mv.provider}:${mv.model || '-'}</td>
      <td>${mv.moveSan || mv.moveUci}</td>
      <td>${mv.latencyMs ?? '-'}</td>
      <td>${mv.usedFallback ? '是' : '否'}</td>
    `;
    tr.addEventListener('click', () => {
      stopReplayTimer();
      setReplayIndex(Number(mv.ply));
    });
    movesTableBody.appendChild(tr);
  }
}

function setReplayIndex(index) {
  if (!replayData || !replayData.snapshots || replayData.snapshots.length === 0) return;

  replayIndex = Math.max(0, Math.min(index, replayData.snapshots.length - 1));
  const snap = replayData.snapshots[replayIndex];
  const lastMove = replayIndex > 0 ? (replayData.moves?.[replayIndex - 1]?.moveUci || '') : '';

  renderBoardFen(snap.fen, lastMove);
  replaySlider.value = String(replayIndex);
  replayLabel.textContent = `ply: ${snap.ply}`;
}

function stopReplayTimer() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
    playBtn.textContent = '▶ 播放';
  }
}

function toggleReplayTimer() {
  if (!replayData) return;
  if (replayTimer) {
    stopReplayTimer();
    return;
  }

  playBtn.textContent = '⏸ 暂停';
  replayTimer = setInterval(() => {
    if (!replayData || replayIndex >= replayData.snapshots.length - 1) {
      stopReplayTimer();
      return;
    }
    setReplayIndex(replayIndex + 1);
  }, 1200);
}

async function loadReplay(gameId) {
  const data = await api(`/api/game/${gameId}/replay`);
  replayData = data.replay;
  renderMovesTable(replayData.moves || []);

  const snapshots = replayData.snapshots || [];
  replaySlider.max = String(Math.max(0, snapshots.length - 1));
  setReplayIndex(snapshots.length - 1);
}

async function pollGame() {
  if (!currentGameId) return;
  try {
    const data = await api(`/api/game/${currentGameId}`);
    const summary = data.game;
    renderSummary(summary);

    if (summary.status === 'finished' || summary.status === 'error') {
      clearInterval(pollTimer);
      pollTimer = null;
      await loadReplay(currentGameId);
      await loadGamesList();
    }
  } catch (err) {
    console.error(err);
  }
}

async function startBattle() {
  stopReplayTimer();

  const payload = {
    white: sideConfig('white'),
    black: sideConfig('black'),
    maxPlies: Number(document.getElementById('max-plies').value || 120),
    moveTimeLimitMs: Number(document.getElementById('move-timeout').value || 30000),
    maxRetries: Number(document.getElementById('max-retries').value || 2),
  };

  const data = await api('/api/game/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  currentGameId = data.gameId;
  replayData = null;
  replayIndex = 0;
  replaySlider.max = '0';
  replaySlider.value = '0';
  replayLabel.textContent = 'ply: 0';
  movesTableBody.innerHTML = '';

  renderSummary(data.summary);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollGame, 1600);
}

async function loadGamesList() {
  const data = await api('/api/games');
  gamesListEl.innerHTML = '';

  for (const g of data.games || []) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.innerHTML = `
      <div><strong>${g.id.slice(0, 8)}</strong> · ${g.status}</div>
      <div style="font-size:12px;color:#6a7c92;">${g.white.provider}:${g.white.model || '-'} vs ${g.black.provider}:${g.black.model || '-'}</div>
    `;

    const btn = document.createElement('button');
    btn.textContent = '加载回放';
    btn.addEventListener('click', async () => {
      currentGameId = g.id;
      renderSummary(g);
      await loadReplay(g.id);
    });

    li.appendChild(info);
    li.appendChild(btn);
    gamesListEl.appendChild(li);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await startBattle();
  } catch (err) {
    alert(`启动失败：${err.message}`);
  }
});

refreshListBtn.addEventListener('click', async () => {
  try {
    await loadGamesList();
  } catch (err) {
    alert(err.message);
  }
});

replaySlider.addEventListener('input', () => {
  stopReplayTimer();
  setReplayIndex(Number(replaySlider.value));
});

prevBtn.addEventListener('click', () => {
  stopReplayTimer();
  setReplayIndex(replayIndex - 1);
});

nextBtn.addEventListener('click', () => {
  stopReplayTimer();
  setReplayIndex(replayIndex + 1);
});

playBtn.addEventListener('click', () => {
  toggleReplayTimer();
});

window.addEventListener('resize', syncBoardSize);

(async function init() {
  initBoardGrid();
  renderBoardFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  try {
    const health = await api('/api/health');
    statusEl.textContent = `服务就绪 ${health.time}`;
  } catch {
    statusEl.textContent = '服务未就绪';
  }

  await loadGamesList();
})();