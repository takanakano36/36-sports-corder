const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3004;

// サーバー側で管理する初期状態 (state)
let state = {
  homeName: "HOME TEAM",
  awayName: "AWAY TEAM",
  homeColor: "#0f2746",
  awayColor: "#7f1d1d",
  homeLogo: "",
  awayLogo: "",
  homeScore: 0,
  awayScore: 0,
  homeFouls: 0,
  awayFouls: 0,
  homeTimeouts: 2, // 初期値（前半は2回）
  awayTimeouts: 2,
  period: "1Q",
  possession: "none", // 'home', 'away', 'none'
  timerRunning: false,
  gameClock: 600, // 10分 = 600秒
  shotClock: 24,
  shotClockMode: "manual", // 'manual' または 'camera'
  clockImage: "", // カメラキャプチャ用Base64画像
  displayMode: "large", // 'large', 'small', 'ransko', 'vs', 'hidden', 'image'
  tournamentName: "CHAMPIONSHIP",
  activePlayer: null, // 現在紹介中の選手
  lineupVisible: false,
  lineupTeam: "home", // 'home' または 'away'
  
  // 各Qのスコア履歴 (ランニングスコア表示用)
  homeScoreQ1: 0, homeScoreQ2: 0, homeScoreQ3: 0, homeScoreQ4: 0, homeScoreOT: 0,
  awayScoreQ1: 0, awayScoreQ2: 0, awayScoreQ3: 0, awayScoreQ4: 0, awayScoreOT: 0,
  
  // 全画面スライド (静止画テロップ)
  imageTelop: {
    active: false,
    url: ""
  },

  // クロマキー背景色
  chromaKey: "transparent",

  players: {
    home: [
      { number: "4", position: "PG", name: "山田 太郎", memo: "3年", comment: "キャプテン・大黒柱", fouls: 0, starter: true },
      { number: "5", position: "SG", name: "佐藤 次郎", memo: "3年", comment: "3Pシューター", fouls: 0, starter: true },
      { number: "6", position: "SF", name: "鈴木 三郎", memo: "2年", comment: "ディフェンスの要", fouls: 0, starter: true },
      { number: "7", position: "PF", name: "高橋 四郎", memo: "2年", comment: "リバウンド王", fouls: 0, starter: true },
      { number: "8", position: "C",  name: "田中 五郎", memo: "3年", comment: "ゴール下の支配者", fouls: 0, starter: true },
      { number: "9", position: "G",  name: "渡辺 六郎", memo: "1年", comment: "期待のルーキー", fouls: 0, starter: false },
      { number: "10", position: "F", name: "伊藤 七郎", memo: "1年", comment: "切り札シックスマン", fouls: 0, starter: false }
    ],
    away: [
      { number: "4", position: "PG", name: "Michael Jordan", memo: "3年", comment: "伝説の神様", fouls: 0, starter: true },
      { number: "5", position: "SG", name: "Kobe Bryant", memo: "3年", comment: "ブラックマンバ", fouls: 0, starter: true },
      { number: "6", position: "SF", name: "LeBron James", memo: "2年", comment: "キング", fouls: 0, starter: true },
      { number: "7", position: "PF", name: "Kevin Durant", memo: "2年", comment: "超絶スコアラー", fouls: 0, starter: true },
      { number: "8", position: "C",  name: "Shaq O'Neal", memo: "3年", comment: "規格外の巨人", fouls: 0, starter: true },
      { number: "9", position: "G",  name: "Stephen Curry", memo: "1年", comment: "3Pの革命児", fouls: 0, starter: false },
      { number: "10", position: "F", name: "Luka Doncic", memo: "1年", comment: "若きジーニアス", fouls: 0, starter: false }
    ]
  }
};

// SSEの接続クライアントリスト
let clients = [];

// クライアントへイベントをブロードキャストする関数
function broadcast(event, data) {
  const payload = JSON.stringify(data);
  clients.forEach(client => {
    client.write(`event: ${event}\n`);
    client.write(`data: ${payload}\n\n`);
  });
}

