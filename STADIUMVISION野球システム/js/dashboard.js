/* ==========================================================================
   スタジアムビジョン野球システム - 管理画面（OBS型：シーン＋レイヤー）
   - 左：シーン（クリック＝PREVIEW、ダブルクリック＝本線へ）／中央：PREVIEW・TAKE・PROGRAM／右：レイヤー
   - シーン ＝ レイヤー（画像・カメラ・色・文字・ロゴ・動画）を下から重ねたもの。位置・大きさは帯に対する割合
   - PREVIEW で直したシーンは、すぐ保存される。TAKE で本線（PROGRAM）に出す（本線はシーンのコピー）
   - 音楽は music_admin.js の音楽バーで鳴らす。シーンの「音」（曲・フェード・停止・小さく）は TAKE のときに動く
   - 台本（Excel）は［台本から作る］でシーンにする。設定は ⚙ のダイアログ
   ========================================================================== */

const SCN = SceneCore;
const SC = ScriptCore;
const ALWAYS = SCN.ALWAYS_GROUP;
const PREF_KEY = "stadiumvision-baseball.prefs";
const PREF_CHECKS = ["opt-live-program", "opt-monitor-cam"];
// OBSに入れる表示画面のアドレス（layer-width / layer-height は、OBSにドラッグしたときのブラウザソースの大きさ）
// camera=obs：カメラの枠を透明にする（キャプチャーボードはOBSの「映像キャプチャデバイス」で下に敷く）
function obsUrl() { return `${location.origin}/vision.html?camera=obs&layer-width=${isSdi() ? 1920 : 3840}&layer-height=1080`; }

let state = null;
let slides = [];
let slidesVer = 0;
const aspectMap = {};          // スライドの場所 → 横÷縦
let videoDevices = [];
const layerSel = {};           // シーンの番号 → 選んでいるレイヤーの番号
let renaming = "";             // 名前を直しているシーンの番号
let pvwKey = "";

// --------------------------------------------------------------------------
// このPCに覚えさせる設定（チェックボックスなど）
// --------------------------------------------------------------------------
function readLocal(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
}
function writeLocal(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn("設定を保存できませんでした", e); }
}
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
            return false;
        }
        return true;
    } catch (e) {
        showError(SERVER_NG);
        return false;
    }
}

// シーンの編集は、手元の state をすぐ変えて画面を更新し、少しまとめてからサーバーへ保存する（ドラッグ中も間引く）
let saveTimer = null;
let savePending = 0;
let saveChain = Promise.resolve(true);
const saveKeys = new Set();
const saving = () => !!saveTimer || savePending > 0 || saveKeys.size > 0;

function queueSave(keys, delay) {
    keys.forEach(k => saveKeys.add(k));
    if (saveTimer) return;
    saveTimer = setTimeout(flushSave, delay === undefined ? 90 : delay);
}
function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!saveKeys.size || !state) return saveChain;
    const body = {};
    saveKeys.forEach(k => { body[k] = state[k]; });
    saveKeys.clear();
    // 本線に出ているシーンを直したら、設定によっては本線にもすぐ反映
    const cur = body.scenes && byId(state.preview);
    if (cur && $("#opt-live-program").checked && state.program.sceneId === cur.id && !state.futa.active) {
        body.program = SCN.programFromScene(cur, logos());
    }
    savePending++;
    saveChain = saveChain.then(() => patch(body)).finally(() => { savePending--; });
    return saveChain;
}

// --------------------------------------------------------------------------
// 状態の読み出し
// --------------------------------------------------------------------------
const scenes = () => (state ? state.scenes : []);
const byId = id => scenes().find(s => s.id === id) || null;
const curScene = () => (state ? byId(state.preview) : null);
const stage = () => SCN.stageOf(state && state.output);
const isSdi = () => !!(state && state.output && state.output.mode === "sdi");
const logos = () => ({ left: SC.resolveLogo(state && state.futa, "left", slides), full: SC.resolveLogo(state && state.futa, "full", slides), lid: SCN.findLid(state && state.lidImage, slides), lidOn: !state || state.lid !== false });
const baseName = p => String(p || "").split("/").pop();
const mediaUrl = p => String(p).split("/").map(encodeURIComponent).join("/");
const thumbUrl = p => `${mediaUrl(p)}?v=${slidesVer}`;
const oneLine = t => String(t || "").replace(/\s*\n\s*/g, " ");
const orderIds = () => (state ? state.sceneOrder : []);
const bgmOn = () => !!(state && state.bgmEnabled);
const flowIndexOf = id => SCN.flowIds(state).indexOf(id);

function curLayer() {
    const sc = curScene();
    if (!sc || !sc.layers.length) return null;
    const id = layerSel[sc.id];
    // 何も選んでいないときは、いちばん上の（フタではない）レイヤー
    return sc.layers.find(l => l.id === id) || sc.layers.slice().reverse().find(l => l.type !== "lid") || sc.layers[sc.layers.length - 1];
}

// --------------------------------------------------------------------------
// モニター（PREVIEW は管理画面から送る／PROGRAM は表示画面が自分でサーバーから受け取る）
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
    const sc = curScene();
    const scene = sc ? SCN.programFromScene(sc, logos()) : { sceneId: "", name: "", layers: [] };
    if (f.contentWindow) f.contentWindow.postMessage({ type: "preview-scene", scene }, location.origin);
}

// --------------------------------------------------------------------------
// シーンのサムネイル（帯の形に、レイヤーを重ねて小さく描く）
// --------------------------------------------------------------------------
function thumbHtml(sc) {
    const lg = logos();
    const parts = [];
    (sc.layers || []).forEach(l => {
        if (!l.visible) return;
        const st = `left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;height:${l.h * 100}%;${l.opacity < 1 ? `opacity:${l.opacity};` : ""}`;
        switch (l.type) {
            case "image":
            case "logo": {
                const src = l.type === "logo" && !l.src ? (l.logo === "full" ? lg.full : lg.left) : l.src;
                parts.push(src
                    ? `<div class="tl" style="${st}"><img src="${thumbUrl(src)}" loading="lazy" alt="" style="object-fit:${l.fit}" onerror="this.remove()"></div>`
                    : `<div class="tl" style="${st}background:#222"></div>`);
                break;
            }
            case "lid": {
                if (!lg.lidOn) break;
                parts.push(lg.lid ? `<div class="tl" style="${st}"><img src="${thumbUrl(lg.lid)}" loading="lazy" alt="" style="object-fit:cover" onerror="this.remove()"></div>` : `<div class="tl" style="${st}background:#000"></div>`);
                break;
            }
            case "video": parts.push(`<div class="tl" style="${st}background:#2b1b4e;color:#c4b5fd;font-size:12px">動画</div>`); break;
            case "camera": parts.push(`<div class="tl tl-camera" style="${st}">CAM</div>`); break;
            case "color": parts.push(`<div class="tl" style="${st}background:${escapeHtml(l.color)}"></div>`); break;
            case "text": parts.push(`<div class="tl tl-text" style="${st}">${escapeHtml(oneLine(l.text).slice(0, 24))}</div>`); break;
            case "test": parts.push(`<div class="tl tl-test" style="${st}"></div>`); break;
        }
    });
    // 「当日に選ぶ」シーンは、まだ画像を選んでいない間、サムネイルの位置に「＋選ぶ」
    if (sc.pick && !(sc.layers || []).some(l => l.visible && (l.type === "image" || l.type === "video"))) {
        parts.push(`<div class="pickmark" data-pick="${escapeHtml(sc.id)}">＋選ぶ</div>`);
    }
    return parts.join("");
}

function soundBadge(sc) {
    const b = bgmOn() ? sc.bgm : null;
    const out = [];
    const warn = bgmOn() ? sc.warn : String(sc.warn || "").split(" ／ ").filter(x => !/^曲が見つかりません/.test(x)).join(" ／ ");
    if (b) out.push(b.action === "play" ? `<span class="badge" title="曲：${escapeHtml(b.name)}${b.loop ? "（くり返し）" : ""}">♪</span>` : b.action === "fade" ? `<span class="badge" title="BGMをフェードアウト">♪↘</span>` : `<span class="badge" title="BGMを止める">■</span>`);
    if (bgmOn() && sc.duck === true) out.push(`<span class="badge" title="BGMを小さくする">小</span>`);
    else if (bgmOn() && sc.duck === false) out.push(`<span class="badge" title="BGMの音量を戻す">戻</span>`);
    if (warn) out.push(`<span class="badge warn" title="${escapeHtml(warn)}">⚠</span>`);
    return out.join("");
}

