/* ==========================================================================
   アメフト中継用スポーツコーダー - 配信オーバーレイ用 JS
   ========================================================================== */

// 出力モード判定 (URL引数 ?mode=fill または ?mode=key)
(function initOutputMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'fill') {
        document.body.classList.add('fill-mode');
        document.body.classList.remove('key-mode');
    } else if (modeParam === 'key') {
        document.body.classList.add('key-mode');
        document.body.classList.remove('fill-mode');
    }
})();

// デフォルトの状態（初期プレビュー用）
const defaultState = {
    homeName: "HOME TEAM",
    homeSub: "HOME",
    homeColor: "#991b1b",
    homeLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iIzk5MWIxYiIvPjwvc3ZnPg==",
    homeScore: 0,
    homeTO: 3,

    awayName: "AWAY TEAM",
    awaySub: "AWAY",
    awayColor: "#1d4ed8",
    awayLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgZmlsbD0iIzFkNGVkOCIvPjwvc3ZnPg==",
    awayScore: 0,
    awayTO: 3,

    tournament: "",
    currentPeriod: "1Q",
    timerMinutes: 15,
    timerSeconds: 0,
    timerRunning: false,
    playclock: 40,

    gameClockImage: "",
    playClockImage: "",

    possession: "none",
    down: 1,
    togo: "10",
    ddVisible: true, // D&Dの表示状態

    flagActive: false,
    showOT: false,

    displayMode: "large",

    ransko: {
        home: [0, 0, 0, 0, 0],
        away: [0, 0, 0, 0, 0]
    },

    oneshot: {
        active: false,
        number: "1",
        position: "QB",
        name: "関根 怜玖",
        grade: "4年",
        comment: "名城のエースQB、抜群 of パス精度で攻撃陣を牽引",
        team: "HOME"
    },

    imageTelop: {
        active: false,
        url: ""
    },

    roster: [
        { team: "HOME", side: "offense", number: "52", position: "LT", name: "矢野 耕亮", memo: "4年", comment: "強靭な下半身でパスプロテクションの要を担う。" },
        { team: "HOME", side: "offense", number: "56", position: "LG", name: "関 凛晟", memo: "2年", comment: "鋭い踏み込みでランコースをこじ開ける若き盾。" },
        { team: "HOME", side: "offense", number: "59", position: "C", name: "高松 碧仁", memo: "4年", comment: "正確なスナップと冷静なアジャストでラインを統率。" },
        { team: "HOME", side: "offense", number: "70", position: "RG", name: "蔵石 大和", memo: "3年", comment: "破壊力抜群のブロッキングで道を切り拓く。" },
        { team: "HOME", side: "offense", number: "77", position: "RT", name: "高橋 優斗", memo: "4年", comment: "圧倒的なフィジカルでエッジを死守する巨漢。" },
        { team: "HOME", side: "offense", number: "1", position: "QB", name: "関根 怜玖", memo: "4年", comment: "抜群のパス精度と高いアメフトIQで攻撃陣を牽引。" },
        { team: "HOME", side: "offense", number: "25", position: "RB", name: "松田 吟", memo: "4年", comment: "俊敏なカットバックと粘り強いランが武器のエース。" },
        { team: "HOME", side: "offense", number: "6", position: "WR", name: "岩崎 太亮", memo: "4年", comment: "卓越したキャッチ技術を誇るディープスレット。" },
        { team: "HOME", side: "offense", number: "2", position: "WR", name: "山本 羚王", memo: "1年", comment: "圧倒的なスプリント力を持つ期待のルーキー。" },
        { team: "HOME", side: "offense", number: "31", position: "WR", name: "能代 真紘", memo: "2年", comment: "インサイドでの確実なキャッチでファーストダウンを獲得。" },
        { team: "HOME", side: "offense", number: "88", position: "TE", name: "河村 剛宇", memo: "4年", comment: "ブロック・キャッチ共に高次元でこなす万能型。" },
        { team: "HOME", side: "offense", number: "8", position: "P", name: "平野 翔大", memo: "1年", comment: "滞空時間の長いハングタイムパントで陣地を回復。" }
    ],

    chromaKey: "green"
};

// 最新の状態
let state = Object.assign({}, defaultState);

