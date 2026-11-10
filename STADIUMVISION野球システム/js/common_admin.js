/* ==========================================================================
   スタジアムビジョン野球システム - 管理画面の共通部品
   （music_admin.js・dashboard.js から使う。いちばん先に読み込む）
   ========================================================================== */

// ファイルをダブルクリックで開いた場合（file://）はサーバーと通信できないため、
// サーバー経由の正しいアドレスに切り替える
if (location.protocol === "file:") {
    location.replace("http://localhost:3007/");
}

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const clone = obj => JSON.parse(JSON.stringify(obj));
const escapeHtml = v => String(v === undefined || v === null ? "" : v)
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --------------------------------------------------------------------------
// エラー・お知らせの表示（数秒で消える）
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

const SERVER_NG = "サーバーにつながりません。サーバーの画面（「野球ビジョン 管理画面」で開いた黒い画面）が開いたままか確認してください。";