// --------------------------------------------------------------------------
// シーンの一覧（左）
// --------------------------------------------------------------------------
const sceneEls = new Map();     // シーンの番号 → { el, sig }
const groupEls = new Map();     // グループ名 → 見出しの要素

function sceneInner(sc) {
    return `<div class="th">${thumbHtml(sc)}</div>` +
        (renaming === sc.id
            ? `<input class="nm-edit" type="text" maxlength="100" value="${escapeHtml(sc.name)}">`
            : `<div class="nm" title="${escapeHtml(sc.name)}">${escapeHtml(sc.name)}</div>`) +
        `<div class="badges">${soundBadge(sc)}</div>`;
}

function renderSceneList() {
    if (!state) return;
    const box = $("#sc-list");
    const lgSig = JSON.stringify(logos()) + "|" + bgmOn() + "|" + slidesVer + "|" + JSON.stringify(state.output);
    const nodes = [];
    let lastGroup = null;
    const live = new Set();
    orderIds().forEach(id => {
        const sc = byId(id);
        if (!sc) return;
        live.add(id);
        if (sc.group !== lastGroup) {
            lastGroup = sc.group;
            let g = groupEls.get(sc.group);
            if (!g) { g = document.createElement("div"); g.className = "grp"; g.textContent = sc.group || "（グループなし）"; g.dataset.group = sc.group; groupEls.set(sc.group, g); }
            nodes.push(g);
        }
        let rec = sceneEls.get(id);
        if (!rec) {
            const el = document.createElement("div");
            el.className = "scene";
            el.dataset.id = id;
            el.draggable = true;
            rec = { el, sig: "" };
            sceneEls.set(id, rec);
        }
        const sig = JSON.stringify([sc.name, sc.layers, sc.bgm, sc.duck, sc.pick, sc.warn]) + lgSig + (renaming === id ? "R" : "");
        if (rec.sig !== sig) {
            rec.sig = sig;
            rec.el.innerHTML = sceneInner(sc);
            if (renaming === id) { const inp = rec.el.querySelector(".nm-edit"); if (inp) { inp.focus(); inp.select(); } }
        }
        nodes.push(rec.el);
    });
    [...sceneEls.keys()].forEach(id => { if (!live.has(id)) sceneEls.delete(id); });
    const used = new Set(nodes.filter(n => n.dataset.group !== undefined).map(n => n.dataset.group));
    [...groupEls.keys()].forEach(g => { if (!used.has(g)) groupEls.delete(g); });
    const cur = [...box.children];
    if (cur.length !== nodes.length || cur.some((c, i) => c !== nodes[i])) {
        const top = box.scrollTop;
        box.replaceChildren(...nodes);
        box.scrollTop = top;
    }
    renderSceneMarks();
}

// 本線＝赤枠、PREVIEW＝緑枠
function renderSceneMarks() {
    const pv = state.preview, pg = state.program.sceneId;
    sceneEls.forEach((rec, id) => {
        rec.el.classList.toggle("pvw", id === pv);
        rec.el.classList.toggle("pgm", id === pg);
    });
}

function scrollSceneIntoView() {
    const rec = sceneEls.get(state.preview);
    if (rec) rec.el.scrollIntoView({ block: "nearest" });
}

// ---- 選ぶ・出す ----
function selectScene(id, opts = {}) {
    if (!state || !byId(id)) return;
    if (state.preview !== id) {
        state.preview = id;
        queueSave(["preview"], 120);
    }
    renderAll();
    if (opts.scroll) scrollSceneIntoView();
}

function moveSel(d) {
    const ids = orderIds();
    if (!ids.length) return;
    const i = ids.indexOf(state.preview);
    const n = ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i + d)))];
    if (n !== state.preview) selectScene(n, { scroll: true });
}

// TAKE：PREVIEW のシーンを本線へ（直した内容を保存してから）。BGM などの「音」は、出たときの合図（CUE_FIRED）で動く
async function doTake() {
    const sc = curScene();
    if (!sc) return showError("出すシーンがありません。左のシーンを選んでください");
    await flushSave();
    const ok = await control("scene", sc.id);
    if (!ok) return;
    const b = $("#btn-take");
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
}
const scNext = () => control("next");
const scPrev = () => control("prev");
function nextSceneToPreview() {
    const ids = orderIds();
    const base = state.program.sceneId && ids.includes(state.program.sceneId) ? state.program.sceneId : state.preview;
    const i = ids.indexOf(base);
    const n = ids[i + 1];
    if (!n) return showError("次のシーンがありません");
    selectScene(n, { scroll: true });
}

// シーンが出されたとき（このPCのボタン・Stream Deck・HTTP どれでも）：音を動かす
function onSceneFired(ev) {
    const sc = byId(ev.sceneId);
    if (sc && !ev.silent) runSceneAudio(sc);
}

// シーンの音：BGM（鳴らす／フェードアウト／止める）と「小さく」
function runSceneAudio(sc) {
    if (!bgmOn()) return;       // BGMをこのシステムで鳴らさない設定
    const b = sc.bgm;
    if (b && b.action === "play") {
        if (musicCur && musicCur.item.path === b.path) {      // すでに同じ曲が鳴っていれば、二重に鳴らさない
            if (typeof sc.duck === "boolean") musicDuckSet(sc.duck);
            return;
        }
        musicDuckSet(sc.duck === true, true);                 // 曲を新しく鳴らすときは、小さく指定が無ければふつうの音量
        playMusicPath(b.path, b.name, { loop: b.loop });
        return;
    }
    if (b && b.action === "fade") musicFade();
    else if (b && b.action === "stop") musicHalt();
    if (typeof sc.duck === "boolean") musicDuckSet(sc.duck);
}

// 曲は場所で探し、見つからなければ名前で探す（曲のフォルダを選び直したときのため）
function playMusicPath(p, label, opts) {
    const found = typeof musicList !== "undefined" && (musicList.find(m => m.path === p) || (label && musicList.find(m => SC.norm(m.name) === SC.norm(label))));
    // 別フォルダの曲（local:）は、そのフォルダを選んでいないと鳴らせない
    if (!found && /^local:/.test(p)) return showError(`曲が見つかりません（${label || p}）。音楽バーの「曲のフォルダ」で、この曲の入ったフォルダを選んでください`);
    musicPlay(found || { path: p, no: null, name: label || baseName(p).replace(/\.[^.]+$/, "") }, opts);
}

// --------------------------------------------------------------------------
// シーンを足す・複製・消す・名前・並べ替え
// --------------------------------------------------------------------------
function newSceneObj(name, group, layers) {
    return { id: SCN.uid("s"), name, group, layers: layers || [], bgm: null, duck: null, pick: null, script: null, warn: "" };
}
function insertSceneAfter(sc, afterId) {
    state.scenes.push(sc);
    const i = state.sceneOrder.indexOf(afterId);
    state.sceneOrder.splice(i >= 0 ? i + 1 : state.sceneOrder.length, 0, sc.id);
}
function addScene() {
    const cur = curScene();
    const sc = newSceneObj(`シーン${state.scenes.length + 1}`, cur ? cur.group : "シーン", []);
    insertSceneAfter(sc, cur ? cur.id : "");
    state.preview = sc.id;
    queueSave(["scenes", "sceneOrder", "preview"], 0);
    renderAll();
    scrollSceneIntoView();
}
function duplicateScene() {
    const cur = curScene();
    if (!cur) return;
    const sc = clone(cur);
    sc.id = SCN.uid("s");
    sc.name = `${cur.name} コピー`.slice(0, 100);
    sc.script = null;
    const idMap = {};
    sc.layers.forEach(l => { const n = SCN.uid("l"); idMap[l.id] = n; l.id = n; });
    sc.layers.forEach(l => { if (l.lidFor) l.lidFor = idMap[l.lidFor] || l.lidFor; });
    insertSceneAfter(sc, cur.id);
    state.preview = sc.id;
    queueSave(["scenes", "sceneOrder", "preview"], 0);
    renderAll();
    scrollSceneIntoView();
}
function deleteScene() {
    const cur = curScene();
    if (!cur) return;
    if (!confirm(`シーン「${cur.name}」を消しますか？（元に戻せません）`)) return;
    const ids = orderIds();
    const i = ids.indexOf(cur.id);
    state.scenes = state.scenes.filter(s => s.id !== cur.id);
    state.sceneOrder = ids.filter(x => x !== cur.id);
    state.preview = state.sceneOrder[Math.min(i, state.sceneOrder.length - 1)] || "";
    if (state.cursor === cur.id) state.cursor = "";
    queueSave(["scenes", "sceneOrder", "preview", "cursor"], 0);
    renderAll();
}

