/* ==========================================================================
   スタジアムビジョン野球システム - 管理画面
   - プレビュー（次に出す画面）を組み立てて、TAKE で本線（ビジョン）へ出す
   - 素材（スライド・カメラ・文字）／選手紹介／式次第／設定
   - 音楽は music_admin.js の音楽バー（得点板システムと同じもの）で鳴らす
     登場曲・式次第の曲も、音楽バーの音量・フェード・出力先で鳴る
   - 画面の表示は、サーバーから届いた状態(/events)をもとに更新する
   ========================================================================== */

const LAYOUT_SLOTS = { wide: ["wide"], split: ["left", "right"], single: ["single", "bg"] };
const SLOT_NAMES_WIDE = { wide: "全面 32:9", left: "左 16:9", right: "右 16:9", single: "16:9の枠", bg: "背景 32:9" };
const SLOT_NAMES_SDI = { wide: "全面（帯）", left: "左半分", right: "右半分", single: "16:9の枠", bg: "背景（帯）" };
const LAYOUT_NAMES_WIDE = { wide: "32:9 一枚", split: "16:9 左右2枚", single: "16:9 1枚（位置指定）" };
const LAYOUT_NAMES_SDI = { wide: "帯 一枚", split: "左右に2分割", single: "16:9 1枚（位置指定）" };
// 出力の形（設定タブ）。sdi = 1920×1080 で出し、ビジョンに映る帯だけを使う
function isSdi() { return !!(state && state.output && state.output.mode === "sdi"); }
function slotNames() { return isSdi() ? SLOT_NAMES_SDI : SLOT_NAMES_WIDE; }
function layoutNames() { return isSdi() ? LAYOUT_NAMES_SDI : LAYOUT_NAMES_WIDE; }
// ステージ（素材を並べる面）の大きさ
function stageSize() { return isSdi() ? { w: 1920, h: state.output.bandH } : { w: 3840, h: 1080 }; }
const CROP_KEYS = ["fit", "posX", "posY", "zoom"];
const MEDIA_TYPES = ["slide", "url", "camera"];   // トリミングできる素材
const TEAMS = ["HOME", "AWAY"];
const PREF_KEY = "stadiumvision-baseball.prefs";
// OBSに入れる表示画面のアドレス（layer-width / layer-height は、OBSにドラッグしたときのブラウザソースの大きさ）
// camera=obs：カメラの枠を透明にする（キャプチャーボードはOBSの「映像キャプチャデバイス」で下に敷く）
function obsUrl() { return `${location.origin}/vision.html?camera=obs&layer-width=${isSdi() ? 1920 : 3840}&layer-height=1080`; }
const PVW_KEY = "stadiumvision-baseball.preview";

let state = null;
let pvw = readLocal(PVW_KEY, null) || emptyScene();
let selectedSlot = LAYOUT_SLOTS[pvw.layout] ? LAYOUT_SLOTS[pvw.layout][0] : "wide";
let slides = [];
let slideFolder = "";
const aspectMap = {};      // スライドの場所 → 横÷縦
let playerMedia = [];
let walkups = [];
let teamFilter = "HOME";
let selectedPlayer = -1;
let videoDevices = [];
let lastRosterKey = "";

function emptyScene() {
    // 守山の既定：左右2分割で、右面は遊撃カメラ（cam1）
    return {
        layout: "split",
        slots: { wide: { type: "black" }, left: { type: "black" }, right: { type: "camera", cam: "cam1" }, single: { type: "black" }, bg: { type: "black" } },
        singleX: 50
    };
}

// --------------------------------------------------------------------------
// このPCに覚えさせる設定（チェックボックスなど）
// --------------------------------------------------------------------------
function readLocal(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
}
function writeLocal(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn("設定を保存できませんでした", e); }
}
const PREF_CHECKS = ["opt-live-crop", "opt-auto-take", "opt-auto-layout", "opt-player-take", "opt-player-music", "opt-player-slide", "opt-player-stats", "opt-player-comment", "opt-monitor-cam"];
function savePrefs() {
    const p = {};
    PREF_CHECKS.forEach(id => { p[id] = $("#" + id).checked; });
    writeLocal(PREF_KEY, p);
}
function restorePrefs() {
    const p = readLocal(PREF_KEY, {});
    PREF_CHECKS.forEach(id => { if (typeof p[id] === "boolean") $("#" + id).checked = p[id]; });
}

// --------------------------------------------------------------------------
// サーバーへの送信
// --------------------------------------------------------------------------
async function control(action, val) {
    const q = new URLSearchParams({ action });
    if (val !== undefined) q.set("val", val);
    try {
        const res = await fetch(`/api/control?${q}`);
        const body = await res.json();
        if (!res.ok) showError(`反映できませんでした：${body.error}`);
        return res.ok;
    } catch (e) {
        showError(SERVER_NG);
        return false;
    }
}

async function patch(changes) {
    try {
        const res = await fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changes)
        });
        const body = await res.json();
        if (!res.ok) {
            showError(`反映できませんでした：${body.error}`);
            renderFromState();
        }
        return res.ok;
    } catch (e) {
        showError(SERVER_NG);
        return false;
    }
}

// ドラッグ中など連続で変わるときは、本線への送信を間引く
let pendingProgram = null;
let programTimer = null;
function patchProgramThrottled(program) {
    pendingProgram = program;
    if (programTimer) return;
    programTimer = setTimeout(() => {
        programTimer = null;
        const p = pendingProgram;
        pendingProgram = null;
        if (p) patch({ program: p });
    }, 80);
}

// --------------------------------------------------------------------------
// 説明の文字
// --------------------------------------------------------------------------
const baseName = p => String(p || "").split("/").pop();
const mediaUrl = p => String(p).split("/").map(encodeURIComponent).join("/");

function contentKey(src) {
    if (!src) return "none";
    const o = {};
    Object.keys(src).sort().forEach(k => { if (!CROP_KEYS.includes(k)) o[k] = src[k]; });
    return JSON.stringify(o);
}

function describeSrc(src) {
    if (!src) return "—";
    switch (src.type) {
        case "slide": return "🖼 " + baseName(src.file);
        case "url": return "🔗 URL";
        case "camera": return "📹 カメラ" + (src.cam === "cam2" ? "2" : "1");
        case "player": {
            const p = src.player || {};
            const kind = { atbat: "打席", sub: src.label || "交代", hr: "HR競争" }[src.card] || "選手";
            return `👤 ${kind} #${p.number || ""} ${p.name || ""}`;
        }
        case "lineup": return "📋 スタメン " + (src.team || "");
        case "text": return "Ｔ " + (src.title || "");
        case "test": return "▦ テスト画面";
        case "color": return "■ " + src.color;
        default: return "■ 黒";
    }
}

function describeScene(scene) {
    if (!scene) return "";
    const s = scene.slots || {};
    const n = layoutNames();
    if (scene.layout === "split") return `${n.split} ／ 左：${describeSrc(s.left)} ／ 右：${describeSrc(s.right)}`;
    if (scene.layout === "single") return `16:9 1枚（位置 ${Math.round(scene.singleX)}）／ ${describeSrc(s.single)} ／ 背景：${describeSrc(s.bg)}`;
    return `${n.wide} ／ ${describeSrc(s.wide)}`;
}

// --------------------------------------------------------------------------
// プレビュー（次に出す画面）
// --------------------------------------------------------------------------
function monitorUrl(mode) {
    return `vision.html?monitor=${mode}${$("#opt-monitor-cam").checked ? "" : "&nocam=1"}`;
}
function reloadMonitors() {
    $("#pvw-frame").src = monitorUrl("pvw");
    $("#pgm-frame").src = monitorUrl("pgm");
}
function postPvw() {
    const f = $("#pvw-frame");
    if (f.contentWindow) f.contentWindow.postMessage({ type: "preview-scene", scene: pvw }, location.origin);
}

let autoTakeTimer = null;
function pvwChanged(opts = {}) {
    writeLocal(PVW_KEY, pvw);
    postPvw();
    renderControls();
    renderOverlay();
    renderLibraryMarks();
    if ($("#opt-auto-take").checked && !opts.noAuto) {
        clearTimeout(autoTakeTimer);
        autoTakeTimer = setTimeout(doTake, 60);
    }
}

function setLayout(layout) {
    pvw.layout = layout;
    if (!LAYOUT_SLOTS[layout].includes(selectedSlot)) selectedSlot = LAYOUT_SLOTS[layout][0];
    pvwChanged();
}

function setSingleX(x) {
    pvw.singleX = Math.max(0, Math.min(100, Number(x)));
    pvw.layout = "single";
    if (!LAYOUT_SLOTS.single.includes(selectedSlot)) selectedSlot = "single";
    liveAdjust(prog => { prog.singleX = pvw.singleX; }, false);
    pvwChanged();
}

// 左右2分割の左と右を入れ替える（素材とトリミング位置をそのまま交換。選んでいる枠は同じ素材を追いかける）
function swapSides() {
    if (pvw.layout !== "split") return;
    const l = pvw.slots.left;
    pvw.slots.left = pvw.slots.right;
    pvw.slots.right = l;
    if (selectedSlot === "left" || selectedSlot === "right") selectedSlot = selectedSlot === "left" ? "right" : "left";
    pvwChanged();
}

function selectSlot(slot) {
    selectedSlot = slot;
    renderControls();
    renderOverlay();
}

const curSrc = () => pvw.slots[selectedSlot] || { type: "black" };

function pickCrop(src) {
    const o = {};
    CROP_KEYS.forEach(k => { if (src[k] !== undefined) o[k] = src[k]; });
    return o;
}

function setCrop(key, val) {
    const src = curSrc();
    if (!MEDIA_TYPES.includes(src.type)) return;
    if (key !== "fit") {
        val = Number(val);
        if (!isFinite(val)) return;
        val = key === "zoom" ? Math.max(100, Math.min(400, val)) : Math.max(0, Math.min(100, val));
    }
    src[key] = val;
    liveAdjust(prog => { Object.assign(prog.slots[selectedSlot], pickCrop(src)); }, true);
    pvwChanged();
}

function resetCrop() {
    const src = curSrc();
    CROP_KEYS.forEach(k => delete src[k]);
    liveAdjust(prog => { CROP_KEYS.forEach(k => delete prog.slots[selectedSlot][k]); }, true);
    pvwChanged();
}

// 「本線にもすぐ反映」：プレビューと本線に同じ素材が出ているときだけ、位置の調整を本線にも送る
function liveAdjust(mutate, slotOnly) {
    if (!$("#opt-live-crop").checked || $("#opt-auto-take").checked || !state) return;
    const prog = clone(state.program);
    if (prog.layout !== pvw.layout) return;
    const slots = slotOnly ? [selectedSlot] : LAYOUT_SLOTS[pvw.layout];
    if (slots.some(s => contentKey(prog.slots[s]) !== contentKey(pvw.slots[s]))) return;
    mutate(prog);
    state.program = prog;
    patchProgramThrottled(prog);
}

