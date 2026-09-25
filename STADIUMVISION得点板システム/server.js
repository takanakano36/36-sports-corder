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
const VIDEO_DIR = path.join(__dirname, 'videos');
const VIDEO_EXTS = ['.mp4', '.webm', '.m4v'];
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

// ロゴの縁取り（色と太さ）の初期値：白・5
const OUTLINE_MAX = 12;
function defaultOutline() {
    return { color: "#ffffff", width: 5 };
}

// 対戦バナーの初期値（対戦は未登録）
const BANNER_MAX_MATCHES = 8;
function defaultBanner() {
    return {
        date: "",          // 試合日（YYYY-MM-DD）。曜日は表示画面で日付から計算する
        venue: "",         // 会場
        leagueLogo: "",    // リーグロゴ（logos/ フォルダの画像。空なら出さない）
        interval: 30,      // 対戦を切り替える秒数
        footer: true,      // 日付・会場・キックオフの帯を出すか（ハーフタイムなどは出さない）
        active: false,     // バナーを出しているか
        startedAt: 0,      // バナーを出し始めた時刻（ミリ秒）。①②…の切り替えをすべての表示画面でそろえる
        matches: []        // 対戦の一覧
    };
}

// 初めて起動したときの状態（保存ファイルがまだ無いときだけ使う）
function initialState() {
    return {
        tournament: "",
        home: { name: "", color: "#3f3f46", logo: "", outline: defaultOutline(), tdVideo: "", q: [0, 0, 0, 0, 0], to: 3 },
        away: { name: "", color: "#3f3f46", logo: "", outline: defaultOutline(), tdVideo: "", q: [0, 0, 0, 0, 0], to: 3 },
        period: 1,            // 1〜4 = 1Q〜4Q, 5 = OT
        possession: "none",   // home / away / none
        down: 1,              // 1〜4
        togo: "10",           // 数字(1〜99) / GOAL / INCHES
        ballOn: 25,           // 1〜50
        showDown: true,
        showBall: true,
        fgVideo: "",          // FG(+3)の演出動画（チーム共通）
        effectsOn: true,      // TD(+6)・FG(+3)を押したときに演出動画を流すか
        banner: defaultBanner()
    };
}

// ==========================================================================
// 状態のチェック（おかしな値は受け付けずにエラーを返す）
// ==========================================================================
const TEAM_KEYS = ['name', 'color', 'logo', 'outline', 'tdVideo', 'q', 'to'];
const STATE_KEYS = ['tournament', 'home', 'away', 'period', 'possession', 'down', 'togo', 'ballOn', 'showDown', 'showBall', 'fgVideo', 'effectsOn', 'banner'];

// ロゴの指定（空＝ロゴなし、または logos/ フォルダ内の画像）をチェックする
function validateLogo(v, label) {
    if (typeof v !== 'string') return `${label}: ロゴの指定が正しくありません`;
    if (v === '') return null;
    const m = /^logos\/([^\/\\]+)$/.exec(v);
    if (!m || !LOGO_EXTS.includes(path.extname(m[1]).toLowerCase())) return `${label}: ロゴの指定が正しくありません (${v})`;
    if (!fs.existsSync(path.join(LOGO_DIR, m[1]))) return `${label}: ロゴファイルが見つかりません (${v})`;
    return null;
}

function validateOutline(o, label) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !sameKeys(o, ['color', 'width'])) return `${label}: ロゴの縁取りの設定が正しくありません`;
    if (typeof o.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.color)) return `${label}: ロゴの縁取りの色が正しくありません (${o.color})`;
    if (!isInt(o.width, 0, OUTLINE_MAX)) return `${label}: ロゴの縁取りの太さは0〜${OUTLINE_MAX}にしてください`;
    return null;
}

