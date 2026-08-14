/* ==========================================================================
   アメフト中継用スポーツコーダー - コントロールパネル用 JS
   ========================================================================== */

// 状態オブジェクト (state)
const state = {
    // チーム情報
    homeName: 'HOME TEAM',
    homeSub: 'HOME',
    homeColor: "#991b1b",
    homeLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iIzk5MWIxYiIvPjwvc3ZnPg==",
    homeScore: 0,
    homeTO: 3,

    awayName: 'AWAY TEAM',
    awaySub: 'AWAY',
    awayColor: "#1d4ed8",
    awayLogo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgZmlsbD0iIzFkNGVkOCIvPjwvc3ZnPg==",
    awayScore: 0,
    awayTO: 3,

    tournament: "第54回 東海学生アメリカンフットボールリーグ戦",

    // クロックキャプチャ画像 (Base64)
    gameClockImage: "",
    playClockImage: "",

    // クロップパラメータ (パーセント値 0-100)
    crop: {
        gx: 45, gy: 8, gw: 10, gh: 6,  // game clock
        px: 75, py: 8, pw: 6, ph: 6    // play clock
    },

    // 予備時計情報
    currentPeriod: "1Q",
    timerMinutes: 15,
    timerSeconds: 0,
    timerRunning: false,
    playclock: 40,

    // 攻撃状況
    possession: "none", // 'home', 'away', 'none'
    down: 1,
    togo: "10",
    ddVisible: true, // D&Dの表示状態

    // 特殊表示フラグ
    flagActive: false, // 反則 FLAG カバー
    showOT: false,    // OT (延長) の表示有無

    // 表示モード (初期表示は大得点板)
    displayMode: "large", 

    // ランニングスコア (1Q, 2Q, 3Q, 4Q, OT)
    ransko: {
        home: [0, 0, 0, 0, 0],
        away: [0, 0, 0, 0, 0]
    },

    // ワンショット選手紹介テロップ
    oneshot: {
        active: false,
        number: "1",
        position: "QB",
        name: "関根 怜玖",
        grade: "4年",
        comment: "名城のエースQB、抜群 of パス精度で攻撃陣を牽引",
        team: "HOME"
    },

    // 全画面スライド (静止画) テロップ
    imageTelop: {
        active: false,
        url: ""
    },

    // 選手データ
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

    // クロマキー背景色 (デフォルトはグリーン)
    chromaKey: "green"
};

// 野球・サッカー等と同様のデモ選手リスト
const demoHomeRoster = [
    { team: "HOME", side: "offense", number: "52", position: "LT", name: "矢野 耕亮", memo: "4年", comment: "強靭な下半身でパスプロテクションの要を担う。" },
    { team: "HOME", side: "offense", number: "56", position: "LG", name: "関 凛晟", memo: "2年", comment: "鋭い踏み込みでランコースをこじ開ける若き盾。" },
    { team: "HOME", side: "offense", number: "59", position: "C", name: "高松 碧仁", memo: "4年", comment: "正確なスナップと冷静なアジャストでラインを統率。" },
    { team: "HOME", side: "offense", number: "70", position: "RG", name: "蔵石 大和", memo: "3年", comment: "破壊力抜群 of ブロッキングで道を切り拓く。" },
    { team: "HOME", side: "offense", number: "77", position: "RT", name: "高橋 優斗", memo: "4年", comment: "圧倒的なフィジカルでエッジを死守する巨漢。" },
    { team: "HOME", side: "offense", number: "1", position: "QB", name: "関根 怜玖", memo: "4年", comment: "抜群 of パス精度と高いアメフトIQで攻撃陣を牽引。" },
    { team: "HOME", side: "offense", number: "25", position: "RB", name: "松田 吟", memo: "4年", comment: "俊敏なカットバックと粘り強いランが武器のエース。" },
    { team: "HOME", side: "offense", number: "6", position: "WR", name: "岩崎 太亮", memo: "4年", comment: "卓越したキャッチ技術を誇るディープスレット。" },
    { team: "HOME", side: "offense", number: "2", position: "WR", name: "山本 羚王", memo: "1年", comment: "圧倒的なスプリント力を持つ期待 of ルーキー。" },
    { team: "HOME", side: "offense", number: "31", position: "WR", name: "能代 真紘", memo: "2年", comment: "インサイドでの確実なキャッチでファーストダウンを獲得。" },
    { team: "HOME", side: "offense", number: "88", position: "TE", name: "河村 剛宇", memo: "4年", comment: "ブロック・キャッチ共に高次元でこなす万能型。" },
    { team: "HOME", side: "offense", number: "8", position: "P", name: "平野 翔大", memo: "1年", comment: "滞空時間の長いハングタイムパントで陣地を回復。" },
    { team: "HOME", side: "defense", number: "90", position: "DL", name: "鈴木 大地", memo: "4年", comment: "爆発的なファーストステップでQBサックを狙う。" },
    { team: "HOME", side: "defense", number: "99", position: "DL", name: "佐藤 陸", memo: "3年", comment: "中央 of ランを完全にシャットアウトする重戦車。" },
    { team: "HOME", side: "defense", number: "44", position: "LB", name: "田中 健太", memo: "4年", comment: "抜群 of タックル精度を誇る守備 of リーダー。" },
    { team: "HOME", side: "defense", number: "51", position: "LB", name: "渡辺 翼", memo: "2年", comment: "広い守備範囲と逆サイドも追うカバー力が魅力。" },
    { team: "HOME", side: "defense", number: "21", position: "DB", name: "小林 翔", memo: "4年", comment: "シャットダウンコーナーバック。インターセプトを量産。" },
    { team: "HOME", side: "defense", number: "24", position: "DB", name: "高橋 誠", memo: "3年", comment: "ハードタッカー。最後尾からランを仕留めるセーフティ。" }
];

const demoAwayRoster = [
    { team: "AWAY", side: "offense", number: "10", position: "QB", name: "John Smith", memo: "4年", comment: "強肩を活かしたロングパスが魅力 of 司令塔。" },
    { team: "AWAY", side: "offense", number: "34", position: "RB", name: "Michael Carter", memo: "3年", comment: "パワフルなランで相手タックルを跳ね返す。" },
    { team: "AWAY", side: "offense", number: "81", position: "WR", name: "David Miller", memo: "4年", comment: "勝負強いキャッチと俊足が武器 of WR。" },
    { team: "AWAY", side: "offense", number: "73", position: "OL", name: "Robert Jones", memo: "2年", comment: "チーム最重量。圧倒的なパワーでランを支える。" },
    { team: "AWAY", side: "defense", number: "92", position: "DL", name: "Chris Evans", memo: "4年", comment: "素早いラッシュでプレッシャーを与え続けるDL。" },
    { team: "AWAY", side: "defense", number: "55", position: "LB", name: "Alex Rodriguez", memo: "3年", comment: "広いエリアをカバーする万能型LB。" },
    { team: "AWAY", side: "defense", number: "23", position: "DB", name: "James Williams", memo: "2年", comment: "抜群 of 反応でパスを叩き落とすCB。" }
];

// 選手紹介用名簿 (HOME/AWAY分離管理)
let oneshotPlayers = {
    HOME: [],
    AWAY: []
};
let currentOneshotTab = "HOME";

// 別ウィンドウ参照
let overlayWindow = null;

// BroadcastChannel
const channel = new BroadcastChannel('americanfootball_overlay_channel');

// サーバー同期管理用変数
let isServerConnected = false;
let eventSource = null;

// カメラ・消去タイマー等の変数
let oneshotTimer = null; // ワンショット消去用