function assignSource(src, opts = {}) {
    src = clone(src);
    // 横長（32:9・ビジョンの帯の形など）のスライドは「一枚」に自動で切り替える
    if (!opts.keepLayout && $("#opt-auto-layout").checked && src.type === "slide") {
        const r = aspectMap[src.file];
        if (r && r > 2.4 && pvw.layout !== "wide") {
            pvw.layout = "wide";
            selectedSlot = "wide";
        }
    }
    // 同じカメラを入れ直したときは、トリミング位置を引き継ぐ
    const prev = pvw.slots[selectedSlot];
    if (prev && prev.type === "camera" && src.type === "camera" && prev.cam === src.cam) Object.assign(src, pickCrop(prev));
    pvw.slots[selectedSlot] = src;
    pvwChanged();
}

// --------------------------------------------------------------------------
// 画面の組み立ての表示
// --------------------------------------------------------------------------
function renderControls() {
    const ln = layoutNames();
    $$("#layout-seg button").forEach(b => { b.classList.toggle("on", b.dataset.layout === pvw.layout); b.textContent = ln[b.dataset.layout]; });
    $("#single-pos").classList.toggle("hidden", pvw.layout !== "single");
    $("#btn-swap").classList.toggle("hidden", pvw.layout !== "split");
    $("#single-x").value = pvw.singleX;
    $("#single-x-val").textContent = Math.round(pvw.singleX);

    $("#slot-seg").innerHTML = LAYOUT_SLOTS[pvw.layout]
        .map(s => `<button type="button" data-slot="${s}" class="${s === selectedSlot ? "on" : ""}">${slotNames()[s]}</button>`).join("");
    const src = curSrc();
    $("#slot-src").textContent = describeSrc(src);

    $("#crop-row").classList.toggle("disabled", !MEDIA_TYPES.includes(src.type));
    const fit = src.fit || "cover";
    $$("#fit-seg button").forEach(b => b.classList.toggle("on", b.dataset.fit === fit));
    const vals = { posX: src.posX !== undefined ? src.posX : 50, posY: src.posY !== undefined ? src.posY : 50, zoom: src.zoom || 100 };
    Object.entries(vals).forEach(([k, v]) => {
        $(`#crop-${k}`).value = v;
        if (document.activeElement !== $(`#crop-${k}-num`)) $(`#crop-${k}-num`).value = v;
    });
    $("#pvw-desc").textContent = describeScene(pvw);
}

function slotRect(scene, slot) {
    // ステージの幅に対する %
    if (slot === "left") return { left: 0, width: 50 };
    if (slot === "right") return { left: 50, width: 50 };
    if (slot === "single") {
        // 16:9 の枠（高さいっぱい）。32:9 では半分、SDIの帯では 帯の高さ×16/9
        const st = stageSize();
        const w = Math.min(100, st.h * 16 / 9 / st.w * 100);
        return { left: (100 - w) * scene.singleX / 100, width: w };
    }
    return { left: 0, width: 100 };
}

function renderOverlay() {
    const ov = $("#slot-overlay");
    ov.innerHTML = "";
    // 背景は16:9の枠の下に敷く
    const order = pvw.layout === "single" ? ["bg", "single"] : LAYOUT_SLOTS[pvw.layout];
    order.forEach(s => {
        const r = slotRect(pvw, s);
        const box = document.createElement("div");
        box.className = "slot-box" + (s === selectedSlot ? " selected" : "");
        box.style.left = r.left + "%";
        box.style.width = r.width + "%";
        if (s === "bg") box.style.borderStyle = "dotted";
        box.innerHTML = `<span class="slot-name">${slotNames()[s]}</span>`;
        box.addEventListener("mousedown", e => onSlotMouseDown(e, s, box));
        box.addEventListener("wheel", e => onSlotWheel(e, s), { passive: false });
        ov.appendChild(box);
    });
}

