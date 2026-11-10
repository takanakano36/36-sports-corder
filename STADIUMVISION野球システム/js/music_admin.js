/* ==========================================================================
   スタジアムビジョン得点板 - 管理画面「音楽バー」（ヘッダーの2段目）
   - music/ フォルダ（既定のフォルダ）の曲をボタンで並べ、この管理画面を開いているPCで鳴らす
     （ビジョンの表示画面やOBSからは鳴らない。サーバーの状態にも残さない）
   - 「曲のフォルダ」のボタンで、エクスプローラーから別のフォルダを選べる
     （曲はコピーせず、選んだフォルダから直接読む。選んだフォルダはこのPCのブラウザが覚える）
   - 曲のボタンで再生、同じボタンか「■ STOP」でフェードアウトして止める
   - 最後まで流すと止まる。「くり返し」をオンにするとループ
   - 出力先（イヤホンジャックなど）を選べる。選んだ出力先が無いときは、別の所から鳴らさずに知らせて止める
   - 音量・フェード秒数・くり返し・出力先は、このPCのブラウザに覚えさせる
   ※ dashboard.js より先に読み込む（ここは関数を用意するだけ。initMusic() は dashboard.js から呼ぶ）
   ※ dashboard.js の部品（$・$$・showError・showInfo）を使う
   ========================================================================== */

let musicList = [];       // [{ path, no, name, getFile? }]（getFile があるのは、選んだフォルダの曲）
let musicSource = null;   // 選んだフォルダ { name, handle } または { name, files }。null は既定のフォルダ
let musicCur = null;      // いま鳴っている曲 { audio, item, gain, objectUrl }
const musicFading = [];   // フェードアウト中の曲（途中で音量を動かしても追従させる）
let musicSinkLabels = {}; // 出力先のID → 名前

// --------------------------------------------------------------------------
// このPCに覚えさせる設定（ブラウザの保存領域が使えないときは、その回だけの設定として動く）
// --------------------------------------------------------------------------
const MUSIC_PREF_KEY = "stadiumvision.music";
function readMusicPrefs() {
    const base = { vol: 80, fade: 2, loop: false, sink: "" };
    try {
        const saved = JSON.parse(localStorage.getItem(MUSIC_PREF_KEY) || "{}");
        return Object.assign(base, saved);
    } catch (e) {
        console.warn("音楽の設定を読み込めませんでした（この回だけの設定で動きます）", e);
        return base;
    }
}
const musicPrefs = readMusicPrefs();
function saveMusicPrefs() {
    try {
        localStorage.setItem(MUSIC_PREF_KEY, JSON.stringify(musicPrefs));
    } catch (e) {
        console.warn("音楽の設定を保存できませんでした（次に開いたときは元の設定に戻ります）", e);
    }
}

