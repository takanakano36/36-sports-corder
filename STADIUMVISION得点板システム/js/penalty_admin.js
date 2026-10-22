/* ==========================================================================
   スタジアムビジョン得点板 - 管理画面「反則」（左の列の下）
   - 反則の画像（penalties/ フォルダ）を、罰退ヤードごとにボタンで並べる
   - ボタンを押すとビジョンに全画面で出す。もう一度押すか「消す」で得点板に戻る
   ※ dashboard.js より先に読み込む（ここは関数を用意するだけ。呼び出すのは dashboard.js）
   ※ dashboard.js の部品（state・patch・$・showError など）を使う
   ========================================================================== */

let penaltyList = [];   // [{ path, no, yards, name }]（サーバーが番号順に並べて返す）

async function loadPenalties() {
    const res = await fetch("/api/penalties");
    if (!res.ok) throw new Error("反則の一覧を取得できません");
    penaltyList = await res.json();
    buildPenaltyButtons();
}

const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 罰退ヤードごとにまとめてボタンを作る（名前の決まりに合わない画像は「その他」）
function buildPenaltyButtons() {
    const holder = $("#pen-groups");
    if (penaltyList.length === 0) {
        holder.innerHTML = `<p class="note">反則の画像がありません。</p>`;
        return;
    }
    const groups = new Map();
    penaltyList.forEach(p => {
        const key = p.yards === null ? "other" : String(p.yards);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });
    // 5 → 10 → 15ヤード…の順、「その他」は最後
    const keys = [...groups.keys()].sort((a, b) => (a === "other") - (b === "other") || Number(a) - Number(b));
    holder.innerHTML = keys.map(k => `
        <div class="pen-group" data-yd="${k}">
            <h3>${k === "other" ? "その他" : `<span class="pen-yd">${k}yd</span>${k}ヤード罰退`}</h3>
            <div class="pen-btns">${groups.get(k).map(p => `
                <button type="button" data-pen="${escapeHtml(p.path)}" title="${escapeHtml(p.name)}">${p.no === null ? "" : `<span class="no">${String(p.no).padStart(2, "0")}</span>`}<span>${escapeHtml(p.name)}</span></button>`).join("")}
            </div>
        </div>`).join("");
    renderPenaltyAdmin();
}

function renderPenaltyAdmin() {
    if (!state) return;
    const cur = state.penalty;
    const hit = penaltyList.find(p => p.path === cur);
    if (cur && !hit) showError(`反則の一覧に無い画像が出ています (${cur})。「一覧を読み直す」を押してください`);
    $$("#pen-groups [data-pen]").forEach(b => b.classList.toggle("on", b.dataset.pen === cur));
    $("#pen-now").textContent = cur ? `ビジョンに表示中：${hit ? hit.name : cur}` : "表示していません";
    $(".pen-now").classList.toggle("on", !!cur);
    $("#btn-pen-hide").disabled = !cur;
}

function bindPenaltyEvents() {
    // 押した反則を出す。いま出している反則をもう一度押したら消す
    $("#pen-groups").addEventListener("click", e => {
        const b = e.target.closest("[data-pen]");
        if (!b) return;
        if (!state) return showError("まだサーバーから状態を受け取っていません。");
        patch({ penalty: state.penalty === b.dataset.pen ? "" : b.dataset.pen });
    });
    $("#btn-pen-hide").addEventListener("click", () => patch({ penalty: "" }));
    $("#btn-pen-reload").addEventListener("click", () => {
        loadPenalties()
            .then(() => showInfo(`反則の一覧を読み直しました（${penaltyList.length}件）`))
            .catch(e => showError(e.message));
    });
}