// プレビューの上でドラッグ ＝ トリミング位置を動かす（素材をつかんで動かす向き）
function onSlotMouseDown(e, slot, box) {
    e.preventDefault();
    if (slot !== selectedSlot) return selectSlot(slot);
    const src = curSrc();
    if (!MEDIA_TYPES.includes(src.type)) return;
    const rect = box.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const px = src.posX !== undefined ? src.posX : 50;
    const py = src.posY !== undefined ? src.posY : 50;
    box.classList.add("dragging");
    const move = ev => {
        const dx = (ev.clientX - sx) / rect.width * 100;
        const dy = (ev.clientY - sy) / rect.height * 100;
        src.posX = Math.max(0, Math.min(100, Math.round((px - dx * 1.5) * 2) / 2));
        src.posY = Math.max(0, Math.min(100, Math.round((py - dy * 1.5) * 2) / 2));
        liveAdjust(prog => { Object.assign(prog.slots[selectedSlot], pickCrop(src)); }, true);
        pvwChanged();
    };
    const up = () => {
        box.classList.remove("dragging");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
}

function onSlotWheel(e, slot) {
    if (slot !== selectedSlot || !MEDIA_TYPES.includes(curSrc().type)) return;
    e.preventDefault();
    setCrop("zoom", (curSrc().zoom || 100) + (e.deltaY < 0 ? 5 : -5));
}

// --------------------------------------------------------------------------
// TAKE・BLACK・切り替え方
// --------------------------------------------------------------------------
async function doTake() {
    const ok = await patch({ program: clone(pvw) });
    if (!ok) return;
    const b = $("#btn-take");
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
}

function pgmToPvw() {
    if (!state) return;
    pvw = clone(state.program);
    if (!LAYOUT_SLOTS[pvw.layout].includes(selectedSlot)) selectedSlot = LAYOUT_SLOTS[pvw.layout][0];
    pvwChanged({ noAuto: true });
}

function setTransition(type) {
    const ms = Math.max(0, Math.min(5000, parseInt($("#trans-ms").value, 10) || 0));
    patch({ transition: { type, ms } });
}

function openOutput(view) {
    if (isSdi() && view !== "all") return showError("SDI 1本（1920×1080）で出す設定のため、左右に分けて開けません。「全体」を使ってください");
    const w = view === "all" ? 1280 : 960;
    const h = view === "all" ? (isSdi() ? 720 : 360) : 540;
    window.open(`vision.html?view=${view}`, `sv_baseball_${view}`, `popup=yes,width=${w},height=${h}`);
    showInfo("確認用の表示画面を開きました。本番は「野球ビジョン HDMI出力」を使ってください（ダブルクリックかFキーで全画面）");
}

// --------------------------------------------------------------------------
// サーバーとの接続
// --------------------------------------------------------------------------
function connect() {
    const es = new EventSource("/events");
    const conn = $("#conn");
    es.addEventListener("UPDATE_STATE", e => {
        state = JSON.parse(e.data);
        conn.textContent = "接続中";
        conn.className = "conn ok";
        renderFromState();
    });
    es.addEventListener("COMMAND", e => handleCommand(JSON.parse(e.data)));
    es.addEventListener("CUE_FIRED", e => onCueFired(JSON.parse(e.data)));
    es.addEventListener("NOTICE", e => showError(JSON.parse(e.data).message));
    es.onerror = () => {
        conn.textContent = "サーバーにつながっていません";
        conn.className = "conn ng";
    };
}

function handleCommand(cmd) {
    if (cmd.action === "take") doTake();
    else if (cmd.action === "swap") swapSides();
    else if (cmd.action === "musicStop") musicStop();
    else if (cmd.action === "musicFade") musicFade();
    else if (cmd.action === "musicDuck") musicDuck(cmd.val);
    else if (cmd.action === "readNext") moveReadPos(1);
    else if (cmd.action === "readPrev") moveReadPos(-1);
    else if (cmd.action === "musicPlay") playMusicPath(cmd.val);
}

function renderFromState() {
    if (!state) return;
    $("#btn-black").classList.toggle("on", state.black);
    $("#pgm-black-flag").classList.toggle("on", state.black);
    $("#pgm-desc").textContent = describeScene(state.program);
    $("#opt-guide").checked = state.guide;
    renderOutput();
    $$("#trans-seg button").forEach(b => b.classList.toggle("on", b.dataset.trans === state.transition.type));
    if (document.activeElement !== $("#trans-ms")) $("#trans-ms").value = state.transition.ms;
    $("#derby-count").textContent = state.derby.count;
    $("#derby-outs").textContent = state.derby.outs;
    renderTeams();
    renderCameraSelects();
    const rk = JSON.stringify([state.roster, state.teams]);
    if (rk !== lastRosterKey) { lastRosterKey = rk; renderPlayers(); }
    renderFuta();
    refreshSuggestions();
    renderScript();
    renderLibraryMarks();
}

// --------------------------------------------------------------------------
// スライド（slides フォルダ）
// --------------------------------------------------------------------------
async function loadSlides() {
    const res = await fetch("/api/slides");
    if (!res.ok) throw new Error("スライドの一覧を取得できません");
    slides = await res.json();
    const folders = [...new Set(slides.map(s => s.folder))].filter(Boolean);
    $("#slide-folders").innerHTML = folders.map(f => `<option value="${escapeHtml(f)}">`).join("");
    if (slideFolder && !folders.some(f => f === slideFolder || f.startsWith(slideFolder + "/"))) slideFolder = "";
    $("#slide-folder-chips").innerHTML = ["", ...folders]
        .map(f => `<button type="button" class="chip ${f === slideFolder ? "on" : ""}" data-folder="${escapeHtml(f)}">${escapeHtml(f || "すべて")}</button>`).join("");
    renderLibrary();
    if (state) { renderFuta(); refreshSuggestions(); }
}

function aspectLabel(r) {
    if (!r) return "";
    if (Math.abs(r - 32 / 9) < 0.08) return "32:9";
    if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
    return r.toFixed(2) + ":1";
}

function renderLibrary() {
    const q = $("#slide-search").value.trim().toLowerCase();
    const list = slides
        .filter(s => !slideFolder || s.folder === slideFolder || s.folder.startsWith(slideFolder + "/"))
        .filter(s => !q || s.path.toLowerCase().includes(q));
    const lib = $("#slide-library");
    if (list.length === 0) {
        lib.innerHTML = `<div class="empty">スライドがありません。<br>画像・動画を上の枠にドロップするか、slides フォルダに入れて「⟳ 読み直す」を押します。</div>`;
        return;
    }
    lib.innerHTML = list.map(s => {
        const thumb = s.kind === "video"
            ? `<video class="lib-thumb" src="${mediaUrl(s.path)}#t=0.5" preload="metadata" muted></video>`
            : `<img class="lib-thumb" src="${mediaUrl(s.path)}" loading="lazy" alt="">`;
        const r = aspectMap[s.path];
        return `<div class="lib-item" data-path="${escapeHtml(s.path)}" title="${escapeHtml(s.path)}">${thumb}
            <span class="lib-badge ${aspectLabel(r) === "32:9" ? "r329" : ""}">${aspectLabel(r)}</span>
            ${s.kind === "video" ? '<span class="lib-badge vid">動画</span>' : ""}
            <button type="button" class="lib-del" title="slides フォルダから消す">✕</button>
            <div class="lib-name">${escapeHtml(s.name)}</div></div>`;
    }).join("");
    $$("#slide-library .lib-item").forEach(item => {
        const media = item.querySelector(".lib-thumb");
        const onDim = (w, h) => {
            if (!w || !h) return;
            aspectMap[item.dataset.path] = w / h;
            const badge = item.querySelector(".lib-badge");
            badge.textContent = aspectLabel(w / h);
            badge.classList.toggle("r329", aspectLabel(w / h) === "32:9");
        };
        if (media.tagName === "VIDEO") media.addEventListener("loadedmetadata", () => onDim(media.videoWidth, media.videoHeight));
        else media.addEventListener("load", () => onDim(media.naturalWidth, media.naturalHeight));
    });
    renderLibraryMarks();
}

function renderLibraryMarks() {
    const inScene = (scene, p) => !!scene && LAYOUT_SLOTS[scene.layout].some(s => scene.slots[s].type === "slide" && scene.slots[s].file === p);
    $$("#slide-library .lib-item").forEach(el => {
        const onPgm = inScene(state && state.program, el.dataset.path);
        el.classList.toggle("on-pgm", onPgm);
        el.classList.toggle("on-pvw", !onPgm && inScene(pvw, el.dataset.path));
    });
}

async function uploadSlides(files) {
    if (!files || files.length === 0) return;
    const folder = $("#upload-folder").value.trim();
    let ok = 0;
    for (const f of files) {
        try {
            const res = await fetch(`/api/slides?filename=${encodeURIComponent(f.name)}&folder=${encodeURIComponent(folder)}`, { method: "POST", body: f });
            const body = await res.json();
            if (!res.ok) showError(`登録できませんでした（${f.name}）：${body.error}`);
            else ok++;
        } catch (e) {
            showError(SERVER_NG);
            break;
        }
    }
    if (ok) showInfo(`${ok}件のスライドを登録しました`);
    await loadSlides().catch(e => showError(e.message));
}

async function deleteSlide(p) {
    if (!confirm(`「${p}」を slides フォルダから消しますか？（元に戻せません）`)) return;
    try {
        const res = await fetch("/api/slides/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
        const body = await res.json();
        if (!res.ok) return showError(`消せませんでした：${body.error}`);
    } catch (e) {
        return showError(SERVER_NG);
    }
    await loadSlides().catch(e => showError(e.message));
}

function assignText() {
    const title = $("#text-title").value.trim();
    if (!title) return showError("タイトルを入れてください");
    const src = { type: "text", title, color: $("#text-bg").value, textColor: $("#text-fg").value };
    const sub = $("#text-sub").value.trim();
    if (sub) src.sub = sub;
    assignSource(src);
}

function assignUrl() {
    let url = $("#url-input").value.trim();
    if (!/^https?:\/\//.test(url)) return showError("URLは http:// か https:// で始めてください");
    // GoogleスライドのURLは、画像(PNG)として書き出すURLに直す（「リンクを知っている全員」に共有が必要）
    const m = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
    if (m) {
        const page = url.match(/slide=id\.([a-zA-Z0-9-_]+)/);
        url = `https://docs.google.com/presentation/d/${m[1]}/export/png` + (page ? `?pageid=${page[1]}` : "");
    }
    assignSource({ type: "url", url });
}

// --------------------------------------------------------------------------
// 選手
// --------------------------------------------------------------------------
const roster = () => (state && state.roster) || [];

// 写真フォルダ名 → 表示名 → HOME/AWAY の順で探す
function teamFolders(team) {
    const t = (state && state.teams[team]) || {};
    return [...new Set([t.photoTeam, t.name, team].filter(Boolean))];
}

function findPlayerSlide(p) {
    if (p.slide) return /^(players|slides)\//.test(p.slide) ? p.slide : `players/${p.slide}`;
    for (const f of teamFolders(p.team)) {
        const hit = playerMedia.find(m => m.folder === f && m.name === String(p.number));
        if (hit) return hit.path;
    }
    return "";
}

function findWalkup(p) {
    if (p.bgm) return /^music\//.test(p.bgm) ? p.bgm : `music/${p.bgm}`;
    for (const f of teamFolders(p.team)) {
        const hit = walkups.find(m => m.folder === f && m.name === String(p.number));
        if (hit) return hit.path;
    }
    return "";
}

function renderPlayers() {
    $$("#team-filter button").forEach(b => b.classList.toggle("on", b.dataset.team === teamFilter));
    const list = $("#player-list");
    const all = roster();
    if (all.length === 0) {
        list.innerHTML = `<div class="empty">選手の名簿がありません。「名簿CSVを読み込む」から読み込みます。<br><small>列：チーム, 打順, 背番号, ポジション, 名前, ふりがな, 打率, 本塁打, 打点, 防御率, コメント, 登場曲, スライド</small></div>`;
        renderPlayerAction();
        return;
    }
    const q = $("#player-search").value.trim();
    list.innerHTML = all.map((p, i) => {
        if (teamFilter && p.team !== teamFilter) return "";
        if (q && !`${p.number} ${p.name} ${p.kana || ""}`.includes(q)) return "";
        const icons = (findWalkup(p) ? "🎵" : "") + (findPlayerSlide(p) ? "🖼" : "");
        return `<div class="player-row ${i === selectedPlayer ? "on" : ""}" data-i="${i}">
            <span class="o">${escapeHtml(p.order || "")}</span><span class="n">#${escapeHtml(p.number || "")}</span>
            <span class="p">${escapeHtml(p.position || "")}</span><span class="nm">${escapeHtml(p.name)}</span><span class="icons">${icons}</span></div>`;
    }).join("");
    renderPlayerAction();
}

function renderPlayerAction() {
    const p = roster()[selectedPlayer];
    $("#pa-player").textContent = p ? `${p.team}　${p.order ? p.order + "番 " : ""}#${p.number || ""} ${p.position || ""} ${p.name}` : "選手を選んでください";
    const sel = $("#pa-out");
    const keep = sel.value;
    sel.innerHTML = `<option value="">（出さない）</option>` + (p ? roster().map((o, i) =>
        o.team === p.team && i !== selectedPlayer ? `<option value="${i}">#${escapeHtml(o.number || "")} ${escapeHtml(o.position || "")} ${escapeHtml(o.name)}</option>` : "").join("") : "");
    sel.value = keep;
    if (sel.value !== keep) sel.value = "";
}

// 名簿のうち、画面に出す項目だけを取り出す
function playerData(p) {
    const o = {};
    ["team", "order", "number", "position", "name", "kana", "avg", "hr", "rbi", "era", "comment", "photo"].forEach(k => { if (p[k]) o[k] = p[k]; });
    return o;
}

function sendPlayer(card, subLabel) {
    const p = roster()[selectedPlayer];
    if (!p) return showError("選手を選んでください");
    const label = $("#pa-label").value.trim() || subLabel || "";
    const slide = findPlayerSlide(p);
    let src;
    if ($("#opt-player-slide").checked && slide && card !== "hr") {
        src = { type: "slide", file: slide };
        // 選手スライドは16:9。「32:9 一枚」のままだと上下が切れるため、「16:9 1枚」の枠に入れる（背景・位置はそのまま）
        if (pvw.layout === "wide") {
            pvw.layout = "single";
            selectedSlot = "single";
        }
    } else {
        src = { type: "player", card, player: playerData(p), showStats: $("#opt-player-stats").checked, showComment: $("#opt-player-comment").checked };
        if (label) src.label = label;
        if (card === "sub" && $("#pa-out").value !== "") {
            const o = roster()[Number($("#pa-out").value)];
            if (o) src.out = { number: o.number || "", position: o.position || "", name: o.name };
        }
    }
    assignSource(src, { keepLayout: true });
    if ($("#opt-player-take").checked && !$("#opt-auto-take").checked) doTake();
    if ($("#opt-player-music").checked) {
        const walk = findWalkup(p);
        if (walk) playMusicPath(walk, `登場曲 #${p.number} ${p.name}`);
    }
}

function sendLineup(team) {
    const rows = roster().filter(p => p.team === team && p.order)
        .sort((a, b) => (parseInt(a.order, 10) || 99) - (parseInt(b.order, 10) || 99))
        .slice(0, 12)
        .map(p => ({ order: p.order, position: p.position || "", number: p.number || "", name: p.name }));
    if (rows.length === 0) return showError(`${team} に打順の入った選手がいません（名簿CSVの「打順」列）`);
    assignSource({ type: "lineup", team, rows }, { keepLayout: true });
}

// 名簿CSVの読み込み（UTF-8 / Shift_JIS を自動で判別。Excelで「CSV」保存したものも読める）
async function importRoster(file) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder("shift_jis").decode(buf); }
    const rows = parseCSV(text.replace(/^﻿/, "")).filter(r => r.some(c => c.trim() !== ""));
    if (rows.length < 2) return showError("CSVに選手がいません（1行目は列名にしてください）");
    const header = rows[0].map(h => h.trim());
    const COLS = {
        team: ["チーム", "team", "TEAM", "所属"], order: ["打順", "order"], number: ["背番号", "No", "NO", "number", "#"],
        position: ["ポジション", "守備", "守備位置", "position", "POS"], name: ["名前", "選手名", "氏名", "name"],
        kana: ["ふりがな", "フリガナ", "カナ", "よみ", "kana"], avg: ["打率", "AVG"], hr: ["本塁打", "HR"], rbi: ["打点", "RBI"],
        era: ["防御率", "ERA"], comment: ["コメント", "紹介コメント", "comment"], bgm: ["登場曲", "BGM", "bgm"],
        slide: ["スライド", "slide"], photo: ["写真", "photo"]
    };
    const idx = {};
    Object.entries(COLS).forEach(([k, names]) => {
        const i = header.findIndex(h => names.includes(h));
        if (i >= 0) idx[k] = i;
    });
    if (idx.name === undefined) return showError("「名前」の列が見つかりません（1行目に列名を入れてください）");

    const fallback = teamFilter || "HOME";
    const players = rows.slice(1).map(r => {
        const p = {};
        Object.entries(idx).forEach(([k, i]) => { const v = (r[i] || "").trim(); if (v) p[k] = v.slice(0, 300); });
        let team = String(p.team || fallback).toUpperCase();
        if (!TEAMS.includes(team)) {
            // チーム列に表示名や写真フォルダ名が書かれているときは、チーム設定と照らし合わせる
            team = TEAMS.find(t => state.teams[t].name === p.team || state.teams[t].photoTeam === p.team) || fallback;
        }
        p.team = team;
        if (p.era && parseFloat(p.era) === 0) delete p.era;   // 防御率 0.00 の野手は出さない
        return p;
    }).filter(p => p.name);
    const teamsIn = [...new Set(players.map(p => p.team))];
    const kept = roster().filter(p => !teamsIn.includes(p.team));
    selectedPlayer = -1;
    if (await patch({ roster: kept.concat(players) })) showInfo(`${players.length}人を読み込みました（${teamsIn.join("・")}）`);
}

function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
            else cell += c;
        } else if (c === '"') q = true;
        else if (c === ",") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// --------------------------------------------------------------------------
// 音楽（登場曲・式次第の曲は、音楽バーの仕組みで鳴らす）
// --------------------------------------------------------------------------
function playMusicPath(p, label, opts) {
    const found = typeof musicList !== "undefined" && musicList.find(m => m.path === p);
    // 別フォルダの曲（local:）は、そのフォルダを選んでいないと鳴らせない
    if (!found && /^local:/.test(p)) return showError(`曲が見つかりません（${label || p}）。音楽バーの「曲のフォルダ」で、この曲の入ったフォルダを選んでください`);
    musicPlay(found || { path: p, no: null, name: label || baseName(p).replace(/\.[^.]+$/, "") }, opts);
}

