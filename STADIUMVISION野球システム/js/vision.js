/* ==========================================================================
   スタジアムビジョン野球システム - 表示画面
   - サーバー(/events)から届いた本線(program)を 3840×1080 に描画する
   - ?view=left / right … 左半分・右半分だけを出す（HDMI 2本で出すとき）
   - ?monitor=pvw … 管理画面のプレビュー（管理画面から送られた画面を出す）
     ?monitor=pgm … 管理画面の本線モニター。nocam=1 でカメラを開かない
   ========================================================================== */

// ファイルをダブルクリックで開いた場合（file://）はサーバーと通信できないため、
// サーバー経由の正しいアドレスに切り替える
// OBSの「ローカルファイル」で開いた場合（http://absolute/...）も同じ
if (location.protocol === "file:" || location.hostname === "absolute") {
    location.replace("http://localhost:3007/vision.html");
}

const STAGE_W = 3840;
const STAGE_H = 1080;
const HALF_W = 1920;

const params = new URLSearchParams(location.search);
const VIEW = ['left', 'right'].includes(params.get('view')) ? params.get('view') : 'all';
const MONITOR = params.get('monitor') || '';       // '' / pvw / pgm
const NO_CAM = params.get('nocam') === '1';
// ?camera=obs … OBS用。カメラの枠は透明にしてカメラを開かない
// （OBSで、このブラウザソースの下に「映像キャプチャデバイス」を敷くと、その枠から見える）
const CAM_HOLE = params.get('camera') === 'obs' && !MONITOR;
// （OBSの中のブラウザは古いことがあるため、新しいCSSの書き方を使わずに html・body の両方に印を付ける）
if (CAM_HOLE) { document.documentElement.classList.add('cam-hole'); document.body.classList.add('cam-hole'); }
if (MONITOR) document.body.classList.add('monitor');
if (params.get('guide') === '1') document.body.classList.add('show-guide');

const CROP_KEYS = ['fit', 'posX', 'posY', 'zoom'];
const LAYOUT_SLOTS = {
    wide: ['wide'],
    split: ['left', 'right'],
    single: ['bg', 'single']
};

let state = null;          // サーバーの最新状態
let previewScene = null;   // pvwモニター用シーン
let current = null;        // { key, layer, scene }
let lastDerbyCount = null;

