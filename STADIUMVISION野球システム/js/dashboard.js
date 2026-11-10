/* ==========================================================================
   スタジアムビジョン野球システム - 管理画面
   - プレビュー（次に出す画面）を組み立てて、TAKE で本線（ビジョン）へ出す
   - 素材（スライド・カメラ・文字）／選手紹介／式次第／設定
   - 音楽は music_admin.js の音楽バー（得点板システムと同じもの）で鳴らす
     登場曲・式次第の曲も、音楽バーの音量・フェード・出力先で鳴る
   - 画面の表示は、サーバーから届いた状態(/events)をもとに更新する
   ========================================================================== */

const LAYOUT_SLOTS = { wide: ["wide"], split: ["left", "right"], single: ["single", "bg"] };
const SLOT_NAMES = { wide: "全面 32:9", left: "左 16:9", right: "右 16:9", single: "16:9の枠", bg: "背景 32:9" };
const CROP_KEYS = ["fit", "posX", "posY", "zoom"];
const MEDIA_TYPES = ["slide", "url", "camera"];   // トリミングできる素材
const TEAMS = ["HOME", "AWAY"];
const PREF_KEY = "stadiumvision-baseball.prefs";
// OBSに入れる表示画面のアドレス（layer-width / layer-height は、OBSにドラッグしたときのブラウザソースの大きさ）
// camera=obs：カメラの枠を透明にする（キャプチャーボードはOBSの「映像キャプチャデバイス」で下に敷く）
const OBS_URL = `${location.origin}/vision.html?camera=obs&layer-width=3840&layer-height=1080`;
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
let selectedCue = -1;
let videoDevices = [];
let lastRosterKey = "";
let lastCueKey = "";