async function loadWalkups() {
    const res = await fetch("/api/walkup");
    if (!res.ok) throw new Error("登場曲の一覧を取得できません");
    walkups = await res.json();
    renderPlayers();
}

async function loadPlayerMedia() {
    const res = await fetch("/api/players");
    if (!res.ok) throw new Error("選手スライドの一覧を取得できません");
    playerMedia = await res.json();
    renderPlayers();
}

// --------------------------------------------------------------------------
// 台本（読み込み・キューのひもづけ・本番）
//   台本の1行 ＝ 時刻・内容・BGM・ビジョン・MIC・話者・セリフ・備考 ＋ キュー（出すもの）
//   旧「式次第」は「手動の式次第」セクションとして、台本の先頭に入っている
// --------------------------------------------------------------------------
const SC = ScriptCore;
const SC_MODE_KEY = "stadiumvision-baseball.scmode";
const EMPTY_SCRIPT = { title: "", rev: 0, sections: [], rows: [], pos: -1, onair: -1 };
const script = () => (state && state.script) || EMPTY_SCRIPT;
let scMode = readLocal(SC_MODE_KEY, "edit") === "live" ? "live" : "edit";
let currentTab = "media";
let selectedRow = -1;
let scListKey = "";
let scMarks = { pos: -2, onair: -2, next: -2 };
let suggestions = {};
let suggestKey = "";
let importState = null;     // 読み込み中のファイル { resp, cfg:[{index, include, headerRow, roles}] }

const logos = () => ({ left: SC.resolveLogo(state && state.futa, "left", slides), full: SC.resolveLogo(state && state.futa, "full", slides) });

function cueChips(cue) {
    if (!cue) return [];
    const chips = [];
    if (cue.scene) chips.push("画面（プレビューのまま）");
    else if (cue.band) chips.push("帯：" + SC.describeFace(cue.band));
    else {
        if (cue.left) chips.push("左：" + SC.describeFace(cue.left));
        if (cue.right) chips.push("右：" + SC.describeFace(cue.right));
    }
    const b = cue.bgm;
    if (b) chips.push(b.action === "play" ? `♪ ${b.name}${b.loop ? " ↻" : " ①"}` : b.action === "fade" ? "♪ フェードアウト" : "♪ 停止");
    if (cue.duck === true) chips.push("♪ 小さく");
    else if (cue.duck === false) chips.push("♪ 小さくを戻す");
    return chips;
}

function rowHtml(r, i, edit) {
    // 章の行：帯の見出しにする（キューは付けられない）
    if (r.kind === "chapter") return `<div class="sc-row sc-chap" data-i="${i}">${escapeHtml(r.title)}</div>`;
    const sg = edit && !r.cue ? suggestions[i] : null;
    const chips = r.cue ? cueChips(r.cue).map(c => `<span class="chip-cue">${escapeHtml(c)}</span>`).join("") : "";
    let sgHtml = "";
    if (sg && sg.cue) sgHtml = `<div class="sc-sg"><span class="sg-text">提案：${escapeHtml(sg.reasons.join(" ／ "))}</span><button type="button" class="btn small" data-adopt="${i}">採用</button>${sg.hints.length ? `<span class="sg-hint">${escapeHtml(sg.hints.join(" ／ "))}</span>` : ""}</div>`;
    else if (sg && sg.hints.length) sgHtml = `<div class="sc-sg"><span class="sg-hint">${escapeHtml(sg.hints.join(" ／ "))}</span></div>`;
    const tag = (label, v) => v ? `<span class="sc-tag"><b>${label}</b>${escapeHtml(v)}</span>` : "";
    const tags = tag("BGM", r.bgm) + tag("左", r.vision) + tag("右", r.visionR) + tag("MIC", r.mic);
    return `<div class="sc-row ${r.cue ? "hascue" : ""}" data-i="${i}">
        <div class="sc-head">${r.no ? `<span class="sc-no">${escapeHtml(r.no)}</span>` : ""}<span class="sc-time">${escapeHtml(r.time)}${r.dur ? `<small> ${escapeHtml(r.dur)}</small>` : ""}</span>
            <span class="sc-title">${escapeHtml(r.title)}</span><span class="sc-spk">${escapeHtml(r.speaker)}</span>
            <span class="sc-badges">${chips}</span></div>
        ${r.script ? `<div class="sc-script">${escapeHtml(r.script)}</div>` : ""}
        ${tags ? `<div class="sc-tags">${tags}</div>` : ""}
        ${r.note ? `<div class="sc-note">${escapeHtml(r.note)}</div>` : ""}${sgHtml}</div>`;
}

function renderScript() {
    const sc = script();
    const edit = scMode === "edit";
    document.body.classList.toggle("sc-live", scMode === "live");
    $$("#sc-mode button").forEach(b => b.classList.toggle("on", b.dataset.scmode === scMode));
    // 編集の部品は本番では隠す（本番中の誤操作を防ぐ）
    $$(".sc-edit-only").forEach(el => { if (!edit) el.classList.add("hidden"); else if (el.id !== "sc-editor" && el.id !== "sc-lost") el.classList.remove("hidden"); });
    if (!edit) $("#sc-import").classList.add("hidden");

    const key = [sc.rev, scMode, Object.keys(suggestions).length, suggestKey].join("|");
    if (key !== scListKey) {
        scListKey = key;
        const list = $("#sc-list");
        if (sc.rows.length === 0) {
            list.innerHTML = `<div class="empty">台本がありません。<br>「編集」で Excel の台本（.xlsx）を読み込むか、「＋ いまのプレビューを手動の式次第に追加」を使います。</div>`;
        } else {
            let lastSec = -1;
            const parts = [];
            sc.rows.forEach((r, i) => {
                if (r.sec !== lastSec) {
                    lastSec = r.sec;
                    parts.push(`<div class="sc-sec" data-sec="${r.sec}" data-first="${i}">▼ ${escapeHtml(sc.sections[r.sec].name)}</div>`);
                }
                parts.push(rowHtml(r, i, edit));
            });
            list.innerHTML = parts.join("");
        }
        scMarks = { pos: -2, onair: -2, next: -2 };
        const jumps = [];
        let jSec = -1;
        sc.rows.forEach((r, k) => {
            if (r.sec !== jSec) { jSec = r.sec; jumps.push(`<option value="${k}">${escapeHtml(sc.sections[r.sec].name)}</option>`); }
            if (r.kind === "chapter") jumps.push(`<option value="${k}">${escapeHtml(sc.sections[r.sec].name)} › ${escapeHtml(r.title.slice(0, 40))}</option>`);
        });
        $("#sc-jump").innerHTML = `<option value="">セクション・章へ…</option>` + jumps.join("");
        $("#sc-summary").textContent = sc.rows.length ? `${sc.title ? sc.title + "：" : ""}${sc.sections.length}セクション・${sc.rows.length}行・キュー ${SC.cueRows(sc).length}個` : "";
        if (selectedRow >= sc.rows.length) selectedRow = -1;
    }
    renderScriptMarks();
    renderCueEditor();
}

// 読み位置（青）・ON AIR（赤）・次のキュー（黄）の色だけを付け替える（行は作り直さない）
function renderScriptMarks(opts = {}) {
    const sc = script();
    const next = SC.nextCueRow(sc);
    const list = $("#sc-list");
    const set = (cls, from, to) => {
        if (from === to && !opts.force) return;
        const a = from >= 0 ? list.querySelector(`.sc-row[data-i="${from}"]`) : null;
        if (a) a.classList.remove(cls);
        const b = to >= 0 ? list.querySelector(`.sc-row[data-i="${to}"]`) : null;
        if (b) b.classList.add(cls);
    };
    const posChanged = scMarks.pos !== sc.pos;
    set("pos", scMarks.pos, sc.pos);
    set("onair", scMarks.onair, sc.onair);
    set("next", scMarks.next, next);
    const changed = posChanged || scMarks.onair !== sc.onair || scMarks.next !== next;
    scMarks = { pos: sc.pos, onair: sc.onair, next };
    if (posChanged || opts.scroll) scrollToPos();
    if (changed || opts.force) followNextInPreview();
    $("#sc-jump").value = "";
    sdRefresh();
}