document.addEventListener("DOMContentLoaded", () => {
    initEventListeners();
    setupServerSync(); // サーバー同期のセットアップ
    updateDashboardUI();
    broadcastState();

    // --- ドラッグ＆ドロップ登録 (ファイル選択ダイアログ非起動での全画面クリア防止対策) ---
    const setupDragAndDrop = (dropZoneId, successCallback) => {
        const zone = document.getElementById(dropZoneId);
        if (!zone) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.borderColor = '#00ba37';
            zone.style.backgroundColor = 'rgba(0, 186, 55, 0.05)';
        });

        const resetStyle = () => {
            zone.style.borderColor = 'transparent';
            zone.style.backgroundColor = 'transparent';
        };

        zone.addEventListener('dragleave', resetStyle);
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            resetStyle();
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    successCallback(event.target.result, file.name);
                };
                reader.readAsDataURL(file);
            }
        });
    };

    // 1. ホームロゴのドラッグ＆ドロップ
    setupDragAndDrop('home-logo-drop-zone', (dataUrl) => {
        state.homeLogo = dataUrl;
        broadcastState();
        updateDashboardUI();
    });

    // 2. アウェイロゴのドラッグ＆ドロップ
    setupDragAndDrop('away-logo-drop-zone', (dataUrl) => {
        state.awayLogo = dataUrl;
        broadcastState();
        updateDashboardUI();
    });

    // 3. スライドのドラッグ＆ドロップ
    const slideUrlInput = document.getElementById('slide-input-url');
    if (slideUrlInput) {
        slideUrlInput.addEventListener('dragover', (e) => {
            e.preventDefault();
            slideUrlInput.style.borderColor = '#00ba37';
        });
        slideUrlInput.addEventListener('dragleave', () => {
            slideUrlInput.style.borderColor = '#cbd5e1';
        });
        slideUrlInput.addEventListener('drop', (e) => {
            e.preventDefault();
            slideUrlInput.style.borderColor = '#cbd5e1';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    localDragSlideDataUrl = event.target.result;
                    slideUrlInput.value = `[ドラッグ＆ドロップ画像選択中: ${file.name}]`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    initCameraCapture();
    initStreamDeckHID();
    renderStreamDeckPreview();
    const previewEl = document.getElementById('streamdeck-keypad-preview');
    if (previewEl) previewEl.classList.remove('hidden');

    function resizePreviewIframe() {
        const container = document.querySelector('.preview-container');
        const iframe = document.getElementById('preview-iframe');
        if (!container || !iframe) return;
        
        const containerWidth = container.clientWidth;
        const scale = containerWidth / 1920;
        iframe.style.transform = `scale(${scale})`;
    }

    window.addEventListener('resize', resizePreviewIframe);
    window.addEventListener('load', resizePreviewIframe);
    resizePreviewIframe();
    setTimeout(resizePreviewIframe, 150);
    setTimeout(resizePreviewIframe, 500);
});

channel.onmessage = function(event) {
    if (event.data && event.data.event === 'REQUEST_STATE') {
        broadcastState();
    }
};

function openOverlayWindow() {
    overlayWindow = window.open('americanfootball_overlay.html?v=' + Date.now(), 'americanfootball_overlay', 'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no');
}

// サーバー同期SSE接続
function setupServerSync() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        eventSource = new EventSource('/events');

        eventSource.onopen = () => {
            isServerConnected = true;
            const statusEl = document.getElementById("connection-status");
            if (statusEl) {
                statusEl.innerHTML = '<span class="status-indicator online"></span> 同期中 (ローカルサーバー)';
            }
        };

        eventSource.addEventListener('UPDATE_STATE', (event) => {
            try {
                const newState = JSON.parse(event.data);
                // エコーバックによるループを防止
                if (JSON.stringify(state) !== JSON.stringify(newState)) {
                    Object.assign(state, newState);
                    updateDashboardUI();
                }
            } catch (e) {
                console.error("SSE parse error:", e);
            }
        });

        eventSource.onerror = () => {
            isServerConnected = false;
            const statusEl = document.getElementById("connection-status");
            if (statusEl) {
                statusEl.innerHTML = '<span class="status-indicator" style="background-color: #ef4444; box-shadow: 0 0 8px #ef4444;"></span> サーバー切断 (BroadcastChannel同期中)';
            }
        };
    }
}

function broadcastState() {
    channel.postMessage({
        event: 'UPDATE_STATE',
        state: state
    });

    const iframe = document.getElementById('preview-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
            event: 'UPDATE_STATE',
            state: state
        }, '*');
    }

    if (overlayWindow && !overlayWindow.closed) {
        overlayWindow.postMessage({
            event: 'UPDATE_STATE',
            state: state
        }, '*');
    }

    // サーバーへ状態同期
    if (isServerConnected) {
        fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        }).catch(err => console.error("Server sync error:", err));
    }
}

function updateDashboardUI() {
    const lblHomeScore = document.getElementById("label-home-score");
    if (lblHomeScore) lblHomeScore.textContent = state.homeScore;
    const lblAwayScore = document.getElementById("label-away-score");
    if (lblAwayScore) lblAwayScore.textContent = state.awayScore;
    
    const inHomeName = document.getElementById("input-home-name");
    if (inHomeName) inHomeName.value = state.homeName;
    const inAwayName = document.getElementById("input-away-name");
    if (inAwayName) inAwayName.value = state.awayName;
    const inHomeSub = document.getElementById("input-home-sub");
    if (inHomeSub) inHomeSub.value = state.homeSub;
    const inAwaySub = document.getElementById("input-away-sub");
    if (inAwaySub) inAwaySub.value = state.awaySub;
    const inHomeColor = document.getElementById("input-home-color");
    if (inHomeColor) inHomeColor.value = state.homeColor;
    const inAwayColor = document.getElementById("input-away-color");
    if (inAwayColor) inAwayColor.value = state.awayColor;
    const inTournament = document.getElementById("input-tournament");
    if (inTournament) inTournament.value = state.tournament;

    const minStr = String(state.timerMinutes).padStart(2, "0");
    const secStr = String(state.timerSeconds).padStart(2, "0");
    const labelTimer = document.getElementById("label-timer");
    if (labelTimer) labelTimer.textContent = `${minStr}:${secStr}`;
    document.getElementById("select-period").value = state.currentPeriod;

    updateTODotsDashboard();
    updatePossessionButtons();
    updateDownButtons();
    document.getElementById("input-togo").value = state.togo;

    // スイッチ類
    document.getElementById("switch-flag-btn").className = "switch-btn" + (state.flagActive ? " active" : "");
    document.getElementById("switch-flag-container").className = "toggle-switch-container flag-switch" + (state.flagActive ? " active" : "");
    document.getElementById("switch-ot-btn").className = "switch-btn" + (state.showOT ? " active" : "");
    
    // D&D表示トグル
    const ddBtn = document.getElementById("switch-dd-visible-btn");
    const ddContainer = document.getElementById("switch-dd-visible-container");
    if (ddBtn) ddBtn.className = "switch-btn" + (state.ddVisible ? " active" : "");
    if (ddContainer) ddContainer.className = "toggle-switch-container" + (state.ddVisible ? " active" : "");

    // OTランスコ制御
    const otHeader = document.getElementById("ransko-ot-header");
    const otCellHome = document.getElementById("ransko-h-ot-cell");
    const otCellAway = document.getElementById("ransko-a-ot-cell");
    const otRadioOption = document.getElementById("target-q-ot-option");

    if (state.showOT) {
        if (otHeader) otHeader.style.display = "";
        if (otCellHome) otCellHome.style.display = "";
        if (otCellAway) otCellAway.style.display = "";
        if (otRadioOption) otRadioOption.style.display = "";
    } else {
        if (otHeader) otHeader.style.display = "none";
        if (otCellHome) otCellHome.style.display = "none";
        if (otCellAway) otCellAway.style.display = "none";
        if (otRadioOption) otRadioOption.style.display = "none";
        const checkedRadio = document.querySelector('input[name="target-q"]:checked');
        if (checkedRadio && checkedRadio.value === "OT") {
            const rad1Q = document.querySelector('input[name="target-q"][value="1Q"]');
            if (rad1Q) rad1Q.checked = true;
        }
    }

    for (let i = 0; i < 4; i++) {
        const elH = document.getElementById(`ransko-h-${i+1}`);
        const elA = document.getElementById(`ransko-a-${i+1}`);
        if (elH) elH.value = state.ransko.home[i];
        if (elA) elA.value = state.ransko.away[i];
    }
    const elHOt = document.getElementById("ransko-h-ot");
    const elAOt = document.getElementById("ransko-a-ot");
    if (elHOt) elHOt.value = state.ransko.home[4];
    if (elAOt) elAOt.value = state.ransko.away[4];
    calcRanskoTotal(false);

    // 表示モードボタンのアクティブ状態の更新
    const btns = document.querySelectorAll(".display-mode-buttons-grid .btn-mode");
    btns.forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`btn-mode-${state.displayMode}`);
    if (activeBtn) activeBtn.classList.add("active");

    document.getElementById("oneshot-input-num").value = state.oneshot.number;
    document.getElementById("oneshot-input-pos").value = state.oneshot.position;
    document.getElementById("oneshot-input-name").value = state.oneshot.name;
    document.getElementById("oneshot-input-grade").value = state.oneshot.grade;
    document.getElementById("oneshot-input-comment").value = state.oneshot.comment;

    updateRosterTable();
    renderOneshotListTable();
}

function updateTODotsDashboard() {
    const homeContainer = document.getElementById("to-dots-home-dashboard");
    const awayContainer = document.getElementById("to-dots-away-dashboard");
    if (!homeContainer || !awayContainer) return;

    homeContainer.innerHTML = "";
    awayContainer.innerHTML = "";

    for (let i = 1; i <= 3; i++) {
        const dotHome = document.createElement("span");
        dotHome.className = "status-indicator" + (i <= state.homeTO ? " online" : "");
        dotHome.style.backgroundColor = i <= state.homeTO ? "#eab308" : "#475569";
        if (i <= state.homeTO) dotHome.style.boxShadow = "0 0 6px #eab308";
        homeContainer.appendChild(dotHome);

        const dotAway = document.createElement("span");
        dotAway.className = "status-indicator" + (i <= state.awayTO ? " online" : "");
        dotAway.style.backgroundColor = i <= state.awayTO ? "#eab308" : "#475569";
        if (i <= state.awayTO) dotAway.style.boxShadow = "0 0 6px #eab308";
        awayContainer.appendChild(dotAway);
    }
}