// BroadcastChannel
const channel = new BroadcastChannel('americanfootball_overlay_channel');

// サーバー同期管理用変数
let isServerConnected = false;
let eventSource = null;

// コントラスト自動判定関数 (チームカラー等の背景が白/明色の際、テキストカラーを黒に変更)
function getContrastColor(hexColor) {
    if (!hexColor) return '#ffffff';
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // 相対輝度の算出 (W3C公式アルゴリズム)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.75 ? '#000000' : '#ffffff';
}

document.addEventListener("DOMContentLoaded", () => {
    updateOverlay();
    setupServerSync(); // サーバー同期のセットアップ
    requestDashboardState();
});

function requestDashboardState() {
    channel.postMessage({
        event: 'REQUEST_STATE'
    });
}

// サーバー同期SSE接続
function setupServerSync() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        eventSource = new EventSource('/events');

        eventSource.onopen = () => {
            isServerConnected = true;
        };

        eventSource.addEventListener('UPDATE_STATE', (event) => {
            try {
                const newState = JSON.parse(event.data);
                if (JSON.stringify(state) !== JSON.stringify(newState)) {
                    state = newState;
                    updateOverlay();
                }
            } catch (e) {
                console.error("SSE parse error:", e);
            }
        });

        eventSource.onerror = () => {
            isServerConnected = false;
        };
    }
}

// 外付けカメラのクロップ映像を、手元確認用の浮動プレビュー枠と
// スコアボードの時計表示位置(小得点板/大得点板)の両方へ反映する
function updateCameraClockImage(visible, image) {
    state.gameClockImage = (visible && image) ? image : "";
    updateSmallScoreboard();
    updateLargeScoreboard();
}

channel.onmessage = function(event) {
    if (event.data && event.data.type === 'CLOCK_IMAGE') {
        updateCameraClockImage(event.data.visible, event.data.image);
        return;
    }

    if (isServerConnected) return;

    if (event.data && event.data.event === 'UPDATE_STATE') {
        state = event.data.state;
        updateOverlay();
    }
};

window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'CLOCK_IMAGE') {
        updateCameraClockImage(event.data.visible, event.data.image);
        return;
    }

    if (isServerConnected) return;

    if (event.data && event.data.event === 'UPDATE_STATE') {
        state = event.data.state;
        updateOverlay();
    }
});

function updateOverlay() {
    if (!state) return;

    const chromaBg = document.getElementById("chromakey-bg");
    if (chromaBg) {
        chromaBg.className = `chromakey-bg ${state.chromaKey || 'green'}`;
    }

    switchDisplayMode(state.displayMode);
    updateSmallScoreboard();
    updateLargeScoreboard();
    updateRunningScore();
    updateVSOverlay();
    updateLineupOverlay();
    updateOneshotOverlay();
    updateImageTelop();
}

function switchDisplayMode(mode) {
    const smallSb = document.getElementById("overlay-small-scoreboard");
    const largeSb = document.getElementById("overlay-large-scoreboard");
    const ransko = document.getElementById("overlay-runningscore");
    const vs = document.getElementById("overlay-vs");
    const lineup = document.getElementById("overlay-lineup");

    if (!smallSb || !largeSb || !ransko || !vs || !lineup) return;

    smallSb.classList.add("hidden");
    largeSb.classList.add("hidden");
    ransko.classList.add("hidden");
    vs.classList.add("hidden");
    lineup.classList.add("hidden");

    if (mode === "small") {
        smallSb.classList.remove("hidden");
    } else if (mode === "large") {
        largeSb.classList.remove("hidden");
    } else if (mode === "ransko") {
        ransko.classList.remove("hidden");
    } else if (mode === "vs") {
        vs.classList.remove("hidden");
    } else if (mode && mode.startsWith("lineup-")) {
        lineup.classList.remove("hidden");
    }
}