// 読み位置が、一覧の上から1/3の位置に来るようにする
function scrollToPos() {
    const sc = script();
    const list = $("#sc-list");
    if (sc.pos < 0 || list.offsetParent === null) return;
    const el = list.querySelector(`.sc-row[data-i="${sc.pos}"]`);
    if (!el) return;
    const top = el.offsetTop - list.offsetTop - list.clientHeight / 3;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

// 本番モードでは、PREVIEWにいつも「次のキュー」の画面を出す
function followNextInPreview() {
    if (scMode !== "live" || currentTab !== "script" || !state) return;
    const sc = script();
    const i = SC.nextCueRow(sc);
    if (i < 0) return;
    pvw = SC.buildScene(sc.rows[i].cue, state.program, logos());
    if (!LAYOUT_SLOTS[pvw.layout].includes(selectedSlot)) selectedSlot = LAYOUT_SLOTS[pvw.layout][0];
    pvwChanged({ noAuto: true });
}

function setScMode(mode) {
    scMode = mode;
    writeLocal(SC_MODE_KEY, mode);
    scListKey = "";
    renderScript();
    scrollToPos();
    followNextInPreview();
}

// ---- 台本の編集（サーバーへ） ----
async function scEdit(ops) {
    try {
        const res = await fetch("/api/script/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) });
        const body = await res.json();
        if (!res.ok) { showError(`反映できませんでした：${body.error}`); return false; }
        return true;
    } catch (e) {
        showError(SERVER_NG);
        return false;
    }
}

// 読み位置を動かす（キューは出さない）。続けて押しても数えこぼさないよう、先に手元の値を変える
function moveReadPos(d) {
    const sc = script();
    if (!sc.rows.length) return;
    const n = Math.max(0, Math.min(sc.rows.length - 1, sc.pos + d));
    if (n === sc.pos) return;
    sc.pos = n;
    renderScriptMarks();
    scEdit([{ op: "pos", pos: n }]);
}
function jumpToRow(i) {
    const sc = script();
    if (!(i >= 0 && i < sc.rows.length)) return;
    sc.pos = i;
    renderScriptMarks();
    scEdit([{ op: "pos", pos: i }]);
}
const scNext = () => control("next");
const scPrev = () => control("prev");

// 行をダブルクリック：キューがあれば出す。無ければ読み位置だけ移す
function fireRow(i) {
    const sc = script();
    const r = sc.rows[i];
    if (!r) return;
    if (r.cue) control("cue", SC.cueRows(sc).indexOf(i) + 1);
    else jumpToRow(i);
}

// ---- キューが出されたとき：BGM を音楽バーで鳴らす（このPCのボタン・Stream Deck・HTTP どれでも） ----
function onCueFired(ev) {
    const r = script().rows[ev.index];
    if (r && r.cue && !ev.silent) runCueAudio(r.cue);
}

// キューの音：BGM（鳴らす／フェードアウト／止める）と「小さく」
function runCueAudio(cue) {
    const b = cue.bgm;
    if (b && b.action === "play") {
        if (musicCur && musicCur.item.path === b.path) {      // すでに同じ曲が鳴っていれば、二重に鳴らさない
            if (typeof cue.duck === "boolean") musicDuckSet(cue.duck);
            return;
        }
        musicDuckSet(cue.duck === true, true);                // 曲を新しく鳴らすときは、小さく指定が無ければふつうの音量
        playMusicPath(b.path, b.name, { loop: b.loop });
        return;
    }
    if (b && b.action === "fade") musicFade();
    else if (b && b.action === "stop") musicHalt();
    if (typeof cue.duck === "boolean") musicDuckSet(cue.duck);
}

// ---- 提案（BGM・ビジョン・内容の文字から） ----
function refreshSuggestions() {
    if (!state) return;
    const sc = script();
    const key = `${sc.rev}|${slides.length}|${musicList.map(m => m.path).join(",").length}|${musicList.length}|${state.futa.left}`;
    if (key === suggestKey) return;
    suggestKey = key;
    suggestions = SC.suggestAll(sc, { music: musicList, slides, futaLeft: state.futa.left });
    scListKey = "";
    renderScript();
}

async function adoptSuggestions(rows) {
    const items = rows.filter(i => suggestions[i] && suggestions[i].cue).map(i => ({ row: i, cue: suggestions[i].cue }));
    if (!items.length) return showInfo("採用できる提案がありません");
    if (await scEdit([{ op: "cues", items }])) showInfo(`${items.length}行にキューを付けました`);
}

// ---- 台本の読み込み ----
async function sendScriptFile(body, query) {
    try {
        const res = await fetch(`/api/script/import?${new URLSearchParams(query)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
        const j = await res.json();
        if (!res.ok) return showError(`台本を読み込めませんでした：${j.error}`);
        beginAssign(j);
    } catch (e) {
        showError(SERVER_NG);
    }
}
function uploadScript(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return showError("ファイルが大きすぎます（20MBまで）");
    sendScriptFile(file, { filename: file.name });
}
function pasteScript() {
    const t = $("#sc-paste").value;
    if (!t.trim()) return showError("貼り付ける内容がありません");
    sendScriptFile(t, { filename: "貼り付け", format: "paste" });
}

// 列の割り当て画面（シートごとに、見出し行と各列の役割をプルダウンで直せる）
function beginAssign(resp) {
    importState = { resp, cfg: resp.sheets.map(sh => ({ index: sh.index, include: !!sh.suggestInclude, headerRow: sh.headerRow, roles: sh.columns.map(c => c.role) })) };
    renderAssign();
}

function renderAssign() {
    const box = $("#sc-import");
    if (!importState) { box.classList.add("hidden"); return; }
    const { resp, cfg } = importState;
    const roleOpts = sel => `<option value="">（使わない）</option>` + resp.roles.map(r => `<option value="${r.role}" ${r.role === sel ? "selected" : ""}>${r.label}</option>`).join("");
    box.innerHTML = `<h2>列の割り当て <small>${escapeHtml(resp.filename)}：シートごとに、見出しの行と各列の役割を確かめます</small></h2>` +
        resp.sheets.map((sh, k) => {
            const c = cfg[k];
            const cols = sh.columns.map((col, ci) => `<div class="as-col">
                <div class="as-head">${escapeHtml(col.header || "（見出しなし）")}</div>
                <select data-as-role="${k}:${ci}" class="text-input">${roleOpts(c.roles[ci])}</select>
                <div class="as-sample">${col.sample.map(escapeHtml).join("<br>")}</div></div>`).join("");
            return `<div class="as-sheet"><div class="ctrl-row wrap">
                <label class="toggle"><input type="checkbox" data-as-inc="${k}" ${c.include ? "checked" : ""}> <b>${escapeHtml(sh.name)}</b></label>
                <span class="note">${sh.rowCount}行${sh.headerFound ? "" : "（見出しが見つかりません。仮に割り当てました）"}</span>
                <label class="toggle">見出しの行 <input type="number" min="0" max="999" value="${c.headerRow + 1}" data-as-header="${k}" class="num-input sm"> <small>（0＝見出しなし）</small></label></div>
                <div class="as-cols">${cols}</div></div>`;
        }).join("") +
        `<div class="ctrl-row"><button type="button" class="btn go" id="btn-as-ok">この内容で取り込む</button><button type="button" class="btn" id="btn-as-cancel">やめる</button></div>`;
    box.classList.remove("hidden");
}

async function reanalyze(k, headerRow) {
    const { resp, cfg } = importState;
    try {
        const res = await fetch("/api/script/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: resp.importId, sheet: resp.sheets[k].index, headerRow }) });
        const j = await res.json();
        if (!res.ok) return showError(j.error);
        resp.sheets[k] = Object.assign({}, resp.sheets[k], j);
        cfg[k].headerRow = j.headerRow;
        cfg[k].roles = j.columns.map(c => c.role);
        renderAssign();
    } catch (e) { showError(SERVER_NG); }
}

async function commitAssign() {
    const { resp, cfg } = importState;
    const hadScript = script().rows.some(r => !script().sections[r.sec].manual);
    if (hadScript && !confirm("いまの台本を、この内容に置き換えます。ひもづけたキューは、同じ内容の行に引き継ぎます。よろしいですか？")) return;
    try {
        const res = await fetch("/api/script/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: resp.importId, sheets: cfg.map(c => ({ index: c.index, include: c.include, headerRow: c.headerRow, roles: c.roles })) }) });
        const j = await res.json();
        if (!res.ok) return showError(`取り込めませんでした：${j.error}`);
        importState = null;
        renderAssign();
        selectedRow = -1;
        showInfo(`${j.sections}セクション・${j.rows}行を取り込みました${j.carried ? `（キューを${j.carried}個引き継ぎ）` : ""}`);
        renderLost(j.lost || []);
    } catch (e) { showError(SERVER_NG); }
}

function renderLost(lost) {
    const box = $("#sc-lost");
    if (!lost.length) { box.classList.add("hidden"); return; }
    box.innerHTML = `<h2>引き継げなかったキュー（${lost.length}個） <button type="button" class="btn small" id="btn-lost-close">閉じる</button></h2>
        <div class="note">読み直した台本で、同じ内容の行が見つからなかったため外れました。必要なら、該当の行に付け直してください。</div>` +
        lost.map(l => `<div class="lost-row">${escapeHtml(l.section)}／${escapeHtml(l.title || l.script)}</div>`).join("");
    box.classList.remove("hidden");
}

// ---- 選んだ行のキューの編集 ----
// folder を渡すと、そのフォルダの中のスライドだけに絞る（例：選手/テストチームA/）
function fillFileSelect(sel, value, folder) {
    const nf = folder ? SC.normPath(folder) : "";
    const opts = slides.filter(s => !s.path.startsWith(SC.FUTA_FOLDER) && (!nf || SC.normPath(s.path).includes(nf))).map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.path.replace(/^slides\//, ""))}</option>`).join("");
    sel.innerHTML = `<option value="">（スライドを選ぶ）</option>` + opts;
    sel.value = value || "";
}
function fillSongSelect(sel, value) {
    const all = musicList.map(m => ({ path: m.path, name: m.name }));
    if (value && !all.some(s => s.path === value)) all.push({ path: value, name: "（見つからない）" + value });
    sel.innerHTML = `<option value="">（曲を選ぶ）</option>` + all.map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.name)}</option>`).join("");
    sel.value = value || "";
}

let editorRow = -2, editorRev = -1, editorPick = "";
function showPickNote() {
    const n = $("#cue-pick-note");
    n.classList.toggle("hidden", !editorPick);
    n.innerHTML = editorPick ? `「${escapeHtml(editorPick)}」の中だけを表示中 <button type="button" class="btn small" id="btn-pick-all">すべて表示</button>` : "";
}
function renderCueEditor() {
    const sc = script();
    const r = sc.rows[selectedRow];
    const box = $("#sc-editor");
    $$(".sc-list .sc-row.sel").forEach(el => el.classList.remove("sel"));
    if (!r || r.kind === "chapter" || scMode !== "edit") { box.classList.add("hidden"); editorRow = -2; return; }
    const el = $(`#sc-list .sc-row[data-i="${selectedRow}"]`);
    if (el) el.classList.add("sel");
    box.classList.remove("hidden");
    if (editorRow === selectedRow && editorRev === sc.rev) return;     // 入力中の内容を消さない
    editorRow = selectedRow; editorRev = sc.rev;
    const c = r.cue || (suggestions[selectedRow] && suggestions[selectedRow].cue) || {};
    $("#sc-editor-title").textContent = `${selectedRow + 1}行目 ${r.title ? "「" + r.title.slice(0, 30) + "」" : ""}${r.cue ? "" : "（キューなし" + (suggestions[selectedRow] ? "・提案を入れています" : "") + "）"}`;
    const face = (sel, fileSel, f) => {
        sel.value = f ? (f.type === "camera" ? f.cam : f.type) : "";
        fillFileSelect(fileSel, f && f.type === "slide" ? f.file : "");
        fileSel.classList.toggle("hidden", sel.value !== "slide");
    };
    face($("#cue-left"), $("#cue-left-file"), c.left);
    // 「当日に選ぶ」行：スライドの選択を、そのフォルダの中だけに絞って開く
    const pick = !r.cue && suggestions[selectedRow] && suggestions[selectedRow].pick && suggestions[selectedRow].pick[0] || "";
    editorPick = pick;
    if (pick) {
        $("#cue-left").value = "slide";
        fillFileSelect($("#cue-left-file"), "", pick);
        $("#cue-left-file").classList.remove("hidden");
    }
    showPickNote();
    face($("#cue-right"), $("#cue-right-file"), c.right);
    $("#cue-right-fit").value = c.right && c.right.type === "camera" && c.right.fit === "contain" ? "contain" : "cover";
    $("#cue-right-fit").classList.toggle("hidden", !c.right || c.right.type !== "camera");
    face($("#cue-band"), $("#cue-band-file"), c.band);
    const b = c.bgm;
    $("#cue-bgm").value = b ? b.action : "";
    $("#cue-duck").value = c.duck === true ? "on" : c.duck === false ? "off" : "";
    fillSongSelect($("#cue-bgm-song"), b && b.action === "play" ? b.path : "");
    $("#cue-bgm-song").classList.toggle("hidden", !b || b.action !== "play");
    $("#cue-bgm-loop-wrap").classList.toggle("hidden", !b || b.action !== "play");
    $("#cue-bgm-loop").checked = !!(b && b.loop);
    $("#cue-memo").value = c.memo || "";
    const manual = sc.sections[r.sec].manual;
    $$("[data-row-move], #btn-row-del").forEach(x => x.classList.toggle("hidden", !manual));
}

function readCueForm() {
    const faceOf = (sel, fileSel, isRight) => {
        const v = sel.value;
        if (!v) return null;
        if (v === "slide") { if (!fileSel.value) throw new Error("スライドを選んでください"); return { type: "slide", file: fileSel.value }; }
        if (v === "cam1" || v === "cam2") return isRight && $("#cue-right-fit").value === "contain" ? { type: "camera", cam: v, fit: "contain" } : { type: "camera", cam: v };
        return { type: v };
    };
    const cue = { left: faceOf($("#cue-left"), $("#cue-left-file")), right: faceOf($("#cue-right"), $("#cue-right-file"), true), band: faceOf($("#cue-band"), $("#cue-band-file")), bgm: null, memo: $("#cue-memo").value.slice(0, 1000) };
    const a = $("#cue-bgm").value;
    if (a === "play") {
        const sel = $("#cue-bgm-song");
        if (!sel.value) throw new Error("鳴らす曲を選んでください");
        cue.bgm = { action: "play", path: sel.value, name: sel.options[sel.selectedIndex].text.slice(0, 300), loop: $("#cue-bgm-loop").checked };
    } else if (a) cue.bgm = { action: a };
    if ($("#cue-duck").value) cue.duck = $("#cue-duck").value === "on";
    const old = script().rows[selectedRow].cue;
    // 左右・帯を指定せず、前から「プレビューの画面」を持っているキューは、その画面を残す
    if (old && old.scene && !cue.left && !cue.right && !cue.band) cue.scene = old.scene;
    return cue;
}

async function saveCue() {
    let cue;
    try { cue = readCueForm(); } catch (e) { return showError(e.message); }
    if (!(await scEdit([{ op: "cue", row: selectedRow, cue }]))) return;
    editorRow = -2;
    showInfo("キューを付けました");
}

async function cueFromPreview() {
    const r = script().rows[selectedRow];
    if (!r) return;
    const cue = { scene: clone(pvw), bgm: r.cue ? r.cue.bgm || null : null, memo: r.cue ? r.cue.memo || "" : "" };
    try { const f = readCueForm(); if (f.bgm) cue.bgm = f.bgm; } catch (e) { /* 曲の選び途中などは、前のBGMのまま */ }
    if (await scEdit([{ op: "cue", row: selectedRow, cue }])) { editorRow = -2; showInfo("いまのプレビューの画面を、キューにしました"); }
}

function testCueInPreview() {
    const r = script().rows[selectedRow];
    let cue = r && r.cue;
    if (!cue) { try { cue = readCueForm(); } catch (e) { return showError(e.message); } }
    pvw = SC.buildScene(cue, state.program, logos());
    if (!LAYOUT_SLOTS[pvw.layout].includes(selectedSlot)) selectedSlot = LAYOUT_SLOTS[pvw.layout][0];
    pvwChanged({ noAuto: true });
}

async function addManualCue() {
    const name = prompt("手動の式次第に足すキューの名前（いまのプレビューの画面を使います）", "");
    if (name === null) return;
    if (!name.trim()) return showError("名前を入れてください");
    if (await scEdit([{ op: "addManual", title: name.trim().slice(0, 300), cue: { scene: clone(pvw), bgm: null, memo: "" } }])) {
        selectedRow = script().rows.findIndex((r, i) => script().sections[r.sec].manual && r.title === name.trim() && i >= 0) ;
        showInfo("手動の式次第に追加しました");
    }
}

async function clearSectionCues() {
    const sc = script();
    const ref = sc.rows[selectedRow >= 0 ? selectedRow : sc.pos];
    if (!ref) return showError("セクションの中の行を選んでください（読み位置か、クリックした行のセクションが対象です）");
    const name = sc.sections[ref.sec].name;
    if (!confirm(`「${name}」のキューを全部消しますか？（台本の文字は消えません）`)) return;
    if (await scEdit([{ op: "clearSection", sec: ref.sec }])) showInfo(`「${name}」のキューを消しました`);
}

function bindScript() {
    $$("#sc-mode button").forEach(b => b.addEventListener("click", () => setScMode(b.dataset.scmode)));
    $("#btn-sc-next").addEventListener("click", scNext);
    $("#btn-sc-prev").addEventListener("click", scPrev);
    $("#btn-read-up").addEventListener("click", () => moveReadPos(-1));
    $("#btn-read-down").addEventListener("click", () => moveReadPos(1));
    $("#sc-jump").addEventListener("change", e => { if (e.target.value !== "") jumpToRow(Number(e.target.value)); });

    $("#btn-sc-file").addEventListener("click", () => $("#sc-file").click());
    $("#sc-file").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; uploadScript(f); });
    $("#btn-sc-paste-toggle").addEventListener("click", () => $("#sc-paste-box").classList.toggle("hidden"));
    $("#btn-sc-paste").addEventListener("click", pasteScript);
    const drop = $("#sc-drop");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); uploadScript(e.dataTransfer.files[0]); });

    $("#sc-import").addEventListener("change", e => {
        const t = e.target;
        if (!importState) return;
        if (t.dataset.asRole) { const [k, c] = t.dataset.asRole.split(":").map(Number); importState.cfg[k].roles[c] = t.value; }
        else if (t.dataset.asInc !== undefined) importState.cfg[Number(t.dataset.asInc)].include = t.checked;
        else if (t.dataset.asHeader !== undefined) {
            const n = parseInt(t.value, 10);
            reanalyze(Number(t.dataset.asHeader), Number.isInteger(n) && n >= 0 ? n - 1 : null);
        }
    });
    $("#sc-import").addEventListener("click", e => {
        if (e.target.closest("#btn-as-ok")) commitAssign();
        else if (e.target.closest("#btn-as-cancel")) { importState = null; renderAssign(); }
    });
    $("#sc-lost").addEventListener("click", e => { if (e.target.closest("#btn-lost-close")) $("#sc-lost").classList.add("hidden"); });

    $("#btn-sc-adopt-all").addEventListener("click", () => {
        const rows = Object.keys(suggestions).map(Number).filter(i => suggestions[i].cue);
        if (!rows.length) return showInfo("採用できる提案がありません");
        if (confirm(`提案を${rows.length}行すべてに採用して、キューを付けます。よろしいですか？`)) adoptSuggestions(rows);
    });
    $("#btn-sc-clear-sec").addEventListener("click", clearSectionCues);
    $("#btn-sc-add-manual").addEventListener("click", addManualCue);

    const list = $("#sc-list");
    list.addEventListener("click", e => {
        const ad = e.target.closest("[data-adopt]");
        if (ad) return adoptSuggestions([Number(ad.dataset.adopt)]);
        const sec = e.target.closest(".sc-sec");
        if (sec) return jumpToRow(Number(sec.dataset.first));
        const row = e.target.closest(".sc-row");
        if (row && scMode === "edit") {
            selectedRow = Number(row.dataset.i);
            editorRow = -2;
            const r = script().rows[selectedRow];
            if (r.cue && state) { pvw = SC.buildScene(r.cue, state.program, logos()); pvwChanged({ noAuto: true }); }
            renderCueEditor();
        }
    });
    list.addEventListener("dblclick", e => {
        if (e.target.closest("[data-adopt]") || e.target.closest(".sc-sec")) return;
        const row = e.target.closest(".sc-row");
        if (row) fireRow(Number(row.dataset.i));
    });

    // キューの編集
    ["left", "right", "band"].forEach(k => $(`#cue-${k}`).addEventListener("change", e => {
        $(`#cue-${k}-file`).classList.toggle("hidden", e.target.value !== "slide");
        if (k === "right") $("#cue-right-fit").classList.toggle("hidden", !/^cam/.test(e.target.value));
    }));
    $("#cue-bgm").addEventListener("change", e => {
        $("#cue-bgm-song").classList.toggle("hidden", e.target.value !== "play");
        $("#cue-bgm-loop-wrap").classList.toggle("hidden", e.target.value !== "play");
        if (e.target.value === "play" && $("#cue-bgm-song").options.length <= 1) fillSongSelect($("#cue-bgm-song"), "");
    });
    $("#btn-cue-save").addEventListener("click", saveCue);
    $("#cue-pick-note").addEventListener("click", e => {
        if (!e.target.closest("#btn-pick-all")) return;
        const cur = $("#cue-left-file").value;
        editorPick = "";
        fillFileSelect($("#cue-left-file"), cur, "");
        showPickNote();
    });
    $("#btn-cue-from-pvw").addEventListener("click", cueFromPreview);
    $("#btn-cue-test").addEventListener("click", testCueInPreview);
    $("#btn-cue-del").addEventListener("click", async () => {
        if (selectedRow < 0) return;
        if (await scEdit([{ op: "cue", row: selectedRow, cue: null }])) { editorRow = -2; showInfo("キューを外しました"); }
    });
    $$("[data-row-move]").forEach(b => b.addEventListener("click", async () => {
        const d = Number(b.dataset.rowMove);
        if (selectedRow < 0) return;
        if (await scEdit([{ op: "moveRow", row: selectedRow, dir: d }])) { selectedRow = Math.max(0, selectedRow + d); editorRow = -2; scListKey = ""; renderScript(); }
    }));
    $("#btn-row-del").addEventListener("click", async () => {
        const r = script().rows[selectedRow];
        if (!r || !confirm(`「${r.title}」の行を消しますか？`)) return;
        if (await scEdit([{ op: "deleteRow", row: selectedRow }])) { selectedRow = -1; editorRow = -2; }
    });
}