function startRename(id) {
    if (!byId(id)) return;
    renaming = id;
    renderSceneList();
}
function finishRename(commitIt, value) {
    const id = renaming;
    renaming = "";
    const sc = byId(id);
    if (sc && commitIt) {
        const v = String(value || "").trim().slice(0, 100);
        if (v && v !== sc.name) { sc.name = v; queueSave(["scenes"]); }
    }
    renderAll();
}

function renameGroup(id) {
    const sc = byId(id);
    if (!sc) return;
    const v = prompt("このシーンのグループ名（同じ名前のシーンが1つにまとまります）", sc.group);
    if (v === null) return;
    sc.group = v.trim().slice(0, 60);
    queueSave(["scenes"], 0);
    renderAll();
}

// ドラッグで並べ替え（別のグループの上に落とすと、そのグループに移る）
let dragSceneId = "";
function moveScene(id, targetId, after, group) {
    const order = state.sceneOrder.filter(x => x !== id);
    let at = order.indexOf(targetId);
    if (at < 0) at = order.length; else if (after) at++;
    order.splice(at, 0, id);
    state.sceneOrder = order;
    const sc = byId(id);
    if (sc && group !== undefined) sc.group = group;
    queueSave(["scenes", "sceneOrder"], 0);
    renderAll();
}

// 右クリックのメニュー
function showCtx(x, y, items) {
    const m = $("#ctx");
    m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? "danger" : ""}">${escapeHtml(it.label)}</button>`).join("");
    m.classList.remove("hidden");
    m.style.left = Math.min(x, window.innerWidth - 210) + "px";
    m.style.top = Math.min(y, window.innerHeight - items.length * 40 - 10) + "px";
    m._items = items;
}
const hideCtx = () => $("#ctx").classList.add("hidden");

function bindScenes() {
    const box = $("#sc-list");
    box.addEventListener("click", e => {
        const pm = e.target.closest("[data-pick]");
        const el = e.target.closest(".scene");
        if (!el || e.target.closest(".nm-edit")) return;
        selectScene(el.dataset.id);
        if (pm) openPickerForPick(el.dataset.id);
    });
    box.addEventListener("dblclick", e => {
        const el = e.target.closest(".scene");
        if (!el || e.target.closest(".nm-edit") || e.target.closest("[data-pick]")) return;
        selectScene(el.dataset.id);
        doTake();
    });
    box.addEventListener("contextmenu", e => {
        const el = e.target.closest(".scene");
        if (!el) return;
        e.preventDefault();
        selectScene(el.dataset.id);
        showCtx(e.clientX, e.clientY, [
            { label: "名前を変える（F2）", run: () => startRename(el.dataset.id) },
            { label: "グループを変える…", run: () => renameGroup(el.dataset.id) },
            { label: "複製", run: duplicateScene },
            { label: "消す", danger: true, run: deleteScene }
        ]);
    });
    box.addEventListener("keydown", e => {
        if (!e.target.classList.contains("nm-edit")) return;
        if (e.key === "Enter") { e.preventDefault(); finishRename(true, e.target.value); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishRename(false); }
    });
    box.addEventListener("focusout", e => {
        if (e.target.classList.contains("nm-edit") && renaming) finishRename(true, e.target.value);
    });
    // 並べ替え
    box.addEventListener("dragstart", e => {
        const el = e.target.closest(".scene");
        if (!el) return;
        dragSceneId = el.dataset.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragSceneId);
    });
    const clearMarks = () => $$(".scene.dragover-top, .scene.dragover-bottom").forEach(x => x.classList.remove("dragover-top", "dragover-bottom"));
    box.addEventListener("dragover", e => {
        if (!dragSceneId) return;
        const el = e.target.closest(".scene");
        const g = e.target.closest(".grp");
        if (!el && !g) return;
        e.preventDefault();
        clearMarks();
        if (el) {
            const r = el.getBoundingClientRect();
            el.classList.add(e.clientY < r.top + r.height / 2 ? "dragover-top" : "dragover-bottom");
        }
    });
    box.addEventListener("dragleave", e => { if (!box.contains(e.relatedTarget)) clearMarks(); });
    box.addEventListener("drop", e => {
        if (!dragSceneId) return;
        e.preventDefault();
        clearMarks();
        const el = e.target.closest(".scene");
        const g = e.target.closest(".grp");
        const id = dragSceneId;
        dragSceneId = "";
        if (el && el.dataset.id !== id) {
            const r = el.getBoundingClientRect();
            const t = byId(el.dataset.id);
            moveScene(id, el.dataset.id, e.clientY >= r.top + r.height / 2, t ? t.group : undefined);
        } else if (g) {
            const first = state.sceneOrder.find(x => { const s = byId(x); return s && s.group === g.dataset.group && x !== id; });
            moveScene(id, first || "", false, g.dataset.group);
        }
    });
    box.addEventListener("dragend", () => { dragSceneId = ""; clearMarks(); });

    $("#ctx").addEventListener("click", e => {
        const b = e.target.closest("[data-i]");
        if (!b) return;
        const it = $("#ctx")._items[Number(b.dataset.i)];
        hideCtx();
        if (it) it.run();
    });
    document.addEventListener("mousedown", e => { if (!e.target.closest("#ctx")) hideCtx(); });
    $("#btn-sc-add").addEventListener("click", addScene);
    $("#btn-sc-dup").addEventListener("click", duplicateScene);
    $("#btn-sc-del").addEventListener("click", deleteScene);
    $("#btn-sc-script").addEventListener("click", openScriptDialog);
}

// --------------------------------------------------------------------------
// レイヤー（右）
// --------------------------------------------------------------------------
// シーンの中身を直したあとの再描画（手元の state はもう変えてある。保存は少しまとめてから）
function edited(keys) {
    const cs = curScene();
    if (cs) SCN.normalizeLids(cs.layers);      // カメラのフタは、カメラの上に同じ位置・大きさで付いてくる
    queueSave(keys || ["scenes"]);
    renderSceneList();
    renderLayers();
    renderOverlay();
    postPvw();
}
function mutLayer(fn) {
    const l = curLayer();
    if (!l) return;
    fn(l);
    edited();
}

function renderLayers() {
    const sc = curScene();
    $("#ly-scene").textContent = sc ? sc.name : "—";
    const list = $("#ly-list");
    const sel = curLayer();
    if (!sc) {
        list.innerHTML = `<div class="empty">シーンがありません。左の［＋］で作ります</div>`;
    } else if (!sc.layers.length) {
        list.innerHTML = `<div class="empty">レイヤーがありません。下の「レイヤーを足す」から入れます</div>`;
    } else {
        // 上が手前（配列は下から順なので、逆に並べる）
        list.innerHTML = sc.layers.slice().reverse().map(l => l.type === "lid" ? `
            <div class="layer ${l.id === (sel && sel.id) ? "on" : ""} ${state.lid ? "" : "hid"}" data-lid="${escapeHtml(l.id)}">
                <span class="eye" data-eye="1" title="全体のスイッチ（上の「カメラのフタ」ボタン）で切り替えます">${state.lid ? "👁" : "－"}</span>
                <span class="lb">🔒 カメラのフタ（上のボタンで切替）</span>
            </div>` : `
            <div class="layer ${l.id === (sel && sel.id) ? "on" : ""} ${l.visible ? "" : "hid"}" data-lid="${escapeHtml(l.id)}" draggable="true">
                <span class="eye" data-eye="1" title="${l.visible ? "隠す" : "表示する"}">${l.visible ? "👁" : "－"}</span>
                <span class="lb">${SCN.LAYER_ICONS[l.type] || ""} ${escapeHtml(SCN.layerLabel(l))}</span>
                <span class="grip" title="ドラッグで重なり順を変える">⋮⋮</span>
            </div>`).join("");
    }
    renderDetail(sc, sel);
    // 置き場所
    const pre = sel ? SCN.presetOf(sel, stage()) : "";
    $$("#ly-preset button").forEach(b => { b.disabled = !sel || sel.type === "lid"; b.classList.toggle("on", b.dataset.preset === pre); });
    $$("#ly-add button").forEach(b => { b.disabled = !sc; });
    renderSound();
}