// 1. 小得点板の更新
function updateSmallScoreboard() {
    const nameHome = document.getElementById("sb-small-name-home");
    const nameAway = document.getElementById("sb-small-name-away");
    const scoreHome = document.getElementById("sb-small-score-home");
    const scoreAway = document.getElementById("sb-small-score-away");
    const period = document.getElementById("sb-small-period");
    const colorHome = document.getElementById("sb-small-color-home");
    const colorAway = document.getElementById("sb-small-color-away");
    
    const imgGameClock = document.getElementById("img-small-gameclock-stream");
    const imgPlayClock = document.getElementById("img-small-playclock-stream");
    const boxGameClock = document.getElementById("sb-small-gameclock-stream");
    const boxPlayClock = document.getElementById("sb-small-playclock-stream");

    if (nameHome) nameHome.textContent = (state.homeName || "").substring(0, 8);
    if (nameAway) nameAway.textContent = (state.awayName || "").substring(0, 8);
    if (scoreHome) scoreHome.textContent = state.homeScore;
    if (scoreAway) scoreAway.textContent = state.awayScore;
    if (period) period.textContent = state.currentPeriod;

    if (colorHome) colorHome.style.backgroundColor = state.homeColor;
    if (colorAway) colorAway.style.backgroundColor = state.awayColor;

    // ゲーム/プレイ両クロックの描画同期
    if (imgGameClock && imgPlayClock && boxGameClock && boxPlayClock) {
        if (state.gameClockImage || state.playClockImage) {
            imgGameClock.src = state.gameClockImage || "";
            imgPlayClock.src = state.playClockImage || "";
            boxGameClock.style.display = state.gameClockImage ? "block" : "none";
            boxPlayClock.style.display = state.playClockImage ? "block" : "none";

            const textTimer = document.getElementById("sb-small-time-text");
            if (textTimer) textTimer.style.display = "none";
        } else {
            boxGameClock.style.display = "none";
            boxPlayClock.style.display = "none";

            let textTimer = document.getElementById("sb-small-time-text");
            if (!textTimer) {
                textTimer = document.createElement("span");
                textTimer.id = "sb-small-time-text";
                textTimer.style.fontFamily = "Oswald, sans-serif";
                textTimer.style.fontSize = "20px";
                textTimer.style.fontWeight = "700";
                boxGameClock.parentNode.appendChild(textTimer);
            }
            textTimer.style.display = "block";
            const minStr = String(state.timerMinutes).padStart(2, "0");
            const secStr = String(state.timerSeconds).padStart(2, "0");
            textTimer.textContent = `${minStr}:${secStr}`;
        }
    }

    updateTODots("to-dots-small-home", state.homeTO);
    updateTODots("to-dots-small-away", state.awayTO);

    // D&D表示トグル
    const ddContainer = document.getElementById("sb-small-down-dist-container");
    if (ddContainer) {
        if (state.ddVisible) {
            ddContainer.style.display = "flex";
        } else {
            ddContainer.style.display = "none";
        }
    }

    // ダウン＆ディスタンス ＆ FLAG
    let downStr = "";
    if (state.down === 1) downStr = "1st";
    else if (state.down === 2) downStr = "2nd";
    else if (state.down === 3) downStr = "3rd";
    else if (state.down === 4) downStr = "4th";
    const ddText = `${downStr} & ${state.togo}`;

    const ddTextEl = document.getElementById("sb-small-down-dist-text");
    if (ddTextEl) ddTextEl.textContent = ddText;

    const flagCover = document.getElementById("sb-small-flag-cover");
    if (flagCover) {
        if (state.flagActive) {
            flagCover.classList.add("active");
        } else {
            flagCover.classList.remove("active");
        }
    }
}

function updateTODots(containerId, activeCount) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= 3; i++) {
        const dot = document.createElement("span");
        dot.className = "sb-small-to-dot" + (i <= activeCount ? " active" : "");
        if (i <= activeCount) {
            dot.style.backgroundColor = "#eab308";
            dot.style.boxShadow = "0 0 4px #eab308";
        }
        container.appendChild(dot);
    }
}