function initEventListeners() {
    document.getElementById("input-home-name").addEventListener("input", (e) => {
        state.homeName = e.target.value;
        const rNameH = document.getElementById("ransko-name-home");
        if (rNameH) rNameH.textContent = e.target.value.substring(0, 8);
        broadcastState();
    });
    document.getElementById("input-away-name").addEventListener("input", (e) => {
        state.awayName = e.target.value;
        const rNameA = document.getElementById("ransko-name-away");
        if (rNameA) rNameA.textContent = e.target.value.substring(0, 8);
        broadcastState();
    });
    document.getElementById("input-home-sub").addEventListener("input", (e) => {
        state.homeSub = e.target.value;
        broadcastState();
    });
    document.getElementById("input-away-sub").addEventListener("input", (e) => {
        state.awaySub = e.target.value;
        broadcastState();
    });
    document.getElementById("input-home-color").addEventListener("change", (e) => {
        state.homeColor = e.target.value;
        broadcastState();
    });
    document.getElementById("input-away-color").addEventListener("change", (e) => {
        state.awayColor = e.target.value;
        broadcastState();
    });
    document.getElementById("input-tournament").addEventListener("input", (e) => {
        state.tournament = e.target.value;
        broadcastState();
    });
    document.getElementById("input-home-logo-file").addEventListener("change", (e) => {
        handleLogoFile(e.target.files[0], "home");
    });
    document.getElementById("input-away-logo-file").addEventListener("change", (e) => {
        handleLogoFile(e.target.files[0], "away");
    });
    document.getElementById("input-home-logo-url").addEventListener("input", (e) => {
        state.homeLogo = e.target.value;
        broadcastState();
    });
    document.getElementById("input-away-logo-url").addEventListener("input", (e) => {
        state.awayLogo = e.target.value;
        broadcastState();
    });

    // ランスコ上のラジオボタン変更時に予備プルダウンとstate.currentPeriodを同期 (双方向連動)
    document.querySelectorAll('input[name="target-q"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const qVal = e.target.value;
            const selectPeriod = document.getElementById("select-period");
            if (selectPeriod) {
                selectPeriod.value = qVal;
            }
            state.currentPeriod = qVal;
            broadcastState();
        });
    });
}

function handleLogoFile(file, team) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            const max_size = 120;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > max_size) {
                    height *= max_size / width;
                    width = max_size;
                }
            } else {
                if (height > max_size) {
                    width *= max_size / height;
                    height = max_size;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            const base64Data = canvas.toDataURL("image/png");
            if (team === "home") {
                state.homeLogo = base64Data;
            } else {
                state.awayLogo = base64Data;
            }
            broadcastState();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function addScore(team, val) {
    const checkedRadio = document.querySelector('input[name="target-q"]:checked');
    const qValue = checkedRadio ? checkedRadio.value : "1Q";

    const qMap = { "1Q": 0, "2Q": 1, "3Q": 2, "4Q": 3, "OT": 4 };
    const qIndex = qMap[qValue];
    if (qIndex !== undefined) {
        if (team === "home") {
            state.ransko.home[qIndex] = Math.max(0, state.ransko.home[qIndex] + val);
            if (qValue === "OT") {
                const el = document.getElementById("ransko-h-ot");
                if (el) el.value = state.ransko.home[qIndex];
            } else {
                const el = document.getElementById(`ransko-h-${qIndex+1}`);
                if (el) el.value = state.ransko.home[qIndex];
            }
        } else {
            state.ransko.away[qIndex] = Math.max(0, state.ransko.away[qIndex] + val);
            if (qValue === "OT") {
                const el = document.getElementById("ransko-a-ot");
                if (el) el.value = state.ransko.away[qIndex];
            } else {
                const el = document.getElementById(`ransko-a-${qIndex+1}`);
                if (el) el.value = state.ransko.away[qIndex];
            }
        }
    }
    calcRanskoTotal(true);
}

function adjustTO(team, val) {
    if (team === "home") {
        state.homeTO = Math.max(0, Math.min(3, state.homeTO + val));
    } else {
        state.awayTO = Math.max(0, Math.min(3, state.awayTO + val));
    }
    updateDashboardUI();
    broadcastState();
}

function onPeriodChange(val) {
    state.currentPeriod = val;
    // 対応するラジオボタンも更新 (双方向連動)
    const radioBtn = document.querySelector(`input[name="target-q"][value="${val}"]`);
    if (radioBtn) {
        radioBtn.checked = true;
    }
    broadcastState();
}

function setManualTimer() {
    const minVal = parseInt(document.getElementById("input-adj-min").value) || 0;
    const secVal = parseInt(document.getElementById("input-adj-sec").value) || 0;
    state.timerMinutes = Math.max(0, Math.min(60, minVal));
    state.timerSeconds = Math.max(0, Math.min(59, secVal));
    broadcastState();
}

function setPossession(team) {
    state.possession = team;
    updatePossessionButtons();
    broadcastState();
}

function updatePossessionButtons() {
    const btnH = document.getElementById("pos-btn-home");
    const btnA = document.getElementById("pos-btn-away");
    const btnN = document.getElementById("pos-btn-none");
    if (btnH) btnH.className = "pos-btn" + (state.possession === "home" ? " active home" : "");
    if (btnA) btnA.className = "pos-btn" + (state.possession === "away" ? " active away" : "");
    if (btnN) btnN.className = "pos-btn" + (state.possession === "none" ? " active" : "");
}

function setDown(downNum) {
    state.down = downNum;
    updateDownButtons();
    broadcastState();
}

function updateDownButtons() {
    for (let i = 1; i <= 4; i++) {
        const btn = document.getElementById(`down-btn-${i}`);
        if (btn) btn.className = "down-btn" + (state.down === i ? " active" : "");
    }
}

function onToGoChange(val) {
    state.togo = val;
    broadcastState();
}

function setToGoPreset(val) {
    state.togo = val;
    const el = document.getElementById("input-togo");
    if (el) el.value = val;
    broadcastState();
}

// 配信画面表示テロップのモード切り替え (ボタンアクション)
function changeDisplayMode(val) {
    state.displayMode = val;
    updateDashboardUI();
    broadcastState();
}

// 下位互換用
function onDisplayModeChange(val) {
    changeDisplayMode(val);
}

function toggleFlag() {
    state.flagActive = !state.flagActive;
    document.getElementById("switch-flag-btn").className = "switch-btn" + (state.flagActive ? " active" : "");
    document.getElementById("switch-flag-container").className = "toggle-switch-container flag-switch" + (state.flagActive ? " active" : "");
    broadcastState();
}

function toggleOT() {
    state.showOT = !state.showOT;
    updateDashboardUI();
    broadcastState();
}

function toggleDDVisible() {
    state.ddVisible = !state.ddVisible;
    const btn = document.getElementById("switch-dd-visible-btn");
    const container = document.getElementById("switch-dd-visible-container");
    if (btn) btn.className = "switch-btn" + (state.ddVisible ? " active" : "");
    if (container) container.className = "toggle-switch-container" + (state.ddVisible ? " active" : "");
    broadcastState();
}

function calcRanskoTotal(shouldSync = true) {
    let homeSum = 0;
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`ransko-h-${i+1}`);
        const val = el ? (parseInt(el.value) || 0) : 0;
        state.ransko.home[i] = val;
        homeSum += val;
    }
    if (state.showOT) {
        const el = document.getElementById("ransko-h-ot");
        const valOT = el ? (parseInt(el.value) || 0) : 0;
        state.ransko.home[4] = valOT;
        homeSum += valOT;
    } else {
        state.ransko.home[4] = 0;
    }
    const totalHome = document.getElementById("ransko-h-total");
    if (totalHome) totalHome.textContent = homeSum;
    state.homeScore = homeSum;
    document.getElementById("label-home-score").textContent = homeSum;

    let awaySum = 0;
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById(`ransko-a-${i+1}`);
        const val = el ? (parseInt(el.value) || 0) : 0;
        state.ransko.away[i] = val;
        awaySum += val;
    }
    if (state.showOT) {
        const el = document.getElementById("ransko-a-ot");
        const valOT = el ? (parseInt(el.value) || 0) : 0;
        state.ransko.away[4] = valOT;
        awaySum += valOT;
    } else {
        state.ransko.away[4] = 0;
    }
    const totalAway = document.getElementById("ransko-a-total");
    if (totalAway) totalAway.textContent = awaySum;
    state.awayScore = awaySum;
    document.getElementById("label-away-score").textContent = awaySum;

    if (shouldSync) {
        broadcastState();
    }
}

// スターターデモロード
function loadRosterDemo(team) {
    if (team === 'home') {
        state.roster = state.roster.filter(p => p.team !== "HOME").concat(demoHomeRoster);
    } else {
        state.roster = state.roster.filter(p => p.team !== "AWAY").concat(demoAwayRoster);
    }
    updateDashboardUI();
    broadcastState();
    alert(`${team === 'home' ? 'HOME' : 'AWAY'}のデモ選手データをロードしました！\n(※チーム名・カラー等の設定は維持されます)`);
}

function syncRanskoToScores() {
    calcRanskoTotal(true);
}