function renderDetail(sc, l) {
    const box = $("#ly-detail");
    if (!l) { box.innerHTML = `<span class="dl">レイヤーを選ぶと、細かい設定が出ます</span>`; box._lid = ""; box._html = ""; return; }
    // 入力欄・スライダーを操作している最中は、作り直さない（入力が途切れないように）
    if (box.contains(document.activeElement) && box._lid === l.id && box._type === l.type) return;
    box._lid = l.id;
    box._type = l.type;
    if (l.type === "lid") { box._html = ""; box.innerHTML = `<span class="dl">全体のスイッチは上の「カメラのフタ」ボタン。このシーンだけ外すときは削除</span><button type="button" data-d="del" class="del">削除</button>`; return; }
    const fitable = ["image", "video", "camera", "logo"].includes(l.type);
    let h = "";
    if (l.type === "camera") h += `<button type="button" data-d="cam1" class="${l.cam === "cam1" ? "on" : ""}">カメラ1</button><button type="button" data-d="cam2" class="${l.cam === "cam2" ? "on" : ""}">カメラ2</button>`;
    if (l.type === "image" || l.type === "video") h += `<button type="button" data-d="replace">差し替え</button>`;
    if (l.type === "logo") h += `<button type="button" data-d="logo-left" class="${l.logo === "left" ? "on" : ""}" title="左フタの画像">左用</button><button type="button" data-d="logo-full" class="${l.logo === "full" ? "on" : ""}" title="全面フタの画像">全面用</button>`;
    if (l.type === "color") h += `<span class="dl">色</span><input type="color" data-d="color" value="${escapeHtml(l.color)}">`;
    if (l.type === "text") h += `<input type="text" data-d="text" maxlength="300" value="${escapeHtml(l.text)}" placeholder="文字（{HR} はHR競争の本数）"><span class="dl">色</span><input type="color" data-d="textcolor" value="${escapeHtml(l.color || "#ffffff")}">`;
    if (fitable) h += `<button type="button" data-d="fit-cover" class="${l.fit === "cover" ? "on" : ""}" title="枠いっぱいに出し、はみ出た所を切り取る">枠いっぱい</button><button type="button" data-d="fit-contain" class="${l.fit === "contain" ? "on" : ""}" title="素材の全体を出す（すき間は透明）">全体を出す</button>`;
    h += `<span class="dl">不透明度</span><input type="range" data-d="opacity" min="0" max="100" step="5" value="${Math.round(l.opacity * 100)}">`;
    h += `<button type="button" data-d="del" class="del" title="このレイヤーを消します（Deleteキー）">削除</button>`;
    if (box._html !== h) { box._html = h; box.innerHTML = h; }
}

function setPreset(name) {
    const l = curLayer();
    if (!l) return;
    const r = SCN.presets(stage())[name];
    Object.assign(l, { x: r.x, y: r.y, w: r.w, h: r.h });
    edited();
}

function addLayer(type, opts, rectOverride) {
    const sc = curScene();
    if (!sc) return showError("先にシーンを作ってください（左の［＋］）");
    if (sc.layers.length >= 40) return showError("レイヤーは40個までです");
    const rect = rectOverride || SCN.defaultRect(sc.layers, type, stage());
    const l = SCN.newLayer(type, opts, rect);
    sc.layers.push(l);
    layerSel[sc.id] = l.id;
    edited();
}

async function deleteLayer() {
    const sc = curScene(), l = curLayer();
    if (!sc || !l) return;
    if (!confirm(l.type === "lid" ? "このシーンのカメラのフタを外します（このシーンだけ。付け直しません）。よろしいですか？" : `レイヤー「${SCN.layerLabel(l)}」を消しますか？`)) return;
    // フタを手で消したら、そのカメラには付け直さない（このシーンだけ）
    if (l.type === "lid") { const c = sc.layers.find(x => x.id === l.lidFor); if (c) c.noLid = true; }
    sc.layers = sc.layers.filter(x => x.id !== l.id);
    delete layerSel[sc.id];
    edited();
}

// 左と右を入れ替える（すべてのレイヤーを左右反転）
function swapSides() {
    const sc = curScene();
    if (!sc) return;
    sc.layers.forEach(l => { l.x = Math.max(-1, Math.min(2, 1 - l.x - l.w)); });
    edited();
}

function onAddClick(kind) {
    switch (kind) {
        case "image": return openPicker({ kinds: ["image"], title: "画像を選ぶ", onPick: (p, img) => addPickedMedia("image", p, img) });
        case "video": return openPicker({ kinds: ["video"], title: "動画を選ぶ", onPick: p => addPickedMedia("video", p) });
        case "camera": return addLayer("camera", { cam: "cam1" });
        case "color": return addLayer("color", { color: "#1e3a8a" });
        case "logo": {
            const sc = curScene();
            const rect = sc ? SCN.defaultRect(sc.layers, "logo", stage()) : null;
            return addLayer("logo", { src: "", logo: rect && rect.w > 0.75 ? "full" : "left" });
        }
        case "text": {
            addLayer("text", { text: "文字を入れてください", color: "#ffffff" });
            const inp = $('#ly-detail [data-d="text"]');
            if (inp) { inp.focus(); inp.select(); }
        }
    }
}

// 選んだ画像・動画をレイヤーにする（全面（14:5）の画像は全面に、そうでなければ空いている半分に）
function addPickedMedia(type, path, img) {
    const rect = type === "image" && isWideSlide(path, img) ? SCN.presets(stage()).full : null;
    addLayer(type, { src: path }, rect || undefined);
}

function bindLayers() {
    const list = $("#ly-list");
    list.addEventListener("click", e => {
        const row = e.target.closest(".layer");
        const sc = curScene();
        if (!row || !sc) return;
        if (e.target.closest("[data-eye]")) {
            const l = sc.layers.find(x => x.id === row.dataset.lid);
            if (l && l.type === "lid") { control("lid"); return; }
            if (l) { l.visible = !l.visible; edited(); }
            return;
        }
        layerSel[sc.id] = row.dataset.lid;
        renderLayers();
        renderOverlay();
    });
    // 重なり順のドラッグ
    let dragId = "";
    const clearMarks = () => $$(".layer.dragover-top, .layer.dragover-bottom").forEach(x => x.classList.remove("dragover-top", "dragover-bottom"));
    list.addEventListener("dragstart", e => {
        const row = e.target.closest(".layer");
        if (!row) return;
        dragId = row.dataset.lid;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId);
    });
    list.addEventListener("dragover", e => {
        const row = e.target.closest(".layer");
        if (!dragId || !row) return;
        e.preventDefault();
        clearMarks();
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY < r.top + r.height / 2 ? "dragover-top" : "dragover-bottom");
    });
    list.addEventListener("dragleave", e => { if (!list.contains(e.relatedTarget)) clearMarks(); });
    list.addEventListener("drop", e => {
        const row = e.target.closest(".layer");
        const sc = curScene();
        if (!dragId || !row || !sc) return;
        e.preventDefault();
        clearMarks();
        const id = dragId;
        dragId = "";
        if (row.dataset.lid === id) return;
        const r = row.getBoundingClientRect();
        const topHalf = e.clientY < r.top + r.height / 2;       // 表示の上（手前）に入れるか
        const moving = sc.layers.find(l => l.id === id);
        const rest = sc.layers.filter(l => l.id !== id);
        const t = rest.findIndex(l => l.id === row.dataset.lid);
        rest.splice(topHalf ? t + 1 : t, 0, moving);
        sc.layers = rest;
        layerSel[sc.id] = id;
        edited();
    });
    list.addEventListener("dragend", () => { dragId = ""; clearMarks(); });

    $("#ly-preset").addEventListener("click", e => { const b = e.target.closest("[data-preset]"); if (b) setPreset(b.dataset.preset); });
    $("#ly-add").addEventListener("click", e => { const b = e.target.closest("[data-add]"); if (b) onAddClick(b.dataset.add); });

    const det = $("#ly-detail");
    det.addEventListener("click", e => {
        const b = e.target.closest("button[data-d]");
        if (!b) return;
        const k = b.dataset.d;
        if (k === "del") return deleteLayer();
        if (k === "replace") {
            const l = curLayer();
            return openPicker({ kinds: [l.type], title: "差し替える素材を選ぶ", onPick: p => mutLayer(x => { x.src = p; }) });
        }
        mutLayer(l => {
            if (k === "cam1" || k === "cam2") l.cam = k;
            else if (k === "fit-cover") l.fit = "cover";
            else if (k === "fit-contain") l.fit = "contain";
            else if (k === "logo-left") { l.logo = "left"; l.src = ""; }
            else if (k === "logo-full") { l.logo = "full"; l.src = ""; }
        });
    });
    det.addEventListener("input", e => {
        const t = e.target;
        const k = t.dataset.d;
        const l = curLayer();
        if (!l) return;
        // 入力中は、詳細欄を作り直さない（入力欄を閉じないため）
        const quiet = fn => { fn(l); queueSave(["scenes"]); renderSceneList(); renderOverlay(); postPvw(); };
        if (k === "opacity") quiet(x => { x.opacity = Number(t.value) / 100; });
        else if (k === "color") quiet(x => { x.color = t.value; });
        else if (k === "textcolor") quiet(x => { x.color = t.value; });
        else if (k === "text") { const v = t.value.slice(0, 300); if (v) quiet(x => { x.text = v; }); }
    });
    $("#ly-scene").addEventListener("dblclick", () => { const sc = curScene(); if (sc) startRename(sc.id); });
}