// 2. 大得点板の更新
function updateLargeScoreboard() {
    const nameHome = document.getElementById("sb-large-name-home");
    const nameAway = document.getElementById("sb-large-name-away");
    const subHome = document.getElementById("sb-large-sub-home");
    const subAway = document.getElementById("sb-large-sub-away");
    const scoreHome = document.getElementById("sb-large-score-home");
    const scoreAway = document.getElementById("sb-large-score-away");
    const period = document.getElementById("sb-large-period");
    const imgClock = document.getElementById("img-large-clock-stream");

    if (nameHome) {
        nameHome.textContent = state.homeName;
        // 8文字までは元のサイズ(26px)を維持し、それ以上の長いチーム名はフォントサイズを自動で縮小して綺麗に収める
        let fontSize = 26;
        nameHome.style.fontSize = `${fontSize}px`;
        while (nameHome.scrollWidth > 290 && fontSize > 14) {
            fontSize -= 0.5;
            nameHome.style.fontSize = `${fontSize}px`;
        }
    }
    if (nameAway) {
        nameAway.textContent = state.awayName;
        let fontSize = 26;
        nameAway.style.fontSize = `${fontSize}px`;
        while (nameAway.scrollWidth > 290 && fontSize > 14) {
            fontSize -= 0.5;
            nameAway.style.fontSize = `${fontSize}px`;
        }
    }
    if (subHome) subHome.textContent = state.homeSub;
    if (subAway) subAway.textContent = state.awaySub;
    if (scoreHome) scoreHome.textContent = state.homeScore;
    if (scoreAway) scoreAway.textContent = state.awayScore;
    if (period) period.textContent = state.currentPeriod;

    const logoBgHome = document.getElementById("sb-large-logo-bg-home");
    const logoBgAway = document.getElementById("sb-large-logo-bg-away");
    if (logoBgHome) logoBgHome.style.backgroundColor = state.homeColor;
    if (logoBgAway) logoBgAway.style.backgroundColor = state.awayColor;

    if (imgClock) {
        if (state.gameClockImage) {
            imgClock.src = state.gameClockImage;
            imgClock.style.display = "block";
            const textTimer = document.getElementById("sb-large-time-text");
            if (textTimer) textTimer.style.display = "none";
        } else {
            imgClock.style.display = "none";
            let textTimer = document.getElementById("sb-large-time-text");
            if (!textTimer) {
                textTimer = document.createElement("span");
                textTimer.id = "sb-large-time-text";
                textTimer.style.fontFamily = "Oswald, sans-serif";
                textTimer.style.fontSize = "34px";
                textTimer.style.fontWeight = "700";
                imgClock.parentNode.appendChild(textTimer);
            }
            textTimer.style.display = "block";
            const minStr = String(state.timerMinutes).padStart(2, "0");
            const secStr = String(state.timerSeconds).padStart(2, "0");
            textTimer.textContent = `${minStr}:${secStr}`;
        }
    }

    const logoHome = document.getElementById("sb-large-logo-home");
    const logoAway = document.getElementById("sb-large-logo-away");
    const hasHomeLogo = state.homeLogo && !state.homeLogo.startsWith('data:image/svg+xml');
    const hasAwayLogo = state.awayLogo && !state.awayLogo.startsWith('data:image/svg+xml');

    if (logoHome) {
        logoHome.src = state.homeLogo || "";
        if (hasHomeLogo) {
            logoHome.style.display = "block";
            logoHome.style.opacity = "1";
            if (logoBgHome) logoBgHome.style.display = "flex";
        } else {
            logoHome.style.display = "none";
            if (logoBgHome) logoBgHome.style.display = "none";
        }
    }
    if (logoAway) {
        logoAway.src = state.awayLogo || "";
        if (hasAwayLogo) {
            logoAway.style.display = "block";
            logoAway.style.opacity = "1";
            if (logoBgAway) logoBgAway.style.display = "flex";
        } else {
            logoAway.style.display = "none";
            if (logoBgAway) logoBgAway.style.display = "none";
        }
    }

    updateLargeTODots("to-dots-large-home", state.homeTO);
    updateLargeTODots("to-dots-large-away", state.awayTO);

    const posHome = document.getElementById("pos-indicator-home");
    const posAway = document.getElementById("pos-indicator-away");
    if (posHome) posHome.className = "possession-indicator" + (state.possession === "home" ? " active" : "");
    if (posAway) posAway.className = "possession-indicator" + (state.possession === "away" ? " active" : "");
}

function updateLargeTODots(containerId, activeCount) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= 3; i++) {
        const dot = document.createElement("span");
        dot.className = "sb-large-to-dot" + (i <= activeCount ? " active" : "");
        container.appendChild(dot);
    }
}

