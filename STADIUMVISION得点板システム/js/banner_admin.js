/* ==========================================================================
   スタジアムビジョン得点板 - 管理画面「対戦バナー」
   - 試合の情報（大会名・日付・会場・リーグロゴ）と対戦の一覧を登録する
   - 「バナーを出す」で、表示画面に①②①②…の順に決めた秒数ごとに切り替えて出す
   ※ dashboard.js の部品（state・patch・control・ロゴの一覧など）を使う
   ========================================================================== */

const CIRCLED = "①②③④⑤⑥⑦⑧";
const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];
let bnBuiltKey = null;   // 対戦カードを作り直す必要があるか（対戦の並びが変わったとき）

function requireState() {
    if (!state) showError("まだサーバーから状態を受け取っていません。");
    return !!state;
}

// 対戦の一覧をまとめて書き換えて送る（常に最新の状態をもとにする）
function updateMatches(fn) {
    if (!requireState()) return;
    const matches = clone(state.banner.matches);
    if (fn(matches) === false) return;
    patch({ banner: { matches } });
}

function updateMatch(id, fn) {
    updateMatches(ms => {
        const m = ms.find(x => x.id === id);
        if (!m) { showError("その対戦が見つかりません（ほかの人が削除した可能性があります）"); return false; }
        fn(m);
    });
}

function newMatchId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// いまの得点板のチームから、バナー用のチームを作る
function teamFromScoreboard(t) {
    return { name: t.name, nick: "", color: t.color, logo: t.logo, outline: clone(t.outline), logoScale: 100 };
}

// --------------------------------------------------------------------------
// 対戦カード
// --------------------------------------------------------------------------
function teamHtml(side) {
    return `<div class="mc-team" data-side="${side}">
        <h3>${side === "home" ? "左チーム" : "右チーム"}</h3>
        <label class="field">大学名<input type="text" class="text-input" maxlength="30" data-tf="name"></label>
        <label class="field">ニックネーム<input type="text" class="text-input" maxlength="30" data-tf="nick" placeholder="例：PANTHERS"></label>
        <div class="field">ロゴ
            <div class="logo-row">
                <img class="logo-thumb" data-thumb alt="">
                <select class="logo-select" data-tf="logo"></select>
                <label class="btn small file-btn">画像を追加<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" data-tf-upload hidden></label>
            </div>
        </div>
        <div class="field">チームカラー
            <div class="color-row"><input type="color" data-tf="color"><span class="cand-label">ロゴの色：</span><span class="cands" data-cands></span></div>
        </div>
        <div class="field">ロゴの縁取り
            <div class="outline-row"><input type="color" data-tf="outlineColor" title="縁取りの色"><span class="lbl-sub">太さ</span><input type="range" min="0" max="12" step="1" data-tf="outlineWidth"><b class="ow" data-ow></b></div>
        </div>
        <div class="field">ロゴの大きさ <small class="hint">（横長のロゴは大きめに）</small>
            <div class="outline-row"><input type="range" min="50" max="200" step="5" data-tf="logoScale"><b class="ow" data-ls></b></div>
        </div>
    </div>`;
}

function cardHtml(m, i, n) {
    return `<div class="match-card" data-id="${m.id}">
        <div class="mc-head">
            <b class="mc-no">${CIRCLED[i]}</b>
            <label class="mc-ko">キックオフ <input type="time" data-mf="kickoff" class="num-input"></label>
            <span class="mc-spacer"></span>
            <button type="button" class="btn small" data-act="apply" title="この対戦のチームを得点板のチーム設定に入れます">得点板に入れる</button>
            <button type="button" class="btn small" data-act="up" ${i === 0 ? "disabled" : ""}>▲</button>
            <button type="button" class="btn small" data-act="down" ${i === n - 1 ? "disabled" : ""}>▼</button>
            <button type="button" class="btn small danger" data-act="del">削除</button>
        </div>
        <div class="mc-teams">${teamHtml("home")}<div class="mc-vs">VS</div>${teamHtml("away")}</div>
    </div>`;
}

function fillLogoSelect(sel) {
    sel.innerHTML = `<option value="">（ロゴなし）</option>` +
        logoList.map(p => `<option value="${p}">${p.replace(/^logos\//, "")}</option>`).join("");
}

function buildMatchCards(matches) {
    const box = $("#bn-matches");
    box.innerHTML = matches.length
        ? matches.map((m, i) => cardHtml(m, i, matches.length)).join("")
        : `<p class="note">まだ対戦が登録されていません。下の「＋ 対戦を追加」から登録してください。</p>`;
    box.querySelectorAll(".logo-select").forEach(fillLogoSelect);
}