// --------------------------------------------------------------------------
// このシーンの音（変えない／曲を選ぶ／フェード／停止／小さく／戻す）
// --------------------------------------------------------------------------
let soundKey = "";
function renderSound() {
    const sc = curScene();
    const b = sc && sc.bgm;
    const on = {
        none: !!sc && !b && sc.duck === null,
        song: !!b && b.action === "play",
        fade: !!b && b.action === "fade",
        stop: !!b && b.action === "stop",
        duck: !!sc && sc.duck === true,
        unduck: !!sc && sc.duck === false
    };
    $$("#sn-sound button").forEach(btn => { btn.disabled = !sc; btn.classList.toggle("on", !!on[btn.dataset.snd]); });
    $("#sn-now").textContent = b && b.action === "play" ? b.name : "";
    const loopWrap = $("#sn-loop-wrap");
    loopWrap.classList.toggle("hidden", !(b && b.action === "play"));
    $("#sn-loop").checked = !!(b && b.action === "play" && b.loop);
    const songs = $("#sn-songs");
    if (!songs.classList.contains("hidden")) {
        const key = musicList.map(m => m.path).join("|") + "|" + (b && b.path);
        if (key !== soundKey) {
            soundKey = key;
            songs.innerHTML = musicList.length
                ? musicList.map(m => `<button type="button" data-song="${escapeHtml(m.path)}" class="${b && b.path === m.path ? "on" : ""}">♪ ${escapeHtml(m.name)}</button>`).join("")
                : `<div class="empty">曲がありません（音楽バーの「曲のフォルダ」で選びます）</div>`;
        }
    }
}

function bindSound() {
    $("#sn-sound").addEventListener("click", e => {
        const btn = e.target.closest("[data-snd]");
        const sc = curScene();
        if (!btn || !sc) return;
        const k = btn.dataset.snd;
        if (k === "song") { soundKey = ""; $("#sn-songs").classList.toggle("hidden"); renderSound(); return; }
        $("#sn-songs").classList.add("hidden");
        if (k === "none") { sc.bgm = null; sc.duck = null; }
        else if (k === "fade") sc.bgm = { action: "fade" };
        else if (k === "stop") sc.bgm = { action: "stop" };
        else if (k === "duck") sc.duck = sc.duck === true ? null : true;
        else if (k === "unduck") sc.duck = sc.duck === false ? null : false;
        edited();
    });
    $("#sn-songs").addEventListener("click", e => {
        const btn = e.target.closest("[data-song]");
        const sc = curScene();
        if (!btn || !sc) return;
        const m = musicList.find(x => x.path === btn.dataset.song);
        if (!m) return;
        sc.bgm = { action: "play", path: m.path, name: String(m.name).slice(0, 300), loop: $("#sn-loop").checked || musicPrefs.loop };
        $("#sn-songs").classList.add("hidden");
        edited();
    });
    $("#sn-loop").addEventListener("change", e => {
        const sc = curScene();
        if (sc && sc.bgm && sc.bgm.action === "play") { sc.bgm.loop = e.target.checked; edited(); }
    });
}

// --------------------------------------------------------------------------
// PREVIEW の上の枠：選んだレイヤーをドラッグで動かす・角で大きさを変える（左半分・右半分・全面・中央16:9に吸着）
// --------------------------------------------------------------------------
let dragging = false;

function renderOverlay() {
    const ov = $("#ov");
    const sc = curScene();
    if (!sc) { ov.innerHTML = ""; return; }
    if (dragging) return;
    const sel = curLayer();
    ov.innerHTML = sc.layers.filter(l => l.visible && l.type !== "lid").map(l => {
        const s = sel && l.id === sel.id;
        return `<div class="ov-box ${s ? "sel" : ""}" data-lid="${escapeHtml(l.id)}" style="left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;height:${l.h * 100}%">` +
            (s ? `<i class="hd nw" data-h="nw"></i><i class="hd ne" data-h="ne"></i><i class="hd sw" data-h="sw"></i><i class="hd se" data-h="se"></i>` : "") + `</div>`;
    }).join("");
}

// 端を、候補の線（0・半分・中央16:9の端・1）に吸着させる
function snapValue(v, cands, tol) {
    let best = v, d = tol;
    cands.forEach(c => { const x = Math.abs(v - c); if (x < d) { d = x; best = c; } });
    return best;
}

function startOverlayDrag(e, layer, mode) {
    e.preventDefault();
    e.stopPropagation();
    const mon = $("#pvw-monitor").getBoundingClientRect();
    const P = SCN.presets(stage());
    const xs = [0, P.center.x, 0.5, P.center.x + P.center.w, 1];
    const ys = [0, 1];
    const TX = 0.014, TY = 0.03, MIN = 0.03;
    const o = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    const sx = e.clientX, sy = e.clientY;
    dragging = true;
    let snapEl = null;
    const move = ev => {
        const dx = (ev.clientX - sx) / mon.width, dy = (ev.clientY - sy) / mon.height;
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;      // 左・上・右・下
        if (mode === "move") {
            let nx = Math.max(0, Math.min(1 - o.w, o.x + dx)), ny = Math.max(0, Math.min(1 - o.h, o.y + dy));
            // 左端・右端（上端・下端）のうち、近いほうの吸着を使う
            const pickSnap = (v, size, cands, tol) => {
                const a = snapValue(v, cands, tol), b = snapValue(v + size, cands, tol) - size;
                const ha = a !== v, hb = b !== v;
                if (ha && hb) return Math.abs(a - v) <= Math.abs(b - v) ? a : b;
                return ha ? a : hb ? b : v;
            };
            nx = pickSnap(nx, o.w, xs, TX);
            ny = pickSnap(ny, o.h, ys, TY);
            x0 = nx; y0 = ny; x1 = nx + o.w; y1 = ny + o.h;
        } else {
            if (mode.includes("w")) x0 = snapValue(Math.max(0, Math.min(x1 - MIN, o.x + dx)), xs, TX);
            if (mode.includes("e")) x1 = snapValue(Math.min(1, Math.max(x0 + MIN, o.x + o.w + dx)), xs, TX);
            if (mode.includes("n")) y0 = snapValue(Math.max(0, Math.min(y1 - MIN, o.y + dy)), ys, TY);
            if (mode.includes("s")) y1 = snapValue(Math.min(1, Math.max(y0 + MIN, o.y + o.h + dy)), ys, TY);
        }
        layer.x = x0; layer.y = y0; layer.w = Math.max(MIN, x1 - x0); layer.h = Math.max(MIN, y1 - y0);
        // 吸着の目印（置き場所のプリセットに合ったとき）
        const pre = SCN.presetOf(layer, stage());
        if (snapEl) { snapEl.remove(); snapEl = null; }
        if (pre) {
            const r = P[pre];
            snapEl = document.createElement("div");
            snapEl.className = "ov-snap";
            snapEl.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
            snapEl.innerHTML = `<span>${SCN.PRESET_NAMES[pre]}</span>`;
            $("#ov").appendChild(snapEl);
        }
        const box = $(`#ov .ov-box[data-lid="${CSS.escape(layer.id)}"]`);
        if (box) Object.assign(box.style, { left: layer.x * 100 + "%", top: layer.y * 100 + "%", width: layer.w * 100 + "%", height: layer.h * 100 + "%" });
        const csc = curScene();
        if (csc) SCN.normalizeLids(csc.layers);
        queueSave(["scenes"]);
        postPvw();
        $$("#ly-preset button").forEach(b => b.classList.toggle("on", b.dataset.preset === pre));
    };
    const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        dragging = false;
        if (snapEl) snapEl.remove();
        edited();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
}

function bindOverlay() {
    $("#ov").addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        const sc = curScene();
        const box = e.target.closest(".ov-box");
        if (!sc || !box) return;
        const l = sc.layers.find(x => x.id === box.dataset.lid);
        if (!l) return;
        const h = e.target.closest("[data-h]");
        if (layerSel[sc.id] !== l.id) { layerSel[sc.id] = l.id; renderLayers(); renderOverlay(); }
        startOverlayDrag(e, l, h ? h.dataset.h : "move");
    });
}

