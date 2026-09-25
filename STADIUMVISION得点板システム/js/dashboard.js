/* ==========================================================================
   スタジアムビジョン得点板 - 管理画面
   - 得点の加算・タイムアウト増減などは /api/control（サーバー側で計算）
     ※ボタンを素早く連打しても数え漏れが起きないようにするため
   - 名前・ロゴ・色などは、「変えた項目だけ」を /api/state へ送る
     ※まとめて送ると、ほぼ同時に変えた別の項目を古い値で上書きしてしまうため
   - 画面の表示は、サーバーから届いた状態(/events)だけをもとに更新する
   ========================================================================== */

// ファイルをダブルクリックで開いた場合（file://）はサーバーと通信できないため、
// サーバー経由の正しいアドレスに切り替える
if (location.protocol === "file:") {
    location.replace("http://localhost:3006/");
}

// OBSに入れる表示画面のアドレス
// layer-width / layer-height は、OBSにドラッグ＆ドロップしたときにブラウザソースの大きさ(1920×1080)として使われる
const OBS_URL = `${location.origin}/scoreboard.html?layer-width=1920&layer-height=1080`;

const SIDES = ["home", "away"];
const SIDE_LABEL = { home: "左チーム", away: "右チーム" };
let state = null;
let logoList = [];

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const clone = obj => JSON.parse(JSON.stringify(obj));
const total = (q, period) => q.slice(0, period).reduce((s, v) => s + v, 0);

// --------------------------------------------------------------------------
// エラー表示（数秒で消える）
// --------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg, isInfo) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("info", !!isInfo);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 5000);
}
const showError = msg => showToast(msg, false);
const showInfo = msg => showToast(msg, true);

function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// --------------------------------------------------------------------------
// サーバーへの送信
// --------------------------------------------------------------------------
async function control(action, params = {}) {
    const q = new URLSearchParams({ action, ...params });
    try {
        const res = await fetch(`/api/control?${q}`);
        const body = await res.json();
        if (!res.ok) showError(`反映できませんでした：${body.error}`);
    } catch (e) {
        showError("サーバーにつながりません。「サーバー起動.bat」の黒い画面が開いているか確認してください。");
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
            render(); // 入力欄を今の正しい値に戻す
        }
    } catch (e) {
        showError("サーバーにつながりません。「サーバー起動.bat」の黒い画面が開いているか確認してください。");
    }
}

// --------------------------------------------------------------------------
// ロゴ一覧・ロゴの色候補
// --------------------------------------------------------------------------
async function loadLogos() {
    const res = await fetch("/api/logos");
    if (!res.ok) throw new Error("ロゴ一覧を取得できません");
    logoList = await res.json();
    $$(".logo-select").forEach(sel => {
        sel.innerHTML = `<option value="">（ロゴなし）</option>` +
            logoList.map(p => `<option value="${p}">${p.replace(/^logos\//, "")}</option>`).join("");
    });
}

// ロゴ画像の中で多く使われている色（白っぽい色と透明部分は除く）を最大4つ取り出す
const colorCache = {};
function logoColors(src) {
    if (colorCache[src]) return colorCache[src];
    colorCache[src] = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const N = 120;
            const cv = document.createElement("canvas");
            cv.width = N; cv.height = N;
            const ctx = cv.getContext("2d");
            ctx.drawImage(img, 0, 0, N, N);
            const d = ctx.getImageData(0, 0, N, N).data;
            const buckets = {};
            for (let i = 0; i < d.length; i += 4) {
                const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
                if (a < 200 || Math.min(r, g, b) > 225) continue;
                const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
                const k = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
                k.n++; k.r += r; k.g += g; k.b += b;
            }
            const hex = v => Math.round(v).toString(16).padStart(2, "0");
            resolve(Object.values(buckets)
                .sort((x, y) => y.n - x.n)
                .slice(0, 4)
                .map(k => `#${hex(k.r / k.n)}${hex(k.g / k.n)}${hex(k.b / k.n)}`));
        };
        img.onerror = () => reject(new Error(`ロゴ画像を読み込めません (${src})`));
        img.src = src;
    });
    return colorCache[src];
}

