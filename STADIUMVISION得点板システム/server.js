/* ==========================================================================
   スタジアムビジョン得点板 - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   - 管理画面(dashboard.html)の操作を、表示画面(scoreboard.html)へ即時に送る
   - 状態は data/state.json に保存し、PCやブラウザが落ちても続きから再開できる
   - Stream Deck 等から /api/control で操作できる
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3006;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOGO_DIR = path.join(__dirname, 'logos');
const LOGO_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// 初めて起動したときの状態（保存ファイルがまだ無いときだけ使う）
function initialState() {
    return {
        tournament: "",
        home: { name: "", color: "#3f3f46", logo: "", q: [0, 0, 0, 0, 0], to: 3 },
        away: { name: "", color: "#3f3f46", logo: "", q: [0, 0, 0, 0, 0], to: 3 },
        period: 1,            // 1〜4 = 1Q〜4Q, 5 = OT
        possession: "none",   // home / away / none
        down: 1,              // 1〜4
        togo: "10",           // 数字(1〜99) / GOAL / INCHES
        ballOn: 25,           // 1〜50
        showDown: true,
        showBall: true
    };
}

// ==========================================================================
// 状態のチェック（おかしな値は受け付けずにエラーを返す）
// ==========================================================================
const TEAM_KEYS = ['name', 'color', 'logo', 'q', 'to'];
const STATE_KEYS = ['tournament', 'home', 'away', 'period', 'possession', 'down', 'togo', 'ballOn', 'showDown', 'showBall'];

function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
}

function sameKeys(obj, keys) {
    const k = Object.keys(obj).sort();
    return k.length === keys.length && [...keys].sort().every((x, i) => x === k[i]);
}

function validateTeam(t, label) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return `${label}: チーム情報がありません`;
    if (!sameKeys(t, TEAM_KEYS)) return `${label}: 項目が正しくありません (${Object.keys(t).join(',')})`;
    if (typeof t.name !== 'string' || t.name.length > 30) return `${label}: チーム名は30文字以内の文字列にしてください`;
    if (typeof t.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(t.color)) return `${label}: チームカラーが正しくありません (${t.color})`;
    if (typeof t.logo !== 'string') return `${label}: ロゴの指定が正しくありません`;
    if (t.logo !== '') {
        const m = /^logos\/([^\/\\]+)$/.exec(t.logo);
        if (!m || !LOGO_EXTS.includes(path.extname(m[1]).toLowerCase())) return `${label}: ロゴの指定が正しくありません (${t.logo})`;
        if (!fs.existsSync(path.join(LOGO_DIR, m[1]))) return `${label}: ロゴファイルが見つかりません (${t.logo})`;
    }
    if (!Array.isArray(t.q) || t.q.length !== 5 || !t.q.every(v => isInt(v, 0, 199))) return `${label}: Qごとの得点が正しくありません`;
    if (!isInt(t.to, 0, 3)) return `${label}: タイムアウト残数は0〜3にしてください`;
    return null;
}

function validateState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return '状態データがありません';
    if (!sameKeys(s, STATE_KEYS)) return `項目が正しくありません (${Object.keys(s).join(',')})`;
    if (typeof s.tournament !== 'string' || s.tournament.length > 60) return '大会名は60文字以内の文字列にしてください';
    const teamErr = validateTeam(s.home, '左チーム') || validateTeam(s.away, '右チーム');
    if (teamErr) return teamErr;
    if (!isInt(s.period, 1, 5)) return 'クォーターが正しくありません';
    if (!['home', 'away', 'none'].includes(s.possession)) return '攻撃権が正しくありません';
    if (!isInt(s.down, 1, 4)) return 'ダウンは1〜4にしてください';
    if (typeof s.togo !== 'string' || !(/^(GOAL|INCHES)$/.test(s.togo) || (/^\d{1,2}$/.test(s.togo) && Number(s.togo) >= 1))) return '残り距離は1〜99、GOAL、INCHESのいずれかにしてください';
    if (!isInt(s.ballOn, 1, 50)) return 'BALL ONは1〜50にしてください';
    if (typeof s.showDown !== 'boolean' || typeof s.showBall !== 'boolean') return '表示切替の値が正しくありません';
    return null;
}

// ==========================================================================
// 状態の読み込み・保存
// ==========================================================================
function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        console.log('[起動] 保存データが無いため、初期状態で開始します');
        return initialState();
    }
    // 保存データが壊れている場合は、勝手に初期化せずに止める（試合中のデータを失わないため）
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    let s;
    try {
        s = JSON.parse(raw);
    } catch (e) {
        throw new Error(`保存データ(${STATE_FILE})を読み込めません: ${e.message}`);
    }
    const err = validateState(s);
    if (err) throw new Error(`保存データ(${STATE_FILE})の内容が正しくありません: ${err}`);
    console.log('[起動] 保存データから前回の状態を復元しました');
    return s;
}

function saveState() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 書き込み途中で止まってもファイルが壊れないよう、一時ファイルに書いてから置き換える
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
}

let state = loadState();

// ==========================================================================
// 表示画面・管理画面への一斉送信 (SSE)
// ==========================================================================
let clients = [];

function broadcastState() {
    const data = JSON.stringify(state);
    clients.forEach(client => client.write(`event: UPDATE_STATE\ndata: ${data}\n\n`));
}

// 送られてきた「変えた項目だけ」を今の状態に重ねる（送られていない項目はそのまま）
function mergePatch(base, patch) {
    const out = JSON.parse(JSON.stringify(base));
    (function merge(target, src, pathLabel) {
        Object.keys(src).forEach(key => {
            if (!(key in target)) throw new Error(`不明な項目です (${pathLabel}${key})`);
            const v = src[key];
            if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                merge(target[key], v, `${pathLabel}${key}.`);
            } else {
                target[key] = v;
            }
        });
    })(out, patch, '');
    return out;
}

function commit(next) {
    const err = validateState(next);
    if (err) return err;
    state = next;
    saveState();
    broadcastState();
    return null;
}

function sendJson(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
}

// 受け取ったデータは最後にまとめて文字に直す（日本語の文字が途中で分かれて化けないように）
function readBody(req, limit, cb) {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
        if (size > limit) return cb(new Error('データが大きすぎます'));
        cb(null, Buffer.concat(chunks).toString('utf-8'));
    });
}

// ==========================================================================
// Stream Deck 等からの操作 (/api/control?action=...&val=...)
// ==========================================================================
function applyControl(action, val, team, q) {
    const next = JSON.parse(JSON.stringify(state));
    const teamObj = () => {
        if (team !== 'home' && team !== 'away') throw new Error('team は home か away を指定してください');
        return next[team];
    };
    const num = () => {
        if (val === undefined || !/^-?\d+$/.test(val)) throw new Error(`val に整数を指定してください (${val})`);
        return Number(val);
    };

    switch (action) {
        case 'addScore': {           // 今のQに得点を加える (team=home|away, val=6/3/2/1/-1 など)
            const t = teamObj();
            const i = next.period - 1;
            const v = t.q[i] + num();
            if (v < 0) throw new Error('得点が0未満になります');
            t.q[i] = v;
            break;
        }
        case 'setPeriod':            // val=1〜5 (5=OT)
            next.period = num();
            break;
        case 'nextPeriod':
            if (next.period >= 5) throw new Error('これ以上先のクォーターはありません');
            next.period += 1;
            break;
        case 'setQ': {               // 得点の直接修正 (team=home|away, q=1〜5, val=0〜199)
            const t = teamObj();
            if (!/^[1-5]$/.test(q || '')) throw new Error(`q に1〜5を指定してください (${q})`);
            const v = num();
            if (v < 0) throw new Error('得点は0以上にしてください');
            t.q[Number(q) - 1] = v;
            break;
        }
        case 'adjustTO':             // team=home|away, val=-1/1
            teamObj().to += num();
            break;
        case 'resetTO':              // 両チームのタイムアウトを3に戻す（後半開始時など）
            next.home.to = 3;
            next.away.to = 3;
            break;
        case 'setPossession':        // val=home|away|none
            next.possession = val;
            break;
        case 'setDown':              // val=1〜4
            next.down = num();
            break;
        case 'setToGo':              // val=1〜99 / GOAL / INCHES
            next.togo = val;
            break;
        case 'setBallOn':            // val=1〜50
            next.ballOn = num();
            break;
        case 'toggleDown':
            next.showDown = !next.showDown;
            break;
        case 'toggleBall':
            next.showBall = !next.showBall;
            break;
        default:
            throw new Error(`不明な操作です (${action})`);
    }
    return next;
}

// ==========================================================================
// HTTPサーバー
// ==========================================================================
const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = reqUrl.pathname;

    // 1. SSE（表示画面・管理画面が接続して、状態の変化を受け取る）
    if (pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write('\n');
        clients.push(res);
        res.write(`event: UPDATE_STATE\ndata: ${JSON.stringify(state)}\n\n`);
        req.on('close', () => { clients = clients.filter(c => c !== res); });
        return;
    }

    // 2. 状態の取得・更新（管理画面から「変えた項目だけ」を送る）
    //    例: {"home":{"name":"立命館大学"}} → 左チームの名前だけ変わり、他はそのまま
    if (pathname === '/api/state') {
        if (req.method === 'GET') return sendJson(res, 200, state);
        if (req.method === 'POST') {
            return readBody(req, 1024 * 1024, (err, body) => {
                if (err) return sendJson(res, 413, { error: err.message });
                let next;
                try {
                    const patch = JSON.parse(body);
                    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('送られたデータの形が正しくありません');
                    next = mergePatch(state, patch);
                } catch (e) {
                    console.error(`[更新拒否] ${e.message}`);
                    return sendJson(res, 400, { error: e instanceof SyntaxError ? '送られたデータを読み取れません' : e.message });
                }
                const vErr = commit(next);
                if (vErr) {
                    console.error(`[更新拒否] ${vErr}`);
                    return sendJson(res, 400, { error: vErr });
                }
                sendJson(res, 200, { status: 'ok' });
            });
        }
        return sendJson(res, 405, { error: 'GET か POST で呼び出してください' });
    }

    // 3. ロゴ一覧の取得・ロゴの追加
    if (pathname === '/api/logos') {
        if (req.method === 'GET') {
            const files = fs.readdirSync(LOGO_DIR)
                .filter(f => LOGO_EXTS.includes(path.extname(f).toLowerCase()))
                .sort((a, b) => a.localeCompare(b, 'ja'))
                .map(f => `logos/${f}`);
            return sendJson(res, 200, files);
        }
        if (req.method === 'POST') {
            return readBody(req, MAX_LOGO_BYTES * 1.4, (err, body) => {
                if (err) return sendJson(res, 413, { error: 'ロゴ画像は5MB以内にしてください' });
                let data;
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    return sendJson(res, 400, { error: '送られたデータを読み取れません' });
                }
                const m = /^data:image\/(png|jpeg|svg\+xml|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl || '');
                if (!m) return sendJson(res, 400, { error: 'PNG・JPEG・SVG・WEBP の画像を選んでください' });
                const ext = { 'png': '.png', 'jpeg': '.jpg', 'svg+xml': '.svg', 'webp': '.webp' }[m[1]];
                // ファイル名に使えない文字を取り除く
                const base = path.basename(String(data.filename || ''), path.extname(String(data.filename || '')))
                    .replace(/[\\\/:*?"<>|\s]+/g, '_').slice(0, 60);
                if (!base) return sendJson(res, 400, { error: 'ファイル名が正しくありません' });
                // 同じ名前のファイルがあっても上書きせず、番号を付けて保存する
                let name = base + ext;
                for (let n = 2; fs.existsSync(path.join(LOGO_DIR, name)); n++) name = `${base}_${n}${ext}`;
                fs.writeFileSync(path.join(LOGO_DIR, name), Buffer.from(m[2], 'base64'));
                console.log(`[ロゴ追加] logos/${name}`);
                sendJson(res, 200, { path: `logos/${name}` });
            });
        }
        return sendJson(res, 405, { error: 'GET か POST で呼び出してください' });
    }

    // 4. Stream Deck 等からの操作
    if (pathname === '/api/control') {
        const { action, val, team, q } = Object.fromEntries(reqUrl.searchParams);
        let next;
        try {
            next = applyControl(action, val, team, q);
        } catch (e) {
            console.error(`[操作拒否] ${action}: ${e.message}`);
            return sendJson(res, 400, { error: e.message });
        }
        const vErr = commit(next);
        if (vErr) {
            console.error(`[操作拒否] ${action}: ${vErr}`);
            return sendJson(res, 400, { error: vErr });
        }
        console.log(`[操作] ${action} team=${team || '-'} val=${val === undefined ? '-' : val}`);
        return sendJson(res, 200, { status: 'ok', state });
    }

    // 5. 画面ファイルの配信
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch (e) {
        res.writeHead(400);
        return res.end('Bad Request');
    }
    const filePath = path.join(__dirname, decodedPath === '/' ? 'dashboard.html' : decodedPath);
    // フォルダの外や保存データへのアクセスは禁止
    if (!filePath.startsWith(__dirname + path.sep) || filePath.startsWith(DATA_DIR + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    const types = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.ttf': 'font/ttf'
    };
    const contentType = types[path.extname(filePath).toLowerCase()];
    if (!contentType) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(error.code === 'ENOENT' ? 404 : 500);
            return res.end(error.code === 'ENOENT' ? 'Not Found' : 'Server Error');
        }
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        res.end(content);
    });
});

// ==========================================================================
// 起動（「--open」付きで起動したときは、準備ができた後に管理画面をブラウザで開く）
// ==========================================================================
const OPEN_DASHBOARD = process.argv.includes('--open');
const DASHBOARD_URL = `http://localhost:${PORT}/`;

// いつも使っているブラウザで管理画面を開く（Windowsの start コマンド）
function openDashboard() {
    require('child_process').exec(`start "" "${DASHBOARD_URL}"`, err => {
        if (err) console.error(`[エラー] 管理画面を自動で開けませんでした。ブラウザで ${DASHBOARD_URL} を開いてください (${err.message})`);
    });
    console.log('   → 管理画面をブラウザで開きました');
}

server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;
    // 3006番がすでに使われている：得点板のサーバーがもう動いているのかを確かめる
    http.get(`http://localhost:${PORT}/api/state`, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            let isScoreboard = false;
            try { isScoreboard = res.statusCode === 200 && validateState(JSON.parse(body)) === null; } catch (e) { isScoreboard = false; }
            if (isScoreboard) {
                console.log('得点板のサーバーは、すでに起動しています（この画面は閉じて大丈夫です）。');
                if (OPEN_DASHBOARD) openDashboard();
                setTimeout(() => process.exit(0), 500);
            } else {
                console.error(`[エラー] ${PORT}番を別のソフトが使っているため、起動できません。そのソフトを終了してからもう一度起動してください。`);
                process.exit(1);
            }
        });
    }).on('error', e => {
        console.error(`[エラー] ${PORT}番が使えないため、起動できません (${e.message})`);
        process.exit(1);
    });
});

server.listen(PORT, () => {
    console.log('======================================================================');
    console.log(' スタジアムビジョン得点板 サーバー起動中');
    console.log(`   管理画面 : ${DASHBOARD_URL}`);
    console.log(`   表示画面 : ${DASHBOARD_URL}scoreboard.html`);
    console.log('======================================================================');
    if (OPEN_DASHBOARD) openDashboard();
});