// --------------------------------------------------------------------------
// 画像・動画を選ぶ（フォルダのタブ付きサムネイルのグリッド）
// --------------------------------------------------------------------------
const GROUP_ORDER = ["全面", "ロゴ", "進行", "入場", "選手"];
function slideGroup(s) {
    const segs = s.folder.split("/").filter(Boolean);
    if (segs.length && /^\d+x\d+$/.test(segs[0])) segs.shift();       // 960x686 のような大きさのフォルダは、とばす
    return segs[0] || "その他";
}
function slideGroups(kinds) {
    const set = new Set(slides.filter(s => kinds.includes(s.kind)).map(slideGroup));
    return [...set].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "ja");
    });
}
// 全面（14:5）の画像か：縦横比 2.4 以上、または 全面/ フォルダ
function isWideSlide(path, imgEl) {
    const r = imgEl && imgEl.naturalWidth ? imgEl.naturalWidth / imgEl.naturalHeight : aspectMap[path];
    if (r) return r >= 2.4;
    return /(^|\/)全面\//.test(path);
}

let picker = null;      // { kinds, title, onPick, tab, sub }
function openPicker(opts) {
    const groups = slideGroups(opts.kinds);
    let tab = groups[0] || "";
    const sub = opts.sub || "";
    if (sub) {
        const f = slides.find(s => opts.kinds.includes(s.kind) && SC.normPath(s.path).includes(SC.normPath(sub)));
        if (f) tab = slideGroup(f);
    } else if (opts.current) {
        const f = slides.find(s => s.path === opts.current);
        if (f) tab = slideGroup(f);
    } else if (groups.includes("進行")) tab = "進行";
    picker = Object.assign({}, opts, { tab, sub });
    renderPicker();
    const dlg = $("#dlg-picker");
    if (!dlg.open) dlg.showModal();
    $("#pick-grid").scrollTop = 0;
}

// 「当日に選ぶ」シーン：そのフォルダを最初に開く。選んだ画像は、シーンの画像（無ければ足す）にする
function openPickerForPick(sceneId) {
    const sc = byId(sceneId);
    if (!sc) return;
    const existing = sc.layers.find(l => l.type === "image" || l.type === "video");
    openPicker({
        kinds: ["image", "video"], title: `${sc.name} に出す画像を選ぶ`, sub: sc.pick ? sc.pick.folder : "", current: existing && existing.src,
        onPick: (p, img) => {
            const cur = byId(sceneId);
            if (!cur) return;
            if (state.preview !== sceneId) { state.preview = sceneId; queueSave(["preview"], 0); }
            const old = cur.layers.find(l => l.type === "image" || l.type === "video");
            if (old) { old.src = p; old.type = SCN.VIDEO_RE.test(p) ? "video" : "image"; layerSel[sceneId] = old.id; edited(); }
            else addPickedMedia(SCN.VIDEO_RE.test(p) ? "video" : "image", p, img);
        }
    });
}

function renderPicker() {
    if (!picker) return;
    const { kinds, tab, sub } = picker;
    $("#pick-title").textContent = picker.title;
    $("#pick-tabs").innerHTML = slideGroups(kinds).map(g => `<button type="button" data-tab="${escapeHtml(g)}" class="${g === tab ? "on" : ""}">${escapeHtml(g)}</button>`).join("")
        + (sub ? `<span class="ed-chip">${escapeHtml(sub)}　<button type="button" class="btn small" data-tab-all="1">フォルダの絞り込みをやめる</button></span>` : "");
    const list = slides.filter(s => kinds.includes(s.kind) && slideGroup(s) === tab && (!sub || SC.normPath(s.path).includes(SC.normPath(sub))));
    $("#pick-grid").innerHTML = list.map(s => `<button type="button" class="pick-item ${s.path === picker.current ? "on" : ""}" data-file="${escapeHtml(s.path)}" title="${escapeHtml(s.path)}">${s.kind === "video"
        ? `<video src="${thumbUrl(s.path)}#t=0.1" preload="metadata" muted></video>` : `<img src="${thumbUrl(s.path)}" loading="lazy" alt="" onerror="this.remove()">`}<span class="pick-name">${escapeHtml(s.name)}</span></button>`).join("")
        || `<div class="empty">画像がありません。「ファイルを足す」か、slides フォルダに入れて「⟳ 読み直す」を押します。</div>`;
}

function bindPicker() {
    $("#pick-close").addEventListener("click", () => $("#dlg-picker").close());
    $("#pick-tabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (b && picker) { picker.tab = b.dataset.tab; picker.sub = ""; renderPicker(); $("#pick-grid").scrollTop = 0; return; }
        if (e.target.closest("[data-tab-all]") && picker) { picker.sub = ""; renderPicker(); }
    });
    $("#pick-grid").addEventListener("click", e => {
        const b = e.target.closest("[data-file]");
        if (!b || !picker) return;
        const p = picker;
        const img = b.querySelector("img");
        $("#dlg-picker").close();
        p.onPick(b.dataset.file, img);
    });
    $("#dlg-picker").addEventListener("close", () => { picker = null; });
    $("#pick-upload").addEventListener("click", () => $("#pick-file").click());
    $("#pick-file").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; uploadSlides(f); });
    $("#pick-reload").addEventListener("click", () => loadSlides().then(() => showInfo(`スライドを読み直しました（${slides.length}件）`)).catch(e => showError(e.message)));
}

