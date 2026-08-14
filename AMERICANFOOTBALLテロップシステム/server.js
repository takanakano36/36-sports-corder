/* ==========================================================================
   アメフト中継用スポーツコーダー - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3001;

// デフォルトの状態定義 (ダッシュボード・オーバーレイと共通)
let state = {
    homeName: "名古屋産業大学",
    homeSub: "NAGOYASANGYO",
    homeColor: "#991b1b",
    homeLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iIzk5MWIxYiIvPjwvc3ZnPg==",
    homeScore: 0,
    homeTO: 3,

    awayName: "中京大学",
    awaySub: "CHUKYO",
    awayColor: "#1d4ed8",
    awayLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgZmlsbD0iIzFkNGVkOCIvPjwvc3ZnPg==",
    awayScore: 0,
    awayTO: 3,

    tournament: "第54回 東海学生アメリカンフットボールリーグ戦",
    currentPeriod: "1Q",
    timerMinutes: 15,
    timerSeconds: 0,
    timerRunning: false,
    playclock: 40,

    gameClockImage: "",
    playClockImage: "",

    crop: {
        gx: 45, gy: 8, gw: 10, gh: 6,
        px: 75, py: 8, pw: 6, ph: 6
    },

    possession: "none",
    down: 1,
    togo: "10",
    ddVisible: true,

    flagActive: false,
    showOT: false,

    displayMode: "large",

    ransko: {
        home: [0, 0, 0, 0, 0],
        away: [0, 0, 0, 0, 0]
    },

    oneshot: {
        active: false,
        number: "1",
        position: "QB",
        name: "関根 怜玖",
        grade: "4年",
        comment: "名城のエースQB、抜群 of パス精度で攻撃陣を牽引",
        team: "HOME"
    },

    imageTelop: {
        active: false,
        url: ""
    },

    roster: [],
    chromaKey: "green"
};

// SSE接続クライアント
let clients = [];

// 定期的なタイマー処理 (秒減算など、ブラウザ非アクティブ時も動作可能にするためサーバー側でもタイマー同期を用意)
let gameTimerInterval = null;

function startServerTimer() {
    if (gameTimerInterval) return;
    gameTimerInterval = setInterval(() => {
        if (state.timerRunning) {
            if (state.timerSeconds > 0) {
                state.timerSeconds--;
            } else if (state.timerMinutes > 0) {
                state.timerMinutes--;
                state.timerSeconds = 59;
            } else {
                state.timerRunning = false;
            }
            broadcastState();
        }
    }, 1000);
}

function broadcastState() {
    const data = JSON.stringify(state);
    clients.forEach(client => {
        client.write(`event: UPDATE_STATE\ndata: ${data}\n\n`);
    });
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 1. SSEエンドポイント
    if (pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write('\n');
        clients.push(res);

        // 初回接続時に現在の状態を送信
        res.write(`event: UPDATE_STATE\ndata: ${JSON.stringify(state)}\n\n`);

        req.on('close', () => {
            clients = clients.filter(c => c !== res);
        });
        return;
    }

    // 2. 状態取得/更新 API
    if (pathname === '/api/state') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(state));
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const newState = JSON.parse(body);
                    // 状態をマージ更新
                    state = Object.assign(state, newState);
                    broadcastState();
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ status: 'ok' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
        }
        return;
    }

    // 3. Stream Deck / コントロールAPI
    if (pathname === '/api/control') {
        const action = parsedUrl.query.action;
        const val = parsedUrl.query.val;

        console.log(`[API Control] Action: ${action}, Val: ${val}`);

        switch (action) {
            case 'addScoreHome':
                addScore('home', parseInt(val) || 0);
                break;
            case 'addScoreAway':
                addScore('away', parseInt(val) || 0);
                break;
            case 'setDown':
                state.down = Math.max(1, Math.min(4, parseInt(val) || 1));
                break;
            case 'setToGo':
                state.togo = val || "10";
                break;
            case 'setPossession':
                state.possession = val || "none"; // home, away, none
                break;
            case 'toggleFlag':
                state.flagActive = !state.flagActive;
                break;
            case 'toggleOT':
                state.showOT = !state.showOT;
                break;
            case 'toggleDDVisible':
                state.ddVisible = !state.ddVisible;
                break;
            case 'setDisplayMode':
                state.displayMode = val || "none";
                break;
            case 'adjustTOHome':
                state.homeTO = Math.max(0, Math.min(3, state.homeTO + (parseInt(val) || 0)));
                break;
            case 'adjustTOAway':
                state.awayTO = Math.max(0, Math.min(3, state.awayTO + (parseInt(val) || 0)));
                break;
            case 'toggleTimer':
                state.timerRunning = !state.timerRunning;
                if (state.timerRunning) startServerTimer();
                break;
            case 'setPeriod':
                state.currentPeriod = val || "1Q";
                break;
            default:
                res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'Unknown action' }));
                return;
        }

        broadcastState();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'success', state }));
        return;
    }

    // 4. 静的ファイル配信
    let filePath = path.join(__dirname, pathname === '/' ? 'americanfootball_dashboard.html' : pathname);
    
    // パスハック防止
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // クエリパラメータの除去
    const cleanFilePath = filePath.split('?')[0];

    const extname = path.extname(cleanFilePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
        case '.svg': contentType = 'image/svg+xml'; break;
        case '.csv': contentType = 'text/csv'; break;
    }

    fs.readFile(cleanFilePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Qスコアの加算処理（サーバー側）
function addScore(team, val) {
    const qValue = state.currentPeriod;
    const qMap = { "1Q": 0, "2Q": 1, "3Q": 2, "4Q": 3, "OT": 4 };
    const qIndex = qMap[qValue];
    if (qIndex !== undefined) {
        if (team === 'home') {
            state.ransko.home[qIndex] = Math.max(0, state.ransko.home[qIndex] + val);
        } else {
            state.ransko.away[qIndex] = Math.max(0, state.ransko.away[qIndex] + val);
        }
    }
    // 合計値を再計算
    state.homeScore = state.ransko.home.reduce((a, b) => a + b, 0);
    state.awayScore = state.ransko.away.reduce((a, b) => a + b, 0);
}

server.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(` 🏈 American Football Sports Coder Local Server is running on:`);
    console.log(`    http://localhost:${PORT}/`);
    console.log(`======================================================================`);
});