function emptyScene() {
    return {
        layout: "wide",
        slots: { wide: { type: "black" }, left: { type: "black" }, right: { type: "black" }, single: { type: "black" }, bg: { type: "black" } },
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
    if (scene.layout === "split") return `16:9左右 ／ 左：${describeSrc(s.left)} ／ 右：${describeSrc(s.right)}`;
    if (scene.layout === "single") return `16:9 1枚（位置 ${Math.round(scene.singleX)}）／ ${describeSrc(s.single)} ／ 背景：${describeSrc(s.bg)}`;
    return `32:9 一枚 ／ ${describeSrc(s.wide)}`;
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
    // 32:9のスライドは「32:9 一枚」に自動で切り替える
    if (!opts.keepLayout && $("#opt-auto-layout").checked && src.type === "slide") {
        const r = aspectMap[src.file];
        if (r && r > 3 && pvw.layout !== "wide") {
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
    $$("#layout-seg button").forEach(b => b.classList.toggle("on", b.dataset.layout === pvw.layout));
    $("#single-pos").classList.toggle("hidden", pvw.layout !== "single");
    $("#single-x").value = pvw.singleX;
    $("#single-x-val").textContent = Math.round(pvw.singleX);

    $("#slot-seg").innerHTML = LAYOUT_SLOTS[pvw.layout]
        .map(s => `<button type="button" data-slot="${s}" class="${s === selectedSlot ? "on" : ""}">${SLOT_NAMES[s]}</button>`).join("");
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
    // 3840の幅に対する %
    if (slot === "left") return { left: 0, width: 50 };
    if (slot === "right") return { left: 50, width: 50 };
    if (slot === "single") return { left: 50 * scene.singleX / 100, width: 50 };
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
        box.innerHTML = `<span class="slot-name">${SLOT_NAMES[s]}</span>`;
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
    const w = view === "all" ? 1280 : 960;
    const h = view === "all" ? 360 : 540;
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
    es.addEventListener("CUE_FIRED", e => onCueFired(JSON.parse(e.data).index));
    es.addEventListener("NOTICE", e => showError(JSON.parse(e.data).message));
    es.onerror = () => {
        conn.textContent = "サーバーにつながっていません";
        conn.className = "conn ng";
    };
}

function handleCommand(cmd) {
    if (cmd.action === "take") doTake();
    else if (cmd.action === "musicStop") musicStop();
    else if (cmd.action === "musicPlay") playMusicPath(cmd.val);
}

function renderFromState() {
    if (!state) return;
    $("#btn-black").classList.toggle("on", state.black);
    $("#pgm-black-flag").classList.toggle("on", state.black);
    $("#pgm-desc").textContent = describeScene(state.program);
    $("#opt-guide").checked = state.guide;
    $$("#trans-seg button").forEach(b => b.classList.toggle("on", b.dataset.trans === state.transition.type));
    if (document.activeElement !== $("#trans-ms")) $("#trans-ms").value = state.transition.ms;
    $("#derby-count").textContent = state.derby.count;
    $("#derby-outs").textContent = state.derby.outs;
    renderTeams();
    renderCameraSelects();
    const rk = JSON.stringify([state.roster, state.teams]);
    if (rk !== lastRosterKey) { lastRosterKey = rk; renderPlayers(); }
    const ck = JSON.stringify([state.cues, state.cueIndex]);
    if (ck !== lastCueKey) { lastCueKey = ck; renderCues(); }
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
function playMusicPath(p, label) {
    const item = (typeof musicList !== "undefined" && musicList.find(m => m.path === p)) || { path: p, no: null, name: label || baseName(p).replace(/\.[^.]+$/, "") };
    musicPlay(item);
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
// 式次第（キュー）
// --------------------------------------------------------------------------
const cues = () => (state && state.cues) || [];

function cueMusicLabel(m) {
    if (!m || !m.action) return "";
    return m.action === "play" ? `🎵 ${m.name}` : "🎵 止める";
}

function renderCues() {
    const cs = cues();
    const onair = state ? state.cueIndex : -1;
    $("#cue-now").textContent = cs[onair] ? `出している：${onair + 1}. ${cs[onair].name}` : "";
    if (selectedCue >= cs.length) selectedCue = cs.length - 1;
    const list = $("#cue-list");
    if (cs.length === 0) {
        list.innerHTML = `<div class="empty">キューがありません。<br>プレビューに画面を組んで「＋ いまのプレビューを追加」を押します。<br>式次第の順に並べておくと「▶ 次へ」で順番に出せます。</div>`;
    } else {
        list.innerHTML = cs.map((c, i) => `<div class="cue-row ${i === selectedCue ? "on" : ""} ${i === onair ? "onair" : ""} ${i === onair + 1 ? "next" : ""}" data-i="${i}">
            <span class="idx">${i + 1}</span>
            <div><div class="nm">${escapeHtml(c.name)}</div><div class="meta">${escapeHtml(describeScene(c.scene))} ${escapeHtml(cueMusicLabel(c.music))}${c.memo ? " ／ " + escapeHtml(c.memo) : ""}</div></div>
            <button type="button" class="go" data-go="${i}">GO</button></div>`).join("");
    }
    renderCueEditor();
}

async function renderCueEditor() {
    const c = cues()[selectedCue];
    $("#cue-editor").classList.toggle("hidden", !c);
    if (!c) return;
    if (document.activeElement !== $("#cue-name")) $("#cue-name").value = c.name;
    if (document.activeElement !== $("#cue-memo")) $("#cue-memo").value = c.memo;
    $("#cue-music-action").value = c.music.action;
    const sel = $("#cue-music-path");
    let songs = [];
    try { songs = await fetch("/api/music").then(r => r.json()); } catch (e) { songs = []; }
    const all = [...songs.map(s => ({ path: s.path, name: s.name })), ...walkups.map(w => ({ path: w.path, name: `登場曲 ${w.folder}/${w.name}` }))];
    if (c.music.path && !all.some(s => s.path === c.music.path)) all.push({ path: c.music.path, name: `（見つからない）${c.music.name}` });
    sel.innerHTML = `<option value="">（曲を選ぶ）</option>` + all.map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.name)}</option>`).join("");
    sel.value = c.music.path;
    sel.classList.toggle("hidden", c.music.action !== "play");
}

function saveCues(list) { return patch({ cues: list }); }

function addCue() {
    const list = clone(cues());
    const name = prompt("キューの名前（式次第の項目名）", `${list.length + 1}. `);
    if (name === null) return;
    const at = selectedCue >= 0 ? selectedCue + 1 : list.length;
    list.splice(at, 0, { name: (name.trim() || `キュー${list.length + 1}`).slice(0, 100), scene: clone(pvw), music: { action: "", path: "", name: "" }, memo: "" });
    selectedCue = at;
    saveCues(list);
}

function overwriteCue() {
    const list = clone(cues());
    if (!list[selectedCue]) return showError("上書きするキューを選んでください");
    if (!confirm(`「${list[selectedCue].name}」を、いまのプレビューの画面で上書きしますか？`)) return;
    list[selectedCue].scene = clone(pvw);
    saveCues(list);
}

function moveCue(d) {
    const list = clone(cues());
    const to = selectedCue + d;
    if (!list[selectedCue] || to < 0 || to >= list.length) return;
    [list[selectedCue], list[to]] = [list[to], list[selectedCue]];
    selectedCue = to;
    // いま出しているキューの番号も一緒に動かす
    let idx = state.cueIndex;
    if (idx === to) idx = to - d; else if (idx === to - d) idx = to;
    patch({ cues: list, cueIndex: idx });
}

function deleteCue() {
    const list = clone(cues());
    if (!list[selectedCue]) return showError("消すキューを選んでください");
    if (!confirm(`「${list[selectedCue].name}」を消しますか？`)) return;
    list.splice(selectedCue, 1);
    let idx = state.cueIndex;
    if (idx === selectedCue) idx = -1; else if (idx > selectedCue) idx--;
    selectedCue = Math.min(selectedCue, list.length - 1);
    patch({ cues: list, cueIndex: idx });
}

function editCue(changes) {
    const list = clone(cues());
    if (!list[selectedCue]) return;
    Object.assign(list[selectedCue], changes);
    saveCues(list);
}

function loadCueToPvw(i) {
    const c = cues()[i];
    if (!c) return;
    selectedCue = i;
    pvw = clone(c.scene);
    if (!LAYOUT_SLOTS[pvw.layout].includes(selectedSlot)) selectedSlot = LAYOUT_SLOTS[pvw.layout][0];
    pvwChanged({ noAuto: true });
    renderCues();
}

// キューが出されたとき（このPCのボタン・Stream Deck どちらでも）：曲を鳴らし、次のキューをプレビューに用意する
function onCueFired(index) {
    const c = cues()[index];
    if (c && c.music.action === "play" && c.music.path) playMusicPath(c.music.path, c.music.name);
    else if (c && c.music.action === "stop") musicStop();
    if (cues()[index + 1]) loadCueToPvw(index + 1);
    else { selectedCue = index; renderCues(); }
}

function exportCues() {
    const blob = new Blob([JSON.stringify(cues(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `式次第_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importCues(file) {
    if (!file) return;
    let list;
    try {
        list = JSON.parse(await file.text());
        if (!Array.isArray(list)) throw new Error("式次第のファイルではありません");
    } catch (e) {
        return showError(`読み込めませんでした：${e.message}`);
    }
    if (cues().length && !confirm(`いまの式次第（${cues().length}個）を、ファイルの内容（${list.length}個）に置き換えますか？`)) return;
    selectedCue = -1;
    if (await patch({ cues: list, cueIndex: -1 })) showInfo(`${list.length}個のキューを読み込みました`);
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
    $("#btn-black").addEventListener("click", () => control("black"));

    // OBSに入れる（ドラッグ＆ドロップ／アドレスのコピー）※得点板システムと同じ
    const drag = $("#obs-drag");
    drag.href = OBS_URL;
    drag.addEventListener("click", e => {
        e.preventDefault();
        showInfo("このボタンを、クリックではなくOBSの画面へドラッグ＆ドロップしてください。");
    });
    drag.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/uri-list", OBS_URL);
        e.dataTransfer.setData("text/plain", OBS_URL);
    });
    $("#btn-copy-url").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(OBS_URL);
            showInfo("アドレスをコピーしました。OBSのブラウザソースのURL欄に貼り付けてください（幅3840・高さ1080）。");
        } catch (e) {
            showError(`コピーできませんでした。次のアドレスを手で入力してください：${OBS_URL}`);
        }
    });

    $$("#layout-seg button").forEach(b => b.addEventListener("click", () => setLayout(b.dataset.layout)));
    $$("[data-singlex]").forEach(b => b.addEventListener("click", () => setSingleX(b.dataset.singlex)));
    $("#single-x").addEventListener("input", e => setSingleX(e.target.value));
    $("#slot-seg").addEventListener("click", e => { const b = e.target.closest("[data-slot]"); if (b) selectSlot(b.dataset.slot); });
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

    $$("#tabs button").forEach(b => b.addEventListener("click", () => {
        $$("#tabs button").forEach(x => x.classList.toggle("on", x === b));
        $$(".tab-body").forEach(t => t.classList.toggle("hidden", t.id !== `tab-${b.dataset.tab}`));
    }));

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

    // 式次第
    $("#btn-cue-next").addEventListener("click", () => control("next"));
    $("#btn-cue-add").addEventListener("click", addCue);
    $("#btn-cue-overwrite").addEventListener("click", overwriteCue);
    $$("[data-cue-move]").forEach(b => b.addEventListener("click", () => moveCue(Number(b.dataset.cueMove))));
    $("#btn-cue-delete").addEventListener("click", deleteCue);
    $("#btn-cue-export").addEventListener("click", exportCues);
    $("#btn-cue-import").addEventListener("click", () => $("#cue-file").click());
    $("#cue-file").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; importCues(f); });
    $("#cue-list").addEventListener("click", e => {
        const go = e.target.closest("[data-go]");
        if (go) return control("cue", Number(go.dataset.go) + 1);
        const r = e.target.closest(".cue-row");
        if (r) loadCueToPvw(Number(r.dataset.i));
    });
    $("#cue-name").addEventListener("change", e => editCue({ name: e.target.value.trim().slice(0, 100) }));
    $("#cue-memo").addEventListener("change", e => editCue({ memo: e.target.value.slice(0, 1000) }));
    $("#cue-music-action").addEventListener("change", e => {
        const c = cues()[selectedCue];
        const music = e.target.value === "play" ? clone(c.music) : { action: e.target.value, path: "", name: "" };
        music.action = e.target.value;
        if (music.action === "play" && !music.path) {
            // 曲を選ぶまでは保存しない（曲のない「鳴らす」は保存できないため）
            $("#cue-music-path").classList.remove("hidden");
            return showInfo("鳴らす曲を選んでください");
        }
        editCue({ music });
    });
    $("#cue-music-path").addEventListener("change", e => {
        const sel = e.target;
        if (!sel.value) return;
        editCue({ music: { action: "play", path: sel.value, name: sel.options[sel.selectedIndex].text.slice(0, 300) } });
    });

    // 設定
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
    reloadMonitors();
    renderControls();
    renderOverlay();
    connect();
    loadSlides().catch(e => showError(`${e.message}。サーバーが起動しているか確認してください`));
    loadPlayerMedia().catch(e => showError(e.message));
    loadWalkups().catch(e => showError(e.message));
    loadPhotoTeams().catch(() => {});
    refreshDevices(false).catch(() => {});
}

init();
