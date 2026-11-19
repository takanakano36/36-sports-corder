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
const { parseXlsx, XlsxError } = require('./lib/xlsx');
const SI = require('./lib/script_import');
const Core = require('./lib/script_core');

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
const MAX_ROSTER = 200;
// 台本（Excel の台本を読み込んだもの）
const MAX_SCRIPT_ROWS = 6000;          // 全シート合わせた行数の上限
const MAX_SCRIPT_SECTIONS = 31;        // シート30 ＋ 手動の式次第
const MAX_CELL = 5000;
const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MANUAL_SECTION = '手動の式次第';
const ROW_TEXT_KEYS = ['no', 'time', 'dur', 'title', 'bgm', 'vision', 'visionR', 'mic', 'speaker', 'script', 'note'];
const ROW_KINDS = ['row', 'chapter'];
const FUTA_ACTIVE = ['', 'left', 'full'];

function emptyScene() {
    const slots = {};
    SLOT_KEYS.forEach(k => { slots[k] = { type: 'black' }; });
    return { layout: 'wide', slots, singleX: 50 };
}

// 守山の既定：左右2分割（左＝スライド、右＝遊撃カメラ cam1）
function moriyamaScene() {
    const sc = emptyScene();
    sc.layout = 'split';
    sc.slots.right = { type: 'camera', cam: 'cam1' };
    return sc;
}

function emptyScript() {
    return { title: '', rev: 0, sections: [], rows: [], pos: -1, onair: -1 };
}