// 実在する日付か（YYYY-MM-DD）
function isValidDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const BANNER_KEYS = ['date', 'venue', 'leagueLogo', 'interval', 'footer', 'active', 'startedAt', 'matches'];
const MATCH_KEYS = ['id', 'show', 'kickoff', 'home', 'away'];
const BANNER_TEAM_KEYS = ['name', 'nick', 'color', 'logo', 'outline', 'logoScale'];

function validateBanner(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b) || !sameKeys(b, BANNER_KEYS)) return '対戦バナーの設定の項目が正しくありません';
    if (typeof b.date !== 'string' || (b.date !== '' && !isValidDate(b.date))) return `対戦バナー: 日付が正しくありません (${b.date})`;
    if (typeof b.venue !== 'string' || b.venue.length > 40) return '対戦バナー: 会場は40文字以内にしてください';
    const llErr = validateLogo(b.leagueLogo, '対戦バナーのリーグロゴ');
    if (llErr) return llErr;
    if (!isInt(b.interval, 5, 600)) return '対戦バナー: 切り替えの秒数は5〜600にしてください';
    if (typeof b.footer !== 'boolean' || typeof b.active !== 'boolean') return '対戦バナー: 表示の設定が正しくありません';
    if (!isInt(b.startedAt, 0, Number.MAX_SAFE_INTEGER)) return '対戦バナー: 開始時刻が正しくありません';
    if (!Array.isArray(b.matches) || b.matches.length > BANNER_MAX_MATCHES) return `対戦バナー: 対戦は${BANNER_MAX_MATCHES}件までにしてください`;
    const ids = new Set();
    for (let i = 0; i < b.matches.length; i++) {
        const m = b.matches[i];
        const label = `対戦${i + 1}`;
        if (!m || typeof m !== 'object' || Array.isArray(m) || !sameKeys(m, MATCH_KEYS)) return `${label}: 項目が正しくありません`;
        if (typeof m.id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(m.id) || ids.has(m.id)) return `${label}: 番号(id)が正しくありません`;
        ids.add(m.id);
        if (typeof m.show !== 'boolean') return `${label}: 「表示する」の値が正しくありません`;
        if (typeof m.kickoff !== 'string' || (m.kickoff !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.kickoff))) return `${label}: キックオフ時間は 12:00 のように入力してください (${m.kickoff})`;
        for (const side of ['home', 'away']) {
            const t = m[side];
            const tl = `${label}の${side === 'home' ? '左' : '右'}チーム`;
            if (!t || typeof t !== 'object' || Array.isArray(t) || !sameKeys(t, BANNER_TEAM_KEYS)) return `${tl}: 項目が正しくありません`;
            if (typeof t.name !== 'string' || t.name.length > 30) return `${tl}: 大学名は30文字以内にしてください`;
            if (typeof t.nick !== 'string' || t.nick.length > 30) return `${tl}: ニックネームは30文字以内にしてください`;
            if (typeof t.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(t.color)) return `${tl}: チームカラーが正しくありません (${t.color})`;
            const e = validateLogo(t.logo, tl) || validateOutline(t.outline, tl);
            if (e) return e;
            if (!isInt(t.logoScale, 50, 200)) return `${tl}: ロゴの大きさは50〜200%にしてください`;
        }
    }
    if (b.active && !b.matches.some(m => m.show)) return '「表示する」にチェックの入った対戦が1件もないため、バナーを出せません（出している最中は、すべてのチェックを外すことはできません）';
    return null;
}