// --------------------------------------------------------------------------
// タブの切り替え・フタ
// --------------------------------------------------------------------------
function selectTab(name) {
    currentTab = name;
    $$("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === name));
    $$(".tab-body").forEach(t => t.classList.toggle("hidden", t.id !== `tab-${name}`));
    // 台本タブでは、左に台本・右にモニターの並びにする（CSS の .script-mode）
    document.body.classList.toggle("script-mode", name === "script");
    if (name === "script") {
        scListKey = "";
        renderScript();
        scrollToPos();
        followNextInPreview();
    }
}

function renderFuta() {
    const f = state.futa;
    $("#btn-futa-left").classList.toggle("on", f.active === "left");
    $("#btn-futa-full").classList.toggle("on", f.active === "full");
    renderFutaSelects();
    const lg = logos();
    $("#futa-info").textContent = (lg.left ? `左フタ：${baseName(lg.left)}` : "左フタ：画像がありません（黒になります）") + " ／ " +
        (lg.full ? `全面フタ：${baseName(lg.full)}` : "全面フタ：画像がありません（黒になります）") +
        (!lg.left || !lg.full ? "　→ slides/フタ/ に画像を入れて「⟳ 読み直す」を押すか、上で選んでください" : "");
    sdRefresh();
}

let lastFutaOptKey = "";
function renderFutaSelects() {
    if (!state) return;
    const imgs = slides.filter(s => s.kind === "image");
    const key = imgs.map(s => s.path).join("|") + "|" + state.futa.left + "|" + state.futa.full;
    if (key === lastFutaOptKey) return;
    lastFutaOptKey = key;
    const opts = `<option value="">自動（slides/フタ/ の最初の画像）</option>` + imgs.map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.path.replace(/^slides\//, ""))}</option>`).join("");
    ["left", "full"].forEach(k => {
        const sel = $(`#futa-${k}`);
        let o = opts;
        if (state.futa[k] && !imgs.some(s => s.path === state.futa[k])) o += `<option value="${escapeHtml(state.futa[k])}">（見つからない）${escapeHtml(state.futa[k])}</option>`;
        sel.innerHTML = o;
        sel.value = state.futa[k];
    });
}

// 右面のカメラ⇔ロゴ（本線に直接）。カメラのときはロゴに、そうでなければカメラ1に切り替える
let rightCamMemo = { type: "camera", cam: "cam1" };
function rightCamLogo() {
    if (!state) return;
    const prog = clone(state.program);
    if (prog.layout !== "split") prog.layout = "split";
    const logo = logos().left;
    const isLogo = prog.slots.right.type === "slide" && prog.slots.right.file === logo && !!logo;
    if (!isLogo && prog.slots.right.type === "camera") rightCamMemo = clone(prog.slots.right);
    prog.slots.right = isLogo ? clone(rightCamMemo) : (logo ? { type: "slide", file: logo } : { type: "black" });
    if (!logo && !isLogo) showError("フタの画像がありません。slides/フタ/ に画像を入れてください");
    patch({ program: prog });
}

// --------------------------------------------------------------------------
// Stream Deck（USB直結）。キーの割り当て・LCD描画は streamdeck.js。ここでは「操作の一覧」を渡す
// --------------------------------------------------------------------------
const SD_BGM_KEY = "stadiumvision-baseball.sdbgm";
const SD_SECTION_KEYS = 8;
const SD_BGM_KEYS = 12;
const sdBgmPrefs = readLocal(SD_BGM_KEY, []);
const wrapLabel = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n) + "\n" + t.slice(n, n * 2) : t; };

