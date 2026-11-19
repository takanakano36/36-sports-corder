/* ==========================================================================
   スタジアムビジョン野球システム - 表示画面
   - サーバー(/events)から届いた本線(program)＝レイヤーを下から順に重ねたシーンを描画する
     （レイヤーの位置・大きさは、帯に対する割合 0〜1。カメラのレイヤーは、OBS取り込み(camera=obs)のとき透明な穴になる）
     出力の形（state.output）が
       wide … 3840×1080（32:9）
       sdi  … 1920×1080 の画面の中の「帯」（ビジョンに映る部分。例 1920×630）だけに描く。帯の外は黒
   - ?view=left / right … 左半分・右半分だけを出す（HDMI 2本で出すとき。sdi のときは使わない）
   - ?monitor=pvw … 管理画面のプレビュー（管理画面から送られた画面を出す）
     ?monitor=pgm … 管理画面の本線モニター。nocam=1 でカメラを開かない
   ========================================================================== */

// ファイルをダブルクリックで開いた場合（file://）はサーバーと通信できないため、
// サーバー経由の正しいアドレスに切り替える
// OBSの「ローカルファイル」で開いた場合（http://absolute/...）も同じ
if (location.protocol === "file:" || location.hostname === "absolute") {
    location.replace("http://localhost:3007/vision.html");
}

// ステージ（素材を並べる面）の大きさ。出力の形で変わる（applyOutput）
let STAGE_W = 3840;
let STAGE_H = 1080;
let HALF_W = 1920;
// ウィンドウに出す画面の大きさと、その中のステージの位置
let FRAME_W = 3840;
let FRAME_H = 1080;
let STAGE_Y = 0;
let OUTPUT_MODE = 'wide';

const params = new URLSearchParams(location.search);
const VIEW_PARAM = ['left', 'right'].includes(params.get('view')) ? params.get('view') : 'all';
let VIEW = VIEW_PARAM;
const MONITOR = params.get('monitor') || '';       // '' / pvw / pgm
const NO_CAM = params.get('nocam') === '1';
// ?camera=obs … OBS用。カメラの枠は透明にしてカメラを開かない
// （OBSで、このブラウザソースの下に「映像キャプチャデバイス」を敷くと、その枠から見える）
const CAM_HOLE = params.get('camera') === 'obs' && !MONITOR;
// （OBSの中のブラウザは古いことがあるため、新しいCSSの書き方を使わずに html・body の両方に印を付ける）
if (CAM_HOLE) { document.documentElement.classList.add('cam-hole'); document.body.classList.add('cam-hole'); }
if (MONITOR) document.body.classList.add('monitor');
if (params.get('guide') === '1') document.body.classList.add('show-guide');

let state = null;          // サーバーの最新状態
let previewScene = null;   // pvwモニター用シーン
let current = null;        // { key, layer, scene }
let lastDerbyCount = null;

// --------------------------------------------------------------------------
// ステージのスケーリング
// --------------------------------------------------------------------------
// 出力の形を反映する。形が変わったら true
function applyOutput(o) {
    const sdi = !!o && o.mode === 'sdi';
    const next = sdi
        ? { mode: 'sdi', w: 1920, h: o.bandH, y: o.bandY }
        : { mode: 'wide', w: 3840, h: 1080, y: 0 };
    const changed = next.mode !== OUTPUT_MODE || next.w !== STAGE_W || next.h !== STAGE_H || next.y !== STAGE_Y;
    OUTPUT_MODE = next.mode;
    STAGE_W = next.w;
    STAGE_H = next.h;
    HALF_W = STAGE_W / 2;
    // 管理画面のモニターは、ビジョンに映る部分（帯）だけを出す
    STAGE_Y = MONITOR ? 0 : next.y;
    FRAME_W = STAGE_W;
    FRAME_H = sdi && !MONITOR ? 1080 : STAGE_H;
    // SDI 1本のときは左右に分けて出さない
    VIEW = sdi ? 'all' : VIEW_PARAM;
    document.body.classList.toggle('out-sdi', sdi);
    const stage = document.getElementById('stage');
    stage.style.width = STAGE_W + 'px';
    stage.style.height = STAGE_H + 'px';
    document.querySelector('.guide-l').textContent = `LEFT ${HALF_W}×${STAGE_H}`;
    document.querySelector('.guide-r').textContent = `RIGHT ${HALF_W}×${STAGE_H}`;
    fitStage();
    return changed;
}