// 演出動画の指定（空＝未登録、または videos/ フォルダ内の動画）をチェックする
function validateVideo(v, label) {
    if (typeof v !== 'string') return `${label}の指定が正しくありません`;
    if (v === '') return null;
    const m = /^videos\/([^\/\\]+)$/.exec(v);
    if (!m || !VIDEO_EXTS.includes(path.extname(m[1]).toLowerCase())) return `${label}の指定が正しくありません (${v})`;
    if (!fs.existsSync(path.join(VIDEO_DIR, m[1]))) return `${label}のファイルが見つかりません (${v})`;
    return null;
}

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
    const lErr = validateLogo(t.logo, label) || validateOutline(t.outline, label);
    if (lErr) return lErr;
    const vErr = validateVideo(t.tdVideo, `${label}: TD演出動画`);
    if (vErr) return vErr;
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
    const fgErr = validateVideo(s.fgVideo, 'FG演出動画');
    if (fgErr) return fgErr;
    if (typeof s.effectsOn !== 'boolean') return '演出動画のオン・オフの値が正しくありません';
    return validateBanner(s.banner);
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
    // 機能を追加する前の保存データには、新しい項目を書き足す（何を足したかは記録に残す）
    ['home', 'away'].forEach(side => {
        const t = s[side];
        if (!t || typeof t !== 'object') return;
        const label = side === 'home' ? '左' : '右';
        if (!('outline' in t)) {
            t.outline = defaultOutline();
            console.log(`[起動] 以前の形式の保存データのため、${label}チームにロゴの縁取り設定（白・5）を追加しました`);
        }
        if (!('tdVideo' in t)) {
            t.tdVideo = '';
            console.log(`[起動] 以前の形式の保存データのため、${label}チームにTD演出動画の欄（未登録）を追加しました`);
        }
    });
    if (!('fgVideo' in s)) {
        s.fgVideo = '';
        console.log('[起動] 以前の形式の保存データのため、FG演出動画の欄（未登録）を追加しました');
    }
    if (!('effectsOn' in s)) {
        s.effectsOn = true;
        console.log('[起動] 以前の形式の保存データのため、演出動画の設定（オン）を追加しました');
    }
    if (!('banner' in s)) {
        s.banner = defaultBanner();
        console.log('[起動] 以前の形式の保存データのため、対戦バナーの設定（対戦は未登録）を追加しました');
    }
    if (s.banner && Array.isArray(s.banner.matches)) {
        s.banner.matches.forEach((m, i) => {
            if (m && typeof m === 'object' && !('show' in m)) {
                m.show = true;
                console.log(`[起動] 以前の形式の保存データのため、対戦${i + 1}に「表示する」（チェックあり）を追加しました`);
            }
        });
    }
    const err = validateState(s);
    if (err) throw new Error(`保存データ(${STATE_FILE})の内容が正しくありません: ${err}`);
    console.log('[起動] 保存データから前回の状態を復元しました');
    return s;
}

// 指定ミリ秒だけ待つ（保存のやり直しの間隔用）
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function saveState(s) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 書き込み途中で止まってもファイルが壊れないよう、一時ファイルに書いてから置き換える
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8');
    renameWithRetry(tmp, STATE_FILE);
}

// OneDrive などの同期ソフトがファイルを一瞬つかんでいると置き換えに失敗するため、少し待ってやり直す
function renameWithRetry(from, to) {
    const RETRY_CODES = ['EPERM', 'EBUSY', 'EACCES'];
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(from, to);
            if (attempt > 1) console.log(`[保存] ${attempt}回目で保存できました (${path.basename(to)})`);
            return;
        } catch (e) {
            if (!RETRY_CODES.includes(e.code) || attempt >= 10) throw e;
            sleepSync(50);
        }
    }
}

let state = loadState();

// ==========================================================================
// 表示画面・管理画面への一斉送信 (SSE)
// ==========================================================================
let clients = [];

function broadcastState() {
    broadcastEvent('UPDATE_STATE', state);
}

