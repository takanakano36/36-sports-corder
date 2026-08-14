/* ==========================================================================
   野球・ソフトボール中継用スポーツコーダー - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3002;

// デフォルトの状態定義 (ダッシュボード・オーバーレイと共通)
let state = {
    scoreboard: {
        visible: true,
        displayMode: 'small', // 'none', 'small', 'large', 'vs'
        homeName: '名古屋産業大',
        homeSubName: 'NAGOYASANGYO',
        homeColor: '#059669',
        homeLogo: '',
        awayName: '中京大学',
        awaySubName: 'CHUKYO',
        awayColor: '#1d4ed8',
        awayLogo: '',
        tournamentName: '第62回 東海学生野球リーグ戦',
        
        // イニングとスコア
        inningNum: 1,
        inningHalf: 'top', // 'top' (表) or 'bot' (裏)
        homeInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''], // 1-12回
        awayInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''],
        homeScore: 0,
        awayScore: 0,
        homeHits: 0,
        awayHits: 0,
        homeErrors: 0,
        awayErrors: 0,
        showHE: true,

        // BSOカウント
        balls: 0,
        strikes: 0,
        outs: 0,

        // ランナー
        runner1st: false,
        runner2nd: false,
        runner3rd: false,

        // 打者・投手・球数
        batterName: '',
        batterNumber: '',
        pitcherName: '',
        pitcherNumber: '',
        pitchCount: 0,

        // カメラキャプチャ（球速・球数画像）
        speedImage: '',
        pitchImage: ''
    },
    players: {
        home: [],
        away: []
    },
    chromakey: 'green'
};

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

    // 2.5 イベント中継 API (DashboardのコマンドをOverlayへブロードキャスト)
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
        const type = parsedUrl.query.type;

        console.log(`[Baseball API Control] Action: ${action}, Type: ${type}, Val: ${val}`);

        const sb = state.scoreboard;

        switch (action) {
            case 'addBSO':
                if (type === 's') {
                    sb.strikes++;
                    if (sb.strikes >= 3) {
                        sb.strikes = 0;
                        sb.balls = 0;
                        sb.outs = Math.min(3, sb.outs + 1);
                    }
                } else if (type === 'b') {
                    sb.balls++;
                    if (sb.balls >= 4) {
                        sb.strikes = 0;
                        sb.balls = 0;
                    }
                } else if (type === 'o') {
                    sb.outs++;
                    if (sb.outs >= 3) {
                        sb.outs = 0;
                        sb.strikes = 0;
                        sb.balls = 0;
                        // イニングチェンジ
                        if (sb.inningHalf === 'top') {
                            sb.inningHalf = 'bot';
                        } else {
                            sb.inningHalf = 'top';
                            sb.inningNum = Math.min(12, sb.inningNum + 1);
                        }
                    }
                }
                break;
            case 'clearBSO':
                sb.balls = 0;
                sb.strikes = 0;
                break;
            case 'addScoreHome':
                addInningScore('home', parseInt(val) || 0);
                break;
            case 'addScoreAway':
                addInningScore('away', parseInt(val) || 0);
                break;
            case 'setInning':
                sb.inningNum = Math.max(1, Math.min(12, parseInt(val) || 1));
                break;
            case 'setInningHalf':
                sb.inningHalf = val === 'bot' ? 'bot' : 'top';
                break;
            case 'toggleRunner':
                if (val === '1') sb.runner1st = !sb.runner1st;
                else if (val === '2') sb.runner2nd = !sb.runner2nd;
                else if (val === '3') sb.runner3rd = !sb.runner3rd;
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
                        avg: p.avg,
                        hr: p.hr,
                        rbi: p.rbi,
                        era: p.era,
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
    let filePath = path.join(__dirname, pathname === '/' ? 'baseball_dashboard.html' : pathname);
    
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

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

// 野球イニングスコア加算処理
function addInningScore(team, val) {
    const sb = state.scoreboard;
    const currentIdx = sb.inningNum - 1; // 0-indexed (0-11)
    
    if (team === 'home') {
        const currentVal = parseInt(sb.homeInningScores[currentIdx]) || 0;
        sb.homeInningScores[currentIdx] = String(Math.max(0, currentVal + val));
        // 合計スコア計算
        sb.homeScore = sb.homeInningScores.reduce((sum, score) => sum + (parseInt(score) || 0), 0);
    } else {
        const currentVal = parseInt(sb.awayInningScores[currentIdx]) || 0;
        sb.awayInningScores[currentIdx] = String(Math.max(0, currentVal + val));
        sb.awayScore = sb.awayInningScores.reduce((sum, score) => sum + (parseInt(score) || 0), 0);
    }
}

server.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(` ⚾ Baseball Sports Coder Local Server is running on:`);
    console.log(`    http://localhost:${PORT}/`);
    console.log(`======================================================================`);
});
