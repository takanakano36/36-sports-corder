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
const Scene = require('./lib/scene_core');

// ポート（既定は 3007。試験用に環境変数 PORT で変えられる）
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3007;
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
//   画面は「シーン」（レイヤーを下から順に重ねたもの）で作る。位置・大きさは帯に対する割合（0〜1）
//   program ＝ いまビジョンに出ているシーンのコピー（出したあとにシーンを直しても、本線は変わらない）
// ==========================================================================
const CAMS = ['cam1', 'cam2'];
const TEAMS = ['HOME', 'AWAY'];
const MAX_ROSTER = 200;
const MAX_SCENES = 500;
const MAX_LAYERS = 40;
const MAX_CELL = 5000;
const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_SCRIPT_ROWS = 6000;          // 台本を読み込むときの行数の上限
const MAX_SCRIPT_SECTIONS = 31;        // シート30 ＋ 予備
const ROW_TEXT_KEYS = ['no', 'time', 'dur', 'title', 'bgm', 'vision', 'visionR', 'mic', 'speaker', 'script', 'note'];
const FUTA_ACTIVE = ['', 'left', 'full'];
const ALWAYS_GROUP = Scene.ALWAYS_GROUP;

// 守山の既定：左は黒、右は遊撃カメラ（cam1）
function moriyamaProgram() {
    const P = Scene.presets(Scene.stageOf({ mode: 'sdi', bandH: 686 }));
    return { sceneId: '', name: '', layers: [Scene.newLayer('camera', { cam: 'cam1' }, P.right)] };
}