// --------------------------------------------------------------------------
// 画面の更新（入力中の欄は書き換えない）
// --------------------------------------------------------------------------
function setValue(el, v) {
    if (document.activeElement !== el) el.value = v;
}

function buildQEdit() {
    SIDES.forEach(side => {
        const row = $(`.qedit tr[data-side="${side}"]`);
        for (let i = 0; i < 5; i++) {
            const td = document.createElement("td");
            td.innerHTML = `<input type="number" min="0" max="199" data-q="${i}">`;
            row.appendChild(td);
        }
        const sum = document.createElement("td");
        sum.className = "sum";
        sum.dataset.sum = side;
        row.appendChild(sum);
    });
}

function render() {
    if (!state) return;
    const s = state;

    SIDES.forEach(side => {
        const t = s[side];
        const label = t.name || SIDE_LABEL[side];
        $$(`[data-label="${side}"]`).forEach(el => { el.textContent = label; });
        $$(`[data-swatch="${side}"]`).forEach(el => { el.style.background = t.color; });
        $$(`[data-total="${side}"]`).forEach(el => { el.textContent = total(t.q, s.period); });
        $$(`[data-dots="${side}"]`).forEach(el => {
            el.innerHTML = [0, 1, 2].map(i => `<i class="${i < t.to ? "on" : ""}"></i>`).join("");
        });

        // Qごとの得点表
        const row = $(`.qedit tr[data-side="${side}"]`);
        row.querySelectorAll("input[data-q]").forEach(inp => {
            const i = Number(inp.dataset.q);
            setValue(inp, t.q[i]);
            inp.parentElement.classList.toggle("cur", i + 1 === s.period);
        });
        row.querySelector("[data-sum]").textContent = total(t.q, s.period);

        // チーム設定
        const box = $(`.team-setting[data-side="${side}"]`);
        setValue(box.querySelector('[data-field="name"]'), t.name);
        const sel = box.querySelector('[data-field="logo"]');
        if (t.logo && !logoList.includes(t.logo)) {
            showError(`ロゴ一覧に無いロゴが指定されています (${t.logo})`);
        }
        sel.value = t.logo;
        const thumb = box.querySelector("[data-thumb]");
        if (t.logo) thumb.src = t.logo; else thumb.removeAttribute("src");
        setValue(box.querySelector('[data-field="color"]'), t.color);
        setValue(box.querySelector('[data-field="colorText"]'), t.color);
        // ロゴの縁取り
        setValue(box.querySelector('[data-field="outlineColor"]'), t.outline.color);
        setValue(box.querySelector('[data-field="outlineWidth"]'), t.outline.width);
        box.querySelector("[data-ow]").textContent = t.outline.width;
        box.querySelectorAll("[data-oc]").forEach(b => {
            const c = b.dataset.oc === "team" ? t.color : b.dataset.oc;
            b.classList.toggle("on", t.outline.width > 0 && c.toLowerCase() === t.outline.color.toLowerCase());
        });
        box.querySelector("[data-ow-set]").classList.toggle("on", t.outline.width === 0);
        renderCandidates(box, t.logo);
    });

    $$("#period button").forEach(b => b.classList.toggle("on", Number(b.dataset.period) === s.period));
    $$("#possession button").forEach(b => b.classList.toggle("on", b.dataset.poss === s.possession));
    $$("#down button").forEach(b => b.classList.toggle("on", Number(b.dataset.down) === s.down));
    $$("#togo button").forEach(b => b.classList.toggle("on", b.dataset.togo === s.togo));
    setValue($("#togo-num"), /^\d+$/.test(s.togo) ? s.togo : "");
    setValue($("#ballon"), s.ballOn);
    $("#show-down").checked = s.showDown;
    $("#show-ball").checked = s.showBall;
    setValue($("#tournament"), s.tournament);
}

function renderCandidates(box, logo) {
    const holder = box.querySelector("[data-cands]");
    if (holder.dataset.logo === logo) return;
    holder.dataset.logo = logo;
    holder.innerHTML = "";
    if (!logo) return;
    logoColors(logo).then(colors => {
        if (holder.dataset.logo !== logo) return;
        holder.innerHTML = colors.map(c => `<button type="button" title="${c}" data-cand="${c}" style="background:${c}"></button>`).join("");
    }).catch(e => showError(e.message));
}