function renderMatchCards(b) {
    const key = b.matches.map(m => m.id).join(",");
    if (key !== bnBuiltKey) {
        bnBuiltKey = key;
        buildMatchCards(b.matches);
    }
    b.matches.forEach(m => {
        const card = $(`.match-card[data-id="${m.id}"]`);
        setValue(card.querySelector('[data-mf="kickoff"]'), m.kickoff);
        ["home", "away"].forEach(side => {
            const t = m[side];
            const box = card.querySelector(`.mc-team[data-side="${side}"]`);
            setValue(box.querySelector('[data-tf="name"]'), t.name);
            setValue(box.querySelector('[data-tf="nick"]'), t.nick);
            const sel = box.querySelector('[data-tf="logo"]');
            if (t.logo && !logoList.includes(t.logo)) showError(`ロゴ一覧に無いロゴが指定されています (${t.logo})`);
            sel.value = t.logo;
            const thumb = box.querySelector("[data-thumb]");
            if (t.logo) thumb.src = t.logo; else thumb.removeAttribute("src");
            setValue(box.querySelector('[data-tf="color"]'), t.color);
            setValue(box.querySelector('[data-tf="outlineColor"]'), t.outline.color);
            setValue(box.querySelector('[data-tf="outlineWidth"]'), t.outline.width);
            box.querySelector("[data-ow]").textContent = t.outline.width;
            setValue(box.querySelector('[data-tf="logoScale"]'), t.logoScale);
            box.querySelector("[data-ls]").textContent = `${t.logoScale}%`;
            renderCandidates(box, t.logo);
        });
    });
    $("#bn-add").disabled = b.matches.length >= 8;
}

// --------------------------------------------------------------------------
// 画面の更新（dashboard.js の render から呼ばれる）
// --------------------------------------------------------------------------
function renderBannerAdmin() {
    if (!state) return;
    const b = state.banner;

    // 表示中かどうか
    const toggle = $("#btn-banner-toggle");
    toggle.textContent = b.active ? "得点板に戻る" : "対戦バナーを出す";
    toggle.classList.toggle("on", b.active);
    $("#bn-status").textContent = b.active
        ? `いま対戦バナーを表示中です（${b.matches.length}件を${b.interval}秒ごとに切り替え）`
        : "いまは得点板を表示中です";
    $("#bn-status").classList.toggle("on", b.active);
    $("#bn-show").disabled = b.matches.length === 0;

    // 試合の情報（全対戦で共通）
    setValue($("#bn-tournament"), state.tournament);
    setValue($("#bn-date"), b.date);
    if (b.date) {
        const [y, m, d] = b.date.split("-").map(Number);
        $("#bn-dow-label").textContent = `（${DOW_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}曜日）`;
    } else {
        $("#bn-dow-label").textContent = "";
    }
    setValue($("#bn-venue"), b.venue);
    setValue($("#bn-interval"), b.interval);
    $("#bn-footer").checked = b.footer;
    const league = $("#bn-league");
    if (b.leagueLogo && !logoList.includes(b.leagueLogo)) showError(`ロゴ一覧に無いロゴが指定されています (${b.leagueLogo})`);
    league.value = b.leagueLogo;
    const lt = $("#bn-league-thumb");
    if (b.leagueLogo) lt.src = b.leagueLogo; else lt.removeAttribute("src");

    renderMatchCards(b);
}

// --------------------------------------------------------------------------
// 操作の割り当て
// --------------------------------------------------------------------------
function cardOf(el) { return el.closest(".match-card").dataset.id; }

// 入力の手が止まったら送る（送る値は入力した時点で確定させる）。要素ごとに1つ用意する
function debouncedFor(el, ms, fn) {
    if (!el._bnSend) el._bnSend = debounce(fn, ms);
    return el._bnSend;
}

function onTeamField(el, value, immediate) {
    const id = cardOf(el);
    const side = el.closest(".mc-team").dataset.side;
    const f = el.dataset.tf;
    const apply = v => updateMatch(id, m => {
        const t = m[side];
        if (f === "outlineColor") t.outline.color = v;
        else if (f === "outlineWidth") t.outline.width = Number(v);
        else if (f === "logoScale") t.logoScale = Number(v);
        else t[f] = v;
    });
    if (immediate) apply(value);
    else debouncedFor(el, f === "name" || f === "nick" ? 400 : 80, apply)(value);
}