// 静的ファイルのマイムタイプマッピング
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORSヘッダーの設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. SSEエンドポイント
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // 接続時に現在のstateを送信
    res.write(`event: init\n`);
    res.write(`data: ${JSON.stringify(state)}\n\n`);

    clients.push(res);
    console.log(`[SSE] Client connected. Total: ${clients.length}`);

    req.on('close', () => {
      clients = clients.filter(c => c !== res);
      console.log(`[SSE] Client disconnected. Total: ${clients.length}`);
    });
    return;
  }

  // 2. イベント中継 API (POST)
  if (pathname === '/api/event' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const eventData = JSON.parse(body);
        if (eventData.type === 'UPDATE_STATE') {
          state = { ...state, ...eventData.state };
          broadcast('state', state);
        } else if (eventData.type === 'SHOW_PLAYER' || eventData.type === 'show_player') {
          state.activePlayer = eventData.data;
          broadcast('SHOW_PLAYER', eventData.data || {});
          broadcast('show_player', eventData.data || {});
        } else if (eventData.type === 'HIDE_PLAYER' || eventData.type === 'hide_player') {
          state.activePlayer = null;
          broadcast('HIDE_PLAYER', {});
          broadcast('hide_player', {});
        } else if (eventData.type === 'CLOCK_IMAGE') {
          // カメラキャプチャ画像専用の軽量ブロードキャスト
          state.clockImage = eventData.data;
          broadcast('CLOCK_IMAGE', eventData.data);
          broadcast('clock_image', eventData.data);
        } else {
          // 一般的なイベントのブロードキャスト (大文字・小文字両対応)
          broadcast(eventData.type, eventData.data || {});
          broadcast(eventData.type.toLowerCase(), eventData.data || {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 3. Stream Deck等からの外部コントロール用 API (GET)
  if (pathname === '/api/control' && req.method === 'GET') {
    const action = parsedUrl.query.action;
    const val = parsedUrl.query.val;
    const team = parsedUrl.query.team;
    const number = parsedUrl.query.number;

    let updated = false;

    if (action === 'addScoreHome') {
      const increment = parseInt(val) || 0;
      const p = state.period || '1Q';
      let key = 'homeScoreQ1';
      if (p === '1Q') key = 'homeScoreQ1';
      else if (p === '2Q') key = 'homeScoreQ2';
      else if (p === '3Q') key = 'homeScoreQ3';
      else if (p === '4Q') key = 'homeScoreQ4';
      else if (p === 'OT') key = 'homeScoreOT';
      state[key] = Math.max(0, (state[key] || 0) + increment);
      state.homeScore = (state.homeScoreQ1 || 0) + (state.homeScoreQ2 || 0) + (state.homeScoreQ3 || 0) + (state.homeScoreQ4 || 0) + (state.homeScoreOT || 0);
      updated = true;
    } else if (action === 'addScoreAway') {
      const increment = parseInt(val) || 0;
      const p = state.period || '1Q';
      let key = 'awayScoreQ1';
      if (p === '1Q') key = 'awayScoreQ1';
      else if (p === '2Q') key = 'awayScoreQ2';
      else if (p === '3Q') key = 'awayScoreQ3';
      else if (p === '4Q') key = 'awayScoreQ4';
      else if (p === 'OT') key = 'awayScoreOT';
      state[key] = Math.max(0, (state[key] || 0) + increment);
      state.awayScore = (state.awayScoreQ1 || 0) + (state.awayScoreQ2 || 0) + (state.awayScoreQ3 || 0) + (state.awayScoreQ4 || 0) + (state.awayScoreOT || 0);
      updated = true;
    } else if (action === 'addFoulHome') {
      const increment = parseInt(val) || 0;
      state.homeFouls = Math.max(0, state.homeFouls + increment);
      updated = true;
    } else if (action === 'addFoulAway') {
      const increment = parseInt(val) || 0;
      state.awayFouls = Math.max(0, state.awayFouls + increment);
      updated = true;
    } else if (action === 'toggleTimer') {
      state.timerRunning = !state.timerRunning;
      broadcast('timer_toggle', { running: state.timerRunning, gameClock: state.gameClock, shotClock: state.shotClock });
      broadcast('TIMER_TOGGLE', { running: state.timerRunning, gameClock: state.gameClock, shotClock: state.shotClock });
      updated = true;
    } else if (action === 'setDisplayMode') {
      if (['large', 'small', 'ransko', 'vs', 'hidden', 'image'].includes(val)) {
        state.displayMode = val;
        updated = true;
      }
    } else if (action === 'showPlayer' || action === 'togglePlayer') {
      // 選手紹介トグル送出 (1回押すと表示、もう1度押すと消去)
      const targetTeam = team === 'away' ? 'away' : 'home';
      const playerNum = String(number);
      
      // すでに同じ選手が表示中の場合は消去 (トグル動作)
      if (state.activePlayer && state.activePlayer.team === targetTeam && state.activePlayer.number === playerNum) {
        state.activePlayer = null;
        broadcast('hide_player', {});
        broadcast('HIDE_PLAYER', {});
        updated = true;
      } else {
        const player = state.players[targetTeam].find(p => p.number === playerNum);
        if (player) {
          state.activePlayer = {
            team: targetTeam,
            ...player,
            teamName: targetTeam === 'home' ? state.homeName : state.awayName,
            teamColor: targetTeam === 'home' ? state.homeColor : state.awayColor
          };
          broadcast('show_player', state.activePlayer);
          broadcast('SHOW_PLAYER', state.activePlayer);
          updated = true;
        }
      }
    } else if (action === 'hidePlayer') {
      state.activePlayer = null;
      broadcast('hide_player', {});
      broadcast('HIDE_PLAYER', {});
      updated = true;
    }

    if (updated) {
      broadcast('state', state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', state }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid action or missing parameters' }));
    }
    return;
  }

  // 4. 静的ファイルの配信
  // URLは%エンコードされているため、日本語・スペースを含む写真フォルダ名などを読めるよう復号する
  let decodedPath = pathname;
  try { decodedPath = decodeURIComponent(pathname); } catch (e) { decodedPath = pathname; }
  let filePath = path.join(__dirname, decodedPath === '/' ? 'basketball_dashboard.html' : decodedPath);
  
  // 安全性の確認 (ディレクトリトラバーサル防止)
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🏀 BASKETBALL Coder Server is running!`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