function initialState() {
    const output = { mode: 'sdi', bandY: 197, bandH: 686 };   // 守山：1920×686 の帯（14:5）
    const scenes = Scene.defaultScenes(Scene.stageOf(output), []);
    return {
        program: moriyamaProgram(),            // いまビジョンに出ているシーン
        black: false,                          // 黒にする（BLACK）
        guide: false,                          // 2画面の境目の線を出す（設置・調整用）
        // 出力の形
        //   wide … 3840×1080（32:9）をそのまま出す
        //   sdi  … 1920×1080 で出し、ビジョンに映る「帯」（y=bandY から高さ bandH）だけを使う
        //          （HDMI→SDIコンバーター経由で、スケーラーが横100%・上下トリミングする現場用）
        output,
        transition: { type: 'fade', ms: 500 }, // 切り替え方（cut / fade）
        cameras: { cam1: { deviceId: '', label: '' }, cam2: { deviceId: '', label: '' } },
        teams: {
            HOME: { name: 'HOME', color: '#b91c1c', photoTeam: '' },
            AWAY: { name: 'AWAY', color: '#1d4ed8', photoTeam: '' }
        },
        roster: [],                            // 選手名簿（CSVから読み込む）
        derby: { count: 0, outs: 0 },          // ホームラン競争のカウンター
        futa: { left: '', full: '', active: '', prev: null },   // フタ（ロゴ画面）。空の画像＝slides/フタ/ の最初の画像
        scenes,                                // シーン（作った画面）
        sceneOrder: scenes.map(s => s.id),     // シーンの並び順
        preview: scenes[0].id,                 // PREVIEW（次に出す・いま直しているシーン）
        cursor: '',                            // 台本の流れの中で、最後に出したシーン
        lid: true,                             // カメラのフタ（全体のスイッチ）。ONの間、カメラの上にフタの画像を重ねる
        lidImage: '',                          // フタの画像（空＝slides の L_960x686_horiz_black）
        bgmEnabled: false                      // BGM（音楽）をこのシステムで鳴らすか（既定は鳴らさない）
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

// 曲の場所：music/ の中、または「local:ファイル名」（音楽バーで選んだ別フォルダの曲）
const isSongPath = v => isMediaPath(v, ['music']) || (isStr(v, 200) && /^local:[^\/\\]+$/.test(v));
const isId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

const LAYER_KEYS = ['id', 'type', 'name', 'src', 'cam', 'color', 'text', 'logo', 'lidFor', 'noLid', 'x', 'y', 'w', 'h', 'visible', 'fit', 'opacity'];
function validateLayer(l, label) {
    if (!isObj(l)) return `${label}の形が正しくありません`;
    for (const k of Object.keys(l)) if (!LAYER_KEYS.includes(k)) return `${label}に不明な項目があります (${k})`;
    if (!isId(l.id)) return `${label}の番号が正しくありません`;
    if (!Scene.LAYER_TYPES.includes(l.type)) return `${label}の種類が正しくありません`;
    if (!isNum(l.x, -1, 2) || !isNum(l.y, -1, 2)) return `${label}の位置が正しくありません`;
    if (!isNum(l.w, 0.005, 3) || !isNum(l.h, 0.005, 3)) return `${label}の大きさが正しくありません`;
    if (typeof l.visible !== 'boolean') return `${label}の表示の指定が正しくありません`;
    if (!['cover', 'contain'].includes(l.fit)) return `${label}の収め方は cover か contain にしてください`;
    if (!isNum(l.opacity, 0, 1)) return `${label}の不透明度は0〜1にしてください`;
    if (l.name !== undefined && !isStr(l.name, 60)) return `${label}の名前は60文字以内にしてください`;
    switch (l.type) {
        case 'image':
        case 'video':
            if (!isMediaPath(l.src, ['slides', 'players'])) return `${label}の画像・動画のファイル名が正しくありません`;
            break;
        case 'logo':
            if (!isStr(l.src, 500) || (l.src !== '' && !isMediaPath(l.src, ['slides']))) return `${label}のロゴの画像の場所が正しくありません`;
            if (!['left', 'full'].includes(l.logo)) return `${label}のロゴの種類が正しくありません`;
            break;
        case 'camera':
            if (!CAMS.includes(l.cam)) return `${label}のカメラは cam1 か cam2 にしてください`;
            if (l.noLid !== undefined && typeof l.noLid !== 'boolean') return `${label}のフタの指定が正しくありません`;
            break;
        case 'lid':
            if (!isStr(l.src, 500) || (l.src !== '' && !isMediaPath(l.src, ['slides']))) return `${label}のフタの画像の場所が正しくありません`;
            if (!isId(l.lidFor)) return `${label}のフタの対象が正しくありません`;
            break;
        case 'color':
            if (!isHex(l.color)) return `${label}の色が正しくありません`;
            break;
        case 'text':
            if (!isStr(l.text, 300) || !l.text) return `${label}の文字を入れてください（300文字以内）`;
            if (l.color !== undefined && !isHex(l.color)) return `${label}の文字の色が正しくありません`;
            break;
    }
    return null;
}

function validateLayers(layers, label) {
    if (!Array.isArray(layers) || layers.length > MAX_LAYERS) return `${label}のレイヤーは${MAX_LAYERS}個までです`;
    const ids = new Set();
    for (let i = 0; i < layers.length; i++) {
        const e = validateLayer(layers[i], `${label}の${i + 1}番目のレイヤー`);
        if (e) return e;
        if (ids.has(layers[i].id)) return `${label}のレイヤーの番号が重なっています`;
        ids.add(layers[i].id);
    }
    return null;
}

function validateProgram(p, label) {
    if (!isObj(p)) return `${label}の形が正しくありません`;
    for (const k of Object.keys(p)) if (!['sceneId', 'name', 'layers'].includes(k)) return `${label}に不明な項目があります (${k})`;
    if (!(p.sceneId === '' || isId(p.sceneId))) return `${label}のシーンの番号が正しくありません`;
    if (!isStr(p.name, 100)) return `${label}の名前が正しくありません`;
    return validateLayers(p.layers, label);
}

const SCENE_KEYS = ['id', 'name', 'group', 'layers', 'bgm', 'duck', 'pick', 'script', 'warn'];
function validateSceneItem(sc, label) {
    if (!isObj(sc)) return `${label}の形が正しくありません`;
    for (const k of Object.keys(sc)) if (!SCENE_KEYS.includes(k)) return `${label}に不明な項目があります (${k})`;
    if (!isId(sc.id)) return `${label}の番号が正しくありません`;
    if (!isStr(sc.name, 100) || !sc.name.trim()) return `${label}の名前を入れてください（100文字以内）`;
    if (!isStr(sc.group, 60)) return `${label}のグループ名は60文字以内にしてください`;
    let e = validateLayers(sc.layers, label);
    if (e) return e;
    const b = sc.bgm === undefined ? null : sc.bgm;
    if (b !== null) {
        if (!isObj(b) || !['play', 'fade', 'stop'].includes(b.action)) return `${label}の音の指定が正しくありません`;
        const keys = b.action === 'play' ? ['action', 'path', 'name', 'loop'] : ['action'];
        for (const k of Object.keys(b)) if (!keys.includes(k)) return `${label}の音に不明な項目があります (${k})`;
        if (b.action === 'play') {
            if (!isSongPath(b.path)) return `${label}の曲が正しくありません`;
            if (!isStr(b.name, 300) || typeof b.loop !== 'boolean') return `${label}の曲の名前・くり返しの指定が正しくありません`;
        }
    }
    if (sc.duck !== null && typeof sc.duck !== 'boolean') return `${label}の「小さく」の指定が正しくありません`;
    if (sc.pick !== null) {
        if (!isObj(sc.pick) || !isStr(sc.pick.folder, 200) || Object.keys(sc.pick).length !== 1) return `${label}の「当日に選ぶ」の指定が正しくありません`;
    }
    if (sc.script !== null) {
        const t = sc.script;
        if (!isObj(t) || !isStr(t.sec, 100) || !isStr(t.no, 40) || typeof t.edited !== 'boolean' || Object.keys(t).length !== 3) return `${label}の台本との対応が正しくありません`;
    }
    if (!isStr(sc.warn, 500)) return `${label}の注意の文が長すぎます`;
    return null;
}

function validateScenes(s) {
    if (!Array.isArray(s.scenes) || s.scenes.length > MAX_SCENES) return `シーンは${MAX_SCENES}個までです`;
    const ids = new Set();
    for (let i = 0; i < s.scenes.length; i++) {
        const e = validateSceneItem(s.scenes[i], `シーン${i + 1}`);
        if (e) return e;
        if (ids.has(s.scenes[i].id)) return 'シーンの番号が重なっています';
        ids.add(s.scenes[i].id);
    }
    if (!Array.isArray(s.sceneOrder) || s.sceneOrder.length !== ids.size || new Set(s.sceneOrder).size !== ids.size || s.sceneOrder.some(id => !ids.has(id))) {
        return 'シーンの並び順が正しくありません（シーンの一覧と合っていません）';
    }
    if (!(s.preview === '' || ids.has(s.preview))) return 'PREVIEWのシーンが正しくありません';
    if (!(s.cursor === '' || ids.has(s.cursor))) return '台本の流れの位置が正しくありません';
    if (typeof s.lid !== 'boolean') return 'カメラのフタの設定が正しくありません';
    if (!isStr(s.lidImage, 500) || (s.lidImage !== '' && !isMediaPath(s.lidImage, ['slides']))) return 'カメラのフタの画像の場所が正しくありません';
    if (typeof s.bgmEnabled !== 'boolean') return 'BGMの使う・使わないの設定が正しくありません';
    return null;
}

function validateFuta(f) {
    if (!isObj(f)) return 'フタの設定が正しくありません';
    for (const k of Object.keys(f)) if (!['left', 'full', 'active', 'prev'].includes(k)) return `フタの設定に不明な項目があります (${k})`;
    for (const k of ['left', 'full']) {
        if (!isStr(f[k], 500) || (f[k] !== '' && !isMediaPath(f[k], ['slides']))) return `フタの画像（${k === 'left' ? '左' : '全面'}）の場所が正しくありません`;
    }
    if (!FUTA_ACTIVE.includes(f.active)) return 'フタの状態が正しくありません';
    if (f.prev !== null) { const e = validateProgram(f.prev, 'フタの前の画面'); if (e) return e; }
    return null;
}

function validateState(s) {
    if (!isObj(s)) return '状態の形が正しくありません';
    for (const k of STATE_KEYS) if (!(k in s)) return `項目が足りません (${k})`;
    for (const k of Object.keys(s)) if (!STATE_KEYS.includes(k)) return `不明な項目です (${k})`;

    let e = validateProgram(s.program, '本線');
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
    e = validateFuta(s.futa);
    if (e) return e;
    e = validateScenes(s);
    if (e) return e;
    return null;
}

// ==========================================================================
// 状態の読み込み・保存
// ==========================================================================
// 旧い保存データの式次第（cues・cueIndex）を、台本の「手動の式次第」セクションに移す
const MANUAL_SECTION = '手動の式次第';
function migrateLegacyCues(s) {
    if (!('cues' in s) && !('cueIndex' in s)) return;
    const legacy = Array.isArray(s.cues) ? s.cues : [];
    if (!s.script) {
        const sc = { title: '', rev: 0, sections: [], rows: [], pos: -1, onair: -1 };
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

// 旧い形（台本の行にキューを付ける）の台本を、シーンに変えて返す。台本の行のキュー → 1シーン
function scenesFromLegacyScript(old, stage, ctx) {
    const rows = Array.isArray(old.rows) ? old.rows : [];
    const sections = Array.isArray(old.sections) ? old.sections : [];
    let sugg = {};
    try { sugg = Core.suggestAll({ sections, rows }, ctx); } catch (e) { console.error(`[移行] 台本の提案を作れませんでした（${e.message}）`); }
    const scenes = [], rowScene = new Map();
    let sec = -1, pic = null;
    rows.forEach((r, i) => {
        if (!isObj(r) || !sections[r.sec]) return;
        if (r.sec !== sec) { sec = r.sec; pic = { band: null, left: null, right: null }; }
        if (r.kind === 'chapter') return;
        const cue = isObj(r.cue) ? r.cue : null;
        const pk = sugg[i] && sugg[i].pick && sugg[i].pick[0] ? sugg[i].pick[0] : '';
        if (!cue && !pk) return;
        const manual = !!sections[r.sec].manual;
        const secName = String(sections[r.sec].name || 'シート').slice(0, 60);
        const title = Scene.oneLine(r.title);
        const name = (Scene.oneLine((r.no ? r.no + ' ' : '') + title) || `${i + 1}行目`).slice(0, 100);
        let layers;
        if (cue && cue.scene) layers = Scene.legacySceneToLayers(cue.scene, stage);
        else {
            if (cue) {
                if (cue.band) pic.band = cue.band;
                else if (cue.left || cue.right) {
                    pic.band = null;
                    if (cue.left) pic.left = cue.left;
                    if (cue.right) pic.right = cue.right;
                }
            }
            if (pk && !(cue && (cue.left || cue.band))) { pic.band = null; pic.left = null; }
            layers = Scene.pictureLayers(pic, stage);
        }
        Scene.normalizeLids(layers);
        const sc = {
            id: Scene.uid('s'), name, group: secName, layers,
            bgm: cue && cue.bgm ? cue.bgm : null,
            duck: cue && typeof cue.duck === 'boolean' ? cue.duck : null,
            pick: pk ? { folder: String(pk).slice(0, 200) } : null,
            script: manual ? null : { sec: String(sections[r.sec].name || 'シート').slice(0, 100), no: r.no ? String(r.no).slice(0, 40) : '', edited: false },
            warn: ''
        };
        scenes.push(sc);
        rowScene.set(i, sc.id);
    });
    return { scenes, rowScene };
}

// 旧い保存データ（layout＋slots の本線・台本のキュー）を、シーンの形に移す
function migrateToScenes(s) {
    if (Array.isArray(s.scenes)) { delete s.script; return; }
    const out = isObj(s.output) && Number.isInteger(s.output.bandH) ? s.output : { mode: 'sdi', bandH: 686 };
    const stage = Scene.stageOf(out);
    const slideList = listTree(SLIDE_DIR, 'slides', SLIDE_EXTS);
    let music = [];
    try { music = listMusic(); } catch (e) { music = []; }
    const old = isObj(s.script) ? s.script : { sections: [], rows: [], pos: -1, onair: -1 };
    const conv = scenesFromLegacyScript(old, stage, { music, slides: slideList, futaLeft: isObj(s.futa) ? s.futa.left : '' });
    const defaults = Scene.defaultScenes(stage, slideList);
    s.scenes = conv.scenes.concat(defaults);
    s.sceneOrder = s.scenes.map(x => x.id);
    const legacyProgram = sc => ({ sceneId: '', name: '', layers: Scene.legacySceneToLayers(sc, stage) });
    if (isObj(s.program) && 'layout' in s.program) s.program = legacyProgram(s.program);
    if (isObj(s.futa) && isObj(s.futa.prev) && 'layout' in s.futa.prev) s.futa.prev = legacyProgram(s.futa.prev);
    s.preview = conv.rowScene.get(old.pos) || (conv.scenes[0] ? conv.scenes[0].id : s.scenes[0].id);
    s.cursor = conv.rowScene.get(old.onair) || '';
    delete s.script;
    console.log(`[起動] 旧い形の保存データを、シーンに移しました（台本のキュー→ ${conv.scenes.length}シーン、いつでも ${defaults.length}シーン）`);
}

// 本線のフタのレイヤーを、いまの設定（画像・ON／OFF）に合わせる。フタが無い本線には付ける
function refreshProgramLids(st) {
    try {
        Scene.normalizeLids(st.program.layers);
        st.program.layers = Scene.resolveLayers(st.program.layers, currentLogos(st));
    } catch (e) { console.error(`[フタ] 本線のフタを更新できませんでした（${e.message}）`); }
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        console.log('[起動] 保存データが無いため、初期状態で開始します');
        const st = initialState();
        // slides/フタ/・slides/全面/ の画像が見つかれば、「いつでも」のシーンに使う
        st.scenes = Scene.defaultScenes(Scene.stageOf(st.output), listTree(SLIDE_DIR, 'slides', SLIDE_EXTS));
        st.sceneOrder = st.scenes.map(x => x.id);
        st.preview = st.scenes[0].id;
        refreshProgramLids(st);
        return st;
    }
    // 保存データが壊れている場合は、勝手に初期化せずに止める（式次第や名簿を失わないため）
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    let s;
    try {
        s = JSON.parse(raw);
    } catch (e) {
        throw new Error(`保存データ(${STATE_FILE})を読み込めません: ${e.message}`);
    }
    if (!isObj(s)) throw new Error(`保存データ(${STATE_FILE})の形が正しくありません`);
    // 旧い「式次第（cues）」は、いったん台本の形に直してから、シーンに移す
    migrateLegacyCues(s);
    if (isObj(s.script) && Array.isArray(s.script.rows)) {
        s.script.rows.forEach(r => { if (isObj(r)) { if (r.no === undefined) r.no = ''; if (r.visionR === undefined) r.visionR = ''; if (r.kind === undefined) r.kind = 'row'; } });
    }
    migrateToScenes(s);
    const hadLid = 'lid' in s;
    // 機能を追加する前の保存データには、新しい項目を書き足す
    const init = initialState();
    STATE_KEYS.forEach(k => {
        if (!(k in s)) {
            s[k] = init[k];
            console.log(`[起動] 以前の形式の保存データのため、「${k}」を初期値で追加しました`);
        }
    });
    // カメラのフタ：なかった保存データのシーンにも、カメラの上にフタを置く。本線のフタも画像・ON／OFFに合わせる
    if (Array.isArray(s.scenes) && !hadLid) s.scenes.forEach(sc => { if (isObj(sc) && Array.isArray(sc.layers)) Scene.normalizeLids(sc.layers); });
    // BLACKはその場かぎりのもの。起動し直したときに真っ黒のままにならないよう解除して始める
    if (s.black) {
        console.log('[起動] 前回の終了時に BLACK になっていたため、解除して始めます');
        s.black = false;
    }
    if (isObj(s.program) && Array.isArray(s.program.layers)) refreshProgramLids(s);
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

// 台本から作ったシーンを、画面で手直ししたら「手で直した」印を付ける（台本を読み直しても上書きしない）
function markEdited(old, next) {
    if (!Array.isArray(old.scenes) || !Array.isArray(next.scenes)) return;
    const prev = new Map(old.scenes.filter(isObj).map(sc => [sc.id, sc]));
    // カメラのフタ（自動で付く）の変化は「手で直した」に数えない
    const sig = x => JSON.stringify([x.name, (x.layers || []).filter(l => l && l.type !== 'lid').map(l => { const c = Object.assign({}, l); delete c.noLid; return c; }), x.bgm, x.duck, x.pick]);
    next.scenes.forEach(sc => {
        const o = isObj(sc) ? prev.get(sc.id) : null;
        if (!o || !isObj(sc.script) || !isObj(o.script) || sc.script.edited) return;
        if (sig(o) !== sig(sc)) sc.script.edited = true;
    });
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
    return { left: Core.resolveLogo(st.futa, 'left', list), full: Core.resolveLogo(st.futa, 'full', list), lid: Scene.findLid(st.lidImage, list), lidOn: st.lid !== false };
}

// シーンを本線に出す（BLACK・フタは解除）。流れのシーンなら、「最後に出したシーン」にして、次の流れのシーンを PREVIEW に入れる
function takeScene(next, id, opts = {}) {
    const sc = next.scenes.find(x => x.id === id);
    if (!sc) throw new Error('シーンが見つかりません');
    next.program = Scene.programFromScene(sc, currentLogos(next));
    next.black = false;
    next.futa = Object.assign({}, next.futa, { active: '', prev: null });
    if (Scene.isFlow(sc)) {
        next.cursor = id;
        const nx = Scene.flowAfter(next, id);
        if (nx) next.preview = nx;
    }
    return { sceneId: id, name: sc.name, silent: !!opts.silent };
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
    const P = Scene.presets(Scene.stageOf(next.output));
    const p = JSON.parse(JSON.stringify(next.program));
    let layers;
    if (kind === 'left') {
        // 右半分のレイヤーはそのまま残し、左半分にロゴを重ねる（右が空なら遊撃カメラ）
        layers = p.layers.filter(l => l.x >= 0.49);
        if (!layers.length) layers = [Scene.newLayer('camera', { cam: 'cam1' }, P.right)];
        layers.push(Scene.newLayer('logo', { src: logo, logo: 'left' }, P.left));
    } else {
        layers = [Scene.newLayer('logo', { src: logo, logo: 'full' }, P.full)];
    }
    next.program = { sceneId: '', name: kind === 'left' ? '左フタ' : '全面フタ', layers };
    next.futa = Object.assign({}, f, { active: kind, prev });
    return logo ? null : 'フタの画像がありません。slides/フタ/ に画像を入れるか、⚙の設定で選んでください（いまは黒を出しています）';
}

function applyControl(action, val) {
    const next = JSON.parse(JSON.stringify(state));
    let cue = null;
    let command = null;
    let notice = null;
    switch (action) {
        case 'take':                 // 管理画面のプレビューを本線に出す（管理画面が開いている必要あり）
        case 'swap':                 // PREVIEWのシーンの左と右を入れ替える（管理画面が開いている必要あり）
        case 'musicStop':            // 音楽を止める（フェードは音楽バーの設定どおり）
        case 'musicFade':            // 音楽をフェードアウト（音楽バーの秒数。0秒のときは2秒）
        case 'readNext':             // PREVIEWを1つ下のシーンへ（出さない。管理画面が開いている必要あり）
        case 'readPrev':             // PREVIEWを1つ上のシーンへ
            command = { action };
            break;
        case 'musicDuck':            // BGMを小さく／戻す（val=on / off、省略でトグル。管理画面が開いている必要あり）
            if (val !== undefined && val !== '' && !['on', 'off'].includes(val)) throw new Error('val は on か off にしてください（省略で切り替え）');
            command = { action, val: val || '' };
            break;
        case 'lid':                  // カメラのフタ（val=on / off、省略で切り替え）。本線のフタも、すぐ付く・外れる
            if (val !== undefined && val !== '' && !['on', 'off'].includes(val)) throw new Error('val は on か off にしてください（省略で切り替え）');
            next.lid = val === 'on' ? true : val === 'off' ? false : !state.lid;
            refreshProgramLids(next);
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
        case 'next': {               // 台本の流れの中で、最後に出したシーンの次を出す
            const f = Scene.flowIds(state);
            const i = f.indexOf(state.cursor);
            const id = f[i + 1];
            if (!id) throw new Error('次のシーンがありません');
            cue = takeScene(next, id);
            break;
        }
        case 'prev': {               // 1つ前のシーンを出し直す（BGMは鳴らし直さない）
            const f = Scene.flowIds(state);
            if (!f.length) throw new Error('シーンがありません');
            const i = f.indexOf(state.cursor);
            cue = takeScene(next, f[i > 0 ? i - 1 : 0], { silent: true });
            break;
        }
        case 'cue': {                // val=流れのシーンの順番（1から）
            const n = Number(val);
            if (!Number.isInteger(n) || n < 1) throw new Error('val にシーンの番号（1から）を入れてください');
            const id = Scene.flowIds(state)[n - 1];
            if (!id) throw new Error(`シーンの${n}番目はありません`);
            cue = takeScene(next, id);
            break;
        }
        case 'scene': {              // val=シーンの番号（管理画面が使う）。PREVIEWのシーンをすぐ出す
            if (!val) throw new Error('val にシーンの番号を入れてください');
            cue = takeScene(next, String(val));
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
// 台本の読み込み（台本から作る）
//   Excel の台本を読み、キューの付く行ごとにシーンを作る（読み直すと、番号で既存のシーンを更新する）
// ==========================================================================
let lastImport = null;     // 直近に読み込んだファイルの中身（列の割り当てを直してから取り込むため、サーバーが覚えておく）
let importSeq = 0;

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

// 取り込み：シートごとの設定（見出し行・列の役割）どおりに台本を読み、シーンを作る・更新する
//   - 台本由来で、まだ手で触っていないシーン（script.edited = false）だけ、中身を更新する
//   - 手で直したシーンは、そのまま残す（件数と名前を知らせる）
//   - 台本に無くなった行のシーンは、消さずに残す（知らせる）
function commitImport(req) {
    if (!isObj(req) || !lastImport || req.importId !== lastImport.id) {
        throw new Error('読み込んだファイルの情報がありません。もう一度ファイルを選んでください');
    }
    if (!Array.isArray(req.sheets)) throw new Error('シートの設定が正しくありません');
    const next = JSON.parse(JSON.stringify(state));

    const sections = [];
    const rows = [];
    const names = new Set();
    for (const cfg of req.sheets) {
        if (!isObj(cfg) || !Number.isInteger(cfg.index) || !lastImport.sheets[cfg.index]) throw new Error('シートの番号が正しくありません');
        if (cfg.include === false) continue;
        const sh = lastImport.sheets[cfg.index];
        if (!Array.isArray(cfg.roles) || cfg.roles.some(r => r !== '' && !SI.ROLES.includes(r))) throw new Error(`シート「${sh.name}」の列の割り当てが正しくありません`);
        if (!Number.isInteger(cfg.headerRow) || cfg.headerRow < -1) throw new Error(`シート「${sh.name}」の見出し行が正しくありません`);
        const got = SI.extractRows(sh.grid, cfg.headerRow, cfg.roles);
        if (got.length === 0) continue;
        let name = String(sh.name).slice(0, 60) || 'シート';
        for (let n = 2; names.has(name); n++) name = `${String(sh.name).slice(0, 50)}(${n})`;
        names.add(name);
        sections.push({ name, manual: false });
        got.forEach(r => rows.push(Object.assign({ sec: sections.length - 1, cue: null }, r)));
    }
    if (rows.length === 0) throw new Error('取り込める行がありません。列の割り当てを確かめてください（「内容」や「セリフ」の列が必要です）');
    if (rows.length > MAX_SCRIPT_ROWS || sections.length > MAX_SCRIPT_SECTIONS) throw new Error(`行・シートが多すぎます（${rows.length}行。${MAX_SCRIPT_ROWS}行・${MAX_SCRIPT_SECTIONS}シートまで）`);

    const ctx = { music: listMusic(), slides: listTree(SLIDE_DIR, 'slides', SLIDE_EXTS), futaLeft: state.futa.left };
    const sugg = Core.suggestAll({ sections, rows }, ctx);
    const built = Scene.buildScenesFromScript({ sections, rows }, sugg, Scene.stageOf(next.output), { mergePicks: req.mergePicks !== false, songWarn: next.bgmEnabled });
    if (!built.length) throw new Error('シーンにできる行がありません。スライド・曲の場所（slides・music フォルダ）を確かめてください');

    const firstImport = !next.scenes.some(sc => sc.script);
    const existing = Scene.sceneKeys(next.scenes);
    const seen = new Set();
    const summary = { created: 0, updated: 0, kept: [], missing: [] };
    let prevId = '';          // 台本の順で、1つ前のシーン（新しいシーンの置き場所）
    built.forEach(({ key, scene }) => {
        seen.add(key);
        const old = existing.get(key);
        if (old) {
            if (old.script.edited) summary.kept.push(old.name);
            else {
                old.name = scene.name;
                old.group = scene.group;
                old.layers = scene.layers;
                old.bgm = scene.bgm;
                old.duck = scene.duck;
                old.pick = scene.pick;
                old.warn = scene.warn;
                summary.updated++;
            }
            prevId = old.id;
            return;
        }
        next.scenes.push(scene);
        // 台本の順：1つ前のシーンの次へ。最初のシーンは「いつでも」より前へ
        let at;
        if (prevId) at = next.sceneOrder.indexOf(prevId) + 1;
        else {
            const firstAlways = next.sceneOrder.findIndex(id => !Scene.isFlow(next.scenes.find(x => x.id === id)));
            at = firstAlways >= 0 ? firstAlways : next.sceneOrder.length;
        }
        next.sceneOrder.splice(at, 0, scene.id);
        prevId = scene.id;
        summary.created++;
    });
    existing.forEach((sc, key) => { if (!seen.has(key) && sections.some(x => x.name === sc.script.sec)) summary.missing.push(sc.name); });
    if (next.scenes.length > MAX_SCENES) throw new Error(`シーンが多すぎます（${MAX_SCENES}個まで）`);
    // はじめて台本から作ったときは、最初のシーンを PREVIEW に入れる
    if (firstImport) next.preview = built[0].scene.id;
    return { next, summary: Object.assign(summary, { sections: sections.length, rows: rows.length, scenes: built.length }) };
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
            // 台本から作ったシーンの並びが正しいか、保存の前に確かめる（commit の中の validateState）
            const vErr = commit(next);
            if (vErr) throw new Error(vErr);
            console.log(`[台本] 取り込み: ${summary.sections}シート ${summary.rows}行 → 新規${summary.created}・更新${summary.updated}・手で直したため残した${summary.kept.length}・台本に無い${summary.missing.length}`);
            sendJson(res, 200, Object.assign({ status: 'ok' }, summary));
        });
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
                    markEdited(state, next);
                    if ('lid' in patch || 'lidImage' in patch) refreshProgramLids(next);
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
            const used = JSON.stringify([state.program, state.futa, state.scenes]).includes(JSON.stringify(rel));
            if (used) return sendJson(res, 400, { error: '本線・フタ・シーンで使っているため消せません。先に差し替えてください' });
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
        // BGMをこのシステムで鳴らさない設定のときは、音楽の操作は何もせず、エラーにもしない
        if (['musicPlay', 'musicStop', 'musicFade', 'musicDuck'].includes(action) && !state.bgmEnabled) {
            console.log(`[操作] ${action} は、BGMを鳴らさない設定のため何もしませんでした`);
            return sendJson(res, 200, { status: 'ok', ignored: true, message: 'BGMはこのシステムでは鳴らさない設定です' });
        }
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