// 3. ランニングスコアの更新
function updateRunningScore() {
    const nameHome = document.getElementById("ransko-overlay-name-home");
    const nameAway = document.getElementById("ransko-overlay-name-away");
    if (nameHome) nameHome.textContent = (state.homeName || "").substring(0, 10);
    if (nameAway) nameAway.textContent = (state.awayName || "").substring(0, 10);

    const ranskoTournament = document.getElementById("ransko-tournament-name");
    if (ranskoTournament) ranskoTournament.textContent = state.tournament;

    const logoHome = document.getElementById("ransko-overlay-logo-home");
    const logoAway = document.getElementById("ransko-overlay-logo-away");
    const circleHome = document.getElementById("ransko-logo-circle-home");
    const circleAway = document.getElementById("ransko-logo-circle-away");

    const cellHome = document.getElementById("ransko-logo-cell-home");
    const cellAway = document.getElementById("ransko-logo-cell-away");
    if (cellHome) cellHome.style.backgroundColor = state.homeColor || "#991b1b";
    if (cellAway) cellAway.style.backgroundColor = state.awayColor || "#1d4ed8";

    if (logoHome && circleHome) {
        if (state.homeLogo) {
            logoHome.src = state.homeLogo;
            logoHome.style.display = "block";
            logoHome.style.opacity = "1";
            circleHome.style.backgroundColor = "transparent";
        } else {
            logoHome.style.display = "none";
            circleHome.style.backgroundColor = state.homeColor || "#991b1b";
        }
    }

    if (logoAway && circleAway) {
        if (state.awayLogo) {
            logoAway.src = state.awayLogo;
            logoAway.style.display = "block";
            logoAway.style.opacity = "1";
            circleAway.style.backgroundColor = "transparent";
        } else {
            logoAway.style.display = "none";
            circleAway.style.backgroundColor = state.awayColor || "#1d4ed8";
        }
    }

    const otHeader = document.getElementById("ransko-ot-header-overlay");
    const otCellHome = document.getElementById("ransko-overlay-h-ot");
    const otCellAway = document.getElementById("ransko-overlay-a-ot");
    if (otHeader && otCellHome && otCellAway) {
        if (state.showOT) {
            otHeader.style.display = "";
            otCellHome.style.display = "";
            otCellAway.style.display = "";
        } else {
            otHeader.style.display = "none";
            otCellHome.style.display = "none";
            otCellAway.style.display = "none";
        }
    }

    const periodOrder = { "1Q": 1, "2Q": 2, "3Q": 3, "4Q": 4, "OT": 5, "End": 6 };
    const currentPeriodRank = periodOrder[state.currentPeriod] || 1;

    for (let q = 1; q <= 4; q++) {
        const el = document.getElementById(`ransko-overlay-h-${q}`);
        if (el) {
            const score = state.ransko.home[q-1];
            if (q <= currentPeriodRank || score > 0) {
                el.textContent = score;
            } else {
                el.textContent = ""; 
            }
        }
    }
    for (let q = 1; q <= 4; q++) {
        const el = document.getElementById(`ransko-overlay-a-${q}`);
        if (el) {
            const score = state.ransko.away[q-1];
            if (q <= currentPeriodRank || score > 0) {
                el.textContent = score;
            } else {
                el.textContent = ""; 
            }
        }
    }

    if (state.showOT) {
        const elHome = document.getElementById("ransko-overlay-h-ot");
        const elAway = document.getElementById("ransko-overlay-a-ot");
        if (elHome && elAway) {
            const scoreH = state.ransko.home[4];
            const scoreA = state.ransko.away[4];
            if (state.currentPeriod === "OT" || state.currentPeriod === "End" || currentPeriodRank >= 5 || scoreH > 0 || scoreA > 0) {
                elHome.textContent = scoreH;
                elAway.textContent = scoreA;
            } else {
                elHome.textContent = "";
                elAway.textContent = "";
            }
        }
    }

    const totalHome = document.getElementById("ransko-overlay-h-total");
    const totalAway = document.getElementById("ransko-overlay-a-total");
    if (totalHome) totalHome.textContent = state.homeScore;
    if (totalAway) totalAway.textContent = state.awayScore;
}

