/* ==========================================================================
   スタジアムビジョン得点板 - 表示画面
   サーバー(/events)から届いた状態をそのまま画面に反映する
   ========================================================================== */

// ファイルをダブルクリックで開いた場合（file://）や、OBSの「ローカルファイル」で開いた場合
// （http://absolute/...）はサーバーと通信できないため、サーバー経由の正しいアドレスに切り替える
if (location.protocol === "file:" || location.hostname === "absolute") {
    location.replace("http://localhost:3006/scoreboard.html");
}

const BOARD_W = 1920;
const BOARD_H = 1080;
// チーム名に使える最大の横幅（これを超える名前は横幅だけ縮める）
const NAME_MAX_WIDTH = 440;
const PERIOD_LABELS = ["1Q", "2Q", "3Q", "4Q", "OT"];

const board = document.getElementById("board");
let state = null;

// --------------------------------------------------------------------------
// ウィンドウの大きさに合わせて 1920×1080 の画面を拡大・縮小（上下左右は黒で余白）
// --------------------------------------------------------------------------
function fitToWindow() {
    const s = Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
    const x = (window.innerWidth - BOARD_W * s) / 2;
    const y = (window.innerHeight - BOARD_H * s) / 2;
    board.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}

// --------------------------------------------------------------------------
// チームカラーから、グラデーション用の明るい色・暗い色を作る
// （2色を割合で混ぜる。OBSの古いブラウザでも動くようJSで計算する）
// --------------------------------------------------------------------------
function mixHex(hex, withHex, ratio) {
    const a = hex.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16));
    const b = withHex.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16));
    return "#" + a.map((v, i) => Math.round(v * (1 - ratio) + b[i] * ratio).toString(16).padStart(2, "0")).join("");
}

function setTeamColor(prefix, hex) {
    board.style.setProperty(`--${prefix}-light`, mixHex(hex, "#ffffff", 0.18));
    board.style.setProperty(`--${prefix}`, hex);
    board.style.setProperty(`--${prefix}-dark`, mixHex(hex, "#000000", 0.45));
}

// --------------------------------------------------------------------------
// 長いチーム名は、文字の高さはそのままで横幅だけ縮める
// --------------------------------------------------------------------------
function fitName(el) {
    el.style.transform = "";
    el.style.marginRight = "";
    const w = el.offsetWidth;
    if (w > NAME_MAX_WIDTH) {
        const r = NAME_MAX_WIDTH / w;
        el.style.transform = `scaleX(${r})`;
        el.style.marginRight = `${-(w * (1 - r))}px`;
    }
}

// ロゴの形に沿って縁取りを付ける（上下左右に同じ色の影をずらして重ねる）＋黒い影で少し浮かせる
function setOutline(img, outline) {
    const w = outline.width;
    const c = outline.color;
    const ring = w > 0
        ? `drop-shadow(${w}px 0 0 ${c}) drop-shadow(-${w}px 0 0 ${c}) drop-shadow(0 ${w}px 0 ${c}) drop-shadow(0 -${w}px 0 ${c}) `
        : "";
    img.style.filter = `${ring}drop-shadow(0 8px 14px rgba(0,0,0,.45))`;
}

function setLogo(imgs, src) {
    imgs.forEach(img => {
        if (src) {
            if (img.getAttribute("src") !== src) img.src = src;
            img.classList.remove("hidden");
        } else {
            img.removeAttribute("src");
            img.classList.add("hidden");
        }
    });
}

const total = (q, period) => q.slice(0, period).reduce((s, v) => s + v, 0);

function render() {
    if (!state) return;
    const s = state;

    document.getElementById("tournament").textContent = s.tournament;

    ["home", "away"].forEach(side => {
        const t = s[side];
        setTeamColor(side === "home" ? "hc" : "ac", t.color);
        setLogo([document.getElementById(`logo-${side}`), document.getElementById(`wm-${side}`)], t.logo);
        setOutline(document.getElementById(`logo-${side}`), t.outline);
        const nameEl = document.getElementById(`name-${side}`);
        nameEl.textContent = t.name;
        fitName(nameEl);
        document.getElementById(`score-${side}`).textContent = total(t.q, s.period);
        document.getElementById(`to-${side}`).innerHTML =
            [0, 1, 2].map(i => `<i class="${i < t.to ? "on" : ""}"></i>`).join("");
        document.getElementById(`poss-${side}`).classList.toggle("off", s.possession !== side);
    });

    // Q別得点：まだ始まっていないQは空欄、OTの行はOTになった時だけ出す
    let html = "";
    PERIOD_LABELS.forEach((label, i) => {
        if (i === 4 && s.period !== 5) return;
        const played = i + 1 <= s.period;
        html += `<tr class="${i + 1 === s.period ? "cur" : ""}">` +
            `<td class="qs">${played ? s.home.q[i] : ""}</td>` +
            `<td class="ql">${label}</td>` +
            `<td class="qs">${played ? s.away.q[i] : ""}</td></tr>`;
    });
    html += `<tr class="total"><td class="qs">${total(s.home.q, s.period)}</td><td class="ql">TOTAL</td><td class="qs">${total(s.away.q, s.period)}</td></tr>`;
    document.getElementById("qtable").innerHTML = html;

    // ダウン＆BALL ON（それぞれ表示・非表示を選べる。両方非表示なら帯ごと消す）
    const downLabel = ["1st", "2nd", "3rd", "4th"][s.down - 1];
    document.getElementById("down").textContent = `${downLabel} & ${s.togo}`;
    document.getElementById("ballon").textContent = s.ballOn;
    document.getElementById("down").classList.toggle("hidden", !s.showDown);
    document.getElementById("ball").classList.toggle("hidden", !s.showBall);
    document.getElementById("dd-sep").classList.toggle("hidden", !(s.showDown && s.showBall));
    document.getElementById("ddbar").classList.toggle("hidden", !s.showDown && !s.showBall);

    board.classList.remove("waiting");
}

// --------------------------------------------------------------------------
// サーバーとの接続（切れても自動で再接続。切れている間は最後の表示を保つ）
// --------------------------------------------------------------------------
function connect() {
    const es = new EventSource("/events");
    es.addEventListener("UPDATE_STATE", ev => {
        state = JSON.parse(ev.data);
        render();
    });
    es.onerror = () => console.warn("サーバーとの接続が切れました。自動で再接続します。");
}

// --------------------------------------------------------------------------
// 表示中は画面をスリープさせない（試合中にビジョンが真っ暗になるのを防ぐ）
// ※画面が隠れると解除されるため、再び見えたときに取り直す
// --------------------------------------------------------------------------
async function keepScreenOn() {
    if (!("wakeLock" in navigator)) {
        console.warn("このブラウザは画面のスリープ防止に対応していません。Windowsの電源設定で画面をオフにしない設定にしてください。");
        return;
    }
    try {
        await navigator.wakeLock.request("screen");
    } catch (e) {
        console.warn(`画面のスリープ防止を設定できませんでした: ${e.message}`);
    }
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") keepScreenOn();
});

window.addEventListener("resize", fitToWindow);
fitToWindow();
connect();
keepScreenOn();
// フォント読み込み後は文字の幅が変わるので、チーム名の縮め具合を計算し直す
document.fonts.ready.then(render);