function sdSong(i) {
    const path = sdBgmPrefs[i];
    return (path && musicList.find(m => m.path === path)) || (!path ? musicList[i] : null) || null;
}
function sdNextTitle() {
    const sc = script();
    const i = SC.nextCueRow(sc);
    return i >= 0 ? (sc.rows[i].title || `${i + 1}行目`) : "（なし）";
}

function buildSdActions() {
    const A = [];
    const add = (id, describe, run) => A.push({ id, describe, run });
    // 優先順位の高い順（6キー・8キーの機種には、この順に詰める）
    add("next", () => ({ label: "NEXT ▶", sub: sdNextTitle(), color: "#15803d" }), scNext);
    add("prev", () => ({ label: "◀ PREV", sub: "前のキュー", color: "#0f766e" }), scPrev);
    add("futaLeft", () => ({ label: "左フタ", sub: "ロゴ", color: "#7c3aed", toggle: true, on: !!state && state.futa.active === "left", onColor: "#a78bfa" }), () => control("futa"));
    add("black", () => ({ label: "BLACK", color: "#475569", toggle: true, on: !!state && state.black, onColor: "#dc2626" }), () => control("black"));
    add("bgmFade", () => ({ label: "BGM\nフェード", sub: "アウト", color: "#b45309" }), musicFade);
    add("bgmStop", () => ({ label: "BGM\n停止", sub: "すぐ止める", color: "#991b1b" }), musicHalt);
    add("futaFull", () => ({ label: "全面フタ", sub: "ロゴ", color: "#6d28d9", toggle: true, on: !!state && state.futa.active === "full", onColor: "#a78bfa" }), () => control("futaFull"));
    add("take", () => ({ label: "TAKE", sub: "PVW→本線", color: "#dc2626" }), doTake);
    add("readDown", () => ({ label: "読み位置\n↓", color: "#1d4ed8" }), () => moveReadPos(1));
    add("readUp", () => ({ label: "読み位置\n↑", color: "#1d4ed8" }), () => moveReadPos(-1));
    add("bgmDuck", () => ({ label: "BGM\n小さく", sub: musicDucked ? "戻す" : "", color: "#b45309", toggle: true, on: musicDucked, onColor: "#f59e0b" }), () => musicDuck());
    add("swap", () => ({ label: "⇄ 入替", sub: "左右", color: "#0369a1" }), swapSides);
    add("camLogo", () => {
        const logo = logos().left;
        const isLogo = !!state && !!logo && state.program.slots.right.type === "slide" && state.program.slots.right.file === logo;
        return { label: "右面\nカメラ⇔ロゴ", color: "#0e7490", toggle: true, on: isLogo, onColor: "#22d3ee" };
    }, rightCamLogo);
    for (let i = 0; i < SD_BGM_KEYS; i++) {
        add(`bgm${i + 1}`, () => {
            const m = sdSong(i);
            if (!m) return { label: `BGM ${i + 1}`, sub: "（曲なし）", color: "#1e293b" };
            return { label: m.name, sub: `BGM ${i + 1}`, color: "#1d4ed8", toggle: true, on: !!musicCur && musicCur.item.path === m.path, onColor: "#16a34a" };
        }, () => {
            const m = sdSong(i);
            if (!m) return showError(`BGM ${i + 1} に曲がありません`);
            if (musicCur && musicCur.item.path === m.path) return musicStop();
            musicPlay(m);
        });
    }
    for (let i = 0; i < SD_SECTION_KEYS; i++) {
        add(`sec${i + 1}`, () => {
            const s = script().sections[i];
            return s ? { label: s.name, sub: "読み位置へ", color: "#854d0e" } : { label: "", color: "#05070c" };
        }, () => { const first = script().rows.findIndex(r => r.sec === i); if (first >= 0) jumpToRow(first); });
    }
    return A;
}

let lastSdMusicKey = "";
function sdRefresh() {
    if (typeof StreamDeck === "undefined" || !state) return;
    StreamDeck.refresh();
    renderSdKeys();
    const mk = musicList.map(m => m.path).join("|");
    if (mk !== lastSdMusicKey) { lastSdMusicKey = mk; renderSdBgmSelects(); refreshSuggestions(); }
}

function renderSdKeys() {
    const box = $("#sd-keys");
    if (!box) return;
    const count = StreamDeck.getKeyCount();
    const cols = { 6: 3, 8: 4, 15: 5, 32: 8 }[count] || 5;
    box.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    box.innerHTML = StreamDeck.layoutFor(count).map((d, i) => {
        const lk = StreamDeck.look(d);
        return `<button type="button" class="sd-key ${lk.on ? "on" : ""}" data-sd-key="${i}" style="background:${lk.bg}">${lk.empty ? "" : `<b>${escapeHtml(lk.label).replace(/\n/g, "<br>")}</b><small>${escapeHtml(lk.sub)}</small>`}</button>`;
    }).join("");
}