// 4. 対戦VS画面の更新
function updateVSOverlay() {
    const tournamentName = document.getElementById("vs-tournament-name");
    const nameLeft = document.getElementById("vs-name-left");
    const nameRight = document.getElementById("vs-name-right");

    if (tournamentName) tournamentName.textContent = state.tournament;
    if (nameLeft) nameLeft.textContent = state.homeName;
    if (nameRight) nameRight.textContent = state.awayName;

    const logoLeft = document.getElementById("vs-logo-left");
    const logoRight = document.getElementById("vs-logo-right");
    const hasHomeLogo = state.homeLogo && !state.homeLogo.startsWith('data:image/svg+xml');
    const hasAwayLogo = state.awayLogo && !state.awayLogo.startsWith('data:image/svg+xml');

    if (logoLeft) {
        logoLeft.src = state.homeLogo || "";
        if (hasHomeLogo) {
            logoLeft.style.display = "block";
            logoLeft.style.opacity = "1";
        } else {
            logoLeft.style.display = "none";
        }
    }
    if (logoRight) {
        logoRight.src = state.awayLogo || "";
        if (hasAwayLogo) {
            logoRight.style.display = "block";
            logoRight.style.opacity = "1";
        } else {
            logoRight.style.display = "none";
        }
    }

    const leftLogoBox = document.getElementById("vs-logo-box-left");
    const rightLogoBox = document.getElementById("vs-logo-box-right");
    
    if (leftLogoBox) {
        if (hasHomeLogo) leftLogoBox.style.display = 'flex';
        else leftLogoBox.style.display = 'none';
    }
    if (rightLogoBox) {
        if (hasAwayLogo) rightLogoBox.style.display = 'flex';
        else rightLogoBox.style.display = 'none';
    }
}

// 5. スタメン一覧の更新 (白背景時の黒文字化を適用)
function updateLineupOverlay() {
    if (!state.displayMode || !state.displayMode.startsWith("lineup-")) return;

    const parts = state.displayMode.split("-");
    const teamKey = parts[1]; // "home" または "away"
    const sideKey = parts[2] === "off" ? "offense" : "defense";

    const teamNameEl = document.getElementById("lineup-team-name");
    const teamLogoEl = document.getElementById("lineup-team-logo");
    const teamLogoBox = document.getElementById("lineup-team-logo-box");
    const teamSideEl = document.getElementById("lineup-team-side");
    const lineupPanel = document.getElementById("overlay-lineup");

    const teamName = teamKey === "home" ? state.homeName : state.awayName;
    const teamLogo = teamKey === "home" ? state.homeLogo : state.awayLogo;
    const teamColor = teamKey === "home" ? state.homeColor : state.awayColor;

    if (teamNameEl) teamNameEl.textContent = teamName;
    if (teamSideEl) teamSideEl.textContent = sideKey === "offense" ? "OFFENSE" : "DEFENSE";

    // AWAYロゴ含めて画像をセット
    if (teamLogoBox && teamLogoEl) {
        if (teamLogo) {
            teamLogoEl.src = teamLogo;
            teamLogoEl.style.opacity = "1";
            teamLogoBox.style.display = "flex";
        } else {
            teamLogoBox.style.display = "none";
        }
    }

    // 動的チームカラーの適用
    if (lineupPanel) {
        lineupPanel.style.setProperty('--lineup-team-color', teamColor);
    }

    // チームカラーが白(明色)の際、文字色を黒に切り替え
    const headerEl = document.getElementById("lineup-team-header");
    if (headerEl) {
        const textContrastColor = getContrastColor(teamColor);
        headerEl.style.color = textContrastColor;
        if (teamNameEl) teamNameEl.style.color = textContrastColor;
    }

    if (!state.roster) return;
    const rosterTeamKey = teamKey.toUpperCase();
    // 読み込んだCSV/Excelの元の並び順をそのまま表示する(自動並び替えはしない)
    let players = state.roster.filter(p => p.team === rosterTeamKey && p.side === sideKey);

    let maxPlayers = 12;
    if (sideKey === "offense") {
        const hasLS = players.some(p => (p.position || "").toUpperCase().includes("LS"));
        maxPlayers = hasLS ? 13 : 12;
    } else {
        const hasSP = players.some(p => (p.position || "").toUpperCase().includes("SP"));
        const hasH = players.some(p => (p.position || "").toUpperCase() === "H");
        maxPlayers = (hasSP || hasH) ? 14 : 12;
    }

    const displayPlayers = players.slice(0, maxPlayers);
    const listContainer = document.getElementById("lineup-players-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    displayPlayers.forEach(p => {
        const row = document.createElement("div");
        row.className = "lineup-row";

        const leftBlock = document.createElement("div");
        leftBlock.className = "lineup-left-block";

        const posLabel = document.createElement("span");
        posLabel.className = "lineup-pos-label";
        posLabel.textContent = p.position;

        const numLabel = document.createElement("span");
        numLabel.className = "lineup-number-label";
        numLabel.textContent = p.number;

        leftBlock.appendChild(posLabel);
        leftBlock.appendChild(numLabel);

        const rightBlock = document.createElement("div");
        rightBlock.className = "lineup-right-block";

        const nameLabel = document.createElement("span");
        nameLabel.className = "lineup-name-label";
        nameLabel.textContent = p.name;

        const gradeTag = document.createElement("span");
        gradeTag.className = "lineup-grade-tag";
        const memoVal = p.memo || "";
        const memoStr = String(memoVal);
        gradeTag.textContent = memoStr ? (/[年歳]/.test(memoStr) ? memoStr : `${memoStr}年`) : "-";

        rightBlock.appendChild(nameLabel);
        rightBlock.appendChild(gradeTag);

        row.appendChild(leftBlock);
        row.appendChild(rightBlock);
        listContainer.appendChild(row);

        let fontSize = 22;
        nameLabel.style.fontSize = `${fontSize}px`;
        while (nameLabel.scrollWidth > 190 && fontSize > 11) {
            fontSize -= 0.5;
            nameLabel.style.fontSize = `${fontSize}px`;
        }
    });
}