// --------------------------------------------------------------------------
// ステージのスケーリング
// --------------------------------------------------------------------------
function fitStage() {
    const stage = document.getElementById('stage');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const viewW = VIEW === 'all' ? STAGE_W : HALF_W;
    const scale = Math.min(vw / viewW, vh / STAGE_H);
    const offsetX = (vw - viewW * scale) / 2 - (VIEW === 'right' ? HALF_W * scale : 0);
    const offsetY = (vh - STAGE_H * scale) / 2;
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

function contentKey(src) {
    if (!src) return 'none';
    const o = {};
    Object.keys(src).sort().forEach(k => { if (!CROP_KEYS.includes(k)) o[k] = src[k]; });
    return JSON.stringify(o);
}

// 一文字の守備位置表記は、ビジョン上で読みやすい正式名称にする (「一」がダッシュに見える対策)
const POS_FULL = { '投': '投手', '捕': '捕手', '一': '一塁手', '二': '二塁手', '三': '三塁手', '遊': '遊撃手', '左': '左翼手', '中': '中堅手', '右': '右翼手', '指': '指名打者', 'DH': '指名打者', '内': '内野手', '外': '外野手' };
function posLabel(p) { return POS_FULL[String(p || '').trim()] || p || ''; }

function teamInfo(team) {
    const t = (state && state.teams && state.teams[team]) || {};
    return { name: t.name || team || '', color: t.color || '#b91c1c', photoTeam: t.photoTeam || t.name || team || '' };
}

// 顔写真: player.photo → photos/<チーム>/player/<背番号>.(png|jpg|jpeg) の順に探す
function photoCandidates(p) {
    const list = [];
    if (p.photo) list.push(p.photo);
    const folder = teamInfo(p.team).photoTeam;
    if (folder && p.number !== undefined && p.number !== '') {
        ['png', 'jpg', 'jpeg', 'webp'].forEach(ext => list.push(`photos/${folder}/player/${p.number}.${ext}`));
    }
    return list;
}

function attachPhoto(container, player) {
    const cands = photoCandidates(player);
    const numBg = document.createElement('div');
    numBg.className = 'pc-num-bg';
    numBg.textContent = player.number || '';
    if (!cands.length) { container.appendChild(numBg); return; }
    const img = document.createElement('img');
    let i = 0;
    img.onerror = () => {
        i++;
        if (i < cands.length) img.src = mediaUrl(cands[i]);
        else { img.remove(); container.appendChild(numBg); }
    };
    img.src = mediaUrl(cands[0]);
    container.appendChild(img);
}

// --------------------------------------------------------------------------
// ソース別の描画
// --------------------------------------------------------------------------
function buildPlayerCard(src) {
    const p = src.player || {};
    const team = teamInfo(p.team);
    const card = document.createElement('div');
    card.className = 'pcard enter card-' + (src.card || 'atbat');
    card.style.setProperty('--team', team.color);

    const photo = document.createElement('div');
    photo.className = 'pc-photo';
    attachPhoto(photo, p);
    card.appendChild(photo);

    const info = document.createElement('div');
    info.className = 'pc-info';

    const defaultLabel = { atbat: 'NOW BATTING', sub: '選手交代', hr: 'HOME RUN DERBY' }[src.card] || '';
    const label = src.label || defaultLabel;
    let html = '';
    if (label) html += `<div class="pc-label"><span>${esc(label)}</span></div>`;
    html += `<div class="pc-team">${esc(team.name)}</div>`;

    const row = [];
    if (src.card === 'atbat' && p.order) row.push(`<span class="pc-order">${esc(p.order)}番</span>`);
    if (src.card === 'sub') row.push('<span class="pc-in-tag">IN</span>');
    if (p.position) row.push(`<span class="pc-pos">${esc(posLabel(p.position))}</span>`);
    if (p.number !== undefined && p.number !== '') row.push(`<span class="pc-number">${esc(p.number)}</span>`);
    if (row.length) html += `<div class="pc-row">${row.join('')}</div>`;

    html += `<div class="pc-name">${esc(p.name)}</div>`;
    if (p.kana) html += `<div class="pc-kana">${esc(p.kana)}</div>`;

    if (src.card === 'atbat' || src.card === 'sub') {
        const stats = [];
        if (p.avg) stats.push(`<div class="pc-stat"><b>${esc(p.avg)}</b><small>打率</small></div>`);
        if (p.hr) stats.push(`<div class="pc-stat"><b>${esc(p.hr)}</b><small>本塁打</small></div>`);
        if (p.rbi) stats.push(`<div class="pc-stat"><b>${esc(p.rbi)}</b><small>打点</small></div>`);
        if (p.era) stats.push(`<div class="pc-stat"><b>${esc(p.era)}</b><small>防御率</small></div>`);
        if (stats.length && src.showStats !== false) html += `<div class="pc-stats">${stats.join('')}</div>`;
        if (p.comment && src.showComment) html += `<div class="pc-comment">${esc(p.comment)}</div>`;
    }
    if (src.card === 'sub' && src.out && src.out.name) {
        const o = src.out;
        html += `<div class="pc-out"><span class="tag">OUT</span>${o.position ? esc(posLabel(o.position)) + ' ' : ''}${o.number ? '#' + esc(o.number) + ' ' : ''}${esc(o.name)}</div>`;
    }
    info.innerHTML = html;
    card.appendChild(info);

    if (src.card === 'hr') {
        const d = document.createElement('div');
        d.className = 'pc-derby';
        d.innerHTML = '<div class="d-label">HR</div><div class="d-count" data-live="derby-count">0</div><div class="d-outs" data-live="derby-outs"></div>';
        card.appendChild(d);
    }
    return card;
}

function buildLineup(src) {
    const team = teamInfo(src.team);
    const el = document.createElement('div');
    el.className = 'lineup enter';
    el.style.setProperty('--team', team.color);
    const rows = src.rows || [];
    el.style.setProperty('--rows', Math.max(5, Math.min(10, rows.length)));
    el.innerHTML = `
        <div class="lu-head"><div class="lu-title">${esc(src.title || 'STARTING LINEUP')}</div><div class="lu-team">${esc(team.name)}</div></div>
        <div class="lu-list">${rows.map((r, i) => `
            <div class="lu-row" style="animation-delay:${(i * 0.06).toFixed(2)}s">
                <span class="o">${esc(r.order || '')}</span><span class="p">${esc(r.position || '')}</span>
                <span class="n">${r.number !== undefined && r.number !== '' ? '#' + esc(r.number) : ''}</span><span class="nm">${esc(r.name || '')}</span>
            </div>`).join('')}
        </div>`;
    return el;
}

function buildTestPattern() {
    const el = document.createElement('div');
    el.className = 'test-pattern';
    const bars = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
    el.innerHTML = `
        <div class="tp-half tp-l"><div class="tp-big">L</div><div class="tp-small">HDMI-1 / 0-1919</div></div>
        <div class="tp-half tp-r"><div class="tp-big">R</div><div class="tp-small">HDMI-2 / 1920-3839</div></div>
        <div class="tp-circle"></div>
        <div class="tp-bars">${bars.map(c => `<span style="background:${c}"></span>`).join('')}</div>`;
    return el;
}

function buildSlotContent(slotEl, src) {
    src = src || { type: 'black' };
    switch (src.type) {
        case 'slide':
        case 'url': {
            const path = src.type === 'slide' ? mediaUrl(src.file || '') : (src.url || '');
            if (!path) return;
            if (isVideoFile(src.file || src.url)) {
                const v = document.createElement('video');
                v.className = 'media';
                v.muted = true;
                v.playsInline = true;
                v.autoplay = true;
                v.loop = src.loop !== false;
                v.src = path;
                v.onerror = () => notice(`動画を読み込めませんでした（${src.file || src.url}）`);
                v.play().catch(() => {});
                slotEl.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.className = 'media';
                img.src = path;
                img.onerror = () => {
                    img.remove();
                    notice(`画像を読み込めませんでした（${src.file || src.url}）`);
                    if (MONITOR) msg(slotEl, '画像を読み込めません<br>' + esc(src.file || src.url));
                };
                slotEl.appendChild(img);
            }
            break;
        }
        case 'camera': {
            if (CAM_HOLE) { slotEl.classList.add('hole'); break; }
            if (NO_CAM) { msg(slotEl, '📹 ' + esc(src.cam || 'cam1') + '<br><small>(モニター表示OFF)</small>'); break; }
            const v = document.createElement('video');
            v.className = 'media';
            v.muted = true;
            v.playsInline = true;
            v.autoplay = true;
            slotEl.appendChild(v);
            getCamStream(src.cam || 'cam1')
                .then(stream => { v.srcObject = stream; v.play().catch(() => {}); })
                .catch(err => {
                    v.remove();
                    notice(window.obsstudio
                        ? `OBSの中ではカメラ(${src.cam})を開けませんでした（${err.name}）。OBSを「--enable-media-stream」を付けて起動するか、キャプチャーボードはOBSの「映像キャプチャデバイス」で入れてください`
                        : `カメラ(${src.cam})を開けませんでした：${err.name} ${err.message}。管理画面のプレビューや他のソフトがキャプチャーボードを使っていないか確かめてください`);
                    if (MONITOR) msg(slotEl, 'カメラを開けません (' + esc(src.cam) + ')<br><small>' + esc(err.message) + '</small>');
                });
            break;
        }
        case 'player':
            slotEl.appendChild(buildPlayerCard(src));
            break;
        case 'lineup':
            slotEl.appendChild(buildLineup(src));
            break;
        case 'text': {
            const t = document.createElement('div');
            t.className = 'text-card';
            t.style.background = src.color || '#0b1220';
            t.style.color = src.textColor || '#fff';
            t.innerHTML = `<div class="t-title">${esc(src.title).replace(/\n/g, '<br>')}</div>${src.sub ? `<div class="t-sub">${esc(src.sub).replace(/\n/g, '<br>')}</div>` : ''}`;
            slotEl.appendChild(t);
            break;
        }
        case 'color':
            slotEl.style.background = src.color || '#000';
            break;
        case 'test':
            slotEl.appendChild(buildTestPattern());
            break;
        default:
            // black / none
            break;
    }
}

function msg(slotEl, html) {
    const m = document.createElement('div');
    m.className = 'msg';
    m.innerHTML = html;
    slotEl.appendChild(m);
}

// トリミング (表示位置・拡大) を反映
function applyCrop(slotEl, src) {
    const media = slotEl.querySelector('.media');
    if (!media) return;
    const fit = (src && src.fit) || 'cover';
    const x = src && src.posX !== undefined ? src.posX : 50;
    const y = src && src.posY !== undefined ? src.posY : 50;
    const zoom = (src && src.zoom ? src.zoom : 100) / 100;
    media.style.objectFit = fit;
    media.style.objectPosition = `${x}% ${y}%`;
    media.style.transformOrigin = `${x}% ${y}%`;
    media.style.transform = zoom !== 1 ? `scale(${zoom})` : '';
}

function slotGeometry(scene, slot) {
    switch (slot) {
        case 'wide':
        case 'bg': return { left: 0, width: STAGE_W };
        case 'left': return { left: 0, width: HALF_W };
        case 'right': return { left: HALF_W, width: HALF_W };
        case 'single': {
            const x = scene.singleX !== undefined ? Number(scene.singleX) : 50;
            return { left: Math.round((STAGE_W - HALF_W) * x / 100), width: HALF_W };
        }
    }
    return { left: 0, width: STAGE_W };
}

// --------------------------------------------------------------------------
// シーン描画 (トランジション付き)
// --------------------------------------------------------------------------
function isVisible(g) {
    if (VIEW === 'left') return g.left < HALF_W;
    if (VIEW === 'right') return g.left + g.width > HALF_W;
    return true;
}

// 位置だけ変わって、片側のウィンドウで映らなかった枠が映るようになったら作り直す
function visibilityKey(scene) {
    return (LAYOUT_SLOTS[scene.layout] || []).map(s => isVisible(slotGeometry(scene, s)) ? 1 : 0).join('');
}

function sceneKey(scene) {
    const slots = LAYOUT_SLOTS[scene.layout] || LAYOUT_SLOTS.wide;
    return scene.layout + '|' + visibilityKey(scene) + '|' + slots.map(s => s + '=' + contentKey(scene.slots && scene.slots[s])).join('|');
}

function buildLayer(scene) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    const slots = LAYOUT_SLOTS[scene.layout] || LAYOUT_SLOTS.wide;
    slots.forEach(name => {
        const el = document.createElement('div');
        el.className = 'slot slot-' + name;
        el.dataset.slot = name;
        const g = slotGeometry(scene, name);
        el.style.left = g.left + 'px';
        el.style.width = g.width + 'px';
        // 片側だけを出すウィンドウでは、映らない枠の中身は作らない
        // （映らないカメラを開かない＝キャプチャーボードを左右のウィンドウで取り合わない）
        if (!isVisible(g)) { el.dataset.hiddenView = '1'; layer.appendChild(el); return; }
        buildSlotContent(el, scene.slots[name]);
        applyCrop(el, scene.slots[name]);
        layer.appendChild(el);
    });
    applyHoles(layer, scene);
    return layer;
}

// OBS用：16:9の枠がカメラのとき、下にある背景(32:9)もその形にくり抜く（OBSのカメラが見えるように）
function applyHoles(layer, scene) {
    if (!CAM_HOLE) return;
    const bg = layer.querySelector('.slot-bg');
    if (!bg) return;
    const single = scene.slots.single;
    if (scene.layout === 'single' && single && single.type === 'camera') {
        const g = slotGeometry(scene, 'single');
        bg.style.clipPath = `path(evenodd, 'M0 0 H${STAGE_W} V${STAGE_H} H0 Z M${g.left} 0 H${g.left + g.width} V${STAGE_H} H${g.left} Z')`;
    } else {
        bg.style.clipPath = '';
    }
}

// 同じ素材のまま位置・トリミングだけ変わった場合は、フェードせずその場で更新
function updateLayerInPlace(layer, scene) {
    layer.querySelectorAll('.slot').forEach(el => {
        const name = el.dataset.slot;
        const g = slotGeometry(scene, name);
        el.style.left = g.left + 'px';
        applyCrop(el, scene.slots[name]);
    });
    applyHoles(layer, scene);
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
    if (!scene || !scene.slots) return;
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