function initialState() {
    return {
        program: moriyamaScene(),              // いまビジョンに出ている画面
        black: false,                          // 黒にする（BLACK）
        guide: false,                          // 2画面の境目の線を出す（設置・調整用）
        // 出力の形
        //   wide … 3840×1080（32:9）をそのまま出す
        //   sdi  … 1920×1080 で出し、ビジョンに映る「帯」（y=bandY から高さ bandH）だけを使う
        //          （HDMI→SDIコンバーター経由で、スケーラーが横100%・上下トリミングする現場用）
        output: { mode: 'sdi', bandY: 197, bandH: 686 },   // 守山：1920×686 の帯（14:5）
        transition: { type: 'fade', ms: 500 }, // 切り替え方（cut / fade）
        cameras: { cam1: { deviceId: '', label: '' }, cam2: { deviceId: '', label: '' } },
        teams: {
            HOME: { name: 'HOME', color: '#b91c1c', photoTeam: '' },
            AWAY: { name: 'AWAY', color: '#1d4ed8', photoTeam: '' }
        },
        roster: [],                            // 選手名簿（CSVから読み込む）
        derby: { count: 0, outs: 0 },          // ホームラン競争のカウンター
        script: emptyScript(),                 // 台本とキュー（旧「式次第」もここに統合）
        futa: { left: '', full: '', active: '', prev: null }   // フタ（ロゴ画面）。空の画像＝slides/フタ/ の最初の画像
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

// 曲の場所：music/ の中、または「local:ファイル名」（音楽バーで選んだ別フォルダの曲）
const isSongPath = v => isMediaPath(v, ['music']) || (isStr(v, 200) && /^local:[^\/\\]+$/.test(v));

function validateFace(f, label, types) {
    if (f === null) return null;
    if (!isObj(f) || !types.includes(f.type)) return `${label}の指定が正しくありません`;
    const keys = f.type === 'slide' ? ['type', 'file'] : f.type === 'camera' ? ['type', 'cam', 'fit'] : ['type'];
    for (const k of Object.keys(f)) if (!keys.includes(k)) return `${label}に不明な項目があります (${k})`;
    if (f.type === 'slide' && !isMediaPath(f.file, ['slides'])) return `${label}のスライドのファイル名が正しくありません`;
    if (f.type === 'camera' && !CAMS.includes(f.cam)) return `${label}のカメラは cam1 か cam2 にしてください`;
    if (f.type === 'camera' && f.fit !== undefined && !['cover', 'contain'].includes(f.fit)) return `${label}のカメラの収め方は cover か contain にしてください`;
    return null;
}

const CUE_KEYS = ['left', 'right', 'band', 'bgm', 'duck', 'memo', 'scene'];
function validateCue(c, label) {
    if (c === null) return null;
    if (!isObj(c)) return `${label}のキューの形が正しくありません`;
    for (const k of Object.keys(c)) if (!CUE_KEYS.includes(k)) return `${label}のキューに不明な項目があります (${k})`;
    let e = validateFace(c.left === undefined ? null : c.left, `${label}の左面`, ['slide', 'futa', 'black'])
        || validateFace(c.right === undefined ? null : c.right, `${label}の右面`, ['camera', 'slide', 'black'])
        || validateFace(c.band === undefined ? null : c.band, `${label}の帯全体`, ['futa', 'slide']);
    if (e) return e;
    if (!isStr(c.memo === undefined ? '' : c.memo, 1000)) return `${label}のメモは1000文字以内にしてください`;
    if (c.duck !== undefined && c.duck !== null && typeof c.duck !== 'boolean') return `${label}の「小さく」の指定が正しくありません`;
    const b = c.bgm === undefined ? null : c.bgm;
    if (b !== null) {
        if (!isObj(b) || !['play', 'fade', 'stop'].includes(b.action)) return `${label}の音楽の指定が正しくありません`;
        const keys = b.action === 'play' ? ['action', 'path', 'name', 'loop'] : ['action'];
        for (const k of Object.keys(b)) if (!keys.includes(k)) return `${label}の音楽に不明な項目があります (${k})`;
        if (b.action === 'play') {
            if (!isSongPath(b.path)) return `${label}の曲が正しくありません`;
            if (!isStr(b.name, 300) || typeof b.loop !== 'boolean') return `${label}の曲の名前・くり返しの指定が正しくありません`;
        }
    }
    if (c.scene !== undefined) { e = validateScene(c.scene, `${label}の画面`); if (e) return e; }
    return null;
}

function validateScript(sc) {
    if (!isObj(sc)) return '台本の形が正しくありません';
    const keys = ['title', 'rev', 'sections', 'rows', 'pos', 'onair'];
    for (const k of keys) if (!(k in sc)) return `台本の項目が足りません (${k})`;
    for (const k of Object.keys(sc)) if (!keys.includes(k)) return `台本に不明な項目があります (${k})`;
    if (!isStr(sc.title, 300)) return '台本の名前は300文字以内にしてください';
    if (!isInt(sc.rev, 0, 1e9)) return '台本の版の番号が正しくありません';
    if (!Array.isArray(sc.sections) || sc.sections.length > MAX_SCRIPT_SECTIONS) return `台本のセクションは${MAX_SCRIPT_SECTIONS}個までです`;
    for (const sec of sc.sections) {
        if (!isObj(sec) || !isStr(sec.name, 100) || !sec.name || typeof sec.manual !== 'boolean') return '台本のセクションの設定が正しくありません';
        for (const k of Object.keys(sec)) if (!['name', 'manual'].includes(k)) return `台本のセクションに不明な項目があります (${k})`;
    }
    if (!Array.isArray(sc.rows) || sc.rows.length > MAX_SCRIPT_ROWS) return `台本の行は${MAX_SCRIPT_ROWS}行までです`;
    const rowKeys = ['sec', 'cue', 'kind', ...ROW_TEXT_KEYS];
    for (let i = 0; i < sc.rows.length; i++) {
        const r = sc.rows[i];
        const label = `台本の${i + 1}行目`;
        if (!isObj(r)) return `${label}の形が正しくありません`;
        for (const k of Object.keys(r)) if (!rowKeys.includes(k)) return `${label}に不明な項目があります (${k})`;
        if (!isInt(r.sec, 0, sc.sections.length - 1)) return `${label}のセクションが正しくありません`;
        if (!ROW_KINDS.includes(r.kind)) return `${label}の種類が正しくありません`;
        if (r.kind === 'chapter' && r.cue) return `${label}は章の行のため、キューは付けられません`;
        for (const k of ROW_TEXT_KEYS) if (!isStr(r[k], MAX_CELL)) return `${label}の「${k}」は${MAX_CELL}文字以内の文字にしてください`;
        const e = validateCue(r.cue === undefined ? null : r.cue, label);
        if (e) return e;
    }
    if (!isInt(sc.pos, -1, Math.max(-1, sc.rows.length - 1))) return '台本の読み位置が正しくありません';
    if (!isInt(sc.onair, -1, Math.max(-1, sc.rows.length - 1))) return 'いま出しているキューの位置が正しくありません';
    return null;
}

function validateFuta(f) {
    if (!isObj(f)) return 'フタの設定が正しくありません';
    for (const k of Object.keys(f)) if (!['left', 'full', 'active', 'prev'].includes(k)) return `フタの設定に不明な項目があります (${k})`;
    for (const k of ['left', 'full']) {
        if (!isStr(f[k], 500) || (f[k] !== '' && !isMediaPath(f[k], ['slides']))) return `フタの画像（${k === 'left' ? '左' : '全面'}）の場所が正しくありません`;
    }
    if (!FUTA_ACTIVE.includes(f.active)) return 'フタの状態が正しくありません';
    if (f.prev !== null) { const e = validateScene(f.prev, 'フタの前の画面'); if (e) return e; }
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
    e = validateScript(s.script);
    if (e) return e;
    e = validateFuta(s.futa);
    if (e) return e;
    return null;
}

// ==========================================================================
// 状態の読み込み・保存
// ==========================================================================
// 旧い保存データの式次第（cues・cueIndex）を、台本の「手動の式次第」セクションに移す
function migrateLegacyCues(s) {
    if (!('cues' in s) && !('cueIndex' in s)) return;
    const legacy = Array.isArray(s.cues) ? s.cues : [];
    if (!s.script) {
        const sc = emptyScript();
        if (legacy.length) {
            sc.sections.push({ name: MANUAL_SECTION, manual: true });
            legacy.forEach(c => {
                const m = c && c.music || {};
                const bgm = m.action === 'play' ? { action: 'play', path: m.path, name: m.name, loop: false } : m.action === 'stop' ? { action: 'fade' } : null;
                const row = { sec: 0, cue: { scene: c.scene, bgm, memo: c.memo || '' } };
                ROW_TEXT_KEYS.forEach(k => { row[k] = ''; });
                row.title = String(c.name || '');
                row.note = String(c.memo || '');
                sc.rows.push(row);
            });
            const ci = Number.isInteger(s.cueIndex) ? s.cueIndex : -1;
            if (ci >= 0 && ci < sc.rows.length) { sc.pos = ci; sc.onair = ci; }
            sc.rev = 1;
            console.log(`[起動] 旧い式次第 ${legacy.length}個を、台本の「${MANUAL_SECTION}」に移しました`);
        }
        s.script = sc;
    }
    delete s.cues;
    delete s.cueIndex;
}

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
    // 旧い「式次第（cues）」は、台本の「手動の式次第」セクションに移す
    migrateLegacyCues(s);
    // 以前の台本の行には、番号・ビジョン右・種類の項目を書き足す
    if (isObj(s.script) && Array.isArray(s.script.rows)) {
        s.script.rows.forEach(r => { if (isObj(r)) { if (r.no === undefined) r.no = ''; if (r.visionR === undefined) r.visionR = ''; if (r.kind === undefined) r.kind = 'row'; } });
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
    // 旧い保存データでは pos が「出した行」だった。選択は「次に出すキュー」にする
    if (isObj(s.script) && Array.isArray(s.script.rows) && s.script.pos >= 0 && s.script.pos === s.script.onair) {
        const nx = Core.nextCueAfter(s.script, s.script.onair);
        if (nx >= 0) s.script.pos = nx;
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
    // 本線の画面がフタ以外の操作（TAKE・キュー）で変わったら、フタは「出ていない」ことにする
    if (isObj(next.futa) && isObj(state.futa) && state.futa.active && next.futa.active === state.futa.active
        && JSON.stringify(next.program) !== JSON.stringify(state.program)) {
        next.futa = Object.assign({}, next.futa, { active: '', prev: null });
    }
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

// バイナリのまま受け取る（Excel のファイル用）。大きすぎるときは受け取りを打ち切る
function readBodyBuffer(req, limit, cb) {
    const chunks = [];
    let size = 0, done = false;
    const finish = (err, buf) => { if (!done) { done = true; cb(err, buf); } };
    if (Number(req.headers['content-length'] || 0) > limit) { req.resume(); return finish(new Error('too-big')); }
    req.on('data', chunk => {
        size += chunk.length;
        if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => size > limit ? finish(new Error('too-big')) : finish(null, Buffer.concat(chunks)));
    req.on('error', e => finish(e));
    req.on('aborted', () => finish(new Error('aborted')));
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
            if (ent.name === '_退避') continue;      // 入れ替えで退避した古いスライド（一覧・提案には出さない）
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

// slides フォルダの変化を見張る（5秒ごと。Windows でも確実に動くよう fs.watch は使わない）。
// design_tools の「ビジョンにセット」で slides が入れ替わると、開いている管理画面に知らせて一覧を読み直させる
function slidesSignature() {
    const parts = [];
    (function walk(abs, rel) {
        let entries;
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of entries) {
            if (ent.name.startsWith('.') || ent.name === '_退避') continue;
            const p = path.join(abs, ent.name);
            if (ent.isDirectory()) { walk(p, `${rel}/${ent.name}`); continue; }
            if (!SLIDE_EXTS.includes(path.extname(ent.name).toLowerCase())) continue;
            try { const st = fs.statSync(p); parts.push(`${rel}/${ent.name}:${st.size}:${Math.round(st.mtimeMs)}`); } catch (e) { /* 消えた */ }
        }
    })(SLIDE_DIR, '');
    return parts.sort().join('\n');
}
let lastSlidesSig = null;
function watchSlides() {
    try {
        const sig = slidesSignature();
        if (lastSlidesSig !== null && sig !== lastSlidesSig) {
            console.log('[スライド] slides フォルダの変化を見つけました。管理画面に知らせます');
            broadcastEvent('SLIDES_CHANGED', {});
        }
        lastSlidesSig = sig;
    } catch (e) {
        console.error(`[スライド] 変化の確認に失敗しました（${e.message}）`);
    }
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
// フタ（ロゴ）の画像の場所（設定が空なら slides/フタ/ の最初の画像）
function currentLogos(st) {
    const list = listTree(SLIDE_DIR, 'slides', SLIDE_EXTS);
    return { left: Core.resolveLogo(st.futa, 'left', list), full: Core.resolveLogo(st.futa, 'full', list) };
}

// 台本の行のキューを本線に出す（読み位置・「いま出している行」もその行にする）
function fireCue(next, index, opts = {}) {
    const row = next.script.rows[index];
    if (!row || !row.cue) throw new Error(`台本の${index + 1}行目にはキューがありません`);
    next.program = Core.buildScene(row.cue, next.program, currentLogos(next));
    next.black = false;
    next.futa = Object.assign({}, next.futa, { active: '', prev: null });
    // 出した行を「いま本線」にし、選択（pos）は次のキューへ進める（次のキューが PREVIEW に入る）
    const nx = Core.nextCueAfter(next.script, index);
    next.script.pos = nx >= 0 ? nx : index;
    next.script.onair = index;
    return { index, silent: !!opts.silent };
}

// フタのオン・オフ（kind = left / full）。もう一度押すと直前の画面に戻る。BLACK には触らない
function toggleFuta(next, kind) {
    const f = next.futa;
    if (f.active === kind) {
        if (f.prev) next.program = f.prev;
        next.futa = Object.assign({}, f, { active: '', prev: null });
        return null;
    }
    const prev = f.active ? f.prev : JSON.parse(JSON.stringify(next.program));
    const logo = currentLogos(next)[kind];
    const src = logo ? { type: 'slide', file: logo } : { type: 'black' };
    const p = JSON.parse(JSON.stringify(next.program));
    if (kind === 'left') {
        if (p.layout !== 'split' && p.slots.right.type === 'black') p.slots.right = { type: 'camera', cam: 'cam1' };
        p.layout = 'split';
        p.slots.left = src;
    } else {
        p.layout = 'wide';
        p.slots.wide = src;
    }
    next.program = p;
    next.futa = Object.assign({}, f, { active: kind, prev });
    return logo ? null : 'フタの画像がありません。slides/フタ/ に画像を入れるか、設定タブで選んでください（いまは黒を出しています）';
}

function applyControl(action, val) {
    const next = JSON.parse(JSON.stringify(state));
    let cue = null;
    let command = null;
    let notice = null;
    switch (action) {
        case 'take':                 // 管理画面のプレビューを本線に出す（管理画面が開いている必要あり）
        case 'swap':                 // プレビューの左右2分割の左と右を入れ替える（管理画面が開いている必要あり）
        case 'musicStop':            // 音楽を止める（フェードは音楽バーの設定どおり）
        case 'musicFade':            // 音楽をフェードアウト（音楽バーの秒数。0秒のときは2秒）
        case 'readNext':             // 台本の読み位置を1行下へ（キューは出さない。管理画面が開いている必要あり）
        case 'readPrev':             // 台本の読み位置を1行上へ
            command = { action };
            break;
        case 'musicDuck':            // BGMを小さく／戻す（val=on / off、省略でトグル。管理画面が開いている必要あり）
            if (val !== undefined && val !== '' && !['on', 'off'].includes(val)) throw new Error('val は on か off にしてください（省略で切り替え）');
            command = { action, val: val || '' };
            break;
        case 'futa':                 // 左フタ（左面だけロゴ）のオン・オフ
        case 'futaFull':             // 全面フタ（帯全体ロゴ）のオン・オフ
            notice = toggleFuta(next, action === 'futa' ? 'left' : 'full');
            break;
        case 'musicPlay':            // 曲を鳴らす (val=music/ からの場所。例: 01_入場曲.mp3 / 登場曲/HOME/25.mp3)
            if (!val) throw new Error('val に曲の場所を入れてください');
            command = { action, val: val.startsWith('music/') ? val : `music/${val}` };
            if (!isMediaPath(command.val, ['music'])) throw new Error('曲の場所が正しくありません');
            break;
        case 'next': {               // いま出している行より後の、最初のキュー付きの行を出す
            const i = Core.nextCueRow(state.script);
            if (i < 0) throw new Error('次のキューがありません');
            cue = fireCue(next, i);
            break;
        }
        case 'prev': {               // 1つ前のキュー付きの行を出し直す（BGMは鳴らし直さない）
            let i = Core.prevCueRow(state.script);
            if (i < 0) i = Core.cueRows(state.script)[0];
            if (i === undefined) throw new Error('キューがありません');
            cue = fireCue(next, i, { silent: true });
            break;
        }
        case 'cue': {                // val=キュー付きの行の順番（1から）
            const n = Number(val);
            if (!Number.isInteger(n) || n < 1) throw new Error('val にキューの番号（1から）を入れてください');
            const i = Core.cueRows(state.script)[n - 1];
            if (i === undefined) throw new Error(`キューの${n}番目はありません`);
            cue = fireCue(next, i);
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
    return { next, cue, command, notice };
}

// ==========================================================================
// 台本の読み込み・編集
// ==========================================================================
let lastImport = null;     // 直近に読み込んだファイルの中身（列の割り当てを直してから取り込むため、サーバーが覚えておく）
let importSeq = 0;

const collapse = t => String(t || '').replace(/\s+/g, '');
// 引き継ぎの照合キー：番号があれば番号を最優先、無ければ（番号があっても見つからないときの予備として）内容＋セリフの先頭
function rowKeys(sectionName, row) {
    const keys = [];
    if (row.kind !== 'chapter' && collapse(row.no)) keys.push(`${collapse(sectionName)}\u0000no\u0000${collapse(row.no)}`);
    keys.push(`${collapse(sectionName)}\u0000${row.kind === 'chapter' ? 'ch' : 'tx'}\u0000${collapse(row.title)}\u0000${collapse(row.script).slice(0, 40)}`);
    return keys;
}

function summarizeImport(imp) {
    return {
        importId: imp.id,
        filename: imp.filename,
        roles: SI.ROLES.map(r => ({ role: r, label: SI.ROLE_NAMES[r] })),
        sheets: imp.sheets.map((sh, index) => Object.assign({ index, name: sh.name }, SI.analyzeSheet(sh.grid)))
    };
}

// アップロードされた台本（xlsx / csv / tsv / 貼り付け）を読み、シートごとの見出し・列の割り当て案を返す
function importScriptBuffer(buf, filename, format) {
    let sheets;
    if (format === 'xlsx') {
        sheets = parseXlsx(buf).sheets;
    } else {
        const text = SI.decodeText(buf);
        const grid = SI.parseDelimited(text, format === 'csv' ? ',' : '\t');
        if (grid.length === 0) throw new XlsxError('中身が空です');
        if (grid.length > 3000) throw new XlsxError('行が多すぎます（1シート3000行まで）');
        if (grid.some(r => r.some(c => c.length > MAX_CELL))) throw new XlsxError(`${MAX_CELL}文字を超えるセルがあります`);
        sheets = [{ name: format === 'paste' ? '貼り付け' : (path.basename(filename, path.extname(filename)) || '台本').slice(0, 100), grid }];
    }
    const imp = { id: `imp${++importSeq}`, filename: String(filename || '').slice(0, 300), sheets };
    lastImport = imp;
    return summarizeImport(imp);
}

// 取り込み：シートごとの設定（見出し行・列の役割）どおりに台本を作り、既にひもづけたキューを引き継ぐ
function commitImport(req) {
    if (!isObj(req) || !lastImport || req.importId !== lastImport.id) {
        throw new Error('読み込んだファイルの情報がありません。もう一度ファイルを選んでください');
    }
    if (!Array.isArray(req.sheets)) throw new Error('シートの設定が正しくありません');
    const next = JSON.parse(JSON.stringify(state));
    const old = next.script;
    const manualCount = old.sections.length && old.sections[0].manual ? old.rows.filter(r => r.sec === 0).length : 0;
    const oldKeys = new Map();
    old.rows.forEach((r, i) => {
        if (old.sections[r.sec].manual) return;
        rowKeys(old.sections[r.sec].name, r).forEach(k => {
            if (!oldKeys.has(k)) oldKeys.set(k, []);
            oldKeys.get(k).push(i);
        });
    });

    const sections = old.sections.filter(sc => sc.manual);
    const manualRows = old.rows.slice(0, manualCount);
    const newRows = [];
    const names = new Set(sections.map(sc => sc.name));
    for (const cfg of req.sheets) {
        if (!isObj(cfg) || !Number.isInteger(cfg.index) || !lastImport.sheets[cfg.index]) throw new Error('シートの番号が正しくありません');
        if (cfg.include === false) continue;
        const sh = lastImport.sheets[cfg.index];
        if (!Array.isArray(cfg.roles) || cfg.roles.some(r => r !== '' && !SI.ROLES.includes(r))) throw new Error(`シート「${sh.name}」の列の割り当てが正しくありません`);
        if (!Number.isInteger(cfg.headerRow) || cfg.headerRow < -1) throw new Error(`シート「${sh.name}」の見出し行が正しくありません`);
        const rows = SI.extractRows(sh.grid, cfg.headerRow, cfg.roles);
        if (rows.length === 0) continue;
        let name = String(sh.name).slice(0, 100) || 'シート';
        for (let n = 2; names.has(name); n++) name = `${String(sh.name).slice(0, 90)}(${n})`;
        names.add(name);
        sections.push({ name, manual: false });
        rows.forEach(r => newRows.push(Object.assign({ sec: sections.length - 1, cue: null }, r)));
    }
    if (newRows.length === 0) throw new Error('取り込める行がありません。列の割り当てを確かめてください（「内容」や「セリフ」の列が必要です）');
    if (manualRows.length + newRows.length > MAX_SCRIPT_ROWS) throw new Error(`行が多すぎます（${manualRows.length + newRows.length}行。合計${MAX_SCRIPT_ROWS}行まで）`);

    // 既にひもづけたキューの引き継ぎ（セクション名＋内容＋セリフの先頭が一致する行へ）
    const indexMap = new Map();     // 旧い行の番号 → 新しい行の番号
    for (let i = 0; i < manualCount; i++) indexMap.set(i, i);
    let carried = 0;
    const used = new Set();
    newRows.forEach((r, j) => {
        let oi;
        for (const k of rowKeys(sections[r.sec].name, r)) {
            const list = oldKeys.get(k);
            oi = list && list.find(i => !used.has(i));
            if (oi !== undefined) break;
        }
        if (oi === undefined) return;
        used.add(oi);
        indexMap.set(oi, manualCount + j);
        if (old.rows[oi].cue && r.kind !== 'chapter') { r.cue = old.rows[oi].cue; carried++; }
    });
    const lost = [];
    old.rows.forEach((r, i) => {
        if (old.sections[r.sec].manual || !r.cue || used.has(i)) return;
        lost.push({ section: old.sections[r.sec].name, title: r.title.slice(0, 60), script: r.script.slice(0, 40) });
    });

    next.script = {
        title: lastImport.filename,
        rev: old.rev + 1,
        sections,
        rows: manualRows.concat(newRows),
        pos: indexMap.has(old.pos) ? indexMap.get(old.pos) : -1,
        onair: indexMap.has(old.onair) ? indexMap.get(old.onair) : -1
    };
    return { next, summary: { rows: newRows.length, sections: sections.filter(sc => !sc.manual).length, carried, lost } };
}

// 台本の編集（キューの付け外し・手動の式次第・読み位置）。ops をまとめて1回で保存する
function applyScriptOps(next, ops) {
    const sc = next.script;
    const rowAt = i => {
        if (!Number.isInteger(i) || i < 0 || i >= sc.rows.length) throw new Error('台本の行の番号が正しくありません');
        return sc.rows[i];
    };
    const manualRow = i => {
        const r = rowAt(i);
        if (!sc.sections[r.sec].manual) throw new Error('読み込んだ台本の行は、並べ替え・削除できません（「手動の式次第」の行だけ）');
        return r;
    };
    // 行の番号を付け替える（pos・onair を追いかけさせる）
    const remap = fn => { sc.pos = fn(sc.pos); sc.onair = fn(sc.onair); };
    let touched = false;
    for (const op of ops) {
        if (!isObj(op)) throw new Error('操作の形が正しくありません');
        switch (op.op) {
            case 'cue':
                if (rowAt(op.row).kind === 'chapter' && op.cue) throw new Error('章の行には、キューは付けられません');
                rowAt(op.row).cue = op.cue === null || op.cue === undefined ? null : op.cue;
                touched = true;
                break;
            case 'cues':
                if (!Array.isArray(op.items)) throw new Error('キューの一覧が正しくありません');
                op.items.forEach(it => {
                    if (!isObj(it)) throw new Error('キューの形が正しくありません');
                    if (rowAt(it.row).kind === 'chapter' && it.cue) throw new Error('章の行には、キューは付けられません');
                    rowAt(it.row).cue = it.cue === undefined ? null : it.cue;
                });
                touched = true;
                break;
            case 'clearSection':
                if (!Number.isInteger(op.sec) || !sc.sections[op.sec]) throw new Error('セクションの番号が正しくありません');
                sc.rows.forEach(r => { if (r.sec === op.sec) r.cue = null; });
                touched = true;
                break;
            case 'addManual': {
                if (!isStr(op.title, 300) || !op.title.trim()) throw new Error('キューの名前を入れてください（300文字以内）');
                if (!(sc.sections.length && sc.sections[0].manual)) {
                    sc.sections.unshift({ name: MANUAL_SECTION, manual: true });
                    sc.rows.forEach(r => { r.sec++; });
                }
                const at = sc.rows.filter(r => r.sec === 0).length;
                const row = { sec: 0, kind: 'row', cue: op.cue === undefined ? null : op.cue };
                ROW_TEXT_KEYS.forEach(k => { row[k] = ''; });
                row.title = op.title.trim();
                sc.rows.splice(at, 0, row);
                remap(i => (i >= at ? i + 1 : i));
                touched = true;
                break;
            }
            case 'deleteRow': {
                manualRow(op.row);
                sc.rows.splice(op.row, 1);
                remap(i => (i === op.row ? -1 : i > op.row ? i - 1 : i));
                if (!sc.rows.some(r => r.sec === 0)) { sc.sections.shift(); sc.rows.forEach(r => { r.sec--; }); }
                touched = true;
                break;
            }
            case 'moveRow': {
                manualRow(op.row);
                const to = op.row + (op.dir < 0 ? -1 : 1);
                if (to < 0 || to >= sc.rows.length || !sc.sections[sc.rows[to].sec].manual) break;
                [sc.rows[op.row], sc.rows[to]] = [sc.rows[to], sc.rows[op.row]];
                remap(i => (i === op.row ? to : i === to ? op.row : i));
                touched = true;
                break;
            }
            case 'rename':
                if (!isStr(op.title, 300) || !op.title.trim()) throw new Error('キューの名前を入れてください（300文字以内）');
                manualRow(op.row).title = op.title.trim();
                touched = true;
                break;
            case 'pos':
                if (!Number.isInteger(op.pos) || op.pos < -1 || op.pos >= sc.rows.length) throw new Error('読み位置が正しくありません');
                sc.pos = op.pos;
                break;
            default:
                throw new Error(`不明な台本の操作です (${op.op})`);
        }
    }
    if (touched) sc.rev++;
}

// 台本の取り込み用のAPI（/api/script/...）。処理したら true を返す
function handleScriptApi(pathname, req, res, reqUrl) {
    if (!pathname.startsWith('/api/script/')) return false;
    const fail = (code, msg) => sendJson(res, code, { error: msg });
    const jsonBody = (limit, cb) => readBody(req, limit, (err, body) => {
        if (err) return fail(413, err.message);
        let obj;
        try { obj = JSON.parse(body); } catch (e) { return fail(400, '送られたデータを読み取れません'); }
        if (!isObj(obj)) return fail(400, '送られたデータの形が正しくありません');
        try { cb(obj); } catch (e) {
            console.error(`[台本] ${pathname}: ${e.message}`);
            fail(400, e.message);
        }
    });

    if (pathname === '/api/script/import') {
        if (req.method !== 'POST') { fail(405, 'POST で呼び出してください'); return true; }
        const ctype = String(req.headers['content-type'] || '');
        readBodyBuffer(req, Math.ceil(MAX_XLSX_BYTES * 1.4) + 4096, (err, buf) => {
            if (err) return fail(413, err.message === 'too-big' ? 'ファイルが大きすぎます（20MBまで）' : 'ファイルの受け取りが途中で止まりました');
            try {
                let filename = String(reqUrl.searchParams.get('filename') || '');
                let format = String(reqUrl.searchParams.get('format') || '');
                let data = buf;
                if (ctype.includes('application/json')) {
                    const j = JSON.parse(buf.toString('utf-8'));
                    if (!isObj(j)) throw new XlsxError('送られたデータの形が正しくありません');
                    filename = String(j.filename || filename);
                    format = String(j.format || format);
                    if (typeof j.base64 === 'string') data = Buffer.from(j.base64, 'base64');
                    else if (typeof j.text === 'string') data = Buffer.from(j.text, 'utf-8');
                    else throw new XlsxError('base64 か text を送ってください');
                }
                if (!format) {
                    const ext = path.extname(filename).toLowerCase();
                    format = ext === '.csv' ? 'csv' : ext === '.tsv' || ext === '.txt' ? 'tsv' : 'xlsx';
                }
                if (!['xlsx', 'csv', 'tsv', 'paste'].includes(format)) throw new XlsxError('形式は xlsx・csv・tsv・paste のどれかにしてください');
                if (data.length === 0) throw new XlsxError('ファイルが空です');
                if (data.length > MAX_XLSX_BYTES) throw new XlsxError('ファイルが大きすぎます（20MBまで）');
                sendJson(res, 200, importScriptBuffer(data, filename, format));
            } catch (e) {
                const msg = e instanceof XlsxError ? e.message : e instanceof SyntaxError ? '送られたデータを読み取れません' : `読み込めませんでした（${e.message}）`;
                if (!(e instanceof XlsxError)) console.error(`[台本] 読み込み失敗: ${e.stack}`);
                else console.error(`[台本] 読み込み失敗: ${e.message}`);
                fail(400, msg);
            }
        });
        return true;
    }
    if (pathname === '/api/script/analyze' && req.method === 'POST') {
        jsonBody(4096, j => {
            if (!lastImport || j.importId !== lastImport.id) throw new Error('読み込んだファイルの情報がありません。もう一度ファイルを選んでください');
            const sh = lastImport.sheets[j.sheet];
            if (!sh) throw new Error('シートの番号が正しくありません');
            const forced = j.headerRow === null || j.headerRow === undefined ? undefined : j.headerRow;
            if (forced !== undefined && !(Number.isInteger(forced) && forced >= -1)) throw new Error('見出し行が正しくありません');
            sendJson(res, 200, Object.assign({ index: j.sheet, name: sh.name }, SI.analyzeSheet(sh.grid, forced)));
        });
        return true;
    }
    if (pathname === '/api/script/commit' && req.method === 'POST') {
        jsonBody(2 * 1024 * 1024, j => {
            const { next, summary } = commitImport(j);
            const vErr = commit(next);
            if (vErr) throw new Error(vErr);
            console.log(`[台本] 取り込み: ${summary.sections}セクション ${summary.rows}行（キュー引き継ぎ ${summary.carried}、引き継げず ${summary.lost.length}）`);
            sendJson(res, 200, Object.assign({ status: 'ok' }, summary));
        });
        return true;
    }
    if (pathname === '/api/script/edit' && req.method === 'POST') {
        jsonBody(8 * 1024 * 1024, j => {
            if (!Array.isArray(j.ops) || j.ops.length === 0 || j.ops.length > 6000) throw new Error('操作の一覧が正しくありません');
            const next = JSON.parse(JSON.stringify(state));
            applyScriptOps(next, j.ops);
            const vErr = commit(next);
            if (vErr) throw new Error(vErr);
            sendJson(res, 200, { status: 'ok' });
        });
        return true;
    }
    if (pathname === '/api/script/suggestions') {
        if (req.method !== 'GET') { fail(405, 'GET で呼び出してください'); return true; }
        const ctx = { music: listMusic(), slides: listTree(SLIDE_DIR, 'slides', SLIDE_EXTS), futaLeft: state.futa.left };
        sendJson(res, 200, { suggestions: Core.suggestAll(state.script, ctx) });
        return true;
    }
    fail(404, '不明な台本のAPIです');
    return true;
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
            const used = JSON.stringify([state.program, state.futa, state.script.rows.map(r => r.cue)]).includes(JSON.stringify(rel));
            if (used) return sendJson(res, 400, { error: '本線・フタ・台本のキューで使っているため消せません。先に差し替えてください' });
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

    // 3.6 台本の読み込み・編集
    if (handleScriptApi(pathname, req, res, reqUrl)) return;

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
            if (result.notice) broadcastEvent('NOTICE', { message: result.notice });
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
    watchSlides();
    setInterval(watchSlides, 5000);
    console.log('======================================================================');
    console.log(' スタジアムビジョン野球システム (32:9) サーバー起動中');
    console.log(`   管理画面 : ${DASHBOARD_URL}`);
    console.log(`   表示画面 : ${DASHBOARD_URL}vision.html  (?view=left / right で片側だけ)`);
    console.log('======================================================================');
    if (OPEN_DASHBOARD) openDashboard();
});