async function uploadSlides(files) {
    if (!files || files.length === 0) return;
    const folder = picker && picker.tab && picker.tab !== "その他" ? picker.tab : "";
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

async function loadSlides() {
    const res = await fetch("/api/slides");
    if (!res.ok) throw new Error("スライドの一覧を取得できません");
    slides = await res.json();
    slidesVer++;
    if (state) { renderFutaSelects(); renderAll(); }
    if (picker) renderPicker();
}

// --------------------------------------------------------------------------
// 台本から作る（Excel → 列の割り当て → シーン）
// --------------------------------------------------------------------------
let importState = null;     // 読み込み中のファイル { resp, cfg:[{index, include, headerRow, roles}] }

function openScriptDialog() {
    $("#sc-result").classList.add("hidden");
    $("#dlg-script").showModal();
}

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
    $("#sc-result").classList.add("hidden");
    sendScriptFile(file, { filename: file.name });
}
function pasteScript() {
    const t = $("#sc-paste").value;
    if (!t.trim()) return showError("貼り付ける内容がありません");
    $("#sc-result").classList.add("hidden");
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
        `<div class="ctrl-row"><button type="button" class="btn go" id="btn-as-ok">この内容でシーンを作る</button><button type="button" class="btn" id="btn-as-cancel">やめる</button></div>`;
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
    const hadScript = scenes().some(s => s.script);
    if (hadScript && !confirm("台本を読み直します。台本から作ったシーンのうち、手で直していないものだけ更新します（手で直したシーンはそのまま残ります）。よろしいですか？")) return;
    try {
        const res = await fetch("/api/script/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: resp.importId, mergePicks: $("#opt-merge-picks").checked, sheets: cfg.map(c => ({ index: c.index, include: c.include, headerRow: c.headerRow, roles: c.roles })) }) });
        const j = await res.json();
        if (!res.ok) return showError(`作れませんでした：${j.error}`);
        importState = null;
        renderAssign();
        showInfo(`シーンを作りました（新しく${j.created}個・更新${j.updated}個）`);
        renderScriptResult(j);
    } catch (e) { showError(SERVER_NG); }
}

function renderScriptResult(j) {
    const box = $("#sc-result");
    const list = (title, names) => names.length ? `<div class="note"><b>${title}（${names.length}個）</b><br>${names.slice(0, 30).map(escapeHtml).join("<br>")}${names.length > 30 ? "<br>…" : ""}</div>` : "";
    box.innerHTML = `<h2>できました</h2><div>${j.sheets}シート・${j.rows}行から、シーンを <b>${j.created}</b> 個作り、<b>${j.updated}</b> 個を更新しました。</div>` +
        list("手で直してあるため、そのまま残したシーン", j.kept || []) + list("台本に無くなったシーン（消さずに残してあります）", j.missing || []);
    box.classList.remove("hidden");
}

function bindScriptDialog() {
    $("#script-close").addEventListener("click", () => $("#dlg-script").close());
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
}

// --------------------------------------------------------------------------
// フタ・BLACK・切り替え方
// --------------------------------------------------------------------------
function renderFuta() {
    const f = state.futa;
    const lb = $("#btn-lid");
    lb.classList.toggle("on", state.lid);
    lb.textContent = state.lid ? "カメラ待ち（フタ ON）" : "カメラのフタ OFF";
    $("#btn-futa-left").classList.toggle("on", f.active === "left");
    $("#btn-futa-full").classList.toggle("on", f.active === "full");
    renderFutaSelects();
    const lg = logos();
    $("#futa-info").textContent = (lg.left ? `左フタ：${baseName(lg.left)}` : "左フタ：画像がありません（黒になります）") + " ／ " +
        (lg.full ? `全面フタ：${baseName(lg.full)}` : "全面フタ：画像がありません（黒になります）") +
        (!lg.left || !lg.full ? "　→ slides/フタ/ に画像を入れて「⟳ 読み直す」を押すか、上で選んでください" : "");
}

let lastFutaOptKey = "";
function renderFutaSelects() {
    if (!state) return;
    const imgs = slides.filter(s => s.kind === "image");
    const key = imgs.map(s => s.path).join("|") + "|" + state.futa.left + "|" + state.futa.full + "|" + state.lidImage;
    if (key === lastFutaOptKey) return;
    lastFutaOptKey = key;
    const opts = `<option value="">自動（slides/フタ/ の最初の画像）</option>` + imgs.map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.path.replace(/^slides\//, ""))}</option>`).join("");
    const lsel = $("#lid-image");
    lsel.innerHTML = `<option value="">自動（slides の L_960x686_horiz_black）</option>` + imgs.map(s => `<option value="${escapeHtml(s.path)}">${escapeHtml(s.path.replace(/^slides./, ""))}</option>`).join("");
    lsel.value = state.lidImage;
    ["left", "full"].forEach(k => {
        const sel = $(`#futa-${k}`);
        let o = opts;
        if (state.futa[k] && !imgs.some(s => s.path === state.futa[k])) o += `<option value="${escapeHtml(state.futa[k])}">（見つからない）${escapeHtml(state.futa[k])}</option>`;
        sel.innerHTML = o;
        sel.value = state.futa[k];
    });
}

function renderTransition() {
    const t = state.transition;
    $("#btn-cut").classList.toggle("on", t.type === "cut");
    $("#btn-fade").classList.toggle("on", t.type === "fade");
    if (document.activeElement !== $("#fade-sec")) $("#fade-sec").value = (t.ms / 1000).toFixed(1);
}
function setTransition(type, ms) {
    const cur = state.transition;
    patch({ transition: { type, ms: ms === undefined ? cur.ms : ms } });
}

// テスト画面（本線に直接出す。もう一度押すと元の画面に戻る）
let testPrev = null;
function toggleTestPattern() {
    if (testPrev) { const p = testPrev; testPrev = null; patch({ program: p }); showInfo("テスト画面をやめました"); return; }
    if (state.program.name === "テスト画面") return showError("テスト画面が出ています。TAKE などで別の画面を出してください");
    testPrev = clone(state.program);
    patch({ program: { sceneId: "", name: "テスト画面", layers: [SCN.newLayer("test", {}, SCN.presets(stage()).full)] }, black: false });
    showInfo("テスト画面を本線に出しました。緑の枠がビジョンの四辺に合うか確かめます");
}

// --------------------------------------------------------------------------
// Stream Deck（USB直結）。キーの割り当て・LCD描画は streamdeck.js。ここでは「操作の一覧」を渡す
// --------------------------------------------------------------------------
const SD_BGM_KEY = "stadiumvision-baseball.sdbgm";
const SD_SECTION_KEYS = 8;
const SD_BGM_KEYS = 12;
const sdBgmPrefs = readLocal(SD_BGM_KEY, []);

function sdSong(i) {
    const path = sdBgmPrefs[i];
    return (path && musicList.find(m => m.path === path)) || (!path ? musicList[i] : null) || null;
}
function sdNextTitle() {
    if (!state) return "";
    const f = SCN.flowIds(state);
    const id = f[f.indexOf(state.cursor) + 1];
    const sc = id && byId(id);
    return sc ? sc.name : "（なし）";
}
// セクション（グループ）の一覧：シーンの並びに出てくる順
function groupList() {
    const out = [];
    orderIds().forEach(id => { const s = byId(id); if (s && !out.includes(s.group)) out.push(s.group); });
    return out;
}

function buildSdActions() {
    const A = [];
    const add0 = (id, describe, run) => A.push({ id, describe, run });
    // BGMを鳴らさない設定のときは、BGM系のキーを割り当てに入れない
    const add = (id, describe, run) => { if (bgmOn() || !/^bgm/.test(id)) add0(id, describe, run); };
    // 優先順位の高い順（6キー・8キーの機種には、この順に詰める）
    add("next", () => ({ label: "NEXT ▶", sub: sdNextTitle(), color: "#15803d" }), scNext);
    add("prev", () => ({ label: "◀ PREV", sub: "前のシーン", color: "#0f766e" }), scPrev);
    add("futaLeft", () => ({ label: "左フタ", sub: "ロゴ", color: "#7c3aed", toggle: true, on: !!state && state.futa.active === "left", onColor: "#a78bfa" }), () => control("futa"));
    add("lid", () => ({ label: "カメラの\nフタ", sub: state && state.lid ? "ON（待ち）" : "OFF", color: "#9a3412", toggle: true, on: !!state && state.lid, onColor: "#ea580c" }), () => control("lid"));
    add("black", () => ({ label: "BLACK", color: "#475569", toggle: true, on: !!state && state.black, onColor: "#dc2626" }), () => control("black"));
    add("bgmFade", () => ({ label: "BGM\nフェード", sub: "アウト", color: "#b45309" }), musicFade);
    add("bgmStop", () => ({ label: "BGM\n停止", sub: "すぐ止める", color: "#991b1b" }), musicHalt);
    add("futaFull", () => ({ label: "全面フタ", sub: "ロゴ", color: "#6d28d9", toggle: true, on: !!state && state.futa.active === "full", onColor: "#a78bfa" }), () => control("futaFull"));
    add("take", () => ({ label: "TAKE", sub: "PVW→本線", color: "#dc2626" }), doTake);
    add("readDown", () => ({ label: "選ぶ\n↓", sub: "PREVIEW", color: "#1d4ed8" }), () => moveSel(1));
    add("readUp", () => ({ label: "選ぶ\n↑", sub: "PREVIEW", color: "#1d4ed8" }), () => moveSel(-1));
    add("bgmDuck", () => ({ label: "BGM\n小さく", sub: musicDucked ? "戻す" : "", color: "#b45309", toggle: true, on: musicDucked, onColor: "#f59e0b" }), () => musicDuck());
    add("swap", () => ({ label: "⇄ 入替", sub: "左右", color: "#0369a1" }), swapSides);
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
            const g = groupList()[i];
            return g !== undefined ? { label: g || "（なし）", sub: "ここへ", color: "#854d0e" } : { label: "", color: "#05070c" };
        }, () => {
            const g = groupList()[i];
            const first = state && state.sceneOrder.find(id => { const s = byId(id); return s && s.group === g; });
            if (first) selectScene(first, { scroll: true });
        });
    }
    return A;
}