function clearRansko() {
    for (let i = 0; i < 5; i++) {
        state.ransko.home[i] = 0;
        state.ransko.away[i] = 0;
    }
    state.homeScore = 0;
    state.awayScore = 0;
    updateDashboardUI();
    broadcastState();
}

function resetRosterScore(team) {
    if (team === "home") {
        state.homeScore = 0;
        for(let i=0; i<5; i++) state.ransko.home[i] = 0;
    } else {
        state.awayScore = 0;
        for(let i=0; i<5; i++) state.ransko.away[i] = 0;
    }
    updateDashboardUI();
    broadcastState();
}

// ==========================================================================
// ワンショット（選手紹介）コントロール
// ==========================================================================
function sendOneshot(active, playerObj = null) {
    state.oneshot.active = active;
    clearTimeout(oneshotTimer);

    if (active) {
        if (playerObj) {
            state.oneshot.number = playerObj.number;
            state.oneshot.position = playerObj.position;
            state.oneshot.name = playerObj.name;
            state.oneshot.grade = String(playerObj.memo || "");
            state.oneshot.comment = playerObj.comment || "";
            state.oneshot.team = playerObj.team || "HOME";
        } else {
            state.oneshot.number = document.getElementById("oneshot-input-num").value;
            state.oneshot.position = document.getElementById("oneshot-input-pos").value;
            state.oneshot.name = document.getElementById("oneshot-input-name").value;
            state.oneshot.grade = document.getElementById("oneshot-input-grade").value;
            state.oneshot.comment = document.getElementById("oneshot-input-comment").value;
            
            const p = state.roster.find(r => r.name === state.oneshot.name || r.number === state.oneshot.number);
            state.oneshot.team = p ? p.team : "HOME";
        }

        const durationInput = document.getElementById("oneshot-input-duration");
        const durationSec = durationInput ? (parseInt(durationInput.value) || 8) : 8;
        oneshotTimer = setTimeout(() => {
            sendOneshot(false);
        }, durationSec * 1000);
    }
    
    broadcastState();
    updateDashboardUI();
}

function loadOneshotDemo(index) {
    if (index === 1) {
        document.getElementById("oneshot-input-num").value = "1";
        document.getElementById("oneshot-input-pos").value = "QB";
        document.getElementById("oneshot-input-name").value = "関根 怜玖";
        document.getElementById("oneshot-input-grade").value = "4年";
        document.getElementById("oneshot-input-comment").value = "名城のエースQB、抜群のパス精度で攻撃陣を牽引";
    } else {
        document.getElementById("oneshot-input-num").value = "56";
        document.getElementById("oneshot-input-pos").value = "LG";
        document.getElementById("oneshot-input-name").value = "関 凛晟";
        document.getElementById("oneshot-input-grade").value = "2年";
        document.getElementById("oneshot-input-comment").value = "強力なパスプロテクションを誇る名城の盾";
    }
}

// 紹介用選手名簿タブ切り替え
function switchOneshotTab(team) {
    currentOneshotTab = team;
    
    const btnHome = document.getElementById("btn-oneshot-tab-home");
    const btnAway = document.getElementById("btn-oneshot-tab-away");
    
    if (btnHome && btnAway) {
        if (team === 'HOME') {
            btnHome.classList.add("active");
            btnAway.classList.remove("active");
        } else {
            btnAway.classList.add("active");
            btnHome.classList.remove("active");
        }
    }
    renderOneshotListTable();
}

// 紹介用選手名簿CSVパース機能 (HOME/AWAY自動振り分け)
// CSVファイルの文字コードを自動判別して読み込む (UTF-8 / Shift-JIS(Excel等) 両対応)
function readCSVFileAuto(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const bytes = new Uint8Array(e.target.result);
        const encoding = isUTF8Bytes(bytes) ? 'utf-8' : 'shift-jis';
        const text = new TextDecoder(encoding).decode(bytes);
        callback(text);
    };
    reader.readAsArrayBuffer(file);
}

// バイト列がUTF-8として妥当かを判定する簡易チェック
function isUTF8Bytes(bytes) {
    let i = 0;
    while (i < bytes.length) {
        if (bytes[i] <= 0x7F) {
            i += 1;
        } else if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF) {
            if (i + 1 >= bytes.length || bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF) return false;
            i += 2;
        } else if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF) {
            if (i + 2 >= bytes.length || bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF || bytes[i + 2] < 0x80 || bytes[i + 2] > 0xBF) return false;
            i += 3;
        } else if (bytes[i] >= 0xF0 && bytes[i] <= 0xF4) {
            if (i + 3 >= bytes.length || bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF || bytes[i + 2] < 0x80 || bytes[i + 2] > 0xBF || bytes[i + 3] < 0x80 || bytes[i + 3] > 0xBF) return false;
            i += 4;
        } else {
            return false;
        }
    }
    return true;
}

function handleOneshotCSVFile(input) {
    const file = input.files[0];
    if (!file) return;

    readCSVFileAuto(file, (text) => {
        parseOneshotCSV(text);
    });
}

function parseOneshotCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const parsedHome = [];
    const parsedAway = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(",").map(c => c.trim());
        if (cols.length < 5) continue;

        if (cols[0].includes("チーム") || cols[2].includes("背番号") || cols[4].includes("氏名")) {
            continue;
        }

        const team = cols[0].toUpperCase() === "AWAY" ? "AWAY" : "HOME";
        const side = (cols[1] || "").includes("ディフェンス") ? "defense" : "offense";
        const number = cols[2] || "";
        const position = (cols[3] || "").toUpperCase();
        const name = cols[4] || "";
        const memo = cols[5] || ""; 
        const comment = cols[6] || "";

        const pObj = {
            team,
            side,
            number,
            position,
            name,
            memo,
            comment
        };

        if (team === "HOME") {
            parsedHome.push(pObj);
        } else {
            parsedAway.push(pObj);
        }
    }

    oneshotPlayers.HOME = parsedHome;
    oneshotPlayers.AWAY = parsedAway;
    renderOneshotListTable();
    alert(`紹介選手データをロードしました。\n(HOME: ${parsedHome.length}件 / AWAY: ${parsedAway.length}件)`);
}

// 紹介デモリストのロード (HOME/AWAY振り分け)
function loadOneshotDemoList() {
    oneshotPlayers.HOME = [
        { team: "HOME", side: "offense", number: "1", position: "QB", name: "関根 怜玖", memo: "4年", comment: "名城のエースQB、抜群のパス精度で攻撃陣を牽引" },
        { team: "HOME", side: "offense", number: "56", position: "LG", name: "関 凛晟", memo: "2年", comment: "強力なパスプロテクションを誇る名城の盾" },
        { team: "HOME", side: "offense", number: "25", position: "RB", name: "松田 吟", memo: "4年", comment: "昨季ラン獲得ヤードリーグ1位の韋駄天エース" }
    ];
    oneshotPlayers.AWAY = [
        { team: "AWAY", side: "offense", number: "10", position: "QB", name: "John Smith", memo: "4年", comment: "中京大を引っ張る強肩パサー、要警戒の司令塔" }
    ];
    renderOneshotListTable();
    alert("紹介用のデモ選手リストを読み込みました！");
}

// 紹介選手リストテーブル描画 (HOME/AWAY個別描画)
function renderOneshotListTable() {
    const table = document.getElementById("oneshot-list-table");
    const tbody = document.getElementById("oneshot-list-table-body");
    const placeholder = document.getElementById("oneshot-list-placeholder");

    if (!table || !tbody || !placeholder) return;

    const listData = oneshotPlayers[currentOneshotTab] || [];

    if (listData.length === 0) {
        table.style.display = "none";
        placeholder.style.display = "block";
        placeholder.textContent = `${currentOneshotTab} の紹介データがロードされていません`;
        return;
    }

    placeholder.style.display = "none";
    table.style.display = "table";
    tbody.innerHTML = "";

    listData.forEach(p => {
        const tr = document.createElement("tr");

        const tdNum = document.createElement("td");
        tdNum.textContent = p.number;
        tdNum.style.fontFamily = "Oswald, sans-serif";
        tdNum.style.fontWeight = "bold";

        const tdPos = document.createElement("td");
        tdPos.textContent = p.position;

        const tdName = document.createElement("td");
        tdName.innerHTML = `<strong>${p.name}</strong> <span style="font-size:9px; color:#94a3b8;">(${String(p.memo || "")})</span>`;

        const tdComment = document.createElement("td");
        tdComment.textContent = p.comment;
        tdComment.style.maxWidth = "200px";
        tdComment.style.overflow = "hidden";
        tdComment.style.textOverflow = "ellipsis";
        tdComment.style.whiteSpace = "nowrap";

        const tdAction = document.createElement("td");
        tdAction.style.display = "flex";
        tdAction.style.gap = "4px";
        tdAction.style.justifyContent = "center";

        const btnShow = document.createElement("button");
        btnShow.className = "btn btn-success";
        btnShow.style.padding = "2px 8px";
        btnShow.style.fontSize = "10px";
        btnShow.textContent = "表示";
        btnShow.onclick = () => sendOneshot(true, p);

        const btnHide = document.createElement("button");
        btnHide.className = "btn btn-danger";
        btnHide.style.padding = "2px 8px";
        btnHide.style.fontSize = "10px";
        btnHide.textContent = "消す";
        btnHide.onclick = () => sendOneshot(false);

        tdAction.appendChild(btnShow);
        tdAction.appendChild(btnHide);

        tr.appendChild(tdNum);
        tr.appendChild(tdPos);
        tr.appendChild(tdName);
        tr.appendChild(tdComment);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
    });
}