// --------------------------------------------------------------------------
// サーバーとの接続
// --------------------------------------------------------------------------
function connect() {
    const conn = $("#conn");
    const es = new EventSource("/events");
    es.onopen = () => { conn.textContent = "サーバー接続中"; conn.className = "conn ok"; };
    es.onerror = () => { conn.textContent = "サーバーに接続できません"; conn.className = "conn ng"; };
    es.addEventListener("UPDATE_STATE", ev => {
        state = JSON.parse(ev.data);
        render();
    });
}

// --------------------------------------------------------------------------
// 操作の割り当て
// --------------------------------------------------------------------------
function sideOf(el) {
    return el.closest("[data-side]").dataset.side;
}

function bindTextField(inp, toPatch) {
    const send = debounce(v => patch(toPatch(v)), 400);
    inp.addEventListener("input", () => send(inp.value));
    inp.addEventListener("change", () => patch(toPatch(inp.value)));
}

function bindEvents() {
    // クォーター
    $$("#period button").forEach(b => b.addEventListener("click", () => control("setPeriod", { val: b.dataset.period })));

    // 得点（いまのQに加算）
    $$(".score-btns button").forEach(b => b.addEventListener("click", () =>
        control("addScore", { team: sideOf(b), val: b.dataset.add })));

    // Qごとの得点の直接修正
    $$(".qedit input[data-q]").forEach(inp => inp.addEventListener("change", () => {
        const v = inp.value.trim();
        if (!/^\d{1,3}$/.test(v) || Number(v) > 199) {
            showError("得点は0〜199の整数で入力してください");
            inp.blur();
            render();
            return;
        }
        control("setQ", { team: sideOf(inp), q: Number(inp.dataset.q) + 1, val: v });
    }));

    // タイムアウト
    $$(".to-team button").forEach(b => b.addEventListener("click", () =>
        control("adjustTO", { team: sideOf(b), val: b.dataset.to })));
    $("#btn-reset-to").addEventListener("click", () => control("resetTO"));

    // 攻撃権
    $$("#possession button").forEach(b => b.addEventListener("click", () => control("setPossession", { val: b.dataset.poss })));

    // ダウン・残り距離
    $$("#down button").forEach(b => b.addEventListener("click", () => control("setDown", { val: b.dataset.down })));
    $$("#togo button").forEach(b => b.addEventListener("click", () => control("setToGo", { val: b.dataset.togo })));
    $("#togo-num").addEventListener("change", e => control("setToGo", { val: e.target.value.trim() }));
    $("#btn-first10").addEventListener("click", () => patch({ down: 1, togo: "10" }));
    $("#show-down").addEventListener("change", e => patch({ showDown: e.target.checked }));

    // BALL ON（1〜50の範囲で増減）
    $$("[data-ball]").forEach(b => b.addEventListener("click", () => {
        if (!state) return;
        const v = Math.max(1, Math.min(50, state.ballOn + Number(b.dataset.ball)));
        control("setBallOn", { val: v });
    }));
    $("#ballon").addEventListener("change", e => control("setBallOn", { val: e.target.value.trim() }));
    $("#show-ball").addEventListener("change", e => patch({ showBall: e.target.checked }));

    // 大会名・チーム名（入力の手が止まったら反映。入力欄から離れたときはすぐ反映）
    // ※送る文字は入力した時点で確定させる（送る前に画面の更新で欄が書き戻されても、入力した文字を送る）
    bindTextField($("#tournament"), v => ({ tournament: v }));
    $$('.team-setting [data-field="name"]').forEach(inp => bindTextField(inp, v => ({ [sideOf(inp)]: { name: v } })));

    // ロゴ
    $$('.team-setting [data-field="logo"]').forEach(sel => sel.addEventListener("change", () =>
        patch({ [sideOf(sel)]: { logo: sel.value } })));
    $$(".team-setting [data-upload]").forEach(inp => inp.addEventListener("change", () => uploadLogo(inp)));

    // チームカラー（カラーチャート／色番号の入力／ロゴの色候補）
    $$('.team-setting [data-field="color"]').forEach(inp => inp.addEventListener("input",
        debounce(() => patch({ [sideOf(inp)]: { color: inp.value } }), 80)));
    $$('.team-setting [data-field="colorText"]').forEach(inp => inp.addEventListener("change", () => {
        const v = inp.value.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
            showError("色番号は #7b1936 のように「#」と英数字6桁で入力してください");
            inp.blur();
            render();
            return;
        }
        patch({ [sideOf(inp)]: { color: v.toLowerCase() } });
    }));
    $$(".team-setting [data-cands]").forEach(holder => holder.addEventListener("click", e => {
        const c = e.target.dataset.cand;
        if (c) patch({ [sideOf(holder)]: { color: c } });
    }));

    // OBSに入れる（ドラッグ＆ドロップ／アドレスのコピー）
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
            showInfo("アドレスをコピーしました。OBSのブラウザソースのURL欄に貼り付けてください（幅1920・高さ1080）。");
        } catch (e) {
            showError(`コピーできませんでした。次のアドレスを手で入力してください：${OBS_URL}`);
        }
    });

    // ロゴの縁取り（色：ボタン／カラーチャート、太さ：つまみ）
    $$(".team-setting [data-oc]").forEach(b => b.addEventListener("click", () => {
        if (!state) return showError("まだサーバーから状態を受け取っていません。");
        const side = sideOf(b);
        const color = b.dataset.oc === "team" ? state[side].color : b.dataset.oc;
        // 縁取りなし(太さ0)のときに色を選んだら、見えるように太さも初期値の5に戻す
        const outline = state[side].outline.width === 0 ? { color, width: 5 } : { color };
        patch({ [side]: { outline } });
    }));
    $$('.team-setting [data-field="outlineColor"]').forEach(inp => inp.addEventListener("input",
        debounce(() => patch({ [sideOf(inp)]: { outline: { color: inp.value } } }), 80)));
    $$('.team-setting [data-field="outlineWidth"]').forEach(inp => {
        inp.addEventListener("input", () => { inp.closest(".field").querySelector("[data-ow]").textContent = inp.value; });
        inp.addEventListener("input", debounce(() => patch({ [sideOf(inp)]: { outline: { width: Number(inp.value) } } }), 80));
    });
    $$(".team-setting [data-ow-set]").forEach(b => b.addEventListener("click", () =>
        patch({ [sideOf(b)]: { outline: { width: Number(b.dataset.owSet) } } })));

    // 上部のボタン
    $("#btn-open-output").addEventListener("click", () => {
        window.open("scoreboard.html", "stadiumvision_output", "width=1280,height=720");
    });
    $("#btn-swap").addEventListener("click", () => {
        if (!state) return showError("まだサーバーから状態を受け取っていません。");
        patch({
            home: clone(state.away),
            away: clone(state.home),
            possession: { home: "away", away: "home", none: "none" }[state.possession]
        });
    });
    $("#btn-reset").addEventListener("click", () => {
        if (!confirm("得点・クォーター・タイムアウト・攻撃権・ダウンを試合開始前の状態に戻します。\n（大会名・チーム名・ロゴ・色はそのまま）\nよろしいですか？")) return;
        patch({
            home: { q: [0, 0, 0, 0, 0], to: 3 },
            away: { q: [0, 0, 0, 0, 0], to: 3 },
            period: 1,
            possession: "none",
            down: 1,
            togo: "10",
            ballOn: 25
        });
    });
}

async function uploadLogo(inp) {
    const file = inp.files[0];
    inp.value = "";
    if (!file) return;
    const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("画像を読み込めません"));
        r.readAsDataURL(file);
    });
    const res = await fetch("/api/logos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, dataUrl })
    });
    const body = await res.json();
    if (!res.ok) {
        showError(`ロゴを追加できませんでした：${body.error}`);
        return;
    }
    await loadLogos();
    patch({ [sideOf(inp)]: { logo: body.path } });
}

// --------------------------------------------------------------------------
// 起動
// --------------------------------------------------------------------------
buildQEdit();
bindEvents();
loadLogos()
    .then(connect)
    .catch(e => showError(`${e.message}。「サーバー起動.bat」でサーバーを起動してから開いてください。`));