function fitStage() {
    const stage = document.getElementById('stage');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewW = VIEW === 'all' ? FRAME_W : HALF_W;
    const scale = Math.min(vw / viewW, vh / FRAME_H);
    const offsetX = (vw - viewW * scale) / 2 - (VIEW === 'right' ? HALF_W * scale : 0);
    const offsetY = (vh - FRAME_H * scale) / 2 + STAGE_Y * scale;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}
window.addEventListener('resize', fitStage);

// --------------------------------------------------------------------------
// カメラ (キャプチャーボード) 管理
// 同じデバイスは1本のストリームを複数の<video>で共有する
// --------------------------------------------------------------------------
const camStreams = {}; // deviceId('' = 既定) -> Promise<MediaStream>

function getCamStream(camId) {
    const cam = (state && state.cameras && state.cameras[camId]) || {};
    const deviceId = cam.deviceId || '';
    if (!camStreams[deviceId]) {
        const video = {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 }
        };
        if (deviceId) video.deviceId = { exact: deviceId };
        camStreams[deviceId] = navigator.mediaDevices.getUserMedia({ video, audio: false })
            .catch(err => {
                delete camStreams[deviceId];
                throw err;
            });
    }
    return camStreams[deviceId];
}

// 割当から外れたデバイスのストリームを停止
function releaseUnusedCams() {
    if (!state || !state.cameras) return;
    const used = new Set(Object.values(state.cameras).map(c => c.deviceId || ''));
    Object.keys(camStreams).forEach(id => {
        if (!used.has(id)) {
            camStreams[id].then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
            delete camStreams[id];
        }
    });
}

// --------------------------------------------------------------------------
// ユーティリティ
// --------------------------------------------------------------------------
// 表示画面で起きた問題（カメラが開けない等）を管理画面に知らせる。ビジョンには文字を出さない
const noticed = {};
function notice(message) {
    if (MONITOR || noticed[message]) return;
    noticed[message] = true;
    setTimeout(() => { delete noticed[message]; }, 10000);
    fetch('/api/notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `[表示画面${VIEW === 'all' ? '' : VIEW === 'left' ? '・左' : '・右'}] ${message}` })
    }).catch(() => {});
}