// ==========================================================================
// 全画面スライド (静止画) コントロール (手動消去仕様)
// ==========================================================================
let localDragSlideDataUrl = ""; // ドラッグ＆ドロップで受け取った画像を一時保持

function sendSlideTelop(active, dataUrl = null) {
    state.imageTelop.active = active;

    if (active) {
        let finalUrl = dataUrl;
        if (!finalUrl && localDragSlideDataUrl) {
            finalUrl = localDragSlideDataUrl;
        }
        if (!finalUrl) {
            const urlInput = document.getElementById("slide-input-url");
            const url = urlInput ? urlInput.value.trim() : "";
            if (!url) {
                alert("表示する画像のURLを入力するか、ローカル画像ファイルを選択またはドロップしてください。");
                state.imageTelop.active = false;
                return;
            }

            finalUrl = url;
            const slideIdMatch = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
            if (slideIdMatch) {
                const slideId = slideIdMatch[1];
                const pageIdMatch = url.match(/slide=id\.([a-zA-Z0-9-_]+)/);
                const pageId = pageIdMatch ? pageIdMatch[1] : '';
                if (pageId) {
                    finalUrl = `https://docs.google.com/presentation/d/${slideId}/export/png?id=${slideId}&pageid=${pageId}`;
                } else {
                    finalUrl = `https://docs.google.com/presentation/d/${slideId}/export/png`;
                }
            }
        }

        state.imageTelop.url = finalUrl;
    }

    broadcastState();
}

function handleSlideFile(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        sendSlideTelop(true, e.target.result);
    };
    reader.readAsDataURL(file);
}

// ==========================================================================
// Roster (選手リスト) CSV パース & ポジションソート
// ==========================================================================

function handleCSVFile(input) {
    const file = input.files[0];
    if (!file) return;

    document.getElementById("csv-upload-text").textContent = file.name;

    readCSVFileAuto(file, (text) => {
        parseRosterCSV(text);
    });
}

function parseRosterCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const rosterData = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(",").map(c => c.trim());
        if (cols.length < 5) continue;

        if (cols[0].includes("チーム") || cols[2].includes("背番号") || cols[4].includes("氏名")) {
            continue;
        }

        const team = cols[0].toUpperCase() === "AWAY" ? "AWAY" : "HOME";
        const side = (cols[1] || "").includes("ディフェンス") ? "defense" : "offense";
        const number = cols[2] || "";
        const position = (cols[3] || "").toUpperCase();
        const name = cols[4] || "";
        const memo = cols[5] || ""; 
        const comment = cols[6] || ""; 

        rosterData.push({
            team,
            side,
            number,
            position,
            name,
            memo,
            comment
        });
    }

    state.roster = rosterData;
    updateRosterTable();
    broadcastState();
}

function getPositionPriority(side, pos) {
    const p = pos ? pos.toUpperCase() : "";
    if (side === "offense") {
        if (p.includes("OL") || p === "C" || p === "G" || p === "T" || p === "LT" || p === "LG" || p === "RG" || p === "RT") return 1;
        if (p.includes("TE")) return 2;
        if (p.includes("QB")) return 3;
        if (p.includes("RB") || p.includes("FB") || p.includes("HB")) return 4;
        if (p.includes("WR") || p.includes("SE") || p.includes("FL")) return 5;
        if (p === "P") return 6;
        if (p.includes("LS")) return 7;
        return 99;
    } else {
        if (p.includes("DL") || p === "DE" || p === "DT" || p === "NT") return 1;
        if (p.includes("LB") || p === "ILB" || p === "OLB" || p === "MLB") return 2;
        if (p.includes("DB") || p === "CB" || p === "S" || p === "FS" || p === "SS" || p === "SF") return 3;
        if (p === "K") return 4;
        if (p.includes("SP")) return 5;
        if (p === "H") return 6;
        return 99;
    }
}

function updateRosterTable() {
    const table = document.getElementById("roster-table");
    const tbody = document.getElementById("roster-table-body");
    const placeholder = document.getElementById("roster-placeholder");

    if (!table || !tbody || !placeholder) return;

    if (!state.roster || state.roster.length === 0) {
        table.style.display = "none";
        placeholder.style.display = "block";
        return;
    }

    placeholder.style.display = "none";
    table.style.display = "table";
    tbody.innerHTML = "";

    const sortedRoster = [...state.roster].sort((a, b) => {
        if (a.team !== b.team) return a.team === "HOME" ? -1 : 1;
        if (a.side !== b.side) return a.side === "offense" ? -1 : 1;
        
        const priA = getPositionPriority(a.side, a.position);
        const priB = getPositionPriority(b.side, b.position);
        if (priA !== priB) return priA - priB;
        
        return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
    });

    sortedRoster.forEach(p => {
        const tr = document.createElement("tr");
        
        const tdTeam = document.createElement("td");
        tdTeam.textContent = p.team;
        tdTeam.style.color = p.team === "HOME" ? "#10b981" : "#f43f5e";
        tdTeam.style.fontWeight = "bold";
        
        const tdSide = document.createElement("td");
        tdSide.textContent = p.side === "offense" ? "オフェンス" : "ディフェンス";
        
        const tdNum = document.createElement("td");
        tdNum.textContent = p.number;
        tdNum.style.fontFamily = "Oswald, sans-serif";
        tdNum.style.fontWeight = "bold";
        
        const tdPos = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "badge-position";
        badge.textContent = p.position;
        tdPos.appendChild(badge);
        
        const tdName = document.createElement("td");
        tdName.textContent = p.name;
        
        const tdGrade = document.createElement("td");
        tdGrade.textContent = String(p.memo || "");

        const tdAction = document.createElement("td");
        tdAction.style.display = "flex";
        tdAction.style.gap = "4px";
        tdAction.style.justifyContent = "center";
        
        const btnShow = document.createElement("button");
        btnShow.className = "btn btn-success";
        btnShow.style.padding = "2px 8px";
        btnShow.style.fontSize = "11px";
        btnShow.textContent = "表示";
        btnShow.onclick = () => sendOneshot(true, p);

        const btnHide = document.createElement("button");
        btnHide.className = "btn btn-danger";
        btnHide.style.padding = "2px 8px";
        btnHide.style.fontSize = "11px";
        btnHide.textContent = "消す";
        btnHide.onclick = () => sendOneshot(false);

        tdAction.appendChild(btnShow);
        tdAction.appendChild(btnHide);

        tr.appendChild(tdTeam);
        tr.appendChild(tdSide);
        tr.appendChild(tdNum);
        tr.appendChild(tdPos);
        tr.appendChild(tdName);
        tr.appendChild(tdGrade);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
    });
}