// 選手紹介テロップの顔写真アイコン (photos/未設置・ロゴ未設定時の最終フォールバック)
const SPORT_FALLBACK_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<ellipse cx="50" cy="50" rx="46" ry="28" fill="#92400e" stroke="#451a03" stroke-width="3"/>' +
    '<line x1="30" y1="50" x2="70" y2="50" stroke="#fef3c7" stroke-width="3"/>' +
    '<line x1="42" y1="42" x2="42" y2="58" stroke="#fef3c7" stroke-width="2"/>' +
    '<line x1="50" y1="42" x2="50" y2="58" stroke="#fef3c7" stroke-width="2"/>' +
    '<line x1="58" y1="42" x2="58" y2="58" stroke="#fef3c7" stroke-width="2"/>' +
    '</svg>'
);

// 選手紹介テロップの画像を「顔写真 > チームロゴ > 競技アイコン」の順で設定する
// 顔写真は photos/<チーム名>/player/<背番号>.(jpg|jpeg|png) を自動探索する
function setPlayerIntroImage(imgEl, teamName, number, logoUrl) {
    if (!imgEl) return;
    const exts = ['jpg', 'jpeg', 'png'];
    const firstNumber = String(number || '').split('/')[0].trim();
    let extIdx = 0;

    function tryNextExt() {
        if (extIdx < exts.length && teamName && firstNumber) {
            const path = `photos/${encodeURIComponent(teamName)}/player/${encodeURIComponent(firstNumber)}.${exts[extIdx]}`;
            extIdx++;
            imgEl.onerror = tryNextExt;
            imgEl.src = path;
        } else {
            tryLogo();
        }
    }

    function tryLogo() {
        if (logoUrl) {
            imgEl.onerror = tryIcon;
            imgEl.src = logoUrl;
        } else {
            tryIcon();
        }
    }

    function tryIcon() {
        imgEl.onerror = null;
        imgEl.src = SPORT_FALLBACK_ICON;
    }

    imgEl.style.display = 'block';
    imgEl.style.opacity = '1';
    tryNextExt();
}