function esc(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mediaUrl(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

function isVideoFile(p) {
    return /\.(mp4|webm|mov|m4v)$/i.test(p || '');
}

function buildTestPattern() {
    const el = document.createElement('div');
    el.className = 'test-pattern';
    const bars = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
    el.innerHTML = `
        <div class="tp-half tp-l"><div class="tp-big">L</div><div class="tp-small">${OUTPUT_MODE === 'sdi' ? `0-${HALF_W - 1}` : 'HDMI-1 / 0-1919'}</div></div>
        <div class="tp-half tp-r"><div class="tp-big">R</div><div class="tp-small">${OUTPUT_MODE === 'sdi' ? `${HALF_W}-${STAGE_W - 1}` : 'HDMI-2 / 1920-3839'}</div></div>
        ${OUTPUT_MODE === 'sdi' ? `<div class="tp-frame"></div><div class="tp-size">${STAGE_W}×${STAGE_H}</div>` : ''}
        <div class="tp-circle"></div>
        <div class="tp-bars">${bars.map(c => `<span style="background:${c}"></span>`).join('')}</div>`;
    return el;
}

// --------------------------------------------------------------------------
// レイヤーの描画
//   シーン（program）= { layers: [下から順] }。各レイヤーは帯に対する割合（x, y, w, h）で絶対配置する
// --------------------------------------------------------------------------
const CAM_NAMES = { cam1: '遊撃カメラ', cam2: 'カメラ2' };

function layerGeom(l) {
    return { left: l.x * STAGE_W, top: l.y * STAGE_H, width: l.w * STAGE_W, height: l.h * STAGE_H };
}

// 片側だけを出すウィンドウ（?view=left / right）で、そのレイヤーが映るか
function inView(g) {
    if (VIEW === 'left') return g.left < HALF_W;
    if (VIEW === 'right') return g.left + g.width > HALF_W;
    return true;
}

// 中身（素材）が同じかを見分ける印。位置・大きさ・不透明度・収め方だけの変更は、作り直さずその場で更新する
function layerContentKey(l) {
    return [l.id, l.type, l.src || '', l.cam || '', l.color || '', l.text || '', l.logo || ''].join('\u0001');
}

function sceneKey(scene) {
    const parts = (scene.layers || []).filter(l => l.visible).map(l => layerContentKey(l) + (inView(layerGeom(l)) ? '' : '\u0001hidden'));
    return STAGE_W + 'x' + STAGE_H + '|' + VIEW + '|' + parts.join('|');
}

function buildTextLayer(l) {
    const t = document.createElement('div');
    t.className = 'text-card';
    t.style.color = /^#[0-9a-fA-F]{6}$/.test(l.color || '') ? l.color : '#fff';
    // {HR} はホームラン競争のカウンターの数字に置き換わる（数字だけ変わり続ける）
    const html = esc(l.text).replace(/\{HR\}/g, '<span class="hr-live" data-live="derby-count">0</span>').replace(/\n/g, '<br>');
    t.innerHTML = `<div class="t-title">${html}</div>`;
    return t;
}

function buildLayerContent(el, l) {
    switch (l.type) {
        case 'image':
        case 'logo':
        case 'video': {
            if (!l.src) return;
            const path = mediaUrl(l.src);
            if (l.type === 'video' || isVideoFile(l.src)) {
                const v = document.createElement('video');
                v.className = 'media';
                v.muted = true;
                v.playsInline = true;
                v.autoplay = true;
                v.loop = true;
                v.src = path;
                v.onerror = () => notice(`動画を読み込めませんでした（${l.src}）`);
                v.play().catch(() => {});
                el.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.className = 'media';
                img.src = path;
                img.onerror = () => {
                    img.remove();
                    notice(`画像を読み込めませんでした（${l.src}）`);
                    if (MONITOR) msg(el, '画像を読み込めません<br>' + esc(l.src));
                };
                el.appendChild(img);
            }
            break;
        }
        case 'camera': {
            if (CAM_HOLE) { el.classList.add('hole'); break; }
            if (NO_CAM) { msg(el, '📹 ' + esc(CAM_NAMES[l.cam] || l.cam || 'cam1')); break; }
            const v = document.createElement('video');
            v.className = 'media';
            v.muted = true;
            v.playsInline = true;
            v.autoplay = true;
            el.appendChild(v);
            getCamStream(l.cam || 'cam1')
                .then(stream => { v.srcObject = stream; v.play().catch(() => {}); })
                .catch(err => {
                    v.remove();
                    notice(window.obsstudio
                        ? `OBSの中ではカメラ(${l.cam})を開けませんでした（${err.name}）。OBSを「--enable-media-stream」を付けて起動するか、キャプチャーボードはOBSの「映像キャプチャデバイス」で入れてください`
                        : `カメラ(${l.cam})を開けませんでした：${err.name} ${err.message}。管理画面のプレビューや他のソフトがキャプチャーボードを使っていないか確かめてください`);
                    if (MONITOR) msg(el, 'カメラを開けません (' + esc(l.cam) + ')<br><small>' + esc(err.message) + '</small>');
                });
            break;
        }
        case 'text':
            el.appendChild(buildTextLayer(l));
            break;
        case 'color':
            el.style.background = l.color || '#000';
            break;
        case 'test':
            el.appendChild(buildTestPattern());
            break;
    }
}

function msg(el, html) {
    const m = document.createElement('div');
    m.className = 'msg';
    m.innerHTML = html;
    el.appendChild(m);
}

// 位置・大きさ・不透明度・収め方を反映
function applyLayerStyle(el, l) {
    const g = layerGeom(l);
    el.style.left = g.left + 'px';
    el.style.top = g.top + 'px';
    el.style.width = g.width + 'px';
    el.style.height = g.height + 'px';
    el.style.opacity = String(l.opacity === undefined ? 1 : l.opacity);
    const fit = l.fit || 'cover';
    if (el.classList.contains('hole')) { el.classList.toggle('hole-contain', fit === 'contain'); return; }
    const media = el.querySelector('.media');
    if (media) media.style.objectFit = fit;
}

// OBS用：カメラのレイヤーは透明な穴。その下にあるレイヤー（背景の色・画像など）も、穴の形にくり抜く（OBSのカメラが見えるように）
function holeRect(l) {
    const g = layerGeom(l);
    if ((l.fit || 'cover') !== 'contain') return g;
    const h = Math.min(g.height, g.width * 9 / 16);
    const w = h * 16 / 9;
    return { left: g.left + (g.width - w) / 2, top: g.top + (g.height - h) / 2, width: w, height: h };
}
function applyHoles(container, layers) {
    if (!CAM_HOLE) return;
    const vis = layers.filter(l => l.visible && inView(layerGeom(l)));
    vis.forEach((l, i) => {
        const el = container.querySelector(`[data-lid="${CSS.escape(l.id)}"]`);
        if (!el) return;
        const g = layerGeom(l);
        const cuts = [];
        vis.slice(i + 1).forEach(u => {
            if (u.type !== 'camera') return;
            const h = holeRect(u);
            const x0 = Math.max(g.left, h.left), y0 = Math.max(g.top, h.top);
            const x1 = Math.min(g.left + g.width, h.left + h.width), y1 = Math.min(g.top + g.height, h.top + h.height);
            if (x1 - x0 > 0.5 && y1 - y0 > 0.5) cuts.push(`M${x0 - g.left} ${y0 - g.top} H${x1 - g.left} V${y1 - g.top} H${x0 - g.left} Z`);
        });
        el.style.clipPath = cuts.length ? `path(evenodd, 'M0 0 H${g.width} V${g.height} H0 Z ${cuts.join(' ')}')` : '';
    });
}

function buildLayer(scene) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    (scene.layers || []).forEach(l => {
        if (!l.visible) return;
        const g = layerGeom(l);
        // 片側だけを出すウィンドウでは、映らないレイヤーは作らない
        // （映らないカメラを開かない＝キャプチャーボードを左右のウィンドウで取り合わない）
        if (!inView(g)) return;
        const el = document.createElement('div');
        el.className = 'lyr lyr-' + l.type;
        el.dataset.lid = l.id;
        buildLayerContent(el, l);
        applyLayerStyle(el, l);
        layer.appendChild(el);
    });
    applyHoles(layer, scene.layers || []);
    return layer;
}

// 同じ素材のまま位置・大きさ・不透明度だけ変わった場合は、フェードせずその場で更新
function updateLayerInPlace(layer, scene) {
    (scene.layers || []).forEach(l => {
        const el = layer.querySelector(`[data-lid="${CSS.escape(l.id)}"]`);
        if (el) applyLayerStyle(el, l);
    });
    applyHoles(layer, scene.layers || []);
}

function disposeLayer(layer) {
    layer.querySelectorAll('video').forEach(v => {
        v.pause();
        v.srcObject = null;   // カメラの共有ストリーム自体は止めない
        v.removeAttribute('src');
        v.load();
    });
    layer.remove();
}

function renderScene(scene, transition) {
    if (!scene || !Array.isArray(scene.layers)) return;
    const key = sceneKey(scene);
    if (current && current.key === key) {
        updateLayerInPlace(current.layer, scene);
        current.scene = scene;
        updateLive();
        return;
    }
    const layers = document.getElementById('layers');
    const layer = buildLayer(scene);
    const t = transition || { type: 'cut', ms: 0 };
    const old = current ? current.layer : null;
    // 前回のフェードが途中なら、古いレイヤーを即座に片付ける
    Array.from(layers.children).forEach(l => { if (l !== old) disposeLayer(l); });

    if (old && t.type === 'fade' && t.ms > 0) {
        layer.style.opacity = '0';
        layers.appendChild(layer);
        layer.getBoundingClientRect();
        layer.style.transition = `opacity ${t.ms}ms ease`;
        layer.style.opacity = '1';
        setTimeout(() => { if (old.parentNode) disposeLayer(old); }, t.ms + 50);
    } else {
        layers.appendChild(layer);
        if (old) disposeLayer(old);
    }
    current = { key, layer, scene };
    lastDerbyCount = null;
    updateLive();
}

// HR競争カウンターなど、シーンを切り替えずに値だけ更新する要素
function updateLive() {
    if (!state) return;
    const d = state.derby || {};
    document.querySelectorAll('[data-live="derby-count"]').forEach(el => {
        const v = String(d.count || 0);
        if (el.textContent !== v) {
            el.textContent = v;
            if (lastDerbyCount !== null) {
                el.classList.remove('bump');
                el.getBoundingClientRect();
                el.classList.add('bump');
            }
        }
    });
    document.querySelectorAll('[data-live="derby-outs"]').forEach(el => {
        el.textContent = d.outs ? `OUT ${d.outs}` : '';
    });
    lastDerbyCount = d.count || 0;
}

function applyBlack() {
    const b = document.getElementById('black');
    const on = !!(state && state.black) && MONITOR !== 'pvw';
    const ms = state && state.transition ? state.transition.ms : 500;
    b.style.transitionDuration = (state && state.transition && state.transition.type === 'cut' ? 0 : ms) + 'ms';
    b.classList.toggle('on', on);
}

// --------------------------------------------------------------------------
// 同期
// --------------------------------------------------------------------------
function onState(newState) {
    const first = !state;
    state = newState;
    applyOutput(state.output);
    document.getElementById('stage').classList.remove('waiting');
    releaseUnusedCams();
    if (MONITOR === 'pvw') {
        if (previewScene) renderScene(previewScene, { type: 'cut', ms: 0 });
    } else {
        renderScene(state.program, first ? { type: 'cut', ms: 0 } : state.transition);
    }
    applyBlack();
    updateLive();
    document.body.classList.toggle('show-guide', !!state.guide || params.get('guide') === '1');
}

function connectSSE() {
    const es = new EventSource('/events');
    es.addEventListener('UPDATE_STATE', e => {
        document.body.classList.remove('disconnected');
        try { onState(JSON.parse(e.data)); } catch (err) { console.error(err); }
    });
    es.onerror = () => { document.body.classList.add('disconnected'); };
    es.onopen = () => { document.body.classList.remove('disconnected'); };
}

// 操作画面 (親ウィンドウ) からのプレビューシーン
window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type === 'preview-scene' && MONITOR === 'pvw') {
        previewScene = d.scene;
        if (state) renderScene(previewScene, { type: 'cut', ms: 0 });
    }
    if (d.type === 'guide') document.body.classList.toggle('show-guide', !!d.on);
});

// 出力ウィンドウ: ダブルクリック or F キーで全画面
function toggleFullscreen() {
    if (MONITOR) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
}
document.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'g' || e.key === 'G') document.body.classList.toggle('show-guide');
});

fitStage();
connectSSE();