// --- 別窓で配信画面(Overlay)を開く ---
function openDualFillAndKey() {
    const winFill = window.open('americanfootball_overlay.html?mode=fill', 'af_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
    const winKey = window.open('americanfootball_overlay.html?mode=key', 'af_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');

    if (!winFill || !winKey || winFill.closed || typeof winFill.closed === 'undefined' || winKey.closed || typeof winKey.closed === 'undefined') {
        alert("【お知らせ】ブラウザのポップアップブロックにより2枚目の画面が遮断されました。\n\nアドレスバー右端の「ポップアップがブロックされました」アイコンをクリックして「常に許可」を設定するか、ヘッダーの「🎬 Fill画面を開く」「🔲 Key画面を開く」ボタンをそれぞれクリックして2枚のウィンドウを開いてください。");
    }
}

const btnOpenDual = document.getElementById('btn-open-dual');
if (btnOpenDual) btnOpenDual.addEventListener('click', openDualFillAndKey);

const btnOpenFill = document.getElementById('btn-open-fill');
if (btnOpenFill) {
    btnOpenFill.addEventListener('click', () => {
        window.open('americanfootball_overlay.html?mode=fill', 'af_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
    });
}

const btnOpenKey = document.getElementById('btn-open-key');
if (btnOpenKey) {
    btnOpenKey.addEventListener('click', () => {
        window.open('americanfootball_overlay.html?mode=key', 'af_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
    });
}

// クロマキー背景色切り替え
function setChromaKey(color) {
    if (!state.chromaKey) state.chromaKey = color;
    state.chromaKey = color;
    const btns = document.querySelectorAll(".btn-chroma");
    btns.forEach(btn => btn.classList.remove("active"));
    const target = document.querySelector(`.chroma-${color}`);
    if (target) target.classList.add("active");
    sendState();
}

// ==========================================================================
// 📷 外付けUSB Webカメラ 超軽量キャプチャ ＆ クロップ配信 (アメフト用)
// ==========================================================================
let cameraStream = null;
let cameraTimer = null;
let isCameraOverlayVisible = false;

async function initCameraCapture() {
    const select = document.getElementById('camera-device-select');
    const btnToggle = document.getElementById('btn-toggle-camera');
    const btnOverlay = document.getElementById('btn-toggle-camera-overlay');
    if (!select || !btnToggle) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        select.innerHTML = '';
        videoDevices.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.innerText = d.label || `カメラ ${i + 1}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn('カメラ列挙失敗:', e);
    }

    btnToggle.addEventListener('click', async () => {
        if (cameraStream) {
            stopCamera();
            btnToggle.innerText = 'カメラ起動';
            btnToggle.style.background = '#0284c7';
            document.getElementById('camera-status-badge').innerText = '停止中';
            document.getElementById('camera-status-badge').style.background = '#334155';
        } else {
            const deviceId = select.value;
            await startCamera(deviceId);
            btnToggle.innerText = 'カメラ停止';
            btnToggle.style.background = '#dc2626';
            document.getElementById('camera-status-badge').innerText = '稼働中';
            document.getElementById('camera-status-badge').style.background = '#22c55e';
        }
    });

    if (btnOverlay) {
        btnOverlay.addEventListener('click', () => {
            isCameraOverlayVisible = !isCameraOverlayVisible;
            btnOverlay.innerText = isCameraOverlayVisible ? 'テロップ画面へ送出 (ON AIR中)' : 'テロップ画面へ送出 (ON)';
            btnOverlay.style.background = isCameraOverlayVisible ? '#dc2626' : '#16a34a';
        });
    }
}

async function startCamera(deviceId) {
    try {
        const constraints = {
            video: deviceId ? { deviceId: { exact: deviceId } } : true,
            audio: false
        };
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('camera-raw-video');
        if (video) {
            video.srcObject = cameraStream;
            video.play();
        }
        startCameraLoop();
    } catch (err) {
        alert('カメラの起動に失敗しました: ' + err.message);
    }
}

function stopCamera() {
    if (cameraTimer) {
        clearInterval(cameraTimer);
        cameraTimer = null;
    }
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (channel) {
        channel.postMessage({ type: 'CLOCK_IMAGE', visible: false, image: null });
    }
}

function startCameraLoop() {
    if (cameraTimer) clearInterval(cameraTimer);
    const video = document.getElementById('camera-raw-video');
    const canvas = document.getElementById('camera-crop-canvas');
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');

    cameraTimer = setInterval(() => {
        if (!video.videoWidth) return;

        const cropX = parseInt(document.getElementById('crop-x')?.value || '0', 10);
        const cropY = parseInt(document.getElementById('crop-y')?.value || '0', 10);
        const zoom = parseInt(document.getElementById('crop-zoom')?.value || '100', 10) / 100;

        const sw = video.videoWidth / zoom;
        const sh = video.videoHeight / zoom;
        const sx = ((video.videoWidth - sw) * (cropX / 100));
        const sy = ((video.videoHeight - sh) * (cropY / 100));

        canvas.width = 320;
        canvas.height = 180;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        if (isCameraOverlayVisible) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6); // 200ms間隔・超軽量圧縮
            if (channel) {
                channel.postMessage({ type: 'CLOCK_IMAGE', visible: true, image: dataUrl });
            }
        }
    }, 200);
}

// ==========================================================================
// 🎮 Stream Deck USB直接接続 ＆ 自動認識・実機LCD描画 (アメフト完全対応)
// ==========================================================================
let streamDeckDevice = null;
let currentDeckProfile = null;
let streamDeckFlipVertical = false;
let streamDeckKeyOffset = 3;
let timerInterval = null;

const ELGATO_VENDOR_ID = 0x0fd9;

const STREAMDECK_MODELS = {
    0x006d: { name: "Stream Deck V2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4 },
    0x0080: { name: "Stream Deck MK.2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4 },
    0x0060: { name: "Stream Deck Original V1", cols: 5, rows: 3, keyCount: 15, imgFormat: "bmp", iconSize: 72, inputOffset: 1 },
    0x0063: { name: "Stream Deck Mini", cols: 3, rows: 2, keyCount: 6, imgFormat: "bmp", iconSize: 80, inputOffset: 1 },
    0x0090: { name: "Stream Deck Mini V2", cols: 3, rows: 2, keyCount: 6, imgFormat: "jpeg", iconSize: 80, inputOffset: 4 },
    0x006c: { name: "Stream Deck XL", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4 },
    0x008f: { name: "Stream Deck XL V2", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4 },
    0x0084: { name: "Stream Deck +", cols: 4, rows: 2, keyCount: 8, imgFormat: "jpeg", iconSize: 120, inputOffset: 4 }
};

function syncAndRender() {
    updateDashboardUI();
    broadcastState();
}

function toggleTimer() {
    state.timerRunning = !state.timerRunning;
    if (state.timerRunning) {
        if (!timerInterval) {
            timerInterval = setInterval(() => {
                if (state.timerSeconds > 0) {
                    state.timerSeconds--;
                } else if (state.timerMinutes > 0) {
                    state.timerMinutes--;
                    state.timerSeconds = 59;
                } else {
                    state.timerRunning = false;
                    clearInterval(timerInterval);
                    timerInterval = null;
                }
                updateDashboardUI();
                broadcastState();
                updateStreamDeckLCD();
            }, 1000);
        }
    } else {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }
    syncAndRender();
    updateStreamDeckLCD();
}

function addToGo(diff) {
    let current = parseInt(state.togo, 10);
    if (isNaN(current)) current = 10;
    current = Math.max(1, Math.min(99, current + diff));
    state.togo = String(current);
    const el = document.getElementById("input-togo");
    if (el) el.value = state.togo;
    broadcastState();
    updateStreamDeckLCD();
}

function resetDownAndDistance() {
    setDown(1);
    setToGoPreset('10');
    updateStreamDeckLCD();
}

function toggleFirstPlayerTelop() {
    if (state.oneshot && state.oneshot.active) {
        sendOneshot(false);
    } else {
        const pool = (oneshotPlayers && oneshotPlayers.HOME && oneshotPlayers.HOME.length > 0) ? oneshotPlayers.HOME : state.roster;
        const p = (pool && pool.length > 0) ? pool[0] : null;
        if (p) sendOneshot(true, p);
    }
    updateStreamDeckLCD();
}

// アメフト用15キー標準アクション定義 (5x3)
const AF_STREAMDECK_ACTIONS = [
    // 1行目: HOME TD(+6), HOME FG(+3), HOME PAT(+1), HOME 2Pt(+2), ⏱ START/STOP
    { keyIndex: 0, label: "HOME TD", sub: "+6点", bg: "#0369a1", action: () => { addScore('home', 6); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "HOME FG", sub: "+3点", bg: "#0284c7", action: () => { addScore('home', 3); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "HOME PAT", sub: "+1点", bg: "#0284c7", action: () => { addScore('home', 1); updateStreamDeckLCD(); } },
    { keyIndex: 3, label: "HOME 2Pt", sub: "+2点", bg: "#0284c7", action: () => { addScore('home', 2); updateStreamDeckLCD(); } },
    { keyIndex: 4, label: "⏱ START", sub: "STOP切替", bg: "#15803d", action: () => { toggleTimer(); } },

    // 2行目: AWAY TD(+6), AWAY FG(+3), AWAY PAT(+1), AWAY 2Pt(+2), 🏈 1st Down
    { keyIndex: 5, label: "AWAY TD", sub: "+6点", bg: "#991b1b", action: () => { addScore('away', 6); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "AWAY FG", sub: "+3点", bg: "#dc2626", action: () => { addScore('away', 3); updateStreamDeckLCD(); } },
    { keyIndex: 7, label: "AWAY PAT", sub: "+1点", bg: "#dc2626", action: () => { addScore('away', 1); updateStreamDeckLCD(); } },
    { keyIndex: 8, label: "AWAY 2Pt", sub: "+2点", bg: "#dc2626", action: () => { addScore('away', 2); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "🏈 1st Down", sub: "10 YDS", bg: "#4338ca", action: () => { resetDownAndDistance(); } },

    // 3行目: 表示モード切替 + スタメン + 選手紹介 + 全面消去
    { keyIndex: 10, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { changeDisplayMode(state.displayMode === 'large' ? 'small' : 'large'); updateStreamDeckLCD(); } },
    { keyIndex: 11, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { changeDisplayMode(state.displayMode === 'vs' ? 'large' : 'vs'); updateStreamDeckLCD(); } },
    { keyIndex: 12, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { changeDisplayMode(state.displayMode === 'lineup' ? 'large' : 'lineup'); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "👤 選手紹介", sub: "ON/OFF", bg: "#b45309", action: () => { toggleFirstPlayerTelop(); } },
    { keyIndex: 14, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { changeDisplayMode('hidden'); updateStreamDeckLCD(); } }
];

// アメフト用32キー拡張アクション定義 (8x4: Stream Deck XL用)
const AF_STREAMDECK_ACTIONS_32 = [
    // 1行目: HOME得点・TO・時計
    { keyIndex: 0, label: "HOME TD", sub: "+6点", bg: "#0369a1", action: () => { addScore('home', 6); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "HOME FG", sub: "+3点", bg: "#0284c7", action: () => { addScore('home', 3); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "HOME PAT", sub: "+1点", bg: "#0284c7", action: () => { addScore('home', 1); updateStreamDeckLCD(); } },
    { keyIndex: 3, label: "HOME 2Pt", sub: "+2点", bg: "#0284c7", action: () => { addScore('home', 2); updateStreamDeckLCD(); } },
    { keyIndex: 4, label: "HOME SAF", sub: "+2点", bg: "#0369a1", action: () => { addScore('home', 2); updateStreamDeckLCD(); } },
    { keyIndex: 5, label: "HOME TO", sub: "タイムアウト", bg: "#ca8a04", action: () => { adjustTO('home', -1); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "⏱ START", sub: "STOP切替", bg: "#15803d", action: () => { toggleTimer(); } },
    { keyIndex: 7, label: "⏱ 40s", sub: "プレイクロック", bg: "#475569", action: () => { state.playclock = 40; broadcastState(); updateStreamDeckLCD(); } },

    // 2行目: AWAY得点・TO・時計
    { keyIndex: 8, label: "AWAY TD", sub: "+6点", bg: "#991b1b", action: () => { addScore('away', 6); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "AWAY FG", sub: "+3点", bg: "#dc2626", action: () => { addScore('away', 3); updateStreamDeckLCD(); } },
    { keyIndex: 10, label: "AWAY PAT", sub: "+1点", bg: "#dc2626", action: () => { addScore('away', 1); updateStreamDeckLCD(); } },
    { keyIndex: 11, label: "AWAY 2Pt", sub: "+2点", bg: "#dc2626", action: () => { addScore('away', 2); updateStreamDeckLCD(); } },
    { keyIndex: 12, label: "AWAY SAF", sub: "+2点", bg: "#991b1b", action: () => { addScore('away', 2); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "AWAY TO", sub: "タイムアウト", bg: "#ca8a04", action: () => { adjustTO('away', -1); updateStreamDeckLCD(); } },
    { keyIndex: 14, label: "🏈 1st & 10", sub: "リセット", bg: "#4338ca", action: () => { resetDownAndDistance(); } },
    { keyIndex: 15, label: "⏱ 25s", sub: "プレイクロック", bg: "#475569", action: () => { state.playclock = 25; broadcastState(); updateStreamDeckLCD(); } },

    // 3行目: ダウン・反則・Qtr
    { keyIndex: 16, label: "2nd Down", sub: "第2ダウン", bg: "#334155", action: () => { setDown(2); updateStreamDeckLCD(); } },
    { keyIndex: 17, label: "3rd Down", sub: "第3ダウン", bg: "#334155", action: () => { setDown(3); updateStreamDeckLCD(); } },
    { keyIndex: 18, label: "4th Down", sub: "第4ダウン", bg: "#b91c1c", action: () => { setDown(4); updateStreamDeckLCD(); } },
    { keyIndex: 19, label: "🚩 FLAG", sub: "反則発生", bg: "#ca8a04", action: () => { toggleFlag(); updateStreamDeckLCD(); } },
    { keyIndex: 20, label: "1Q", sub: "第1Qtr", bg: "#1e293b", action: () => { onPeriodChange("1Q"); updateStreamDeckLCD(); } },
    { keyIndex: 21, label: "2Q", sub: "第2Qtr", bg: "#1e293b", action: () => { onPeriodChange("2Q"); updateStreamDeckLCD(); } },
    { keyIndex: 22, label: "3Q", sub: "第3Qtr", bg: "#1e293b", action: () => { onPeriodChange("3Q"); updateStreamDeckLCD(); } },
    { keyIndex: 23, label: "4Q", sub: "第4Qtr", bg: "#1e293b", action: () => { onPeriodChange("4Q"); updateStreamDeckLCD(); } },

    // 4行目: 残りヤード加減・表示切替・送出・全面消去
    { keyIndex: 24, label: "➕ YDS", sub: "+1 ヤード", bg: "#0284c7", action: () => { addToGo(1); } },
    { keyIndex: 25, label: "➖ YDS", sub: "-1 ヤード", bg: "#0f172a", action: () => { addToGo(-1); } },
    { keyIndex: 26, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { changeDisplayMode(state.displayMode === 'large' ? 'small' : 'large'); updateStreamDeckLCD(); } },
    { keyIndex: 27, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { changeDisplayMode(state.displayMode === 'vs' ? 'large' : 'vs'); updateStreamDeckLCD(); } },
    { keyIndex: 28, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { changeDisplayMode(state.displayMode === 'lineup' ? 'large' : 'lineup'); updateStreamDeckLCD(); } },
    { keyIndex: 29, label: "👤 選手紹介", sub: "ON/OFF", bg: "#b45309", action: () => { toggleFirstPlayerTelop(); } },
    { keyIndex: 30, label: "📷 クロック枠", sub: "カメラ送出", bg: "#0d9488", action: () => { 
        isCameraOverlayVisible = !isCameraOverlayVisible; 
        const btnOverlay = document.getElementById('btn-toggle-camera-overlay');
        if (btnOverlay) {
            btnOverlay.innerText = isCameraOverlayVisible ? 'テロップ画面へ送出 (ON AIR中)' : 'テロップ画面へ送出 (ON)';
            btnOverlay.style.background = isCameraOverlayVisible ? '#dc2626' : '#16a34a';
        }
        updateStreamDeckLCD(); 
    } },
    { keyIndex: 31, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { changeDisplayMode('hidden'); updateStreamDeckLCD(); } }
];

let activeKeyActions = AF_STREAMDECK_ACTIONS;

function getPhysicalKeyIndex(logicKeyIndex) {
    if (!currentDeckProfile) return logicKeyIndex;
    const cols = currentDeckProfile.cols || 5;
    const rows = currentDeckProfile.rows || 3;
    if (streamDeckFlipVertical) {
        const r = Math.floor(logicKeyIndex / cols);
        const c = logicKeyIndex % cols;
        return ((rows - 1) - r) * cols + c;
    }
    return logicKeyIndex;
}

function getLogicalKeyIndex(physicalKeyIndex) {
    if (!currentDeckProfile) return physicalKeyIndex;
    const cols = currentDeckProfile.cols || 5;
    const rows = currentDeckProfile.rows || 3;
    if (streamDeckFlipVertical) {
        const r = Math.floor(physicalKeyIndex / cols);
        const c = physicalKeyIndex % cols;
        return ((rows - 1) - r) * cols + c;
    }
    return physicalKeyIndex;
}

function initStreamDeckHID() {
    const btnConnect = document.getElementById('btn-connect-streamdeck');
    const btnDisconnect = document.getElementById('btn-disconnect-streamdeck');
    const btnFlip = document.getElementById('btn-flip-streamdeck');
    const btnShiftLeft = document.getElementById('btn-shift-left');
    const btnShiftRight = document.getElementById('btn-shift-right');

    if (!navigator.hid) {
        const info = document.getElementById('streamdeck-device-info');
        if (info) info.innerHTML = '<span style="color:#ef4444;">※お使いのブラウザはWeb HID APIに対応していません (Chrome/Edge推奨)。</span>';
        if (btnConnect) btnConnect.disabled = true;
        return;
    }

    navigator.hid.addEventListener('connect', (e) => {
        if (e.device && e.device.vendorId === ELGATO_VENDOR_ID) {
            connectStreamDeckDevice(e.device);
        }
    });

    navigator.hid.addEventListener('disconnect', (e) => {
        if (streamDeckDevice && e.device === streamDeckDevice) {
            disconnectStreamDeck();
        }
    });

    if (btnConnect) {
        btnConnect.addEventListener('click', async () => {
            try {
                const devices = await navigator.hid.requestDevice({
                    filters: [{ vendorId: ELGATO_VENDOR_ID }]
                });
                if (devices.length > 0) {
                    await connectStreamDeckDevice(devices[0]);
                }
            } catch (err) {
                console.error('[StreamDeck] Error:', err);
            }
        });
    }

    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', disconnectStreamDeck);
    }

    if (btnFlip) {
        btnFlip.addEventListener('click', () => {
            streamDeckFlipVertical = !streamDeckFlipVertical;
            btnFlip.style.background = streamDeckFlipVertical ? '#0284c7' : '#475569';
            btnFlip.innerText = streamDeckFlipVertical ? '🔄 上下反転中' : '🔄 上下反転';
            updateStreamDeckLCD();
            renderStreamDeckPreview();
        });
    }

    if (btnShiftLeft) {
        btnShiftLeft.addEventListener('click', () => {
            streamDeckKeyOffset = Math.max(0, streamDeckKeyOffset - 1);
        });
    }

    if (btnShiftRight) {
        btnShiftRight.addEventListener('click', () => {
            streamDeckKeyOffset++;
        });
    }

    navigator.hid.getDevices().then(devices => {
        const streamDecks = devices.filter(d => d.vendorId === ELGATO_VENDOR_ID);
        if (streamDecks.length > 0) {
            connectStreamDeckDevice(streamDecks[0]);
        }
    });
}

async function connectStreamDeckDevice(device) {
    try {
        if (!device.opened) await device.open();
        streamDeckDevice = device;

        const pid = device.productId;
        currentDeckProfile = STREAMDECK_MODELS[pid] || {
            name: device.productName || "Stream Deck",
            cols: 5,
            rows: 3,
            keyCount: 15,
            imgFormat: "jpeg",
            iconSize: 72,
            inputOffset: 4
        };

        // 32キー（XL）の場合は専用の拡張配列をロード
        if (currentDeckProfile.keyCount >= 32) {
            activeKeyActions = AF_STREAMDECK_ACTIONS_32;
        } else {
            activeKeyActions = AF_STREAMDECK_ACTIONS;
        }

        const badge = document.getElementById('streamdeck-status-badge');
        const info = document.getElementById('streamdeck-device-info');
        const btnConnect = document.getElementById('btn-connect-streamdeck');
        const btnDisconnect = document.getElementById('btn-disconnect-streamdeck');
        const preview = document.getElementById('streamdeck-keypad-preview');

        if (badge) {
            badge.style.background = '#22c55e';
            badge.style.color = '#ffffff';
            badge.innerText = `接続中: ${currentDeckProfile.name}`;
        }
        if (info) {
            info.innerHTML = `✅ <b>${currentDeckProfile.name}</b> を自動認識。実機ボタンに文字・カラーが送信され直接操作できます。`;
        }
        if (btnConnect) btnConnect.classList.add('hidden');
        if (btnDisconnect) btnDisconnect.classList.remove('hidden');
        if (preview) {
            preview.classList.remove('hidden');
            preview.style.gridTemplateColumns = `repeat(${currentDeckProfile.cols}, 1fr)`;
        }

        device.oninputreport = handleStreamDeckInput;
        renderStreamDeckPreview();
        setTimeout(updateStreamDeckLCD, 200);

    } catch (err) {
        console.error('[StreamDeck] Open error:', err);
    }
}

function disconnectStreamDeck() {
    if (streamDeckDevice) {
        try { streamDeckDevice.close(); } catch(e) {}
        streamDeckDevice = null;
    }
    const badge = document.getElementById('streamdeck-status-badge');
    const info = document.getElementById('streamdeck-device-info');
    const btnConnect = document.getElementById('btn-connect-streamdeck');
    const btnDisconnect = document.getElementById('btn-disconnect-streamdeck');
    const preview = document.getElementById('streamdeck-keypad-preview');

    if (badge) {
        badge.style.background = '#334155';
        badge.style.color = '#94a3b8';
        badge.innerText = '未接続';
    }
    if (info) {
        info.innerHTML = '※USBで接続されるとWeb HID経由で自動認識され、TD・FG等のキー割り振りとLCD描画が自動起動します。';
    }
    if (btnConnect) btnConnect.classList.remove('hidden');
    if (btnDisconnect) btnDisconnect.classList.add('hidden');
    if (preview) preview.classList.add('hidden');
}

let previousButtonStates = new Array(64).fill(false);

function handleStreamDeckInput(event) {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const keyCount = currentDeckProfile ? currentDeckProfile.keyCount : 15;
    let offset = streamDeckKeyOffset;

    for (let i = 0; i < keyCount; i++) {
        const byteIdx = offset + i;
        if (byteIdx < data.length) {
            const isPressed = (data[byteIdx] === 1 || data[byteIdx] === 0x01);
            const wasPressed = previousButtonStates[i];
            
            if (isPressed && !wasPressed) {
                const logicalIndex = getLogicalKeyIndex(i);
                const mapping = activeKeyActions.find(m => m.keyIndex === logicalIndex);
                if (mapping && mapping.action) {
                    mapping.action();
                    flashKeypadPreview(logicalIndex);
                }
            }
            previousButtonStates[i] = isPressed;
        }
    }
}

function flashKeypadPreview(keyIndex) {
    const container = document.getElementById('streamdeck-keypad-preview');
    if (!container) return;
    const btn = container.children[keyIndex];
    if (btn) {
        const origBg = btn.style.background;
        btn.style.background = '#f59e0b';
        btn.style.color = '#000000';
        setTimeout(() => {
            btn.style.background = origBg;
            btn.style.color = '#f1f5f9';
        }, 150);
    }
}

async function updateStreamDeckLCD() {
    if (!streamDeckDevice || !streamDeckDevice.opened || !currentDeckProfile) return;
    if (currentDeckProfile.imgFormat === 'none') return;

    const iconSize = currentDeckProfile.iconSize || 72;
    const canvas = document.createElement('canvas');
    canvas.width = iconSize;
    canvas.height = iconSize;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < currentDeckProfile.keyCount; i++) {
        const logicalIndex = i;
        const targetPhysicalKey = getPhysicalKeyIndex(logicalIndex);
        const k = activeKeyActions.find(a => a.keyIndex === logicalIndex);
        if (!k) continue;

        ctx.clearRect(0, 0, iconSize, iconSize);

        let bgColor = k.bg || '#1e293b';
        if (k.label.includes('START') && state.timerRunning) bgColor = '#16a34a';
        if (k.label.includes('OFF') && state.displayMode === 'hidden') bgColor = '#dc2626';

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, iconSize, iconSize);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, iconSize - 4, iconSize - 4);

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(iconSize * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(k.label, iconSize / 2, iconSize * 0.38);

        if (k.sub) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = `${Math.round(iconSize * 0.14)}px sans-serif`;
            ctx.fillText(k.sub, iconSize / 2, iconSize * 0.68);
        }

        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = iconSize;
        rotatedCanvas.height = iconSize;
        const rCtx = rotatedCanvas.getContext('2d');
        rCtx.translate(iconSize, iconSize);
        rCtx.rotate(Math.PI);
        rCtx.drawImage(canvas, 0, 0);

        try {
            const blob = await new Promise(resolve => rotatedCanvas.toBlob(resolve, 'image/jpeg', 0.9));
            if (blob) {
                const arrayBuffer = await blob.arrayBuffer();
                const uint8 = new Uint8Array(arrayBuffer);
                await sendKeyImageToDevice(targetPhysicalKey, uint8);
            }
        } catch (e) {}
    }
}

async function sendKeyImageToDevice(keyIndex, imageBytes) {
    if (!streamDeckDevice) return;

    const PAGE_PACKET_SIZE = 1024;
    const NUM_FIRST_PAGE_PIXELS = 1016;
    let pageNumber = 0;
    let bytesRemaining = imageBytes.length;

    while (bytesRemaining > 0) {
        const isLastPage = bytesRemaining <= NUM_FIRST_PAGE_PIXELS;
        const bytesToSend = Math.min(bytesRemaining, NUM_FIRST_PAGE_PIXELS);
        const chunk = new Uint8Array(PAGE_PACKET_SIZE);

        chunk[0] = 0x02;
        chunk[1] = 0x07;
        chunk[2] = keyIndex;
        chunk[3] = isLastPage ? 1 : 0;
        chunk[4] = bytesToSend & 0xff;
        chunk[5] = (bytesToSend >> 8) & 0xff;
        chunk[6] = pageNumber & 0xff;
        chunk[7] = (pageNumber >> 8) & 0xff;

        const offset = imageBytes.length - bytesRemaining;
        chunk.set(imageBytes.subarray(offset, offset + bytesToSend), 8);

        try {
            await streamDeckDevice.sendReport(0x02, chunk.slice(1));
        } catch (err) {
            break;
        }

        bytesRemaining -= bytesToSend;
        pageNumber++;
    }
}

function renderStreamDeckPreview() {
    const container = document.getElementById('streamdeck-keypad-preview');
    if (!container) return;

    container.innerHTML = '';
    activeKeyActions.forEach(k => {
        const keyBtn = document.createElement('div');
        keyBtn.style.background = k.bg || '#1e293b';
        keyBtn.style.border = '1px solid #475569';
        keyBtn.style.borderRadius = '4px';
        keyBtn.style.padding = '6px 2px';
        keyBtn.style.textAlign = 'center';
        keyBtn.style.fontSize = '10px';
        keyBtn.style.fontWeight = '700';
        keyBtn.style.color = '#f1f5f9';
        keyBtn.style.cursor = 'pointer';
        keyBtn.style.transition = 'all 0.1s';
        keyBtn.style.userSelect = 'none';

        if (k.label.includes('START') && state.timerRunning) {
            keyBtn.style.background = '#15803d';
            keyBtn.style.borderColor = '#22c55e';
        }
        if (k.label.includes('OFF') && state.displayMode === 'hidden') {
            keyBtn.style.background = '#991b1b';
        }

        keyBtn.innerHTML = `<div>[Key ${k.keyIndex}]</div><div style="font-size:11px; margin-top:2px; font-weight:900;">${k.label}</div><div style="font-size:9px; color:#94a3b8;">${k.sub || ''}</div>`;
        
        keyBtn.addEventListener('click', () => {
            k.action();
            flashKeypadPreview(k.keyIndex);
        });

        container.appendChild(keyBtn);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initCameraCapture();
    initStreamDeckHID();
});