function renderSdBgmSelects() {
    const box = $("#sd-bgm");
    if (!box) return;
    box.innerHTML = Array.from({ length: SD_BGM_KEYS }, (_, i) => `<label>BGM ${i + 1}<select data-sd-bgm="${i}" class="text-input"><option value="">（${musicList[i] ? musicList[i].name : "曲なし"}）自動</option>` +
        musicList.map(m => `<option value="${escapeHtml(m.path)}" ${sdBgmPrefs[i] === m.path ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("") + `</select></label>`).join("");
}

function onSdStatus(st) {
    $("#sd-badge").textContent = st.connected ? `SD ${st.keyCount}キー` : "SD 未接続";
    $("#sd-badge").classList.toggle("on", st.connected);
    $("#sd-state").textContent = !st.supported ? "このブラウザでは使えません" : st.connected ? `接続中：${st.name}（${st.keyCount}キー）` : "未接続";
    $("#btn-sd-connect").classList.toggle("hidden", !st.supported || st.connected);
    $("#btn-sd-disconnect").classList.toggle("hidden", !st.connected);
    $("#btn-sd-flip").classList.toggle("on", st.flipVertical);
    $("#sd-bright").value = st.brightness;
    $("#sd-preview-count").value = String(st.keyCount);
    $("#sd-preview-count").disabled = st.connected;
    if (!st.supported) $("#sd-info").textContent = "Stream Deck をUSBで直接つなぐには、Chrome か Edge で開いてください（このブラウザには WebHID がありません）。";
    renderSdKeys();
}

function initStreamDeck() {
    StreamDeck.setActions(buildSdActions());
    StreamDeck.init({ onStatus: onSdStatus });
}

function bindStreamDeckUi() {
    $("#btn-sd-connect").addEventListener("click", () => StreamDeck.requestAndConnect());
    $("#btn-sd-disconnect").addEventListener("click", () => StreamDeck.disconnect());
    $("#btn-sd-flip").addEventListener("click", () => StreamDeck.toggleFlip());
    $$("[data-sd-shift]").forEach(b => b.addEventListener("click", () => StreamDeck.shiftKeys(Number(b.dataset.sdShift))));
    $("#sd-bright").addEventListener("change", e => StreamDeck.setBrightness(Number(e.target.value)));
    $("#sd-preview-count").addEventListener("change", e => { StreamDeck.setPreviewCount(Number(e.target.value)); renderSdKeys(); });
    $("#sd-badge").addEventListener("click", () => { selectTab("settings"); $("#sd-panel").scrollIntoView({ block: "center" }); });
    // 画面上のキー見本をクリックしても、実機のキーと同じ操作をする
    $("#sd-keys").addEventListener("click", e => { const k = e.target.closest("[data-sd-key]"); if (k) StreamDeck.press(Number(k.dataset.sdKey)); });
    $("#sd-bgm").addEventListener("change", e => {
        const sel = e.target.closest("[data-sd-bgm]");
        if (!sel) return;
        sdBgmPrefs[Number(sel.dataset.sdBgm)] = sel.value;
        writeLocal(SD_BGM_KEY, sdBgmPrefs);
        sdRefresh();
    });
}

// --------------------------------------------------------------------------
// 設定：カメラ・チーム
// --------------------------------------------------------------------------
async function refreshDevices(askPermission) {
    if (!navigator.mediaDevices) return showError("このブラウザではカメラを選べません（Chrome か Edge で http://localhost:3007 を開いてください）");
    if (askPermission) {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            s.getTracks().forEach(t => t.stop());
        } catch (e) {
            return showError(`カメラの許可が出ませんでした（${e.name}）。アドレス欄のカメラのマークから許可してください`);
        }
    }
    videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
    renderCameraSelects(true);
    if (askPermission) showInfo(`カメラを${videoDevices.length}台見つけました`);
}

function renderCameraSelects(force) {
    if (!state) return;
    ["cam1", "cam2"].forEach(cam => {
        const sel = $(`#${cam}-select`);
        if (!force && document.activeElement === sel) return;
        const cur = state.cameras[cam];
        let html = `<option value="">PCの既定のカメラ</option>` +
            videoDevices.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `カメラ ${i + 1}（名前は「カメラの一覧を出す」で表示）`)}</option>`).join("");
        if (cur.deviceId && !videoDevices.some(d => d.deviceId === cur.deviceId)) {
            html += `<option value="${escapeHtml(cur.deviceId)}">（見つからない）${escapeHtml(cur.label || "前に選んだカメラ")}</option>`;
        }
        if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
        sel.value = cur.deviceId;
    });
}

function setCamera(sel) {
    const cameras = clone(state.cameras);
    cameras[sel.dataset.cam] = { deviceId: sel.value, label: sel.value ? sel.options[sel.selectedIndex].text.slice(0, 300) : "" };
    patch({ cameras });
}

// --------------------------------------------------------------------------
// 出力の形（32:9 ／ SDI 1本の帯）
// --------------------------------------------------------------------------
let lastOutputKey = "";
function renderOutput() {
    const o = state.output;
    $$("#out-mode-seg button[data-outmode]").forEach(b => b.classList.toggle("on", b.dataset.outmode === o.mode));
    $("#out-sdi-box").classList.toggle("hidden", o.mode !== "sdi");
    if (document.activeElement !== $("#out-band-y")) $("#out-band-y").value = o.bandY;
    if (document.activeElement !== $("#out-band-h")) $("#out-band-h").value = o.bandH;
    $("#out-band-info").textContent = o.mode === "sdi"
        ? `ビジョンに映る帯：1920×${o.bandH}（y=${o.bandY}〜${o.bandY + o.bandH}）／ 左右に2分割したときは 1枚 960×${o.bandH}`
        : "";
    $("#hdr-sub").textContent = o.mode === "sdi" ? `SDI 1本（1920×1080 の中の帯 1920×${o.bandH}）管理画面` : "32:9（FHD×2）管理画面";
    $$("[data-open=left],[data-open=right]").forEach(b => { b.disabled = o.mode === "sdi"; });
    const key = JSON.stringify(o);
    if (key === lastOutputKey) return;
    lastOutputKey = key;
    // モニターの形をビジョンに合わせる（帯のときは 1920:帯の高さ）
    const st = stageSize();
    document.documentElement.style.setProperty("--mon-ar", String(st.w / st.h));
    $("#obs-drag").href = obsUrl();
    renderControls();
    renderOverlay();
}

function setOutput(changes) {
    const o = Object.assign({}, state.output, changes);
    o.bandH = Math.max(80, Math.min(1080, Math.round(Number(o.bandH) || 630)));
    o.bandY = Math.max(0, Math.min(1080 - o.bandH, Math.round(Number(o.bandY) || 0)));
    patch({ output: o });
}

// LEDの大きさ（例 488×160）から、横100%・上下トリミングのときに映る帯の高さを出す
function bandFromLed() {
    const w = Number($("#out-led-w").value), h = Number($("#out-led-h").value);
    if (!(w > 0 && h > 0)) return showError("ビジョン（LED）の横・縦のドット数を入れてください");
    const bandH = Math.round(1920 * h / w);
    if (bandH > 1080) return showError(`この比率だと帯の高さが1080を超えます（${bandH}）。横100%・上下トリミングの設定ではありません`);
    setOutput({ bandH, bandY: Math.round((1080 - bandH) / 2) });
    showInfo(`帯の高さを ${bandH}（上下の中央）にしました。テスト画面を出して、緑の枠がビジョンの四辺に合うか確かめてください`);
}

function renderTeams() {
    $$(".team-row").forEach(row => {
        const t = state.teams[row.dataset.team];
        row.querySelectorAll("input").forEach(inp => { if (document.activeElement !== inp) inp.value = t[inp.dataset.k]; });
    });
}

function onTeamChange(inp) {
    const row = inp.closest(".team-row");
    const teams = clone(state.teams);
    teams[row.dataset.team][inp.dataset.k] = inp.value.trim();
    patch({ teams });
}

async function loadPhotoTeams() {
    const res = await fetch("/api/photo-teams");
    if (!res.ok) return;
    $("#photo-teams").innerHTML = (await res.json()).map(t => `<option value="${escapeHtml(t)}">`).join("");
}

// --------------------------------------------------------------------------
// ボタンなどのつなぎこみ
// --------------------------------------------------------------------------
function bindEvents() {
    $$("[data-open]").forEach(b => b.addEventListener("click", () => openOutput(b.dataset.open)));
    $("#opt-guide").addEventListener("change", e => patch({ guide: e.target.checked }));
    $$("#out-mode-seg button[data-outmode]").forEach(b => b.addEventListener("click", () => setOutput({ mode: b.dataset.outmode })));
    $("#out-band-y").addEventListener("change", e => setOutput({ bandY: e.target.value }));
    $("#out-band-h").addEventListener("change", e => setOutput({ bandH: e.target.value }));
    $("#btn-band-center").addEventListener("click", () => setOutput({ bandY: Math.round((1080 - state.output.bandH) / 2) }));
    $("#btn-band-led").addEventListener("click", bandFromLed);
    $("#btn-black").addEventListener("click", () => control("black"));

    // OBSに入れる（ドラッグ＆ドロップ／アドレスのコピー）※得点板システムと同じ
    const drag = $("#obs-drag");
    drag.href = obsUrl();
    drag.addEventListener("click", e => {
        e.preventDefault();
        showInfo("このボタンを、クリックではなくOBSの画面へドラッグ＆ドロップしてください。");
    });
    drag.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/uri-list", obsUrl());
        e.dataTransfer.setData("text/plain", obsUrl());
    });
    $("#btn-copy-url").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(obsUrl());
            showInfo(`アドレスをコピーしました。OBSのブラウザソースのURL欄に貼り付けてください（幅${isSdi() ? 1920 : 3840}・高さ1080）。`);
        } catch (e) {
            showError(`コピーできませんでした。次のアドレスを手で入力してください：${obsUrl()}`);
        }
    });

    $$("#layout-seg button").forEach(b => b.addEventListener("click", () => setLayout(b.dataset.layout)));
    $$("[data-singlex]").forEach(b => b.addEventListener("click", () => setSingleX(b.dataset.singlex)));
    $("#single-x").addEventListener("input", e => setSingleX(e.target.value));
    $("#slot-seg").addEventListener("click", e => { const b = e.target.closest("[data-slot]"); if (b) selectSlot(b.dataset.slot); });
    $("#btn-swap").addEventListener("click", swapSides);
    $$("#fit-seg button").forEach(b => b.addEventListener("click", () => setCrop("fit", b.dataset.fit)));
    $$("[data-posy]").forEach(b => b.addEventListener("click", () => setCrop("posY", b.dataset.posy)));
    ["posX", "posY", "zoom"].forEach(k => {
        $(`#crop-${k}`).addEventListener("input", e => setCrop(k, e.target.value));
        $(`#crop-${k}-num`).addEventListener("change", e => setCrop(k, e.target.value));
    });
    $("#btn-crop-reset").addEventListener("click", resetCrop);

    $$("#trans-seg button").forEach(b => b.addEventListener("click", () => setTransition(b.dataset.trans)));
    $("#trans-ms").addEventListener("change", () => setTransition(state ? state.transition.type : "fade"));
    $("#btn-pgm-to-pvw").addEventListener("click", pgmToPvw);
    $("#btn-take").addEventListener("click", doTake);

    $$("#tabs button").forEach(b => b.addEventListener("click", () => selectTab(b.dataset.tab)));

    // 素材
    $$("[data-src]").forEach(b => b.addEventListener("click", () => assignSource(JSON.parse(b.dataset.src))));
    $$("[data-box]").forEach(b => b.addEventListener("click", () => $("#" + b.dataset.box).classList.toggle("hidden")));
    $("#btn-text").addEventListener("click", assignText);
    $("#btn-url").addEventListener("click", assignUrl);
    $("#btn-slide-file").addEventListener("click", () => $("#slide-file").click());
    $("#slide-file").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; uploadSlides(f); });
    const drop = $("#slide-drop");
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); uploadSlides([...e.dataTransfer.files]); });
    $("#btn-slide-reload").addEventListener("click", () => loadSlides().then(() => showInfo(`スライドを読み直しました（${slides.length}件）`)).catch(e => showError(e.message)));
    $("#slide-search").addEventListener("input", renderLibrary);
    $("#slide-folder-chips").addEventListener("click", e => {
        const c = e.target.closest("[data-folder]");
        if (!c) return;
        slideFolder = c.dataset.folder;
        $$("#slide-folder-chips .chip").forEach(x => x.classList.toggle("on", x === c));
        renderLibrary();
    });
    $("#slide-library").addEventListener("click", e => {
        const item = e.target.closest(".lib-item");
        if (!item) return;
        if (e.target.closest(".lib-del")) return deleteSlide(item.dataset.path);
        assignSource({ type: "slide", file: item.dataset.path });
    });
    $("#slide-library").addEventListener("dblclick", e => { if (e.target.closest(".lib-item") && !e.target.closest(".lib-del")) doTake(); });

    // 選手
    $$("#team-filter button").forEach(b => b.addEventListener("click", () => { teamFilter = b.dataset.team; renderPlayers(); }));
    $("#player-search").addEventListener("input", renderPlayers);
    $("#btn-roster").addEventListener("click", () => $("#roster-file").click());
    $("#roster-file").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; importRoster(f).catch(err => showError(`読み込めませんでした：${err.message}`)); });
    $("#player-list").addEventListener("click", e => {
        const r = e.target.closest(".player-row");
        if (r) { selectedPlayer = Number(r.dataset.i); renderPlayers(); }
    });
    $("#player-list").addEventListener("dblclick", e => { if (e.target.closest(".player-row")) sendPlayer("atbat"); });
    $$("[data-card]").forEach(b => b.addEventListener("click", () => sendPlayer(b.dataset.card, b.dataset.label)));
    $$("[data-derby]").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.derby === "reset" && !confirm("HR競争の本数とアウトを0に戻しますか？")) return;
        control("derby", b.dataset.derby);
    }));
    $$("[data-derby-out]").forEach(b => b.addEventListener("click", () => control("derbyOut", b.dataset.derbyOut)));
    $$("[data-lineup]").forEach(b => b.addEventListener("click", () => sendLineup(b.dataset.lineup)));

    // 台本
    bindScript();

    // 設定
    $("#btn-preset-moriyama").addEventListener("click", () => { setOutput({ mode: "sdi", bandY: 197, bandH: 686 }); showInfo("守山の設定（SDI 1本・帯の上端197・高さ686）にしました"); });
    $("#btn-futa-left").addEventListener("click", () => control("futa"));
    $("#btn-futa-full").addEventListener("click", () => control("futaFull"));
    $("#futa-left").addEventListener("change", e => patch({ futa: Object.assign({}, state.futa, { left: e.target.value }) }));
    $("#futa-full").addEventListener("change", e => patch({ futa: Object.assign({}, state.futa, { full: e.target.value }) }));
    bindStreamDeckUi();
    $("#btn-devices").addEventListener("click", () => refreshDevices(true));
    $$("#cam1-select, #cam2-select").forEach(sel => sel.addEventListener("change", () => setCamera(sel)));
    $("#opt-monitor-cam").addEventListener("change", reloadMonitors);
    $$(".team-row input").forEach(inp => inp.addEventListener("change", () => onTeamChange(inp)));
    PREF_CHECKS.forEach(id => $("#" + id).addEventListener("change", savePrefs));

    // キーボード：Space = TAKE（文字を入れている間は効かない）
    document.addEventListener("keydown", e => {
        const tag = document.activeElement ? document.activeElement.tagName : "";
        if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
        if (e.code === "Space") { e.preventDefault(); doTake(); }
        else if (currentTab === "script" && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); moveReadPos(e.key === "ArrowDown" ? 1 : -1); }
    });

    $("#pvw-frame").addEventListener("load", postPvw);
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener("devicechange", () => refreshDevices(false).catch(() => {}));
    }
}

function init() {
    restorePrefs();
    bindEvents();
    initMusic();
    initStreamDeck();
    reloadMonitors();
    renderControls();
    renderOverlay();
    connect();
    loadSlides().then(() => { renderFutaSelects(); refreshSuggestions(); }).catch(e => showError(`${e.message}。サーバーが起動しているか確認してください`));
    loadPlayerMedia().catch(e => showError(e.message));
    loadWalkups().catch(e => showError(e.message));
    loadPhotoTeams().catch(() => {});
    refreshDevices(false).catch(() => {});
}

init();
