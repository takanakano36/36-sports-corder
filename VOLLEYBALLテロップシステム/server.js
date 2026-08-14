/* ==========================================================================
   バレーボール中継用スポーツコーダー - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3005;

// デフォルトの状態定義 (ダッシュボード・オーバーレイと共通)
let state = {
    gameMode: 'indoor', // 'indoor' | 'beach'
    matchType: '3set',  // '3set' | '5set'
    challengeVisible: true,
    timelineVisible: true,
    homeName: 'HOME TEAM',
    awayName: 'AWAY TEAM',
    homeColor: '#0ea5e9',
    awayColor: '#f97316',
    homeLogo: '',
    awayLogo: '',
    homeScore: 0,
    awayScore: 0,
    homeSets: 0,
    awaySets: 0,
    homeTO: 2,
    awayTO: 2,
    homeChallenge: 2,
    awayChallenge: 2,
    serve: null,       // 'home' | 'away' | null
    displayMode: 'large', // 'large' | 'small' | 'ransko' | 'vs' | 'hidden'
    lineupVisible: false,
    lineupTeam: 'home',
    tournamentName: 'バレーボールカップ 2026',
    chromakey: 'transparent',
    fullscreenSlide: '',
    
    // セット別のスコア
    homeScoreS1: 0, homeScoreS2: 0, homeScoreS3: 0, homeScoreS4: 0, homeScoreS5: 0,
    awayScoreS1: 0, awayScoreS2: 0, awayScoreS3: 0, awayScoreS4: 0, awayScoreS5: 0,
    
    scoreHistory: [],
    courtSwitchAlert: false,
    courtSwitchCount: 0,
    
    players: {
        home: [
            { number: '1', position: 'S', name: '山田 太郎', comment: '正確なトスワーク', memo: '大4', starter: true },
            { number: '3', position: 'OH', name: '佐藤 次郎', comment: '豪快なスパイク', memo: '大3', starter: true },
            { number: '5', position: 'OH', name: '鈴木 三郎', comment: '堅実なレシーブ', memo: '大2', starter: true },
            { number: '7', position: 'MB', name: '高橋 四郎', comment: '鉄壁のブロック', memo: '大4', starter: true },
            { number: '9', position: 'MB', name: '田中 五郎', comment: '俊敏なクイック', memo: '大3', starter: true },
            { number: '11', position: 'OP', name: '渡辺 六郎', comment: '強力なサーブ', memo: '大1', starter: true },
            { number: '12', position: 'L', name: '伊藤 七郎', comment: '守護神リベロ', memo: '大2', starter: true }
        ],
        away: [
            { number: '2', position: 'S', name: 'スミス ジョン', comment: '冷静沈着な司令塔', memo: '大3', starter: true },
            { number: '4', position: 'OH', name: 'ブラウン アレックス', comment: '高さのあるスパイク', memo: '大4', starter: true },
            { number: '6', position: 'OH', name: 'マーフィー クリス', comment: '変幻自在のサーブ', memo: '大3', starter: true },
            { number: '8', position: 'MB', name: 'デイビス ジョージ', comment: '鋭いブロック', memo: '大2', starter: true },
            { number: '10', position: 'MB', name: 'ミラー ケビン', comment: '高い守備範囲', memo: '大4', starter: true },
            { number: '12', position: 'OP', name: 'ジョーンズ マイケル', comment: 'スピードアタッカー', memo: '大1', starter: true },
            { number: '14', position: 'L', name: 'ウイルソン ポール', comment: '驚異の反応速度', memo: '大2', starter: true }
        ]
    }
};

let clients = [];

// クライアントへイベントをブロードキャストする関数
function broadcast(event, data) {
    const payload = JSON.stringify(data);
    clients.forEach(client => {
        client.write(`event: ${event}\n`);
        client.write(`data: ${payload}\n\n`);
    });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
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
                } else {
                    broadcast(eventData.type, eventData.data || {});
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

        console.log(`[Control API] Action: ${action}, Val: ${val}`);
        let updated = false;

        if (action === 'addScoreHome') {
            state.homeScore = Math.max(0, state.homeScore + (parseInt(val) || 1));
            updated = true;
        } else if (action === 'addScoreAway') {
            state.awayScore = Math.max(0, state.awayScore + (parseInt(val) || 1));
            updated = true;
        } else if (action === 'addSetHome') {
            state.homeSets = Math.max(0, state.homeSets + (parseInt(val) || 1));
            updated = true;
        } else if (action === 'addSetAway') {
            state.awaySets = Math.max(0, state.awaySets + (parseInt(val) || 1));
            updated = true;
        } else if (action === 'setServe') {
            state.serve = val === 'none' ? null : val;
            updated = true;
        } else if (action === 'setDisplayMode') {
            if (['large', 'small', 'ransko', 'vs', 'hidden'].includes(val)) {
                state.displayMode = val;
                updated = true;
            }
        }

        if (updated) {
            broadcast('state', state);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', state }));
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid action or parameters' }));
        }
        return;
    }

    // 4. 静的ファイルの配信
    let filePath = path.join(__dirname, pathname === '/' ? 'volleyball_dashboard.html' : pathname);
    
    // ディレクトリトラバーサル防止
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
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(` 🏐 Volleyball Sports Coder Local Server is running on:`);
    console.log(`    http://localhost:${PORT}/`);
    console.log(`======================================================================`);
});
