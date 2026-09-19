/* ==========================================================================
   サッカー中継用スポーツコーダー - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3003;

// デフォルトの状態定義 (ダッシュボード・オーバーレイと共通)
let state = {
    scoreboard: {
        visible: true,
        displayMode: 'small', // 'none', 'small', 'large', 'vs'
        homeName: 'HOME TEAM',
        homeSubName: 'HOME',
        homeColor: '#059669',
        homeLogo: '',
        awayName: 'AWAY TEAM',
        awaySubName: 'AWAY',
        awayColor: '#1d4ed8',
        awayLogo: '',
        tournamentName: '',
        homeScore: 0,
        awayScore: 0,
        period: '1st',
        time: '00:00',
        additionalTime: 0
    },
    pk: {
        visible: false,
        homeResults: [],
        awayResults: [],
        currentIndex: 0,
        currentTeam: 'home',
        firstTeam: 'home'
    },
    players: {
        home: [],
        away: []
    },
    chromakey: 'green'
};

// サッカーのタイマー用内部変数
let totalSeconds = 0;
let timerRunning = false;
let serverTimerInterval = null;

// SSE接続クライアント
let clients = [];

function broadcastState() {
    const data = JSON.stringify(state);
    clients.forEach(client => {
        client.write(`event: UPDATE_STATE\ndata: ${data}\n\n`);
    });
}

function broadcastEvent(type, data) {
    const payload = JSON.stringify({ type, data });
    clients.forEach(client => {
        client.write(`event: EVENT\ndata: ${payload}\n\n`);
    });
}

function startTimer() {
    if (serverTimerInterval) return;
    serverTimerInterval = setInterval(() => {
        if (timerRunning) {
            totalSeconds++;
            const mins = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            state.scoreboard.time = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            broadcastState();
        }
    }, 1000);
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
                    state = Object.assign(state, newState);
                    
                    // ブラウザ側のタイマー値からtotalSecondsを復元
                    const timeParts = state.scoreboard.time.split(':');
                    if (timeParts.length === 2) {
                        totalSeconds = (parseInt(timeParts[0]) || 0) * 60 + (parseInt(timeParts[1]) || 0);
                    }

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

    // 2.5 イベント中継 API
    if (pathname === '/api/event' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                broadcastEvent(payload.type, payload.data);
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // 3. Stream Deck / コントロールAPI
    if (pathname === '/api/control') {
        const action = parsedUrl.query.action;
        const val = parsedUrl.query.val;

        console.log(`[Soccer API Control] Action: ${action}, Val: ${val}`);

        const sb = state.scoreboard;

        switch (action) {
            case 'addScoreHome':
                sb.homeScore = Math.max(0, sb.homeScore + (parseInt(val) || 0));
                break;
            case 'addScoreAway':
                sb.awayScore = Math.max(0, sb.awayScore + (parseInt(val) || 0));
                break;
            case 'toggleTimer':
                timerRunning = !timerRunning;
                if (timerRunning) startTimer();
                break;
            case 'resetTimer':
                totalSeconds = 0;
                sb.time = '00:00';
                break;
            case 'setPeriod':
                sb.period = val || '1st';
                break;
            case 'setAT':
                sb.additionalTime = Math.max(0, parseInt(val) || 0);
                break;
            case 'setDisplayMode':
                sb.displayMode = val || 'none'; // none, small, large, vs
                break;
            
            // 選手紹介テロップのStream Deck操作
            case 'showPlayer':
                const team = parsedUrl.query.team || 'home';
                const num = parsedUrl.query.number || '1';
                const playerList = state.players[team] || [];
                const p = playerList.find(pl => pl.number === num);
                if (p) {
                    broadcastEvent('SHOW_PLAYER_TELOP', {
                        team: team,
                        number: p.number,
                        position: p.position,
                        name: p.name,
                        grade: p.grade,
                        comment: p.comment,
                        color: team === 'home' ? sb.homeColor : sb.awayColor,
                        logo: team === 'home' ? sb.homeLogo : sb.awayLogo,
                        duration: parseInt(parsedUrl.query.duration) || 8
                    });
                }
                break;
            case 'hidePlayer':
                broadcastEvent('HIDE_PLAYER_TELOP');
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
    // URLは%エンコードされているため、日本語・スペースを含む写真フォルダ名などを読めるよう復号する
    let decodedPath = pathname;
    try { decodedPath = decodeURIComponent(pathname); } catch (e) { decodedPath = pathname; }
    let filePath = path.join(__dirname, decodedPath === '/' ? 'soccer_dashboard.html' : decodedPath);
    
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const cleanFilePath = filePath.split('?')[0];
    const extname = path.extname(cleanFilePath).toLowerCase();
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpeg'; break;
        case '.jpeg': contentType = 'image/jpeg'; break;
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

server.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(` ⚽ Soccer Sports Coder Local Server is running on:`);
    console.log(`    http://localhost:${PORT}/`);
    console.log(`======================================================================`);
});
