/* ==========================================================================
   スタジアムビジョン野球システム (32:9 / FHD×2 / SDI 1本の帯) - SSE同期 ＆ API制御用ローカルサーバー (Node.js)
   - 管理画面(dashboard.html)で組んだ画面を、表示画面(vision.html)へ即時に送る
   - 状態は data/state.json に保存し、PCやブラウザが落ちても続きから再開できる
   - Stream Deck 等から /api/control で操作できる
   ※ 「STADIUMVISION得点板システム」(アメフト・3006番) をもとに、野球場の32:9ビジョン向けに作ったもの
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3007;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
// スライド（画像・動画）。中のフォルダ＝分類（例: slides/開会式/01_ようこそ.png）
const SLIDE_DIR = path.join(__dirname, 'slides');
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.m4v'];
const SLIDE_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];
const MAX_SLIDE_BYTES = 500 * 1024 * 1024;
// 既製の選手紹介スライド  players/<チームのフォルダ名>/<背番号>.png
const PLAYER_DIR = path.join(__dirname, 'players');
// 顔写真  photos/<チームのフォルダ名>/player/<背番号>.jpg
const PHOTO_DIR = path.join(__dirname, 'photos');
// 音楽（管理画面のPCで鳴らす）。直下の曲が音楽バーのボタンになる
const MUSIC_DIR = path.join(__dirname, 'music');
const MUSIC_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
const MUSIC_NAME_RE = /^(\d+)_(.+)$/;
// 登場曲  music/登場曲/<チームのフォルダ名>/<背番号>.mp3
const WALKUP_DIR = path.join(MUSIC_DIR, '登場曲');

// ==========================================================================
// 状態の形
// ==========================================================================
const LAYOUTS = ['wide', 'split', 'single'];      // 32:9一枚 / 16:9左右 / 16:9一枚(位置指定)
const SLOT_KEYS = ['wide', 'left', 'right', 'single', 'bg'];
const SRC_TYPES = ['black', 'slide', 'url', 'camera', 'player', 'lineup', 'text', 'color', 'test'];
const CAMS = ['cam1', 'cam2'];
const TEAMS = ['HOME', 'AWAY'];
const CARD_TYPES = ['atbat', 'sub', 'hr'];
const MAX_CUES = 300;
const MAX_ROSTER = 200;

function emptyScene() {
    const slots = {};
    SLOT_KEYS.forEach(k => { slots[k] = { type: 'black' }; });
    return { layout: 'wide', slots, singleX: 50 };
}

function initialState() {
    return {
        program: emptyScene(),                 // いまビジョンに出ている画面
        black: false,                          // 黒にする（BLACK）
        guide: false,                          // 2画面の境目の線を出す（設置・調整用）
        // 出力の形
        //   wide … 3840×1080（32:9）をそのまま出す
        //   sdi  … 1920×1080 で出し、ビジョンに映る「帯」（y=bandY から高さ bandH）だけを使う
        //          （HDMI→SDIコンバーター経由で、スケーラーが横100%・上下トリミングする現場用）
        output: { mode: 'wide', bandY: 225, bandH: 630 },
        transition: { type: 'fade', ms: 500 }, // 切り替え方（cut / fade）
        cameras: { cam1: { deviceId: '', label: '' }, cam2: { deviceId: '', label: '' } },
        teams: {
            HOME: { name: 'HOME', color: '#b91c1c', photoTeam: '' },
            AWAY: { name: 'AWAY', color: '#1d4ed8', photoTeam: '' }
        },
        roster: [],                            // 選手名簿（CSVから読み込む）
        derby: { count: 0, outs: 0 },          // ホームラン競争のカウンター
        cues: [],                              // 式次第（キュー）
        cueIndex: -1                           // いま出しているキュー（-1 = なし）
    };
}

const STATE_KEYS = Object.keys(initialState());

// ==========================================================================
// 入力チェック（おかしな値はビジョンに出さない）
// ==========================================================================
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 300) => typeof v === 'string' && v.length <= max;
const isNum = (v, min, max) => typeof v === 'number' && isFinite(v) && v >= min && v <= max;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
// フォルダの外を指さない、決まったフォルダの中のファイル名か
const isMediaPath = (v, dirs) => isStr(v, 500) && dirs.some(d => v.startsWith(d + '/')) && !v.split('/').includes('..') && !v.includes('\\');

const PLAYER_KEYS = ['team', 'order', 'number', 'position', 'name', 'kana', 'avg', 'hr', 'rbi', 'era', 'comment', 'bgm', 'slide', 'photo'];

function validatePlayer(p, label) {
    if (!isObj(p)) return `${label}の形が正しくありません`;
    for (const k of Object.keys(p)) {
        if (!PLAYER_KEYS.includes(k)) return `${label}に不明な項目があります (${k})`;
        if (!isStr(p[k], 300)) return `${label}の「${k}」が正しくありません`;
    }
    if (p.team !== undefined && !TEAMS.includes(p.team)) return `${label}のチームは HOME か AWAY にしてください`;
    return null;
}

function validateSrc(s, label) {
    if (!isObj(s) || !SRC_TYPES.includes(s.type)) return `${label}の素材の種類が正しくありません`;
    if (s.fit !== undefined && !['cover', 'contain'].includes(s.fit)) return `${label}の表示方法が正しくありません`;
    if (s.posX !== undefined && !isNum(s.posX, 0, 100)) return `${label}の左右位置は0〜100にしてください`;
    if (s.posY !== undefined && !isNum(s.posY, 0, 100)) return `${label}の上下位置は0〜100にしてください`;
    if (s.zoom !== undefined && !isNum(s.zoom, 100, 400)) return `${label}の拡大は100〜400%にしてください`;
    switch (s.type) {
        case 'slide':
            if (!isMediaPath(s.file, ['slides', 'players'])) return `${label}のスライドのファイル名が正しくありません`;
            break;
        case 'url':
            if (!isStr(s.url, 2000) || !/^https?:\/\//.test(s.url)) return `${label}のURLは http:// か https:// で始めてください`;
            break;
        case 'camera':
            if (!CAMS.includes(s.cam)) return `${label}のカメラは cam1 か cam2 にしてください`;
            break;
        case 'player': {
            if (!CARD_TYPES.includes(s.card)) return `${label}の選手紹介の種類が正しくありません`;
            const e = validatePlayer(s.player, `${label}の選手`);
            if (e) return e;
            if (s.out !== undefined) { const e2 = validatePlayer(s.out, `${label}の交代で退く選手`); if (e2) return e2; }
            if (s.label !== undefined && !isStr(s.label, 60)) return `${label}の見出しは60文字以内にしてください`;
            break;
        }
        case 'lineup':
            if (!TEAMS.includes(s.team)) return `${label}のチームが正しくありません`;
            if (!Array.isArray(s.rows) || s.rows.length > 12) return `${label}のスタメンは12人までです`;
            for (const r of s.rows) { const e = validatePlayer(r, `${label}のスタメン`); if (e) return e; }
            break;
        case 'text':
            if (!isStr(s.title, 200) || !s.title) return `${label}のタイトルを入れてください（200文字以内）`;
            if (s.sub !== undefined && !isStr(s.sub, 300)) return `${label}のサブタイトルは300文字以内にしてください`;
            if (s.color !== undefined && !isHex(s.color)) return `${label}の背景色が正しくありません`;
            if (s.textColor !== undefined && !isHex(s.textColor)) return `${label}の文字色が正しくありません`;
            break;
        case 'color':
            if (!isHex(s.color)) return `${label}の色が正しくありません`;
            break;
    }
    return null;
}

function validateScene(sc, label) {
    if (!isObj(sc)) return `${label}の形が正しくありません`;
    if (!LAYOUTS.includes(sc.layout)) return `${label}のレイアウトが正しくありません`;
    if (!isNum(sc.singleX, 0, 100)) return `${label}の16:9の位置は0〜100にしてください`;
    if (!isObj(sc.slots)) return `${label}の枠の形が正しくありません`;
    for (const k of SLOT_KEYS) {
        const e = validateSrc(sc.slots[k], `${label}（${k}）`);
        if (e) return e;
    }
    return null;
}

function validateState(s) {
    if (!isObj(s)) return '状態の形が正しくありません';
    for (const k of STATE_KEYS) if (!(k in s)) return `項目が足りません (${k})`;
    for (const k of Object.keys(s)) if (!STATE_KEYS.includes(k)) return `不明な項目です (${k})`;

    let e = validateScene(s.program, '本線');
    if (e) return e;
    if (typeof s.black !== 'boolean' || typeof s.guide !== 'boolean') return 'BLACK・境目の線の設定が正しくありません';
    if (!isObj(s.transition) || !['cut', 'fade'].includes(s.transition.type) || !isInt(s.transition.ms, 0, 5000)) {
        return '切り替え方は CUT か FADE、時間は0〜5000ミリ秒にしてください';
    }
    const o = s.output;
    if (!isObj(o) || !['wide', 'sdi'].includes(o.mode) || !isInt(o.bandY, 0, 1000) || !isInt(o.bandH, 80, 1080) || o.bandY + o.bandH > 1080) {
        return '出力の形が正しくありません（帯の上端は0〜1000、高さは80〜1080、上端＋高さは1080以内）';
    }
    if (!isObj(s.cameras)) return 'カメラの設定が正しくありません';
    for (const c of CAMS) {
        const cam = s.cameras[c];
        if (!isObj(cam) || !isStr(cam.deviceId, 500) || !isStr(cam.label, 300)) return `カメラ(${c})の設定が正しくありません`;
    }
    if (!isObj(s.teams)) return 'チームの設定が正しくありません';
    for (const t of TEAMS) {
        const tm = s.teams[t];
        if (!isObj(tm) || !isStr(tm.name, 60) || !isHex(tm.color) || !isStr(tm.photoTeam, 100)) return `チーム(${t})の設定が正しくありません`;
        if (tm.photoTeam.includes('/') || tm.photoTeam.includes('\\') || tm.photoTeam.includes('..')) return `チーム(${t})のフォルダ名に / \\ .. は使えません`;
    }
    if (!Array.isArray(s.roster) || s.roster.length > MAX_ROSTER) return `選手名簿は${MAX_ROSTER}人までです`;
    for (let i = 0; i < s.roster.length; i++) {
        e = validatePlayer(s.roster[i], `名簿の${i + 1}人目`);
        if (e) return e;
        if (!s.roster[i].name) return `名簿の${i + 1}人目に名前がありません`;
    }
    if (!isObj(s.derby) || !isInt(s.derby.count, 0, 999) || !isInt(s.derby.outs, 0, 99)) return 'HR競争のカウンターが正しくありません';
    if (!Array.isArray(s.cues) || s.cues.length > MAX_CUES) return `式次第は${MAX_CUES}個までです`;
    for (let i = 0; i < s.cues.length; i++) {
        const c = s.cues[i];
        const label = `式次第の${i + 1}番目`;
        if (!isObj(c) || !isStr(c.name, 100) || !isStr(c.memo, 1000)) return `${label}の名前・メモが正しくありません`;
        e = validateScene(c.scene, label);
        if (e) return e;
        if (!isObj(c.music) || !['', 'play', 'stop'].includes(c.music.action) || !isStr(c.music.path, 500) || !isStr(c.music.name, 300)) {
            return `${label}の音楽の設定が正しくありません`;
        }
        if (c.music.action === 'play' && !isMediaPath(c.music.path, ['music'])) return `${label}の曲が正しくありません`;
    }
    if (!isInt(s.cueIndex, -1, MAX_CUES - 1)) return 'いま出しているキューの番号が正しくありません';
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
    // 保存データが壊れている場合は、勝手に初期化せずに止める（式次第や名簿を失わないため）
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    let s;
    try {
        s = JSON.parse(raw);
    } catch (e) {
        throw new Error(`保存データ(${STATE_FILE})を読み込めません: ${e.message}`);
    }
    // 機能を追加する前の保存データには、新しい項目を書き足す
    const init = initialState();
    STATE_KEYS.forEach(k => {
        if (!(k in s)) {
            s[k] = init[k];
            console.log(`[起動] 以前の形式の保存データのため、「${k}」を初期値で追加しました`);
        }
    });
    // BLACKはその場かぎりのもの。起動し直したときに真っ黒のままにならないよう解除して始める
    if (s.black) {
        console.log('[起動] 前回の終了時に BLACK になっていたため、解除して始めます');
        s.black = false;
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

// 状態とは別の合図（TAKE・音楽の操作・お知らせ）を送る。状態に残さないので、画面を開き直しても繰り返されない
function broadcastEvent(name, data) {
    const text = JSON.stringify(data);
    clients.forEach(client => client.write(`event: ${name}\ndata: ${text}\n\n`));
}

// 送られてきた項目だけを置き換える（送られていない項目はそのまま）
// ※ 画面の組み合わせ・名簿・式次第は中身ごと置き換える（部分的に混ざると別の画面になってしまうため）
function applyPatch(base, patch) {
    const out = JSON.parse(JSON.stringify(base));
    Object.keys(patch).forEach(key => {
        if (!STATE_KEYS.includes(key)) throw new Error(`不明な項目です (${key})`);
        out[key] = patch[key];
    });
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
// 素材の一覧
// ==========================================================================
// フォルダの中を（中のフォルダも含めて）調べる。返す path は「slides/開会式/01.png」の形
function listTree(rootDir, topName, exts) {
    const out = [];
    (function walk(abs, rel) {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of entries) {
            if (ent.name.startsWith('.')) continue;
            const r = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isDirectory()) { walk(path.join(abs, ent.name), r); continue; }
            const ext = path.extname(ent.name).toLowerCase();
            if (!exts.includes(ext)) continue;
            out.push({
                path: `${topName}/${r}`,
                folder: rel,
                name: path.basename(ent.name, path.extname(ent.name)),
                kind: VIDEO_EXTS.includes(ext) ? 'video' : MUSIC_EXTS.includes(ext) ? 'audio' : 'image'
            });
        }
    })(rootDir, '');
    return out.sort((a, b) => a.path.localeCompare(b.path, 'ja', { numeric: true }));
}

// 音楽バーの曲（music/ の直下だけ。番号付きは番号順、番号なしはその後に名前順）
function listMusic() {
    return fs.readdirSync(MUSIC_DIR)
        .filter(f => MUSIC_EXTS.includes(path.extname(f).toLowerCase()))
        .map(f => {
            const stem = path.basename(f, path.extname(f));
            const m = MUSIC_NAME_RE.exec(stem);
            return m
                ? { path: `music/${f}`, no: Number(m[1]), name: m[2] }
                : { path: `music/${f}`, no: null, name: stem };
        })
        .sort((a, b) => (a.no === null) - (b.no === null) || (a.no - b.no) || a.name.localeCompare(b.name, 'ja'));
}

// ==========================================================================
// Stream Deck などからの操作
// ==========================================================================
function fireCue(next, index) {
    const cue = next.cues[index];
    if (!cue) throw new Error(`式次第の${index + 1}番目はありません`);
    next.program = JSON.parse(JSON.stringify(cue.scene));
    next.black = false;
    next.cueIndex = index;
    return { index };
}

function applyControl(action, val) {
    const next = JSON.parse(JSON.stringify(state));
    let cue = null;
    let command = null;
    switch (action) {
        case 'take':                 // 管理画面のプレビューを本線に出す（管理画面が開いている必要あり）
        case 'swap':                 // プレビューの左右2分割の左と右を入れ替える（管理画面が開いている必要あり）
        case 'musicStop':            // 音楽を止める（フェードは音楽バーの設定どおり）
            command = { action };
            break;
        case 'musicPlay':            // 曲を鳴らす (val=music/ からの場所。例: 01_入場曲.mp3 / 登場曲/HOME/25.mp3)
            if (!val) throw new Error('val に曲の場所を入れてください');
            command = { action, val: val.startsWith('music/') ? val : `music/${val}` };
            if (!isMediaPath(command.val, ['music'])) throw new Error('曲の場所が正しくありません');
            break;
        case 'next':                 // 式次第の次へ
            cue = fireCue(next, state.cueIndex + 1);
            break;
        case 'prev':
            cue = fireCue(next, Math.max(0, state.cueIndex - 1));
            break;
        case 'cue': {                // val=式次第の番号（1から）
            const n = Number(val);
            if (!Number.isInteger(n) || n < 1) throw new Error('val に式次第の番号（1から）を入れてください');
            cue = fireCue(next, n - 1);
            break;
        }
        case 'black':                // val=on / off / 省略でオン・オフ切り替え
            next.black = val === 'on' ? true : val === 'off' ? false : !state.black;
            break;
        case 'derby': {              // val=1 / -1 / reset
            if (val === 'reset') { next.derby.count = 0; next.derby.outs = 0; break; }
            const n = Number(val);
            if (!Number.isInteger(n)) throw new Error('val は 1 / -1 / reset のどれかにしてください');
            next.derby.count = Math.max(0, state.derby.count + n);
            break;
        }
        case 'derbyOut': {           // val=1 / -1
            const n = Number(val);
            if (!Number.isInteger(n)) throw new Error('val は 1 か -1 にしてください');
            next.derby.outs = Math.max(0, state.derby.outs + n);
            break;
        }
        case 'cut':
        case 'fade':
            next.transition.type = action;
            break;
        default:
            throw new Error(`不明な操作です (${action})`);
    }
    return { next, cue, command };
}

// ==========================================================================
// HTTPサーバー
// ==========================================================================
// 1つのアクセスで思わぬエラーが起きても、サーバー全体は止めない（本番中にビジョンが止まらないように）
const server = http.createServer((req, res) => {
    try {
        handleRequest(req, res);
    } catch (e) {
        console.error(`[エラー] ${req.method} ${req.url} の処理中にエラーが起きました（サーバーは動き続けます）
${e.stack}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'サーバー内部でエラーが起きました' });
        else res.end();
    }
});

function handleRequest(req, res) {
    let reqUrl;
    try {
        reqUrl = new URL(`http://localhost:${PORT}${req.url.startsWith('/') ? '' : '/'}${req.url}`);
    } catch (e) {
        console.error(`[拒否] 読み取れないアドレスです: ${req.url}`);
        return sendJson(res, 400, { error: '正しくないアドレスです' });
    }
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
    if (pathname === '/api/state') {
        if (req.method === 'GET') return sendJson(res, 200, state);
        if (req.method === 'POST') {
            return readBody(req, 4 * 1024 * 1024, (err, body) => {
                if (err) return sendJson(res, 413, { error: err.message });
                let next;
                try {
                    const patch = JSON.parse(body);
                    if (!isObj(patch)) throw new Error('送られたデータの形が正しくありません');
                    next = applyPatch(state, patch);
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

    // 3. スライドの一覧・登録（登録はファイルの中身をそのまま送る）
    if (pathname === '/api/slides') {
        if (req.method === 'GET') return sendJson(res, 200, listTree(SLIDE_DIR, 'slides', SLIDE_EXTS));
        if (req.method === 'POST') {
            const original = String(reqUrl.searchParams.get('filename') || '');
            const ext = path.extname(original).toLowerCase();
            if (!SLIDE_EXTS.includes(ext)) return sendJson(res, 400, { error: 'PNG・JPEG・WEBP・GIF・SVG の画像か、MP4・WEBM・M4V の動画を選んでください' });
            const base = path.basename(original, path.extname(original)).replace(/[\\\/:*?"<>|]+/g, '_').trim().slice(0, 80);
            if (!base) return sendJson(res, 400, { error: 'ファイル名が正しくありません' });
            // 保存先の分類フォルダ（1段だけ。使えない文字は取り除く）
            const folder = String(reqUrl.searchParams.get('folder') || '').replace(/[\\\/:*?"<>|.]+/g, '_').trim().slice(0, 40);
            const dir = folder ? path.join(SLIDE_DIR, folder) : SLIDE_DIR;
            if (Number(req.headers['content-length'] || 0) > MAX_SLIDE_BYTES) return sendJson(res, 413, { error: 'スライドは500MB以内にしてください' });
            fs.mkdirSync(dir, { recursive: true });
            // 受け取り途中のファイルは一時的な名前で保存し、全部届いてから正式な名前にする
            const tmp = path.join(dir, `.upload_${Date.now()}.part`);
            const ws = fs.createWriteStream(tmp);
            let size = 0;
            let failed = false;
            const fail = (code, msg) => {
                if (failed) return;
                failed = true;
                ws.destroy();
                fs.rm(tmp, { force: true }, () => {});
                console.error(`[スライド登録失敗] ${msg}`);
                sendJson(res, code, { error: msg });
            };
            req.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_SLIDE_BYTES) { fail(413, 'スライドは500MB以内にしてください'); req.destroy(); }
            });
            req.on('aborted', () => fail(400, 'ファイルの受け取りが途中で止まりました'));
            ws.on('error', e => fail(500, `保存できませんでした (${e.code || e.message})`));
            ws.on('finish', () => {
                if (failed) return;
                if (size === 0) return fail(400, 'ファイルが空です');
                // 同じ名前があるときは、上書きせず番号を付けて保存する（使っている式次第が変わらないよう）
                let name = base + ext;
                for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}_${n}${ext}`;
                try {
                    renameWithRetry(tmp, path.join(dir, name));
                } catch (e) {
                    return fail(500, `保存できませんでした (${e.code || e.message})`);
                }
                const rel = ['slides', folder, name].filter(Boolean).join('/');
                console.log(`[スライド登録] ${rel} (${(size / 1024 / 1024).toFixed(1)}MB)`);
                sendJson(res, 200, { path: rel });
            });
            req.pipe(ws);
            return;
        }
        return sendJson(res, 405, { error: 'GET か POST で呼び出してください' });
    }

    // 3.1 スライドの削除（本線・式次第で使っているものは消さない）
    if (pathname === '/api/slides/delete' && req.method === 'POST') {
        return readBody(req, 4096, (err, body) => {
            let rel;
            try { rel = String(JSON.parse(body).path || ''); } catch (e) { rel = ''; }
            if (!isMediaPath(rel, ['slides'])) return sendJson(res, 400, { error: 'ファイルの場所が正しくありません' });
            const used = JSON.stringify([state.program, state.cues.map(c => c.scene)]).includes(JSON.stringify(rel));
            if (used) return sendJson(res, 400, { error: '本線か式次第で使っているため消せません。先に差し替えてください' });
            try {
                fs.rmSync(path.join(__dirname, ...rel.split('/')));
            } catch (e) {
                return sendJson(res, 500, { error: `消せませんでした (${e.code || e.message})` });
            }
            console.log(`[スライド削除] ${rel}`);
            sendJson(res, 200, { status: 'ok' });
        });
    }

    // 3.2 既製の選手紹介スライド（players/ フォルダ）
    if (pathname === '/api/players') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET で呼び出してください' });
        return sendJson(res, 200, listTree(PLAYER_DIR, 'players', SLIDE_EXTS));
    }

    // 3.3 顔写真のチームフォルダ名（photos/ の直下のフォルダ）
    if (pathname === '/api/photo-teams') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET で呼び出してください' });
        let teams = [];
        try { teams = fs.readdirSync(PHOTO_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (e) { teams = []; }
        return sendJson(res, 200, teams);
    }

    // 3.4 曲の一覧（music/ の直下）・登場曲の一覧（music/登場曲/ の中）
    if (pathname === '/api/music') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET で呼び出してください' });
        return sendJson(res, 200, listMusic());
    }
    if (pathname === '/api/walkup') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET で呼び出してください' });
        return sendJson(res, 200, listTree(WALKUP_DIR, 'music/登場曲', MUSIC_EXTS));
    }

    // 3.5 表示画面からのお知らせ（カメラが開けない等）を管理画面へ伝える
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
        const { action, val } = Object.fromEntries(reqUrl.searchParams);
        let result;
        try {
            result = applyControl(action, val);
        } catch (e) {
            console.error(`[操作拒否] ${action}: ${e.message}`);
            return sendJson(res, 400, { error: e.message });
        }
        if (result.command) {
            broadcastEvent('COMMAND', result.command);
        } else {
            const vErr = commit(result.next);
            if (vErr) {
                console.error(`[操作拒否] ${action}: ${vErr}`);
                return sendJson(res, 400, { error: vErr });
            }
            if (result.cue) broadcastEvent('CUE_FIRED', result.cue);
        }
        console.log(`[操作] ${action} val=${val === undefined ? '-' : val}`);
        return sendJson(res, 200, { status: 'ok' });
    }

    // 5. 画面ファイル・素材の配信
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
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
        '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.csv': 'text/csv; charset=utf-8',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac'
    };
    const contentType = types[path.extname(filePath).toLowerCase()];
    if (!contentType) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    // 動画・曲は大きいので少しずつ送る。再生の途中から読み込めるよう「範囲指定（Range）」にも対応する
    if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
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
}

// ==========================================================================
// 起動（「--open」付きで起動したときは、準備ができた後に管理画面をブラウザで開く）
// ==========================================================================
const OPEN_DASHBOARD = process.argv.includes('--open');
const DASHBOARD_URL = `http://localhost:${PORT}/`;

function openDashboard() {
    const onDone = err => {
        if (err) console.error(`[エラー] 管理画面を自動で開けませんでした。ブラウザで ${DASHBOARD_URL} を開いてください (${err.message})`);
    };
    const cp = require('child_process');
    if (process.platform === 'win32') cp.exec(`start "" "${DASHBOARD_URL}"`, onDone);
    else if (process.platform === 'darwin') cp.execFile('open', [DASHBOARD_URL], onDone);
    else cp.execFile('xdg-open', [DASHBOARD_URL], onDone);
    console.log('   → 管理画面をブラウザで開きました');
}

server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;
    // 3007番がすでに使われている：このシステムのサーバーがもう動いているのかを確かめる
    http.get(`http://localhost:${PORT}/api/state`, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            let isOurs = false;
            try { isOurs = res.statusCode === 200 && validateState(JSON.parse(body)) === null; } catch (e) { isOurs = false; }
            if (isOurs) {
                console.log('野球ビジョンのサーバーは、すでに起動しています（この画面は閉じて大丈夫です）。');
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

// 素材のフォルダが無ければ作る（作ったことは記録に残す）
[[SLIDE_DIR, 'スライド'], [PLAYER_DIR, '選手スライド'], [PHOTO_DIR, '顔写真'], [MUSIC_DIR, '音楽'], [WALKUP_DIR, '登場曲']].forEach(([dir, label]) => {
    if (fs.existsSync(dir)) return;
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[起動] ${label}のフォルダが無かったため作りました: ${dir}`);
});

server.listen(PORT, () => {
    console.log('======================================================================');
    console.log(' スタジアムビジョン野球システム (32:9) サーバー起動中');
    console.log(`   管理画面 : ${DASHBOARD_URL}`);
    console.log(`   表示画面 : ${DASHBOARD_URL}vision.html  (?view=left / right で片側だけ)`);
    console.log('======================================================================');
    if (OPEN_DASHBOARD) openDashboard();
});