const musicMaster = () => musicPrefs.vol / 100;
const fmtTime = sec => {
    if (!isFinite(sec)) return "--:--";
    const s = Math.floor(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// --------------------------------------------------------------------------
// 曲の一覧
// --------------------------------------------------------------------------
// 使える形式と並び順は、既定のフォルダ（server.js の MUSIC_EXTS・MUSIC_NAME_RE）と同じにする
const LOCAL_MUSIC_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const LOCAL_MUSIC_NAME_RE = /^(\d+)_(.+)$/;

function toLocalMusicItem(fileName, getFile) {
    const stem = fileName.replace(/\.[^.]+$/, "");
    const m = LOCAL_MUSIC_NAME_RE.exec(stem);
    return { path: `local:${fileName}`, no: m ? Number(m[1]) : null, name: m ? m[2] : stem, getFile };
}

// 選んだフォルダの曲を読む（フォルダの直下だけ。中のフォルダまでは見ない）
async function readLocalMusic(source) {
    const items = [];
    if (source.handle) {
        try {
            for await (const entry of source.handle.values()) {
                if (entry.kind === "file" && LOCAL_MUSIC_RE.test(entry.name)) {
                    items.push(toLocalMusicItem(entry.name, () => entry.getFile()));
                }
            }
        } catch (e) {
            console.error(`フォルダを読めませんでした（${source.name}）`, e);
            throw new Error(`フォルダ「${source.name}」を読めませんでした。移動・削除されていないか、USBメモリなどが抜けていないか確かめてください`);
        }
    } else {
        source.files.forEach(f => {
            if (f.webkitRelativePath.split("/").length === 2 && LOCAL_MUSIC_RE.test(f.name)) {
                items.push(toLocalMusicItem(f.name, async () => f));
            }
        });
    }
    return items.sort((a, b) => (a.no === null) - (b.no === null) || (a.no - b.no) || a.name.localeCompare(b.name, "ja"));
}

async function fetchDefaultMusic() {
    let res;
    try {
        res = await fetch("/api/music");
    } catch (e) {
        console.error("曲の一覧を取得できません", e);
        throw new Error("曲の一覧を取得できません");
    }
    if (!res.ok) throw new Error("曲の一覧を取得できません");
    return res.json();
}

async function loadMusic() {
    musicList = musicSource ? await readLocalMusic(musicSource) : await fetchDefaultMusic();
    const holder = $("#mb-songs");
    if (musicList.length === 0) {
        holder.innerHTML = `<span class="mb-empty">${musicSource ? "このフォルダに曲がありません" : "曲がありません（「📁 曲のフォルダ」で曲の入ったフォルダを選ぶか、既定のフォルダに曲を入れて「⟳ 曲を読み直す」を押します）"}</span>`;
    } else {
        holder.innerHTML = musicList.map(m =>
            `<button type="button" data-music="${escapeHtml(m.path)}" title="${escapeHtml(m.name)}"><span>${escapeHtml(m.name)}</span></button>`).join("");
    }
    renderMusicSource();
    renderMusic();
}

function renderMusicSource() {
    $("#mb-folder-name").textContent = `📁 曲のフォルダ：${musicSource ? musicSource.name : "既定"}`;
    $("#mb-folder-default").classList.toggle("hidden", !musicSource);
}

// --------------------------------------------------------------------------
// 曲のフォルダを選ぶ
// --------------------------------------------------------------------------
// 選んだフォルダを次回も使えるよう、ブラウザの保存領域（IndexedDB）に覚えさせる
function musicDb(run) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open("stadiumvision", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("music");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("music", "readwrite");
            const req = run(tx.objectStore("music"));
            tx.oncomplete = () => { db.close(); resolve(req.result); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}
function saveMusicHandle(handle) {
    return musicDb(store => handle ? store.put(handle, "folder") : store.delete("folder"))
        .catch(e => console.warn("選んだフォルダを覚えられませんでした（次に開いたときは、もう一度選んでください）", e));
}

// 選んだフォルダに切り替える。曲が1つも無いときや読めないときは切り替えず、元のフォルダのままにする
async function useMusicFolder(source, quiet) {
    const items = await readLocalMusic(source);
    if (items.length === 0) throw new Error(`「${source.name}」の直下に曲がありません（MP3・WAV・M4A・AAC・OGG・FLAC）`);
    musicSource = source;
    await loadMusic();
    $("#mb-folder-resume").classList.add("hidden");
    if (source.handle) await saveMusicHandle(source.handle);
    if (!quiet) showInfo(`「${source.name}」の曲を読み込みました（${musicList.length}曲）`);
}

async function pickMusicFolder() {
    // フォルダを選ぶ画面が使えないブラウザ（Safariなど）では、ファイル選択の仕組みでフォルダを選ぶ
    if (!window.showDirectoryPicker) return $("#mb-folder-input").click();
    let handle;
    try {
        handle = await window.showDirectoryPicker({ id: "stadiumvision-music", mode: "read", startIn: "music" });
    } catch (e) {
        // AbortError は「キャンセル」を押したとき
        if (e.name !== "AbortError") {
            console.error("フォルダを開けませんでした", e);
            showError("フォルダを開けませんでした。別のフォルダを選んでください");
        }
        return;
    }
    await useMusicFolder({ name: handle.name, handle }).catch(e => showError(e.message));
}

// 前回選んだフォルダに戻す。ブラウザの許可が残っていなければ、ボタンを出して押してもらう
async function restoreMusicFolder() {
    let handle;
    try {
        handle = await musicDb(store => store.get("folder"));
    } catch (e) {
        console.warn("前回のフォルダを読み出せませんでした", e);
        return false;
    }
    if (!handle) return false;
    const resume = $("#mb-folder-resume");
    resume.textContent = `📁 前回のフォルダ「${handle.name}」を開く`;
    resume.onclick = async () => {
        if (await handle.requestPermission({ mode: "read" }) !== "granted") {
            return showError("フォルダを読む許可が出ませんでした。もう一度押して「許可」を選んでください");
        }
        await useMusicFolder({ name: handle.name, handle }).catch(e => showError(e.message));
    };
    if (await handle.queryPermission({ mode: "read" }) !== "granted") {
        resume.classList.remove("hidden");
        return false;
    }
    try {
        await useMusicFolder({ name: handle.name, handle }, true);
        return true;
    } catch (e) {
        // USBメモリが抜けているときなど。既定のフォルダの曲を出し、戻せるようボタンを残す
        resume.classList.remove("hidden");
        showError(`${e.message}。いまは既定のフォルダの曲を出しています`);
        return false;
    }
}

// --------------------------------------------------------------------------
// 再生・停止
// --------------------------------------------------------------------------
function musicRelease(entry) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = null;
}

async function musicPlay(item) {
    const a = new Audio();
    a.preload = "auto";
    // 出力先を先に決める（決まらなければ鳴らさない。いま鳴っている曲はそのまま）
    if (musicPrefs.sink) {
        try {
            await a.setSinkId(musicPrefs.sink);
        } catch (e) {
            showError(`音楽の出力先（${musicSinkLabels[musicPrefs.sink] || "前に選んだ出力先"}）が見つからないため、鳴らしませんでした。イヤホンなどの差し込みを確かめるか、出力先を選び直してください`);
            return;
        }
    }
    const entry = { audio: a, item, gain: 1, objectUrl: null };
    // 選んだフォルダの曲は、その場でファイルを開く（消した・USBを抜いたなら、いま鳴っている曲はそのままで知らせる）
    if (item.getFile) {
        try {
            entry.objectUrl = URL.createObjectURL(await item.getFile());
        } catch (e) {
            showError(`曲を開けませんでした（${item.name}）。ファイルが移動・削除されていないか、USBメモリなどが抜けていないか確かめてください`);
            return;
        }
    }
    a.src = entry.objectUrl || item.path;
    a.loop = musicPrefs.loop;
    a.volume = musicMaster();
    a.addEventListener("ended", () => {
        musicRelease(entry);
        if (musicCur === entry) { musicCur = null; renderMusic(); }
    });
    a.addEventListener("timeupdate", () => { if (musicCur === entry) renderMusicTime(); });
    a.addEventListener("loadedmetadata", () => { if (musicCur === entry) renderMusicTime(); });
    a.addEventListener("error", () => {
        if (musicCur !== entry) return;
        musicRelease(entry);
        musicCur = null;
        renderMusic();
        showError(`曲を再生できませんでした（${item.name}）。ファイルが壊れているか、このブラウザで再生できない形式です`);
    });

    // 前の曲はフェードアウトさせ、新しい曲をすぐ鳴らす
    if (musicCur) musicFadeOut(musicCur);
    musicCur = entry;
    renderMusic();
    try {
        await a.play();
    } catch (e) {
        musicRelease(entry);
        if (musicCur === entry) { musicCur = null; renderMusic(); }
        console.error(`曲を再生できませんでした（${item.name}）`, e);
        showError(`曲を再生できませんでした（${item.name}）。ファイルが壊れているか、このブラウザで再生できない形式です`);
    }
}

// 音量を少しずつ下げて止める（フェードなしの設定なら、すぐ止める）
function musicFadeOut(entry) {
    const a = entry.audio;
    const sec = musicPrefs.fade;
    const finish = () => {
        a.pause();
        a.removeAttribute("src");
        a.load();
        musicRelease(entry);
        const i = musicFading.indexOf(entry);
        if (i >= 0) musicFading.splice(i, 1);
    };
    if (sec <= 0 || a.paused) return finish();
    musicFading.push(entry);
    const start = performance.now();
    const from = entry.gain;
    const timer = setInterval(() => {
        const t = Math.min(1, (performance.now() - start) / (sec * 1000));
        entry.gain = from * (1 - t);
        a.volume = musicMaster() * entry.gain;
        if (t >= 1) { clearInterval(timer); finish(); }
    }, 50);
}

function musicStop() {
    if (!musicCur) return;
    musicFadeOut(musicCur);
    musicCur = null;
    renderMusic();
}

// --------------------------------------------------------------------------
// 表示
// --------------------------------------------------------------------------
function renderMusic() {
    const cur = musicCur ? musicCur.item.path : "";
    $$("#mb-songs [data-music]").forEach(b => b.classList.toggle("on", b.dataset.music === cur));
    $("#mb-now").classList.toggle("on", !!musicCur);
    $("#mb-now-name").textContent = musicCur ? musicCur.item.name : "停止中";
    $("#mb-stop").disabled = !musicCur;
    renderMusicTime();
}

function renderMusicTime() {
    if (!musicCur) {
        $("#mb-time").textContent = "";
        $("#mb-prog").style.width = "0";
        return;
    }
    const a = musicCur.audio;
    $("#mb-time").textContent = `${fmtTime(a.currentTime)} / ${fmtTime(a.duration)}`;
    $("#mb-prog").style.width = isFinite(a.duration) && a.duration > 0 ? `${(a.currentTime / a.duration) * 100}%` : "0";
}

// --------------------------------------------------------------------------
// 出力先（イヤホンジャックなど）
// --------------------------------------------------------------------------
async function loadMusicSinks(askNames) {
    const sel = $("#mb-sink");
    if (!("setSinkId" in HTMLMediaElement.prototype) || !navigator.mediaDevices) {
        sel.innerHTML = `<option value="">出力先：PCの設定どおり（このブラウザでは選べません）</option>`;
        sel.disabled = true;
        if (musicPrefs.sink) showError("このブラウザでは音楽の出力先を選べません。Chrome か Edge で管理画面を開いてください");
        return;
    }
    if (askNames) {
        // 出力先の名前を出すには、ブラウザの決まりで「マイクの使用」の許可が必要（音を拾ったり録音したりはしない。許可を取ったらすぐ閉じる）
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
    const named = devices.filter(d => d.deviceId && d.label);
    musicSinkLabels = Object.fromEntries(named.map(d => [d.deviceId, d.label]));
    let html = `<option value="">出力先：PCの設定どおり</option>`;
    html += named.map(d => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label)}</option>`).join("");
    if (musicPrefs.sink && !musicSinkLabels[musicPrefs.sink]) {
        html += `<option value="${escapeHtml(musicPrefs.sink)}">（見つからない）前に選んだ出力先</option>`;
    }
    if (named.length === 0) html += `<option value="__names">出力先の名前を表示する…（最初の1回だけ）</option>`;
    sel.innerHTML = html;
    sel.disabled = false;
    sel.value = musicPrefs.sink;
}

async function musicSetSink(id) {
    if (id === "__names") {
        $("#mb-sink").value = musicPrefs.sink;
        try {
            await loadMusicSinks(true);
            showInfo("出力先の一覧を表示しました。イヤホンジャックなど、音楽を出したい出力先を選んでください");
        } catch (e) {
            console.error("出力先の名前を表示できませんでした", e);
            showError("出力先の名前を表示できませんでした。ブラウザの「マイクの使用」を許可してください");
        }
        return;
    }
    // 鳴っている曲があれば、その場で出力先を切り替える
    if (musicCur) {
        try {
            await musicCur.audio.setSinkId(id);
        } catch (e) {
            $("#mb-sink").value = musicPrefs.sink;
            console.error("出力先を切り替えられませんでした", e);
            return showError("その出力先に切り替えられませんでした。イヤホンなどの差し込みを確かめてください");
        }
    }
    musicPrefs.sink = id;
    saveMusicPrefs();
}

// --------------------------------------------------------------------------
// はじめの準備（dashboard.js から呼ぶ）
// --------------------------------------------------------------------------
function initMusic() {
    $("#mb-vol").value = musicPrefs.vol;
    $("#mb-vol-num").textContent = musicPrefs.vol;
    $("#mb-fade").value = String(musicPrefs.fade);
    $("#mb-loop").checked = musicPrefs.loop;

    $("#mb-songs").addEventListener("click", e => {
        const b = e.target.closest("[data-music]");
        if (!b) return;
        // 鳴っている曲をもう一度押したら止める
        if (musicCur && musicCur.item.path === b.dataset.music) return musicStop();
        const item = musicList.find(m => m.path === b.dataset.music);
        if (item) musicPlay(item);
    });
    $("#mb-stop").addEventListener("click", musicStop);
    $("#mb-vol").addEventListener("input", e => {
        musicPrefs.vol = Number(e.target.value);
        $("#mb-vol-num").textContent = musicPrefs.vol;
        [musicCur, ...musicFading].forEach(x => { if (x) x.audio.volume = musicMaster() * x.gain; });
    });
    $("#mb-vol").addEventListener("change", saveMusicPrefs);
    $("#mb-fade").addEventListener("change", e => { musicPrefs.fade = Number(e.target.value); saveMusicPrefs(); });
    $("#mb-loop").addEventListener("change", e => {
        musicPrefs.loop = e.target.checked;
        if (musicCur) musicCur.audio.loop = musicPrefs.loop;
        saveMusicPrefs();
    });
    $("#mb-sink").addEventListener("change", e => musicSetSink(e.target.value));
    $("#mb-folder").addEventListener("click", pickMusicFolder);
    // Safariなど：ファイル選択の仕組みでフォルダを選んだとき
    $("#mb-folder-input").addEventListener("change", e => {
        const files = [...e.target.files];
        e.target.value = "";
        if (files.length === 0) return;
        useMusicFolder({ name: files[0].webkitRelativePath.split("/")[0], files }).catch(err => showError(err.message));
    });
    $("#mb-folder-default").addEventListener("click", async () => {
        musicSource = null;
        await saveMusicHandle(null);
        $("#mb-folder-resume").classList.add("hidden");
        loadMusic().catch(e => showError(e.message));
    });
    $("#mb-reload").addEventListener("click", () => {
        // ファイル選択の仕組みで選んだフォルダは読み直せないので、選び直してもらう
        if (musicSource && musicSource.files) return $("#mb-folder-input").click();
        loadMusic()
            .then(() => showInfo(`曲の一覧を読み直しました（${musicList.length}曲）`))
            .catch(e => showError(e.message));
    });
    if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener("devicechange", () => loadMusicSinks(false).catch(e => {
            console.error("出力先の一覧を更新できませんでした", e);
            showError("出力先の一覧を更新できませんでした");
        }));
    }

    renderMusicSource();
    renderMusic();
    // 前回選んだフォルダが使えればそれを出し、使えなければ既定のフォルダの曲を出す
    restoreMusicFolder()
        .then(restored => { if (!restored) return loadMusic(); })
        .catch(e => showError(`${e.message}。サーバーが起動しているか確認してください`));
    loadMusicSinks(false).catch(e => {
        console.error("出力先の一覧を取得できませんでした", e);
        showError("出力先の一覧を取得できませんでした");
    });
}