// 状態とは別の合図（演出動画の再生・停止、お知らせ）を送る。状態に残さないので、画面を開き直しても再生されない
function broadcastEvent(name, data) {
    const text = JSON.stringify(data);
    clients.forEach(client => client.write(`event: ${name}\ndata: ${text}\n\n`));
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

// 保存できたときだけ反映する（表示と保存データを常に一致させる）
function commit(next) {
    const err = validateState(next);
    if (err) return err;
    try {
        saveState(next);
    } catch (e) {
        console.error(`[保存失敗] ${e.code || ''} ${e.message}`);
        return `保存できなかったため反映していません（${e.code || e.message}）。もう一度操作してください`;
    }
    state = next;
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
    let effect = null;   // 流す演出動画
    let stop = false;    // 演出動画を止める
    const teamLabel = t => t.name || (team === 'home' ? '左チーム' : '右チーム');
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
            const add = num();
            const v = t.q[i] + add;
            if (v < 0) throw new Error('得点が0未満になります');
            t.q[i] = v;
            // TD(+6)・FG(+3)は、演出がオンで動画が登録されていれば演出動画を流す
            if (next.effectsOn && add === 6 && t.tdVideo) effect = { video: t.tdVideo, label: `${teamLabel(t)} TD` };
            if (next.effectsOn && add === 3 && next.fgVideo) effect = { video: next.fgVideo, label: 'FG' };
            break;
        }
        case 'playTD': {             // 得点は変えずに、TD演出動画だけ流す (team=home|away)
            const t = teamObj();
            if (!t.tdVideo) throw new Error(`${teamLabel(t)}のTD演出動画が登録されていません`);
            effect = { video: t.tdVideo, label: `${teamLabel(t)} TD` };
            break;
        }
        case 'playFG':               // 得点は変えずに、FG演出動画だけ流す
            if (!next.fgVideo) throw new Error('FG演出動画が登録されていません');
            effect = { video: next.fgVideo, label: 'FG' };
            break;
        case 'stopEffect':           // 流れている演出動画を止めて得点板に戻す
            stop = true;
            break;
        case 'toggleEffects':        // TD・FGで演出動画を流すかのオン・オフ
            next.effectsOn = !next.effectsOn;
            break;
        case 'showBanner':           // 対戦バナーを出す（①から順に、決めた秒数ごとに切り替えて繰り返す）
            if (!next.banner.matches.some(m => m.show)) throw new Error('「表示する」にチェックの入った対戦が1件もないため、バナーを出せません');
            next.banner.active = true;
            next.banner.startedAt = Date.now();
            break;
        case 'hideBanner':           // 得点板に戻る
            next.banner.active = false;
            break;
        case 'toggleBannerFooter':   // バナーのフッター（日付・会場・キックオフ）のあり／なし
            next.banner.footer = !next.banner.footer;
            break;
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
    return { next, effect, stop };
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

    // 3.5 演出動画の一覧取得・追加（追加はファイルの中身をそのまま送る）
    if (pathname === '/api/videos') {
        if (req.method === 'GET') {
            const files = fs.readdirSync(VIDEO_DIR)
                .filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()))
                .sort((a, b) => a.localeCompare(b, 'ja'))
                .map(f => `videos/${f}`);
            return sendJson(res, 200, files);
        }
        if (req.method === 'POST') {
            const original = String(reqUrl.searchParams.get('filename') || '');
            const ext = path.extname(original).toLowerCase();
            if (!VIDEO_EXTS.includes(ext)) return sendJson(res, 400, { error: 'MP4・WEBM・M4V の動画を選んでください' });
            const base = path.basename(original, path.extname(original)).replace(/[\\\/:*?"<>|\s]+/g, '_').slice(0, 60);
            if (!base) return sendJson(res, 400, { error: 'ファイル名が正しくありません' });
            if (Number(req.headers['content-length'] || 0) > MAX_VIDEO_BYTES) return sendJson(res, 413, { error: '動画は500MB以内にしてください' });
            // 受け取り途中のファイルは一時的な名前で保存し、全部届いてから正式な名前にする
            const tmp = path.join(VIDEO_DIR, `.upload_${Date.now()}.part`);
            const ws = fs.createWriteStream(tmp);
            let size = 0;
            let failed = false;
            const fail = (code, msg) => {
                if (failed) return;
                failed = true;
                ws.destroy();
                fs.rm(tmp, { force: true }, () => {});
                console.error(`[動画追加失敗] ${msg}`);
                sendJson(res, code, { error: msg });
            };
            req.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_VIDEO_BYTES) { fail(413, '動画は500MB以内にしてください'); req.destroy(); }
            });
            req.on('aborted', () => fail(400, '動画の受け取りが途中で止まりました'));
            ws.on('error', e => fail(500, `動画を保存できませんでした (${e.code || e.message})`));
            ws.on('finish', () => {
                if (failed) return;
                if (size === 0) return fail(400, '動画ファイルが空です');
                // 同じ名前のファイルがあっても上書きせず、番号を付けて保存する
                let name = base + ext;
                for (let n = 2; fs.existsSync(path.join(VIDEO_DIR, name)); n++) name = `${base}_${n}${ext}`;
                try {
                    renameWithRetry(tmp, path.join(VIDEO_DIR, name));
                } catch (e) {
                    return fail(500, `動画を保存できませんでした (${e.code || e.message})`);
                }
                console.log(`[動画追加] videos/${name} (${(size / 1024 / 1024).toFixed(1)}MB)`);
                sendJson(res, 200, { path: `videos/${name}` });
            });
            req.pipe(ws);
            return;
        }
        return sendJson(res, 405, { error: 'GET か POST で呼び出してください' });
    }

    // 3.6 表示画面からのお知らせ（動画が再生できなかった等）を管理画面へ伝える
    if (pathname === '/api/notice' && req.method === 'POST') {
        return readBody(req, 4096, (err, body) => {
            let message;
            try { message = String(JSON.parse(body).message || '').slice(0, 300); } catch (e) { message = ''; }
            if (!message) return sendJson(res, 400, { error: 'お知らせの内容がありません' });
            console.error(`[表示画面からのお知らせ] ${message}`);
            broadcastEvent('NOTICE', { message });
            sendJson(res, 200, { status: 'ok' });
        });
    }

    // 4. Stream Deck 等からの操作
    if (pathname === '/api/control') {
        const { action, val, team, q } = Object.fromEntries(reqUrl.searchParams);
        let result;
        try {
            result = applyControl(action, val, team, q);
        } catch (e) {
            console.error(`[操作拒否] ${action}: ${e.message}`);
            return sendJson(res, 400, { error: e.message });
        }
        const vErr = commit(result.next);
        if (vErr) {
            console.error(`[操作拒否] ${action}: ${vErr}`);
            return sendJson(res, 400, { error: vErr });
        }
        if (result.effect) {
            broadcastEvent('PLAY_EFFECT', result.effect);
            console.log(`[演出] ${result.effect.label} (${result.effect.video})`);
        }
        if (result.stop) broadcastEvent('STOP_EFFECT', {});
        console.log(`[操作] ${action} team=${team || '-'} val=${val === undefined ? '-' : val}`);
        return sendJson(res, 200, { status: 'ok', state, effect: result.effect });
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
        '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm'
    };
    const contentType = types[path.extname(filePath).toLowerCase()];
    if (!contentType) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    // 動画は大きいので少しずつ送る。再生の途中から読み込めるよう「範囲指定（Range）」にも対応する
    if (contentType.startsWith('video/')) {
        return fs.stat(filePath, (error, st) => {
            if (error) {
                res.writeHead(error.code === 'ENOENT' ? 404 : 500);
                return res.end(error.code === 'ENOENT' ? 'Not Found' : 'Server Error');
            }
            const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
            if (m && (m[1] !== '' || m[2] !== '')) {
                let start = m[1] === '' ? st.size - Number(m[2]) : Number(m[1]);
                let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
                end = Math.min(end, st.size - 1);
                if (start < 0 || start > end) {
                    res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
                    return res.end();
                }
                res.writeHead(206, {
                    'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
                    'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1
                });
                return fs.createReadStream(filePath, { start, end }).pipe(res);
            }
            res.writeHead(200, { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Content-Length': st.size });
            fs.createReadStream(filePath).pipe(res);
        });
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