function bindBannerEvents() {
    // タブの切り替え（最後に開いていたタブを覚えておく）
    const showTab = tab => {
        $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
        $("#view-score").classList.toggle("hidden", tab !== "score");
        $("#view-banner").classList.toggle("hidden", tab !== "banner");
        try { localStorage.setItem("sv-tab", tab); } catch (e) { /* 保存できなくても表示には影響しない */ }
    };
    $$("#tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
    let saved = "score";
    try { saved = localStorage.getItem("sv-tab") || "score"; } catch (e) { saved = "score"; }
    showTab(saved === "banner" ? "banner" : "score");

    // OBSに対戦バナー専用を入れる（ドラッグ＆ドロップ／アドレスのコピー）
    const bnObsUrl = `${location.origin}/scoreboard.html?only=banner&layer-width=1920&layer-height=1080`;
    const drag = $("#bn-obs-drag");
    drag.href = bnObsUrl;
    drag.addEventListener("click", e => {
        e.preventDefault();
        showInfo("このボタンを、クリックではなくOBSの画面へドラッグ＆ドロップしてください。");
    });
    drag.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/uri-list", bnObsUrl);
        e.dataTransfer.setData("text/plain", bnObsUrl);
    });
    $("#bn-copy-url").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(bnObsUrl);
            showInfo("バナー専用のアドレスをコピーしました。OBSのブラウザソースのURL欄に貼り付けてください（幅1920・高さ1080）。");
        } catch (e) {
            showError(`コピーできませんでした。次のアドレスを手で入力してください：${bnObsUrl}`);
        }
    });

    // 出す／戻る
    $("#btn-banner-toggle").addEventListener("click", () => {
        if (!requireState()) return;
        control(state.banner.active ? "hideBanner" : "showBanner");
    });
    $("#bn-show").addEventListener("click", () => control("showBanner"));
    $("#bn-hide").addEventListener("click", () => control("hideBanner"));

    // 試合の情報（全対戦で共通）
    bindTextField($("#bn-tournament"), v => ({ tournament: v }));
    $("#bn-date").addEventListener("change", e => patch({ banner: { date: e.target.value } }));
    bindTextField($("#bn-venue"), v => ({ banner: { venue: v } }));
    $("#bn-interval").addEventListener("change", e => {
        const v = e.target.value.trim();
        if (!/^\d{1,3}$/.test(v) || Number(v) < 5 || Number(v) > 600) {
            showError("切り替えの秒数は5〜600の整数で入力してください");
            e.target.blur();
            render();
            return;
        }
        patch({ banner: { interval: Number(v) } });
    });
    $("#bn-footer").addEventListener("change", e => patch({ banner: { footer: e.target.checked } }));
    $("#bn-league").addEventListener("change", e => patch({ banner: { leagueLogo: e.target.value } }));
    $("#bn-league-upload").addEventListener("change", e => uploadLogo(e.target, p => patch({ banner: { leagueLogo: p } })));

    // 対戦の追加（いまの得点板のチームで作る）
    $("#bn-add").addEventListener("click", () => updateMatches(ms => {
        if (ms.length >= 8) { showError("対戦は8件までです"); return false; }
        ms.push({ id: newMatchId(), kickoff: "", home: teamFromScoreboard(state.home), away: teamFromScoreboard(state.away) });
    }));

    // 対戦カードの中の操作（カードは作り直されるので、外側の箱でまとめて受ける）
    const box = $("#bn-matches");
    box.addEventListener("input", e => {
        const el = e.target;
        if (el.dataset.tf === "outlineWidth") el.closest(".field").querySelector("[data-ow]").textContent = el.value;
        if (el.dataset.tf === "logoScale") el.closest(".field").querySelector("[data-ls]").textContent = `${el.value}%`;
        if (el.dataset.tf && el.dataset.tf !== "logo") onTeamField(el, el.value, false);
    });
    box.addEventListener("change", e => {
        const el = e.target;
        if (el.dataset.mf === "kickoff") updateMatch(cardOf(el), m => { m.kickoff = el.value; });
        else if (el.dataset.tf === "logo") onTeamField(el, el.value, true);
        else if (el.dataset.tf === "name" || el.dataset.tf === "nick") onTeamField(el, el.value, true);
        else if (el.hasAttribute("data-tf-upload")) {
            const id = cardOf(el);
            const side = el.closest(".mc-team").dataset.side;
            uploadLogo(el, p => updateMatch(id, m => { m[side].logo = p; }));
        }
    });
    box.addEventListener("click", e => {
        const cand = e.target.dataset.cand;
        if (cand) {
            const id = cardOf(e.target);
            const side = e.target.closest(".mc-team").dataset.side;
            updateMatch(id, m => { m[side].color = cand; });
            return;
        }
        const act = e.target.dataset.act;
        if (!act) return;
        const id = cardOf(e.target);
        if (act === "up" || act === "down") {
            updateMatches(ms => {
                const i = ms.findIndex(x => x.id === id);
                const j = act === "up" ? i - 1 : i + 1;
                if (i < 0 || j < 0 || j >= ms.length) return false;
                [ms[i], ms[j]] = [ms[j], ms[i]];
            });
        } else if (act === "del") {
            const m = state.banner.matches.find(x => x.id === id);
            if (!m || !confirm(`「${m.home.name || "左チーム"} vs ${m.away.name || "右チーム"}」を削除します。よろしいですか？`)) return;
            updateMatches(ms => ms.splice(ms.findIndex(x => x.id === id), 1));
        } else if (act === "apply") {
            const m = state.banner.matches.find(x => x.id === id);
            if (!m || !confirm(`得点板のチームを「${m.home.name} vs ${m.away.name}」にします（大学名・ロゴ・チームカラー・縁取り）。\n得点やタイムアウトはそのままです。よろしいですか？`)) return;
            const pick = t => ({ name: t.name, color: t.color, logo: t.logo, outline: clone(t.outline) });
            patch({ home: pick(m.home), away: pick(m.away) });
            showInfo("得点板のチームに入れました");
        }
    });
}

bindBannerEvents();