let lastSdMusicKey = "";
function sdRefresh() {
    if (typeof StreamDeck === "undefined" || !state) return;
    StreamDeck.refresh();
    renderSdKeys();
    const mk = musicList.map(m => m.path).join("|");
    if (mk !== lastSdMusicKey) { lastSdMusicKey = mk; renderSdBgmSelects(); renderSound(); }
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
    box.innerHTML = Array.from({ length: SD_BGM_KEYS }, (_, i) => `<label>BGM ${i + 1}<select data-sd-bgm="${i}" class="text-input"><option value="">（${musicList[i] ? escapeHtml(musicList[i].name) : "曲なし"}）自動</option>` +
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
    $("#sd-badge").addEventListener("click", () => { openSettings(); $("#sd-panel").scrollIntoView({ block: "center" }); });
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
// 設定（⚙）：カメラ・出力の形
// --------------------------------------------------------------------------
function openSettings() {
    const d = $("#dlg-settings");
    if (!d.open) d.showModal();
}

async function refreshDevices(askPermission) {
    if (!navigator.mediaDevices) return showError("このブラウザではカメラを選べません（Chrome か Edge で管理画面を開いてください）");
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

let lastOutputKey = "";
function renderOutput() {
    const o = state.output;
    $$("#out-mode-seg button[data-outmode]").forEach(b => b.classList.toggle("on", b.dataset.outmode === o.mode));
    $("#out-sdi-box").classList.toggle("hidden", o.mode !== "sdi");
    if (document.activeElement !== $("#out-band-y")) $("#out-band-y").value = o.bandY;
    if (document.activeElement !== $("#out-band-h")) $("#out-band-h").value = o.bandH;
    $("#out-band-info").textContent = o.mode === "sdi"
        ? `ビジョンに映る帯：1920×${o.bandH}（y=${o.bandY}〜${o.bandY + o.bandH}）／ 左半分・右半分は 960×${o.bandH}`
        : "";
    $("#hdr-sub").textContent = o.mode === "sdi" ? `1920×${o.bandH}${o.bandH === 686 ? "（守山）" : "（SDI 1本の帯）"}` : "3840×1080（32:9）";
    $$("[data-open=left],[data-open=right]").forEach(b => { b.disabled = o.mode === "sdi"; });
    const key = JSON.stringify(o);
    if (key === lastOutputKey) return;
    lastOutputKey = key;
    // モニターの形をビジョンに合わせる（帯のときは 1920:帯の高さ）
    const st = stage();
    document.documentElement.style.setProperty("--mon-ar", String(st.w / st.h));
    $("#obs-drag").href = obsUrl();
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

function openOutput(view) {
    if (isSdi() && view !== "all") return showError("SDI 1本（1920×1080）で出す設定のため、左右に分けて開けません。「全体」を使ってください");
    const w = view === "all" ? 1280 : 960;
    const h = view === "all" ? (isSdi() ? 720 : 360) : 540;
    window.open(`vision.html?view=${view}`, `sv_baseball_${view}`, `popup=yes,width=${w},height=${h}`);
    showInfo("確認用の表示画面を開きました。本番は「野球ビジョン HDMI出力」を使ってください（ダブルクリックかFキーで全画面）");
}

// --------------------------------------------------------------------------
// 画面の更新・サーバーとの接続
// --------------------------------------------------------------------------
function renderAll() {
    if (!state) return;
    renderTopbar();
    renderSceneList();
    renderLayers();
    renderOverlay();
    postPvw();
    sdRefresh();
}

let lastBgm = null;
function renderBgmMode() {
    const on = bgmOn();
    if (on === lastBgm) return;
    const first = lastBgm === null;
    lastBgm = on;
    document.body.classList.toggle("no-bgm", !on);
    $("#opt-bgm").checked = on;
    if (!on && !first && typeof musicHalt === "function") musicHalt();
    if (typeof StreamDeck !== "undefined") StreamDeck.setActions(buildSdActions());
}

function renderTopbar() {
    renderBgmMode();
    $("#btn-black").classList.toggle("on", state.black);
    $("#pgm-black-flag").classList.toggle("on", state.black);
    $("#opt-guide").checked = state.guide;
    renderOutput();
    renderTransition();
    renderFuta();
    $("#derby-count").textContent = state.derby.count;
    $("#derby-outs").textContent = state.derby.outs;
    renderCameraSelects();
    const pv = curScene();
    $("#pvw-name").textContent = pv ? pv.name : "（シーンなし）";
    $("#pgm-name").textContent = state.program.name || "";
}

function connect() {
    const es = new EventSource("/events");
    const conn = $("#conn");
    es.addEventListener("UPDATE_STATE", e => {
        const ns = JSON.parse(e.data);
        // 手元で直している最中のシーン・選択は、サーバーからの古い内容で上書きしない
        if (state && saving()) { ns.scenes = state.scenes; ns.sceneOrder = state.sceneOrder; ns.preview = state.preview; }
        state = ns;
        conn.textContent = "接続中";
        conn.className = "conn ok";
        renderAll();
    });
    es.addEventListener("COMMAND", e => handleCommand(JSON.parse(e.data)));
    es.addEventListener("CUE_FIRED", e => onSceneFired(JSON.parse(e.data)));
    es.addEventListener("NOTICE", e => showError(JSON.parse(e.data).message));
    // design_tools で slides が入れ替わった：スライド一覧を読み直す
    es.addEventListener("SLIDES_CHANGED", () => loadSlides().then(() => showInfo("スライドが入れ替わりました。一覧を読み直しました")).catch(() => {}));
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
    else if (cmd.action === "readNext") moveSel(1);
    else if (cmd.action === "readPrev") moveSel(-1);
    else if (cmd.action === "musicPlay") playMusicPath(cmd.val);
}

// --------------------------------------------------------------------------
// ボタンなどのつなぎこみ
// --------------------------------------------------------------------------
function bindEvents() {
    // 音楽バーの曲ボタンは1段。ホイールで横に動かす
    $("#mb-songs").addEventListener("wheel", e => {
        const el = e.currentTarget;
        if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    $$("[data-open]").forEach(b => b.addEventListener("click", () => openOutput(b.dataset.open)));
    $("#opt-guide").addEventListener("change", e => patch({ guide: e.target.checked }));
    $$("#out-mode-seg button[data-outmode]").forEach(b => b.addEventListener("click", () => setOutput({ mode: b.dataset.outmode })));
    $("#out-band-y").addEventListener("change", e => setOutput({ bandY: e.target.value }));
    $("#out-band-h").addEventListener("change", e => setOutput({ bandH: e.target.value }));
    $("#btn-band-center").addEventListener("click", () => setOutput({ bandY: Math.round((1080 - state.output.bandH) / 2) }));
    $("#btn-band-led").addEventListener("click", bandFromLed);
    $("#btn-preset-moriyama").addEventListener("click", () => { setOutput({ mode: "sdi", bandY: 197, bandH: 686 }); showInfo("守山の設定（SDI 1本・帯の上端197・高さ686）にしました"); });
    $("#btn-test-pattern").addEventListener("click", toggleTestPattern);
    $("#btn-black").addEventListener("click", () => control("black"));
    $("#btn-lid").addEventListener("click", () => control("lid"));
    $("#lid-image").addEventListener("change", e => patch({ lidImage: e.target.value }));
    $("#btn-futa-left").addEventListener("click", () => control("futa"));
    $("#btn-futa-full").addEventListener("click", () => control("futaFull"));
    $("#futa-left").addEventListener("change", e => patch({ futa: Object.assign({}, state.futa, { left: e.target.value }) }));
    $("#futa-full").addEventListener("change", e => patch({ futa: Object.assign({}, state.futa, { full: e.target.value }) }));
    $("#opt-bgm").addEventListener("change", e => patch({ bgmEnabled: e.target.checked }));
    $("#btn-settings").addEventListener("click", openSettings);
    $("#settings-close").addEventListener("click", () => $("#dlg-settings").close());

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

    // TAKE の段
    $("#btn-cut").addEventListener("click", () => setTransition("cut"));
    $("#btn-fade").addEventListener("click", e => { if (e.target.id !== "fade-sec") setTransition("fade", state.transition.ms || 500); });
    $("#fade-sec").addEventListener("change", e => {
        const ms = Math.max(0, Math.min(5000, Math.round((parseFloat(e.target.value) || 0) * 1000)));
        setTransition("fade", ms);
    });
    $("#btn-take").addEventListener("click", doTake);
    $("#btn-nextsc").addEventListener("click", nextSceneToPreview);

    bindScenes();
    bindLayers();
    bindSound();
    bindOverlay();
    bindPicker();
    bindScriptDialog();

    $$("[data-derby]").forEach(b => b.addEventListener("click", () => {
        if (b.dataset.derby === "reset" && !confirm("HR競争の本数とアウトを0に戻しますか？")) return;
        control("derby", b.dataset.derby);
    }));
    $$("[data-derby-out]").forEach(b => b.addEventListener("click", () => control("derbyOut", b.dataset.derbyOut)));
    bindStreamDeckUi();
    $("#btn-devices").addEventListener("click", () => refreshDevices(true));
    $$("#cam1-select, #cam2-select").forEach(sel => sel.addEventListener("change", () => setCamera(sel)));
    $("#opt-monitor-cam").addEventListener("change", reloadMonitors);
    PREF_CHECKS.forEach(id => $("#" + id).addEventListener("change", savePrefs));

    // ボタンを押したあと、Space・Enter でそのボタンがもう一度押されないよう、フォーカスを外す
    document.addEventListener("click", e => { const b = e.target.closest("button, .pill"); if (b && b.blur) b.blur(); });

    // キーボード（入力中・ダイアログを開いている間は効かない）
    document.addEventListener("keydown", e => {
        const tag = document.activeElement ? document.activeElement.tagName : "";
        if (["INPUT", "SELECT", "TEXTAREA"].includes(tag) || document.querySelector("dialog[open]")) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        if (e.code === "Space" || k === "Enter") { e.preventDefault(); doTake(); }
        else if (k === "ArrowDown") { e.preventDefault(); moveSel(1); }
        else if (k === "ArrowUp") { e.preventDefault(); moveSel(-1); }
        else if (k === "ArrowRight") { e.preventDefault(); scNext(); }
        else if (k === "ArrowLeft") { e.preventDefault(); scPrev(); }
        else if (k === "b" || k === "B") control("black");
        else if (k === "l" || k === "L") control("futa");
        else if (k === "F2") { e.preventDefault(); if (state && state.preview) startRename(state.preview); }
        else if (k === "Delete") { e.preventDefault(); deleteLayer(); }
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
    connect();
    loadSlides().catch(e => showError(`${e.message}。サーバーが起動しているか確認してください`));
    refreshDevices(false).catch(() => {});
}

init();
