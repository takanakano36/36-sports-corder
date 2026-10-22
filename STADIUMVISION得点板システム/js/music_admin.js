/* ==========================================================================
   スタジアムビジョン得点板 - 管理画面「音楽バー」（ヘッダーの2段目）
   - music/ フォルダの曲をボタンで並べ、この管理画面を開いているPCで鳴らす
     （ビジョンの表示画面やOBSからは鳴らない。サーバーの状態にも残さない）
   - 曲のボタンで再生、同じボタンか「■ STOP」でフェードアウトして止める
   - 最後まで流すと止まる。「くり返し」をオンにするとループ
   - 出力先（イヤホンジャックなど）を選べる。選んだ出力先が無いときは、別の所から鳴らさずに知らせて止める
   - 音量・フェード秒数・くり返し・出力先は、このPCのブラウザに覚えさせる
   ※ dashboard.js より先に読み込む（ここは関数を用意するだけ。initMusic() は dashboard.js から呼ぶ）
   ※ dashboard.js の部品（$・$$・showError・showInfo）を使う
   ========================================================================== */

let musicList = [];       // [{ path, no, name }]（サーバーが並べた順）
let musicCur = null;      // いま鳴っている曲 { audio, item, gain }
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
async function loadMusic() {
    const res = await fetch("/api/music");
    if (!res.ok) throw new Error("曲の一覧を取得できません");
    musicList = await res.json();
    const holder = $("#mb-songs");
    if (musicList.length === 0) {
        holder.innerHTML = `<span class="mb-empty">曲がありません（音楽のフォルダに曲を入れて「⟳ 曲を読み直す」を押します）</span>`;
    } else {
        holder.innerHTML = musicList.map(m =>
            `<button type="button" data-music="${escapeHtml(m.path)}" title="${escapeHtml(m.name)}"><span>${escapeHtml(m.name)}</span></button>`).join("");
    }
    renderMusic();
}

// --------------------------------------------------------------------------
// 再生・停止
// --------------------------------------------------------------------------
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
    a.src = item.path;
    a.loop = musicPrefs.loop;
    const entry = { audio: a, item, gain: 1 };
    a.volume = musicMaster();
    a.addEventListener("ended", () => {
        if (musicCur === entry) { musicCur = null; renderMusic(); }
    });
    a.addEventListener("timeupdate", () => { if (musicCur === entry) renderMusicTime(); });
    a.addEventListener("loadedmetadata", () => { if (musicCur === entry) renderMusicTime(); });
    a.addEventListener("error", () => {
        if (musicCur !== entry) return;
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
        if (musicCur === entry) { musicCur = null; renderMusic(); }
        showError(`曲を再生できませんでした（${item.name}：${e.message}）`);
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
            showError(`出力先の名前を表示できませんでした（${e.message}）。ブラウザの「マイクの使用」を許可してください`);
        }
        return;
    }
    // 鳴っている曲があれば、その場で出力先を切り替える
    if (musicCur) {
        try {
            await musicCur.audio.setSinkId(id);
        } catch (e) {
            $("#mb-sink").value = musicPrefs.sink;
            return showError(`その出力先に切り替えられませんでした（${e.message}）`);
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
    $("#mb-reload").addEventListener("click", () => {
        loadMusic()
            .then(() => showInfo(`曲の一覧を読み直しました（${musicList.length}曲）`))
            .catch(e => showError(e.message));
    });
    if (navigator.mediaDevices) {
        navigator.mediaDevices.addEventListener("devicechange", () => loadMusicSinks(false).catch(e => showError(`出力先の一覧を更新できませんでした（${e.message}）`)));
    }

    renderMusic();
    loadMusic().catch(e => showError(`${e.message}。サーバーが起動しているか確認してください`));
    loadMusicSinks(false).catch(e => showError(`出力先の一覧を取得できませんでした（${e.message}）`));
}