// 6. ワンショットテロップ (白背景時の黒文字化を適用)
function updateOneshotOverlay() {
    const telopWrapper = document.getElementById("telop-wrapper");
    if (!telopWrapper) return;

    if (state.oneshot && state.oneshot.active) {
        telopWrapper.classList.remove("hidden");

        const teamNameEl = document.getElementById("player-team");
        const colorBox = document.getElementById("player-team-color-box");
        const logoEl = document.getElementById("player-team-logo");
        const posEl = document.getElementById("player-position");
        const numEl = document.getElementById("player-number");
        const nameEl = document.getElementById("player-name-ja");
        const commentEl = document.getElementById("player-comment");
        const memoEl = document.getElementById("player-memo");

        const isAway = state.oneshot.team === 'AWAY';
        const teamName = isAway ? state.awayName : state.homeName;
        const teamColor = isAway ? state.awayColor : state.homeColor;
        const teamLogo = isAway ? state.awayLogo : state.homeLogo;
        // 顔写真フォルダ名は「写真連携用チーム名」が入力されていればそちらを優先(表示名を略称にしている場合の対応)
        const photoTeamName = (isAway ? state.awayPhotoTeam : state.homePhotoTeam) || teamName;

        if (teamNameEl) teamNameEl.textContent = teamName;
        if (colorBox) {
            colorBox.style.setProperty('--player-team-color', teamColor);
            colorBox.style.backgroundColor = teamColor;

            // チームカラーが白(明色)の際、文字色を黒に切り替え
            const contrastColor = getContrastColor(teamColor);
            if (teamNameEl) teamNameEl.style.color = contrastColor;
        }
        setPlayerIntroImage(logoEl, photoTeamName, state.oneshot.number, teamLogo);
        if (posEl) posEl.textContent = state.oneshot.position;
        if (numEl) numEl.textContent = state.oneshot.number;
        if (nameEl) nameEl.textContent = state.oneshot.name;
        if (commentEl) commentEl.textContent = state.oneshot.comment;
        
        if (memoEl) {
            const memoVal = state.oneshot.memo || state.oneshot.grade || "";
            const memoStr = String(memoVal);
            memoEl.textContent = memoStr ? (/[年歳]/.test(memoStr) ? memoStr : `${memoStr}年`) : "-";
        }
    } else {
        telopWrapper.classList.add("hidden");
    }
}

// 7. 全画面スライド (静止画) 同期表示処理
function updateImageTelop() {
    const container = document.getElementById("overlay-image-telop");
    const img = document.getElementById("img-image-telop");
    if (!container || !img) return;

    if (state.imageTelop && state.imageTelop.active) {
        img.src = state.imageTelop.url || "";
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
    }
}


// ==========================================================================
// フルスクリーン ＆ マウスアイドル非表示制御 (switcher-hdmi-output-support)
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    const fullscreenBtn = document.getElementById('btn-fullscreen-toggle');
    if (!fullscreenBtn) return;

    let mouseIdleTimer = null;
    const isIframe = (window.self !== window.top);

    if (isIframe) {
        fullscreenBtn.style.setProperty('display', 'none', 'important');
        fullscreenBtn.remove();
        return;
    } else {
        fullscreenBtn.style.setProperty('display', 'block', 'important');
    }

    function resetMouseIdleTimer() {
        document.body.classList.remove('mouse-idle');
        clearTimeout(mouseIdleTimer);
        mouseIdleTimer = setTimeout(() => {
            document.body.classList.add('mouse-idle');
        }, 3000);
    }

    window.addEventListener('mousemove', resetMouseIdleTimer);
    window.addEventListener('click', resetMouseIdleTimer);
    resetMouseIdleTimer();

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`フルスクリーンエラー: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }

    fullscreenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
    });

    document.addEventListener('dblclick', () => {
        toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            // display: none によるフォーカスロスト強制解除を防ぐため、透明化で対応
            fullscreenBtn.style.setProperty('opacity', '0', 'important');
            fullscreenBtn.style.setProperty('pointer-events', 'none', 'important');
        } else {
            fullscreenBtn.style.removeProperty('opacity');
            fullscreenBtn.style.removeProperty('pointer-events');
            fullscreenBtn.innerText = '全画面表示 (スイッチャー出力)';
        }
    });
});
