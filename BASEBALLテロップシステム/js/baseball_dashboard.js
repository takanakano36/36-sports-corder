/* ==========================================================================
   野球・ソフトボール配信用ダッシュボード JavaScript
   ========================================================================== */

let state = null;
let globalSendState = null;
let globalUpdateUI = null;
let channel = null;

document.addEventListener('DOMContentLoaded', () => {
    // 状態オブジェクト
    state = {
        scoreboard: {
            visible: true,
            displayMode: 'small', // 'none', 'small', 'large', 'vs'
            homeName: '後攻 TEAM',
            homeSubName: 'NAGOYASANGYO',
            homeColor: '#059669',
            homeLogo: '',
            awayName: '先攻 TEAM',
            awaySubName: 'CHUKYO',
            awayColor: '#1d4ed8',
            awayLogo: '',
            tournamentName: '',
            
            // イニングとスコア
            inningNum: 1,
            inningHalf: 'top', // 'top' (表) or 'bot' (裏)
            homeInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''], // 1-12回
            awayInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''],
            homeScore: 0,
            awayScore: 0,
            homeHits: 0,
            awayHits: 0,
            homeErrors: 0,
            awayErrors: 0,
            showHE: true, // 大得点にH・Eを表示するフラグ

            // BSOカウント
            balls: 0,
            strikes: 0,
            outs: 0,

            // ランナー
            runner1st: false,
            runner2nd: false,
            runner3rd: false,

            // 打者・投手・球数
            batterName: '',
            batterNumber: '',
            pitcherName: '',
            pitcherNumber: '',
            pitchCount: 0,

            // カメラキャプチャ（球速・球数画像）
            speedImage: '',
            pitchImage: ''
        },
        chromakey: 'green' // 'green', 'blue', 'magenta', 'transparent'
    };

    // ハードコードされたデモ選手データ (CORS対策)
    const demoHomePlayers = [
        { number: '1', position: '投', name: '米倉 羽希', grade: '3年', comment: 'エースピッチャー。最速145km/hの直球が武器。', avg: '0.150', hr: '0', rbi: '1', era: '2.45', pitches: '85' },
        { number: '2', position: '捕', name: '佐藤 大雅', grade: '3年', comment: '強肩強打の頼れるキャプテン。', avg: '0.320', hr: '4', rbi: '22', era: '0.00', pitches: '0' },
        { number: '3', position: '一', name: '鈴木 健太', grade: '2年', comment: '長打力が魅力のファースト。', avg: '0.285', hr: '6', rbi: '18', era: '0.00', pitches: '0' },
        { number: '4', position: '二', name: '田中 陸', grade: '2年', comment: '俊足巧打のセカンド。守備範囲が広い。', avg: '0.290', hr: '1', rbi: '10', era: '0.00', pitches: '0' },
        { number: '5', position: '三', name: '渡辺 翔', grade: '3年', comment: '守備の要。サードのホットコーナーを守る。', avg: '0.260', hr: '2', rbi: '12', era: '0.00', pitches: '0' },
        { number: '6', position: '遊', name: '高橋 翼', grade: '1年', comment: '期待のルーキー。俊敏な動きが持ち味。', avg: '0.275', hr: '0', rbi: '8', era: '0.00', pitches: '0' },
        { number: '7', position: '左', name: '小林 拓海', grade: '3年', comment: 'ミート力抜群のレフト。', avg: '0.305', hr: '1', rbi: '15', era: '0.00', pitches: '0' },
        { number: '8', position: '中', name: '伊藤 駿', grade: '3年', comment: '俊足を生かした広い守備範囲を誇るセンター。', avg: '0.280', hr: '3', rbi: '11', era: '0.00', pitches: '0' },
        { number: '9', position: '右', name: '中村 太陽', grade: '2年', comment: '強肩を生かしたライトからのレーザービーム。', avg: '0.250', hr: '2', rbi: '9', era: '0.00', pitches: '0' },
        { number: '10', position: '投', name: '山本 拓也', grade: '2年', comment: '変化球のキレが良い技巧派サウスポー。', avg: '0.000', hr: '0', rbi: '0', era: '3.15', pitches: '45' }
    ];

    const demoAwayPlayers = [
        { number: '11', position: '投', name: '山田 哲也', grade: '3年', comment: '安定感抜群の大黒柱。スライダーが武器。', avg: '0.120', hr: '0', rbi: '0', era: '1.85', pitches: '92' },
        { number: '12', position: '捕', name: '木村 悠人', grade: '2年', comment: '的なリードで投手を引っ張る女房役。', avg: '0.265', hr: '1', rbi: '8', era: '0.00', pitches: '0' },
        { number: '13', position: '一', name: '斎藤 翔太', grade: '3年', comment: '長打力が自慢の主砲。', avg: '0.340', hr: '8', rbi: '28', era: '0.00', pitches: '0' },
        { number: '14', position: '二', name: '清水 拓也', grade: '3年', comment: '堅実な守備と小技が得意なセカンド。', avg: '0.270', hr: '0', rbi: '7', era: '0.00', pitches: '0' },
        { number: '15', position: '三', name: '井上 大輝', grade: '2年', comment: 'シュアなバッティングが持ち味。', avg: '0.280', hr: '2', rbi: '11', era: '0.00', pitches: '0' },
        { number: '16', position: '遊', name: '林 拓海', grade: '2年', comment: '抜群の身体能力を誇るショート。', avg: '0.295', hr: '3', rbi: '14', era: '0.00', pitches: '0' },
        { number: '17', position: '左', name: '山崎 太陽', grade: '3年', comment: '俊足でチャンスメイクするリードオフマン。', avg: '0.315', hr: '2', rbi: '13', era: '0.00', pitches: '0' },
        { number: '18', position: '中', name: '森 翔平', grade: '3年', comment: '走攻守三拍子揃ったセンター。', avg: '0.300', hr: '5', rbi: '20', era: '0.00', pitches: '0' },
        { number: '19', position: '右', name: '吉田 陸', grade: '1年', comment: 'パンチ力のあるバッティングが武器のライト。', avg: '0.255', hr: '1', rbi: '6', era: '0.00', pitches: '0' },
        { number: '20', position: '投', name: '山口 俊', grade: '2年', comment: '力強い速球で押すパワーピッチャー。', avg: '0.000', hr: '0', rbi: '0', era: '4.20', pitches: '30' }
    ];

    // 選手データ
    let players = {
        home: [],
        away: []
    };
    let currentTab = 'home'; // 'home' or 'away'

    // カメラストリーム管理
    let cameraStream = null;
    let captureInterval = null;

    // BroadcastChannel
    // 【将来拡張ToDo】複数PC間での共同作業・リアルタイム同期に対応する場合：
    // 現在のBroadcastChannelによる同一端末内同期から、以下の方法へ拡張可能です。
    // 1. Firebase Realtime Databaseを利用したクラウド同期（ネット環境下でスプレッドシートのように完全同期）
    // 2. Node.js + WebSocketによるローカルLAN同期（PC同士を直接LAN接続するか、ポータブルWi-Fiルーター等に接続して完全オフラインで同期）
    channel = new BroadcastChannel('baseball_overlay_channel');
    const openedWindows = [];

    // DOM要素の取得
    const inputHomeName = document.getElementById('input-home-name');
    const inputHomeSub = document.getElementById('input-home-sub');
    const inputHomeColor = document.getElementById('input-home-color');
    const inputHomeLogoFile = document.getElementById('input-home-logo-file');
    const inputHomeLogoUrl = document.getElementById('input-home-logo-url');
    
    const inputAwayName = document.getElementById('input-away-name');
    const inputAwaySub = document.getElementById('input-away-sub');
    const inputAwayColor = document.getElementById('input-away-color');
    const inputAwayLogoFile = document.getElementById('input-away-logo-file');
    const inputAwayLogoUrl = document.getElementById('input-away-logo-url');
    
    const inputTournament = document.getElementById('input-tournament');

    const labelInning = document.getElementById('label-inning');
    const labelScores = document.getElementById('label-scores');
    const selectInningHalf = document.getElementById('select-inning-half');
    
    const btnPrevInning = document.getElementById('btn-prev-inning');
    const btnNextInning = document.getElementById('btn-next-inning');
    const btnChangeHalf = document.getElementById('btn-change-half');

    // 表示モードボタン（プルダウンの代わりにカード選択）
    const displayModeBtns = document.querySelectorAll('.display-mode-btn');
    const chromaButtons = document.querySelectorAll('.btn-chroma');

    // BSO関連
    const btnAddBall = document.getElementById('btn-add-ball');
    const btnAddStrike = document.getElementById('btn-add-strike');
    const btnAddOut = document.getElementById('btn-add-out');
    const btnClearBs = document.getElementById('btn-clear-bs');
    const btnClearRunner = document.getElementById('btn-clear-runner');
    const btnChangeSides = document.getElementById('btn-change-sides');
    const btnResetBsoAll = document.getElementById('btn-reset-bso-all');

    // ランナーダイヤ
    const base1stBtn = document.getElementById('base-1st-btn');
    const base2ndBtn = document.getElementById('base-2nd-btn');
    const base3rdBtn = document.getElementById('base-3rd-btn');

    // 打者・投手
    const inputBatterName = document.getElementById('input-batter-name');
    const inputBatterNumber = document.getElementById('input-batter-number');
    const inputPitcherName = document.getElementById('input-pitcher-name');
    const inputPitcherNumber = document.getElementById('input-pitcher-number');
    const labelPitchCount = document.getElementById('label-pitch-count');
    const btnPitchMinus = document.getElementById('btn-pitch-minus');
    const btnPitchPlus = document.getElementById('btn-pitch-plus');
    const btnPitchReset = document.getElementById('btn-pitch-reset');

    // カメラキャプチャ
    const selectCameraDevice = document.getElementById('select-camera-device');
    const btnToggleCamera = document.getElementById('btn-toggle-camera');
    const cameraVideo = document.getElementById('camera-video');
    const cameraDebugCanvas = document.getElementById('camera-debug-canvas');

    const cropSpeedX = document.getElementById('crop-speed-x');
    const cropSpeedY = document.getElementById('crop-speed-y');
    const cropSpeedW = document.getElementById('crop-speed-w');
    const cropSpeedH = document.getElementById('crop-speed-h');
    const cropPitchX = document.getElementById('crop-pitch-x');
    const cropPitchY = document.getElementById('crop-pitch-y');
    const cropPitchW = document.getElementById('crop-pitch-w');
    const cropPitchH = document.getElementById('crop-pitch-h');

    const cropVisualSpeed = document.getElementById('crop-visual-speed');
    const cropVisualPitch = document.getElementById('crop-visual-pitch');

    // 選手・テロップ
    const inputSheetUrl = document.getElementById('input-sheet-url');
    const btnLoadSheet = document.getElementById('btn-load-sheet');
    const inputSheetFileHome = document.getElementById('input-sheet-file-home');
    const btnLoadSheetFileHome = document.getElementById('btn-load-sheet-file-home');
    const inputSheetFileAway = document.getElementById('input-sheet-file-away');
    const btnLoadSheetFileAway = document.getElementById('btn-load-sheet-file-away');
    const btnLoadDemoHome = document.getElementById('btn-load-demo-home');
    const btnLoadDemoAway = document.getElementById('btn-load-demo-away');
    const selectTelopDuration = document.getElementById('select-telop-duration');
    const tabHome = document.getElementById('tab-home');
    const tabAway = document.getElementById('tab-away');
    const playerTableBody = document.querySelector('#player-table-body tbody');

    // 画像テロップ
    const inputCustomImageUrl = document.getElementById('input-custom-image-url');
    const btnShowImageTelop = document.getElementById('btn-show-image-telop');
    const inputCustomImageFile = document.getElementById('input-custom-image-file');
    const btnShowImageFileTelop = document.getElementById('btn-show-image-file-telop');
    const btnHideImageTelop = document.getElementById('btn-hide-image-telop');
    const selectImageDuration = document.getElementById('select-image-duration');

    // 接続プレビュー
    const connectionStatus = document.getElementById('connection-status');
    const iframe = document.getElementById('overlay-preview');
    let pongReceived = false;

    // サーバー同期管理用変数
    let isServerConnected = false;
    let eventSource = null;

    // メッセージ送信関数
    function broadcastMessage(type, data) {
        const payload = { type, data };
        try {
            channel.postMessage(payload);
        } catch (e) {
            console.warn('BroadcastChannel が制限されています:', e);
        }
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(payload, '*');
        }
        for (let i = openedWindows.length - 1; i >= 0; i--) {
            const win = openedWindows[i];
            if (win && !win.closed) {
                win.postMessage(payload, '*');
            } else {
                openedWindows.splice(i, 1);
            }
        }
        // ローカルサーバー起動時はイベントをサーバー経由で中継
        if (isServerConnected && type !== 'PING' && type !== 'PONG') {
            fetch('/api/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(err => console.error("Server event send error:", err));
        }
    }

    // サーバーからの同期受信設定
    function setupServerSync() {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            eventSource = new EventSource('/events');

            eventSource.onopen = () => {
                isServerConnected = true;
                const ind = connectionStatus.querySelector('.status-indicator');
                if (ind) {
                    ind.className = 'status-indicator online';
                    ind.style.backgroundColor = '#10b981';
                    ind.style.boxShadow = '0 0 8px #10b981';
                }
                const label = connectionStatus.querySelector('span:not(.status-indicator)');
                if (label) label.textContent = '同期中 (ローカルサーバー)';
            };

            eventSource.addEventListener('UPDATE_STATE', (event) => {
                try {
                    const newState = JSON.parse(event.data);
                    if (JSON.stringify(state) !== JSON.stringify(newState)) {
                        Object.assign(state, newState);
                        if (state.players) {
                            players = state.players;
                        }
                        updateAllUI();
                    }
                } catch (e) {
                    console.error("SSE parse error:", e);
                }
            });

            eventSource.onerror = () => {
                isServerConnected = false;
                const ind = connectionStatus.querySelector('.status-indicator');
                if (ind) {
                    ind.className = 'status-indicator offline';
                    ind.style.backgroundColor = '#64748b';
                    ind.style.boxShadow = 'none';
                }
                const label = connectionStatus.querySelector('span:not(.status-indicator)');
                if (label) label.textContent = '未接続 (BroadcastChannel同期)';
            };
        }
    }

    // 状態が更新された際にUI全体を同期する関数
    function updateAllUI() {
        const sb = state.scoreboard;
        document.getElementById('input-home-name').value = sb.homeName;
        document.getElementById('input-home-sub-name').value = sb.homeSubName;
        document.getElementById('input-home-color').value = sb.homeColor;
        document.getElementById('input-away-name').value = sb.awayName;
        document.getElementById('input-away-sub-name').value = sb.awaySubName;
        document.getElementById('input-away-color').value = sb.awayColor;
        document.getElementById('input-tournament-name').value = sb.tournamentName;

        // 表示モードボタンのアクティブハイライト更新
        displayModeBtns.forEach(btn => {
            if (btn.getAttribute('data-mode') === sb.displayMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // BSO・打者・投手・球数など
        document.getElementById('input-batter-name').value = sb.batterName;
        document.getElementById('input-batter-number').value = sb.batterNumber;
        document.getElementById('input-pitcher-name').value = sb.pitcherName;
        document.getElementById('input-pitcher-number').value = sb.pitcherNumber;
        document.getElementById('input-pitch-count').value = sb.pitchCount;

        // クロマキー背景
        document.querySelectorAll('.chromakey-selector button').forEach(btn => {
            btn.classList.remove('active');
            if (btn.classList.contains(`chroma-${state.chromakey}`)) {
                btn.classList.add('active');
            }
        });

        // イニングスコア入力値の同期
        for (let i = 0; i < 12; i++) {
            const hInput = document.getElementById(`ransko-h-${i+1}`);
            const aInput = document.getElementById(`ransko-a-${i+1}`);
            if (hInput) hInput.value = sb.homeInningScores[i];
            if (aInput) aInput.value = sb.awayInningScores[i];
        }

        updateScoreDisplay();
        updateBsoLamps();
        updateRunnerUI();
        renderPlayerTable();
    }

    // PING 送信による同期確認 (スタンドアロン時のみ)
    setInterval(() => {
        if (isServerConnected) return; // サーバー接続時はPINGチェック不要
        pongReceived = false;
        broadcastMessage('PING');
        setTimeout(() => {
            if (isServerConnected) return;
            if (pongReceived) {
                connectionStatus.querySelector('.status-indicator').className = 'status-indicator online';
            } else {
                connectionStatus.querySelector('.status-indicator').className = 'status-indicator offline';
            }
        }, 300);
    }, 2000);

    channel.onmessage = (event) => {
        if (event.data.type === 'PONG') {
            pongReceived = true;
        }
    };

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PONG') {
            pongReceived = true;
        }
    });

    function sendState() {
        state.players = players;
        broadcastMessage('UPDATE_STATE', state);
        
        // サーバーへの状態送信
        if (isServerConnected) {
            fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            }).catch(err => console.error("Server sync state error:", err));
        }
    }

    iframe.addEventListener('load', () => {
        setTimeout(sendState, 500);
    });

    // プレビュー iframe の縮小スケーリング
    function scalePreview() {
        const container = document.querySelector('.preview-container');
        if (!container) return;
        const containerWidth = container.clientWidth;
        const scale = containerWidth / 1920;
        iframe.style.transform = `scale(${scale})`;
        iframe.style.height = `${1080 * scale}px`;
        container.style.height = `${1080 * scale}px`;
    }
    window.addEventListener('resize', scalePreview);
    setTimeout(scalePreview, 500);

    // ==========================================================================
    // 得点＆イニングロジック
    // ==========================================================================
    
    function updateScoreDisplay() {
        labelInning.innerText = `${state.scoreboard.inningNum}${state.scoreboard.inningHalf === 'top' ? '表' : '裏'}`;
        labelScores.innerText = `H ${state.scoreboard.homeScore} - ${state.scoreboard.awayScore} A`;
        
        // プルダウンの同期
        if (state.scoreboard.inningNum <= 12) {
            selectInningHalf.value = `${state.scoreboard.inningNum}-${state.scoreboard.inningHalf}`;
        } else {
            selectInningHalf.value = 'end';
        }
    }

    function calculateTotalScores() {
        let homeTotal = 0;
        let awayTotal = 0;
        
        // 1-12回までの合計を算出
        for (let i = 0; i < 12; i++) {
            const hVal = parseInt(state.scoreboard.homeInningScores[i]);
            const aVal = parseInt(state.scoreboard.awayInningScores[i]);
            if (!isNaN(hVal)) homeTotal += hVal;
            if (!isNaN(aVal)) awayTotal += aVal;
        }
        
        state.scoreboard.homeScore = homeTotal;
        state.scoreboard.awayScore = awayTotal;
        
        document.getElementById('input-home-r').innerText = homeTotal;
        document.getElementById('input-away-r').innerText = awayTotal;
        
        updateScoreDisplay();
        sendState();
    }

    // セル変更時のバインド
    document.querySelectorAll('.score-cell-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const inning = parseInt(e.target.dataset.inning);
            const team = e.target.dataset.team;
            const val = e.target.value;
            
            if (team === 'home') {
                state.scoreboard.homeInningScores[inning - 1] = val;
            } else {
                state.scoreboard.awayInningScores[inning - 1] = val;
            }
            calculateTotalScores();
        });
    });

    // H・E セレクトボックスのオプション生成
    const awayHSelect = document.getElementById('input-away-h');
    const homeHSelect = document.getElementById('input-home-h');
    const awayESelect = document.getElementById('input-away-e');
    const homeESelect = document.getElementById('input-home-e');

    function populateSelectOptions(selectEl, max) {
        if (!selectEl) return;
        selectEl.innerHTML = '';
        for (let i = 0; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.innerText = i;
            selectEl.appendChild(opt);
        }
    }
    populateSelectOptions(awayHSelect, 30);
    populateSelectOptions(homeHSelect, 30);
    populateSelectOptions(awayESelect, 15);
    populateSelectOptions(homeESelect, 15);

    // H・E 値変更時のイベントリスナー
    [awayHSelect, homeHSelect, awayESelect, homeESelect].forEach(select => {
        if (select) {
            select.addEventListener('change', (e) => {
                const id = e.target.id;
                const val = parseInt(e.target.value) || 0;
                if (id === 'input-home-h') state.scoreboard.homeHits = val;
                else if (id === 'input-away-h') state.scoreboard.awayHits = val;
                else if (id === 'input-home-e') state.scoreboard.homeErrors = val;
                else if (id === 'input-away-e') state.scoreboard.awayErrors = val;
                sendState();
            });
        }
    });

    // H・E 表示トグルチェックボックス
    const checkShowHE = document.getElementById('check-show-he');
    if (checkShowHE) {
        checkShowHE.addEventListener('change', (e) => {
            state.scoreboard.showHE = e.target.checked;
            sendState();
        });
    }

    // イニング操作ボタン
    btnPrevInning.addEventListener('click', () => {
        if (state.scoreboard.inningHalf === 'bot') {
            state.scoreboard.inningHalf = 'top';
        } else if (state.scoreboard.inningNum > 1) {
            state.scoreboard.inningNum--;
            state.scoreboard.inningHalf = 'bot';
        }
        updateScoreDisplay();
        sendState();
    });

    btnNextInning.addEventListener('click', () => {
        if (state.scoreboard.inningHalf === 'top') {
            state.scoreboard.inningHalf = 'bot';
        } else if (state.scoreboard.inningNum < 12) {
            state.scoreboard.inningNum++;
            state.scoreboard.inningHalf = 'top';
        } else {
            state.scoreboard.inningHalf = 'end';
        }
        updateScoreDisplay();
        sendState();
    });

    btnChangeHalf.addEventListener('click', () => {
        state.scoreboard.inningHalf = state.scoreboard.inningHalf === 'top' ? 'bot' : 'top';
        updateScoreDisplay();
        sendState();
    });

    selectInningHalf.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'end') {
            state.scoreboard.inningNum = 13;
            state.scoreboard.inningHalf = 'end';
        } else {
            const parts = val.split('-');
            state.scoreboard.inningNum = parseInt(parts[0]);
            state.scoreboard.inningHalf = parts[1];
        }
        updateScoreDisplay();
        sendState();
    });

    // ==========================================================================
    // BSO ＆ ランナー制御
    // ==========================================================================

    function updateBsoLamps() {
        // B
        for (let i = 1; i <= 3; i++) {
            const lamp = document.querySelector(`#bso-balls-input [data-index="${i}"]`);
            if (lamp) {
                if (i <= state.scoreboard.balls) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }
        }
        // S
        for (let i = 1; i <= 2; i++) {
            const lamp = document.querySelector(`#bso-strikes-input [data-index="${i}"]`);
            if (lamp) {
                if (i <= state.scoreboard.strikes) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }
        }
        // O
        for (let i = 1; i <= 2; i++) {
            const lamp = document.querySelector(`#bso-outs-input [data-index="${i}"]`);
            if (lamp) {
                if (i <= state.scoreboard.outs) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }
        }
    }

    window.adjustCount = function(type, amount) {
        if (type === 'balls') {
            state.scoreboard.balls += amount;
            if (state.scoreboard.balls > 3) {
                state.scoreboard.balls = 0; // 四球でリセット
            }
        } else if (type === 'strikes') {
            state.scoreboard.strikes += amount;
            if (state.scoreboard.strikes > 2) {
                state.scoreboard.strikes = 0;
                adjustCount('outs', 1); // 三振で1アウト追加
            }
        } else if (type === 'outs') {
            state.scoreboard.outs += amount;
            if (state.scoreboard.outs > 2) {
                state.scoreboard.outs = 0;
                triggerChangeSides(); // 3アウトでチェンジ
                return;
            }
        }
        updateBsoLamps();
        sendState();
    };

    btnAddBall.addEventListener('click', () => adjustCount('balls', 1));
    btnAddStrike.addEventListener('click', () => adjustCount('strikes', 1));
    btnAddOut.addEventListener('click', () => adjustCount('outs', 1));

    // マニュアルクリックでの点灯
    document.querySelectorAll('.bso-dot-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const parent = e.target.parentElement;
            const index = parseInt(e.target.dataset.index);
            if (parent.id === 'bso-balls-input') {
                state.scoreboard.balls = state.scoreboard.balls === index ? index - 1 : index;
            } else if (parent.id === 'bso-strikes-input') {
                state.scoreboard.strikes = state.scoreboard.strikes === index ? index - 1 : index;
            } else if (parent.id === 'bso-outs-input') {
                state.scoreboard.outs = state.scoreboard.outs === index ? index - 1 : index;
            }
            updateBsoLamps();
            sendState();
        });
    });

    // ランナーダイヤ操作
    function updateRunnerUI() {
        if (state.scoreboard.runner1st) base1stBtn.classList.add('active');
        else base1stBtn.classList.remove('active');
        
        if (state.scoreboard.runner2nd) base2ndBtn.classList.add('active');
        else base2ndBtn.classList.remove('active');
        
        if (state.scoreboard.runner3rd) base3rdBtn.classList.add('active');
        else base3rdBtn.classList.remove('active');
    }

    base1stBtn.addEventListener('click', () => {
        state.scoreboard.runner1st = !state.scoreboard.runner1st;
        updateRunnerUI();
        sendState();
    });
    base2ndBtn.addEventListener('click', () => {
        state.scoreboard.runner2nd = !state.scoreboard.runner2nd;
        updateRunnerUI();
        sendState();
    });
    base3rdBtn.addEventListener('click', () => {
        state.scoreboard.runner3rd = !state.scoreboard.runner3rd;
        updateRunnerUI();
        sendState();
    });

    btnClearBs.addEventListener('click', () => {
        state.scoreboard.balls = 0;
        state.scoreboard.strikes = 0;
        updateBsoLamps();
        sendState();
    });

    btnClearRunner.addEventListener('click', () => {
        state.scoreboard.runner1st = false;
        state.scoreboard.runner2nd = false;
        state.scoreboard.runner3rd = false;
        updateRunnerUI();
        sendState();
    });

    function triggerChangeSides() {
        // チェンジ
        state.scoreboard.balls = 0;
        state.scoreboard.strikes = 0;
        state.scoreboard.outs = 0;
        state.scoreboard.runner1st = false;
        state.scoreboard.runner2nd = false;
        state.scoreboard.runner3rd = false;
        
        // イニング半切り替え
        if (state.scoreboard.inningHalf === 'top') {
            state.scoreboard.inningHalf = 'bot';
        } else if (state.scoreboard.inningNum < 12) {
            state.scoreboard.inningNum++;
            state.scoreboard.inningHalf = 'top';
        } else {
            state.scoreboard.inningHalf = 'end';
        }
        
        updateBsoLamps();
        updateRunnerUI();
        updateScoreDisplay();
        sendState();
    }

    btnChangeSides.addEventListener('click', triggerChangeSides);

    btnResetBsoAll.addEventListener('click', () => {
        state.scoreboard.balls = 0;
        state.scoreboard.strikes = 0;
        state.scoreboard.outs = 0;
        updateBsoLamps();
        sendState();
    });

    // ==========================================================================
    // 打者・投手・球数制御
    // ==========================================================================
    
    inputBatterName.addEventListener('input', (e) => {
        state.scoreboard.batterName = e.target.value;
        sendState();
    });
    inputBatterNumber.addEventListener('input', (e) => {
        state.scoreboard.batterNumber = e.target.value;
        sendState();
    });
    inputPitcherName.addEventListener('input', (e) => {
        state.scoreboard.pitcherName = e.target.value;
        sendState();
    });
    inputPitcherNumber.addEventListener('input', (e) => {
        const pNum = e.target.value;
        state.scoreboard.pitcherNumber = pNum;
        
        // 当日の球数をロード
        const allPlayers = [...players.home, ...players.away];
        const pitcher = allPlayers.find(p => p.number === pNum);
        if (pitcher) {
            if (pitcher.todayPitches === undefined) {
                pitcher.todayPitches = 0;
            }
            state.scoreboard.pitchCount = pitcher.todayPitches;
            labelPitchCount.innerText = pitcher.todayPitches;
        }
        sendState();
    });

    window.adjustPitches = function(amount) {
        if (amount === 0) {
            state.scoreboard.pitchCount = 0;
        } else {
            state.scoreboard.pitchCount += amount;
            if (state.scoreboard.pitchCount < 0) state.scoreboard.pitchCount = 0;
        }
        labelPitchCount.innerText = state.scoreboard.pitchCount;
        
        // 現在設定されている投手の todayPitches を更新
        const currentPitcherNum = state.scoreboard.pitcherNumber;
        if (currentPitcherNum) {
            const allPlayers = [...players.home, ...players.away];
            const pitcher = allPlayers.find(p => p.number === currentPitcherNum);
            if (pitcher) {
                pitcher.todayPitches = state.scoreboard.pitchCount;
                renderPlayerTable();
            }
        }
        sendState();
    };

    btnPitchMinus.addEventListener('click', () => adjustPitches(-1));
    btnPitchPlus.addEventListener('click', () => adjustPitches(1));
    btnPitchReset.addEventListener('click', () => adjustPitches(0));

    // ==========================================================================
    // 🎥 カメラキャプチャ ＆ クロップ同期ロジック
    // ==========================================================================
    
    // カメラデバイスの列挙
    async function initCameraDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            selectCameraDevice.innerHTML = '<option value="">デバイスを選択してください</option>';
            devices.forEach(device => {
                if (device.kind === 'videoinput') {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.text = device.label || `カメラ (${selectCameraDevice.length})`;
                    selectCameraDevice.appendChild(option);
                }
            });
        } catch (e) {
            console.error('カメラデバイスの取得に失敗:', e);
        }
    }

    initCameraDevices();

    // 視覚的クロップ枠の同期更新
    function updateCropVisuals() {
        const vw = cameraVideo.clientWidth;
        const vh = cameraVideo.clientHeight;
        if (!vw || !vh) return;

        // Speed クロップ
        const sx = cropSpeedX.value;
        const sy = cropSpeedY.value;
        const sw = cropSpeedW.value;
        const sh = cropSpeedH.value;

        cropVisualSpeed.style.left = `${(sx / 100) * vw}px`;
        cropVisualSpeed.style.top = `${(sy / 100) * vh}px`;
        cropVisualSpeed.style.width = `${(sw / 100) * vw}px`;
        cropVisualSpeed.style.height = `${(sh / 100) * vh}px`;

        // Pitch クロップ
        const px = cropPitchX.value;
        const py = cropPitchY.value;
        const pw = cropPitchW.value;
        const ph = cropPitchH.value;

        cropVisualPitch.style.left = `${(px / 100) * vw}px`;
        cropVisualPitch.style.top = `${(py / 100) * vh}px`;
        cropVisualPitch.style.width = `${(pw / 100) * vw}px`;
        cropVisualPitch.style.height = `${(ph / 100) * vh}px`;
    }

    [cropSpeedX, cropSpeedY, cropSpeedW, cropSpeedH, cropPitchX, cropPitchY, cropPitchW, cropPitchH].forEach(slider => {
        slider.addEventListener('input', updateCropVisuals);
    });

    // 映像切り抜き・転送
    function processCrop() {
        if (!cameraStream || cameraVideo.paused) return;

        const cw = cameraVideo.videoWidth;
        const ch = cameraVideo.videoHeight;
        if (!cw || !ch) return;

        const ctx = cameraDebugCanvas.getContext('2d');

        // 1. 球速のクロップ
        const sx = (cropSpeedX.value / 100) * cw;
        const sy = (cropSpeedY.value / 100) * ch;
        const sw = (cropSpeedW.value / 100) * cw;
        const sh = (cropSpeedH.value / 100) * ch;

        cameraDebugCanvas.width = 120; // 転送用に縮小
        cameraDebugCanvas.height = Math.max(20, (sh / sw) * 120);
        ctx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, cameraDebugCanvas.width, cameraDebugCanvas.height);
        const speedBase64 = cameraDebugCanvas.toDataURL('image/jpeg', 0.6);

        // 2. 球数のクロップ
        const px = (cropPitchX.value / 100) * cw;
        const py = (cropPitchY.value / 100) * ch;
        const pw = (cropPitchW.value / 100) * cw;
        const ph = (cropPitchH.value / 100) * ch;

        cameraDebugCanvas.width = 120;
        cameraDebugCanvas.height = Math.max(20, (ph / pw) * 120);
        ctx.drawImage(cameraVideo, px, py, pw, ph, 0, 0, cameraDebugCanvas.width, cameraDebugCanvas.height);
        const pitchBase64 = cameraDebugCanvas.toDataURL('image/jpeg', 0.6);

        // state のみ更新し、BroadcastChannel 送信
        state.scoreboard.speedImage = speedBase64;
        state.scoreboard.pitchImage = pitchBase64;
        
        broadcastMessage('UPDATE_CROP_IMAGES', {
            speedImage: speedBase64,
            pitchImage: pitchBase64
        });
    }

    btnToggleCamera.addEventListener('click', async () => {
        if (cameraStream) {
            // カメラ停止
            clearInterval(captureInterval);
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
            cameraVideo.srcObject = null;
            btnToggleCamera.innerText = 'カメラ開始';
            btnToggleCamera.className = 'btn btn-primary btn-sm';
            
            // 配信画面側をプレースホルダーに戻す
            state.scoreboard.speedImage = '';
            state.scoreboard.pitchImage = '';
            sendState();
        } else {
            // カメラ開始
            const deviceId = selectCameraDevice.value;
            const constraints = {
                video: deviceId ? { deviceId: { exact: deviceId } } : true,
                audio: false
            };
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
                cameraVideo.srcObject = cameraStream;
                btnToggleCamera.innerText = 'カメラ停止';
                btnToggleCamera.className = 'btn btn-danger btn-sm';
                
                cameraVideo.onloadedmetadata = () => {
                    setTimeout(updateCropVisuals, 500);
                    // 100ms (10 FPS) 間隔でクロップ転送
                    captureInterval = setInterval(processCrop, 100);
                };
            } catch (e) {
                alert('カメラの起動に失敗しました: ' + e.message);
            }
        }
    });

    // ==========================================================================
    // チーム基本情報 & クロマキー設定
    // ==========================================================================
    
    function updateTeamInfo() {
        state.scoreboard.homeName = inputHomeName.value;
        state.scoreboard.homeSubName = inputHomeSub.value;
        state.scoreboard.homeColor = inputHomeColor.value;
        
        state.scoreboard.awayName = inputAwayName.value;
        state.scoreboard.awaySubName = inputAwaySub.value;
        state.scoreboard.awayColor = inputAwayColor.value;
        
        state.scoreboard.tournamentName = inputTournament.value;
        sendState();
    }

    [inputHomeName, inputHomeSub, inputHomeColor, inputAwayName, inputAwaySub, inputAwayColor, inputTournament].forEach(input => {
        input.addEventListener('input', updateTeamInfo);
    });

    // 画像ファイルを Canvas で 120px に自動縮小し Base64 化して転送
    function processImageFile(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const max = 120;
                let w = img.width;
                let h = img.height;
                if (w > max || h > max) {
                    if (w > h) {
                        h = (h / w) * max;
                        w = max;
                    } else {
                        w = (w / h) * max;
                        h = max;
                    }
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                callback(canvas.toDataURL('image/png'));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    inputHomeLogoFile.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            processImageFile(e.target.files[0], (base64) => {
                state.scoreboard.homeLogo = base64;
                sendState();
            });
        }
    });

    inputAwayLogoFile.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            processImageFile(e.target.files[0], (base64) => {
                state.scoreboard.awayLogo = base64;
                sendState();
            });
        }
    });

    inputHomeLogoUrl.addEventListener('input', (e) => {
        state.scoreboard.homeLogo = e.target.value;
        sendState();
    });

    inputAwayLogoUrl.addEventListener('input', (e) => {
        state.scoreboard.awayLogo = e.target.value;
        sendState();
    });

    displayModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode');
            state.scoreboard.displayMode = mode;
            
            // ボタンのアクティブクラス更新
            displayModeBtns.forEach(b => {
                if (b === btn) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });

            sendState();
        });
    });

    chromaButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            chromaButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.chromakey = e.target.dataset.color;
            sendState();
        });
    });

    // 別窓で開く
    document.getElementById('btn-open-overlay').addEventListener('click', () => {
        const win = window.open('baseball_overlay.html?v=16', 'baseball_overlay', 'width=1920,height=1080');
        if (win) {
            openedWindows.push(win);
        }
    });

    // ==========================================================================
    // 選手データ読み込み & テロップ送信
    // ==========================================================================
    
    function parseCSV(text) {
        const lines = text.split(/\r?\n/);
        if (lines.length === 0) return [];
        
        const headers = lines[0].split(',');
        const result = [];
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i]) continue;
            const cells = lines[i].split(',');
            if (cells.length < 5) continue;
            
            result.push({
                number: cells[0].trim(),
                position: cells[1].trim(),
                name: cells[2].trim(),
                grade: cells[3].trim(),
                comment: cells[4].trim(),
                avg: cells[5] ? cells[5].trim() : '',
                hr: cells[6] ? cells[6].trim() : '',
                rbi: cells[7] ? cells[7].trim() : '',
                era: cells[8] ? cells[8].trim() : '',
                pitches: cells[9] ? cells[9].trim() : ''
            });
        }
        return result;
    }

    function initializeLineup(team) {
        if (!players[team]) return;
        players[team].forEach((p, index) => {
            if (p.todayPitches === undefined) {
                p.todayPitches = 0;
            }
            if (p.lineup === undefined) {
                if (index < 9) {
                    p.lineup = 'starting';
                    p.order = index + 1;
                } else {
                    p.lineup = 'bench';
                    p.order = 'bench';
                }
            }
        });
    }

    function renderPlayerTable() {
        const team = currentTab;
        initializeLineup(team);
        
        const list = players[team];
        playerTableBody.innerHTML = '';
        
        if (list.length === 0) {
            playerTableBody.innerHTML = '<tr><td colspan="6" class="no-data">選手データを読み込んでください。</td></tr>';
            return;
        }

        // スタメンと控えを分別し、スタメンは打順順にソートして並び替える
        const startingPlayers = list.filter(p => p.lineup === 'starting').sort((a, b) => parseInt(a.order) - parseInt(b.order));
        const benchPlayers = list.filter(p => p.lineup === 'bench').sort((a, b) => parseInt(a.number) - parseInt(b.number));
        const sortedList = [...startingPlayers, ...benchPlayers];

        sortedList.forEach(p => {
            const tr = document.createElement('tr');
            
            // 行のクラス設定
            if (p.lineup === 'starting') {
                tr.className = 'row-starting';
            } else {
                tr.className = 'row-bench';
            }
            
            // 成績表示の決定（投ならERA、他なら打率）
            let statsText = '';
            if (p.position.indexOf('投') !== -1) {
                statsText = `防: ${p.era || '0.00'} / 球: ${p.todayPitches || 0}`;
            } else {
                statsText = `率: ${p.avg || '.000'} /本: ${p.hr || '0'}`;
            }

            // ポジションドロップダウンの作成
            const positions = ['投', '捕', '一', '二', '三', '遊', '左', '中', '右', '指', '代打', '代走', '控え'];
            let posOptions = '';
            positions.forEach(pos => {
                const selected = p.position === pos ? 'selected' : '';
                posOptions += `<option value="${pos}" ${selected}>${pos}</option>`;
            });

            // 打順ドロップダウンの作成
            let orderOptions = '';
            for (let i = 1; i <= 9; i++) {
                const selected = (p.lineup === 'starting' && parseInt(p.order) === i) ? 'selected' : '';
                orderOptions += `<option value="${i}" ${selected}>${i}番</option>`;
            }
            const benchSelected = p.lineup === 'bench' ? 'selected' : '';
            orderOptions += `<option value="bench" ${benchSelected}>控え</option>`;

            tr.innerHTML = `
                <td>
                    <select class="form-input select-lineup" onchange="changePlayerOrder('${team}', '${p.number}', this.value)">
                        ${orderOptions}
                    </select>
                </td>
                <td><strong>${p.number}</strong></td>
                <td>
                    <select class="form-input select-position" onchange="changePlayerPosition('${team}', '${p.number}', this.value)">
                        ${posOptions}
                    </select>
                </td>
                <td>
                    <strong>${p.name}</strong>
                    <br><small style="color:#94a3b8;">${p.grade} / ${p.comment}</small>
                </td>
                <td style="color:#eab308; font-family:'Oswald',sans-serif; font-size:14px;">${statsText}</td>
                <td>
                    <div class="quick-action-row">
                        <button class="btn btn-xs btn-secondary" onclick="quickSetBatter('${team}', '${p.number}')" title="打者に設定">打者</button>
                        <button class="btn btn-xs btn-primary" onclick="quickSetPitcher('${team}', '${p.number}')" title="投手に設定">投手</button>
                        <button class="btn btn-xs btn-accent" onclick="showPlayerTelop('${p.number}')">表示</button>
                    </div>
                </td>
            `;
            playerTableBody.appendChild(tr);
        });
        sendState();
    }

    tabHome.addEventListener('click', () => {
        tabHome.classList.add('active');
        tabAway.classList.remove('active');
        currentTab = 'home';
        renderPlayerTable();
    });

    tabAway.addEventListener('click', () => {
        tabAway.classList.add('active');
        tabHome.classList.remove('active');
        currentTab = 'away';
        renderPlayerTable();
    });

    // 選手読み込み処理 (CSV & Excel)
    function handleFileSelect(file, team) {
        const reader = new FileReader();
        const ext = file.name.split('.').pop().toLowerCase();
        
        if (ext === 'csv') {
            reader.onload = (e) => {
                let text = e.target.result;
                let parsed = parseCSV(text);
                
                // 文字化け判定 (UTF-8で読み込んだ際にデコード失敗して  (\ufffd) が含まれる場合は Shift_JIS で読み直す)
                if (parsed.length > 0 && parsed.some(p => p.name.includes('\ufffd') || p.comment.includes('\ufffd'))) {
                    const sjisReader = new FileReader();
                    sjisReader.onload = (evt) => {
                        const decoder = new TextDecoder('shift-jis');
                        const decodedText = decoder.decode(evt.target.result);
                        players[team] = parseCSV(decodedText);
                        initializeLineup(team);
                        renderPlayerTable();
                    };
                    sjisReader.readAsArrayBuffer(file);
                } else {
                    players[team] = parsed;
                    initializeLineup(team);
                    renderPlayerTable();
                }
            };
            reader.readAsText(file);
        } else if (ext === 'xlsx' || ext === 'xls') {
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                const result = [];
                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length < 5) continue;
                    result.push({
                        number: String(row[0] || '').trim(),
                        position: String(row[1] || '').trim(),
                        name: String(row[2] || '').trim(),
                        grade: String(row[3] || '').trim(),
                        comment: String(row[4] || '').trim(),
                        avg: row[5] ? String(row[5]).trim() : '',
                        hr: row[6] ? String(row[6]).trim() : '',
                        rbi: row[7] ? String(row[7]).trim() : '',
                        era: row[8] ? String(row[8]).trim() : '',
                        pitches: row[9] ? String(row[9]).trim() : ''
                    });
                }
                players[team] = result;
                initializeLineup(team);
                renderPlayerTable();
            };
            reader.readAsArrayBuffer(file);
        }
    }

    btnLoadSheetFileHome.addEventListener('click', () => {
        const file = inputSheetFileHome.files[0];
        if (file) handleFileSelect(file, 'home');
    });

    btnLoadSheetFileAway.addEventListener('click', () => {
        const file = inputSheetFileAway.files[0];
        if (file) handleFileSelect(file, 'away');
    });

    // デモ読み込み (ハードコード配列から読み込んでCORS回避)
    btnLoadDemoHome.addEventListener('click', () => {
        players.home = [...demoHomePlayers];
        initializeLineup('home');
        renderPlayerTable();
    });

    btnLoadDemoAway.addEventListener('click', () => {
        players.away = [...demoAwayPlayers];
        initializeLineup('away');
        renderPlayerTable();
    });

    // URL 読み込み
    btnLoadSheet.addEventListener('click', () => {
        const url = inputSheetUrl.value;
        if (!url) return;
        fetch(url)
            .then(res => res.text())
            .then(text => {
                const parsed = parseCSV(text);
                players[currentTab] = parsed;
                initializeLineup(currentTab);
                renderPlayerTable();
            })
            .catch(err => alert('スプレッドシートの取得に失敗しました: ' + err.message));
    });

    // 選手テロップ表示トリガー
    window.showPlayerTelop = function(number) {
        const list = currentTab === 'home' ? players.home : players.away;
        const player = list.find(p => p.number === number);
        if (!player) return;

        // 打席に立っているか、マウンドに立っているか、または守備位置で投手・打者を判別
        let displayAs = 'batter';
        if (state.scoreboard.batterNumber === player.number) {
            displayAs = 'batter';
        } else if (state.scoreboard.pitcherNumber === player.number) {
            displayAs = 'pitcher';
        } else if (player.position.indexOf('投') !== -1) {
            displayAs = 'pitcher';
        }

        const isPitcher = displayAs === 'pitcher';
        const pitchesToSend = isPitcher ? (parseInt(player.todayPitches) || 0) : 0;

        const duration = parseInt(selectTelopDuration.value);
        broadcastMessage('SHOW_PLAYER_TELOP', {
            player: {
                ...player,
                pitches: isPitcher ? pitchesToSend : player.pitches,
                teamName: currentTab === 'home' ? state.scoreboard.homeName : state.scoreboard.awayName,
                teamLogo: currentTab === 'home' ? state.scoreboard.homeLogo : state.scoreboard.awayLogo,
                teamColor: currentTab === 'home' ? state.scoreboard.homeColor : state.scoreboard.awayColor
            },
            displayAs,
            duration
        });
        sendState();
    };

    // ポジション変更時のハンドラ
    window.changePlayerPosition = function(team, number, newPos) {
        const list = players[team];
        const player = list.find(p => p.number === number);
        if (player) {
            player.position = newPos;
            if (newPos === '控え') {
                player.lineup = 'bench';
                player.order = 'bench';
            }
            renderPlayerTable();
        }
    };

    // 打順・スタメン控え変更時のハンドラ
    window.changePlayerOrder = function(team, number, newOrder) {
        const list = players[team];
        const player = list.find(p => p.number === number);
        if (player) {
            if (newOrder === 'bench') {
                player.lineup = 'bench';
                player.order = 'bench';
                player.position = '控え';
            } else {
                player.lineup = 'starting';
                player.order = parseInt(newOrder);
                if (player.position === '控え') {
                    player.position = '指';
                }
            }
            renderPlayerTable();
        }
    };

    // クイック打者交代 (現在打者にセットするのみ、テロップは送信しない)
    window.quickSetBatter = function(team, number) {
        const list = players[team];
        const player = list.find(p => p.number === number);
        if (player) {
            inputBatterName.value = player.name;
            inputBatterNumber.value = player.number;
            state.scoreboard.batterName = player.name;
            state.scoreboard.batterNumber = player.number;
            sendState();
        }
    };

    // クイック投手交代 (現在投手にセット ＆ 球数ロードのみ、テロップは送信しない)
    window.quickSetPitcher = function(team, number) {
        const list = players[team];
        const player = list.find(p => p.number === number);
        if (player) {
            inputPitcherName.value = player.name;
            inputPitcherNumber.value = player.number;
            state.scoreboard.pitcherName = player.name;
            state.scoreboard.pitcherNumber = player.number;
            
            // 当日の球数をロード (初期状態は0球目からスタート)
            if (player.todayPitches === undefined) {
                player.todayPitches = 0;
            }
            const pCount = parseInt(player.todayPitches) || 0;
            state.scoreboard.pitchCount = pCount;
            labelPitchCount.innerText = pCount;
            sendState();
        }
    };

    // ==========================================================================
    // カスタム画像テロップ制御
    // ==========================================================================
    
    let localDragSlideDataUrl = ""; // ドラッグ＆ドロップで受け取った画像を保持

    btnShowImageTelop.addEventListener('click', () => {
        const duration = parseInt(selectImageDuration.value);

        // ドラッグ＆ドロップされたデータがあれば優先送信
        if (localDragSlideDataUrl) {
            broadcastMessage('SHOW_IMAGE_TELOP', { url: localDragSlideDataUrl, duration });
            return;
        }

        const url = inputCustomImageUrl.value;
        if (!url) {
            alert('表示する画像のURLを入力するか、画像をドロップしてください。');
            return;
        }
        broadcastMessage('SHOW_IMAGE_TELOP', { url, duration });
    });

    btnShowImageFileTelop.addEventListener('click', () => {
        const duration = parseInt(selectImageDuration.value);

        // ドラッグ＆ドロップされたデータがあれば優先送信
        if (localDragSlideDataUrl) {
            broadcastMessage('SHOW_IMAGE_TELOP', { url: localDragSlideDataUrl, duration });
            return;
        }

        const file = inputCustomImageFile.files[0];
        if (file) {
            processImageFile(file, (base64) => {
                broadcastMessage('SHOW_IMAGE_TELOP', { url: base64, duration });
            });
        } else {
            alert('表示する画像ファイルを選択またはドロップしてください。');
        }
    });

    btnHideImageTelop.addEventListener('click', () => {
        broadcastMessage('HIDE_IMAGE_TELOP');
    });

    const btnHidePlayerTelop = document.getElementById('btn-hide-player-telop');
    if (btnHidePlayerTelop) {
        btnHidePlayerTelop.addEventListener('click', () => {
            broadcastMessage('HIDE_PLAYER_TELOP');
        });
    }

    // 初期化状態送信およびサーバー同期接続
    setupServerSync();
    setTimeout(sendState, 1000);

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
    setupDragAndDrop('home-logo-drop-zone', (dataUrl, fileName) => {
        state.scoreboard.homeLogo = dataUrl;
        const inputHomeLogoUrl = document.getElementById('input-home-logo-url');
        if (inputHomeLogoUrl) inputHomeLogoUrl.value = `[ドラッグ登録: ${fileName}]`;
        sendState();
        if (typeof updateTeamDisplay === 'function') updateTeamDisplay();
    });

    // 2. アウェイロゴのドラッグ＆ドロップ
    setupDragAndDrop('away-logo-drop-zone', (dataUrl, fileName) => {
        state.scoreboard.awayLogo = dataUrl;
        const inputAwayLogoUrl = document.getElementById('input-away-logo-url');
        if (inputAwayLogoUrl) inputAwayLogoUrl.value = `[ドラッグ登録: ${fileName}]`;
        sendState();
        if (typeof updateTeamDisplay === 'function') updateTeamDisplay();
    });

    // 3. スライドのドラッグ＆ドロップ (パネル全体を受け入れゾーンとする)
    setupDragAndDrop('custom-image-drop-zone', (dataUrl, fileName) => {
        localDragSlideDataUrl = dataUrl;
        const slideUrlInput = document.getElementById('input-custom-image-url');
        if (slideUrlInput) {
            slideUrlInput.value = `[ドラッグ登録: ${fileName}]`;
        }
    });

    // --- 別窓で配信画面(Overlay)を開く ---
    function openDualFillAndKey() {
        const winFill = window.open('baseball_overlay.html?mode=fill', 'baseball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        const winKey = window.open('baseball_overlay.html?mode=key', 'baseball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');

        if (!winFill || !winKey || winFill.closed || typeof winFill.closed === 'undefined' || winKey.closed || typeof winKey.closed === 'undefined') {
            alert("【お知らせ】ブラウザのポップアップブロックにより2枚目の画面が遮断されました。\n\nアドレスバー右端の「ポップアップがブロックされました」アイコンをクリックして「常に許可」を設定するか、ヘッダーの「🎬 Fill画面を開く」「🔲 Key画面を開く」ボタンをそれぞれクリックして2枚のウィンドウを開いてください。");
        }
    }

    const btnOpenDual = document.getElementById('btn-open-dual');
    if (btnOpenDual) btnOpenDual.addEventListener('click', openDualFillAndKey);

    const btnOpenFill = document.getElementById('btn-open-fill');
    if (btnOpenFill) {
        btnOpenFill.addEventListener('click', () => {
            window.open('baseball_overlay.html?mode=fill', 'baseball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    const btnOpenKey = document.getElementById('btn-open-key');
    if (btnOpenKey) {
        btnOpenKey.addEventListener('click', () => {
            window.open('baseball_overlay.html?mode=key', 'baseball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    // --- プレビュー用iframeの縮小フィット（16:9 100%表示）制御 ---
    function resizePreviewIframe() {
        const container = document.querySelector('.preview-container');
        const iframe = document.getElementById('overlay-preview');
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

    window.updateBsoLamps = updateBsoLamps;
    window.updateRunnerUI = updateRunnerUI;
    window.updateScoreDisplay = updateScoreDisplay;
    window.calculateTotalScores = calculateTotalScores;
    window.sendState = sendState;
    window.triggerChangeSides = triggerChangeSides;

    initCameraCapture();
    initStreamDeckHID();
});

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
// 📷 外付けUSB Webカメラ 超軽量キャプチャ ＆ クロップ配信 (野球用)
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
// 🎮 Stream Deck USB直接接続 ＆ 自動認識・実機LCD描画 (野球完全対応)
// ==========================================================================
let streamDeckDevice = null;
let currentDeckProfile = null;
let streamDeckFlipVertical = false;
let streamDeckKeyOffset = 3;

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

function triggerSync() {
    if (typeof window.updateBsoLamps === 'function') window.updateBsoLamps();
    if (typeof window.updateRunnerUI === 'function') window.updateRunnerUI();
    if (typeof window.updateScoreDisplay === 'function') window.updateScoreDisplay();
    if (typeof window.sendState === 'function') window.sendState();
}

function addBall() {
    if (!state || !state.scoreboard) return;
    state.scoreboard.balls = (state.scoreboard.balls + 1) % 4;
    triggerSync();
}

function addStrike() {
    if (!state || !state.scoreboard) return;
    state.scoreboard.strikes = (state.scoreboard.strikes + 1) % 3;
    triggerSync();
}

function addOut() {
    if (!state || !state.scoreboard) return;
    state.scoreboard.outs = (state.scoreboard.outs + 1) % 3;
    triggerSync();
}

function resetBSO() {
    if (!state || !state.scoreboard) return;
    state.scoreboard.balls = 0;
    state.scoreboard.strikes = 0;
    state.scoreboard.outs = 0;
    triggerSync();
}

function toggleLargeSmallScore() {
    if (!state || !state.scoreboard) return;
    // 大得点(large-soccer) ⇔ 小得点(small) 切替
    const nextMode = state.scoreboard.displayMode === 'large-soccer' ? 'small' : 'large-soccer';
    setDisplayMode(nextMode);
}

function toggleRanskoScore() {
    if (!state || !state.scoreboard) return;
    // ランスコ(large) ⇔ 小得点(small) 切替
    const nextMode = state.scoreboard.displayMode === 'large' ? 'small' : 'large';
    setDisplayMode(nextMode);
}

// 過去の回および現在進行イニングの空欄セルを自動的に0で補完する
function fillPastInningZeros() {
    if (!state || !state.scoreboard) return;
    const currentInning = Math.max(1, Math.min(12, state.scoreboard.inningNum || 1));
    const isBot = state.scoreboard.inningHalf === 'bot';

    // 1. 過去の回（1 〜 currentInning - 1）の空欄をすべて0にする
    for (let i = 0; i < currentInning - 1; i++) {
        if (state.scoreboard.awayInningScores[i] === "" || state.scoreboard.awayInningScores[i] === undefined) {
            state.scoreboard.awayInningScores[i] = "0";
            const inputEl = document.querySelector(`.score-cell-input[data-inning="${i + 1}"][data-team="away"]`);
            if (inputEl) inputEl.value = "0";
        }
        if (state.scoreboard.homeInningScores[i] === "" || state.scoreboard.homeInningScores[i] === undefined) {
            state.scoreboard.homeInningScores[i] = "0";
            const inputEl = document.querySelector(`.score-cell-input[data-inning="${i + 1}"][data-team="home"]`);
            if (inputEl) inputEl.value = "0";
        }
    }

    // 2. 現在の回（currentInning）で、裏（後攻）の場合、表（先攻）が空欄なら0にする
    if (isBot) {
        const currIdx = currentInning - 1;
        if (state.scoreboard.awayInningScores[currIdx] === "" || state.scoreboard.awayInningScores[currIdx] === undefined) {
            state.scoreboard.awayInningScores[currIdx] = "0";
            const inputEl = document.querySelector(`.score-cell-input[data-inning="${currentInning}"][data-team="away"]`);
            if (inputEl) inputEl.value = "0";
        }
    }
}

function toggleInningHalf() {
    if (!state || !state.scoreboard) return;
    const currentInning = Math.max(1, Math.min(12, state.scoreboard.inningNum || 1));
    const currIdx = currentInning - 1;

    if (state.scoreboard.inningHalf === 'top') {
        // 表 ➔ 裏へのチェンジ：その回の表（先攻）が空なら0にする
        if (state.scoreboard.awayInningScores[currIdx] === "" || state.scoreboard.awayInningScores[currIdx] === undefined) {
            state.scoreboard.awayInningScores[currIdx] = "0";
            const inputEl = document.querySelector(`.score-cell-input[data-inning="${currentInning}"][data-team="away"]`);
            if (inputEl) inputEl.value = "0";
        }
        state.scoreboard.inningHalf = 'bot';
    } else {
        // 裏 ➔ 次の回の表へのチェンジ：その回の裏（後攻）が空なら0にする
        if (state.scoreboard.homeInningScores[currIdx] === "" || state.scoreboard.homeInningScores[currIdx] === undefined) {
            state.scoreboard.homeInningScores[currIdx] = "0";
            const inputEl = document.querySelector(`.score-cell-input[data-inning="${currentInning}"][data-team="home"]`);
            if (inputEl) inputEl.value = "0";
        }
        state.scoreboard.inningHalf = 'top';
        state.scoreboard.inningNum = Math.min(12, currentInning + 1);
    }

    fillPastInningZeros();

    state.scoreboard.balls = 0;
    state.scoreboard.strikes = 0;
    state.scoreboard.outs = 0;
    state.scoreboard.runner1st = false;
    state.scoreboard.runner2nd = false;
    state.scoreboard.runner3rd = false;

    if (typeof window.calculateTotalScores === 'function') {
        window.calculateTotalScores();
    } else {
        triggerSync();
    }
}

function setInning(num) {
    if (!state || !state.scoreboard) return;
    state.scoreboard.inningNum = num;
    fillPastInningZeros();
    if (typeof window.calculateTotalScores === 'function') {
        window.calculateTotalScores();
    } else {
        triggerSync();
    }
}

function toggleRunner(base) {
    if (!state || !state.scoreboard) return;
    if (base === 1) state.scoreboard.runner1st = !state.scoreboard.runner1st;
    if (base === 2) state.scoreboard.runner2nd = !state.scoreboard.runner2nd;
    if (base === 3) state.scoreboard.runner3rd = !state.scoreboard.runner3rd;
    triggerSync();
}

function clearRunners() {
    if (!state || !state.scoreboard) return;
    state.scoreboard.runner1st = false;
    state.scoreboard.runner2nd = false;
    state.scoreboard.runner3rd = false;
    triggerSync();
}

function addRun(team) {
    if (!state || !state.scoreboard) return;
    const inningIdx = Math.max(0, Math.min(11, (state.scoreboard.inningNum || 1) - 1));
    const scoresArr = (team === 'home') ? state.scoreboard.homeInningScores : state.scoreboard.awayInningScores;
    
    // 後攻（裏）に得点が入った場合、その回の表（先攻）が空欄なら自動的に0にする
    if (team === 'home') {
        if (state.scoreboard.awayInningScores[inningIdx] === "" || state.scoreboard.awayInningScores[inningIdx] === undefined) {
            state.scoreboard.awayInningScores[inningIdx] = "0";
            const awayInput = document.querySelector(`.score-cell-input[data-inning="${inningIdx + 1}"][data-team="away"]`);
            if (awayInput) awayInput.value = "0";
        }
    }

    let currentVal = parseInt(scoresArr[inningIdx], 10);
    if (isNaN(currentVal)) currentVal = 0;
    currentVal++;
    scoresArr[inningIdx] = String(currentVal);

    // ダッシュボードUIの入力セルも同期
    const inputEl = document.querySelector(`.score-cell-input[data-inning="${inningIdx + 1}"][data-team="${team}"]`);
    if (inputEl) inputEl.value = currentVal;

    fillPastInningZeros();

    if (typeof window.calculateTotalScores === 'function') {
        window.calculateTotalScores();
    } else {
        triggerSync();
    }
}

function subRun(team) {
    if (!state || !state.scoreboard) return;
    const inningIdx = Math.max(0, Math.min(11, (state.scoreboard.inningNum || 1) - 1));
    const scoresArr = (team === 'home') ? state.scoreboard.homeInningScores : state.scoreboard.awayInningScores;
    
    let currentVal = parseInt(scoresArr[inningIdx], 10);
    if (isNaN(currentVal) || currentVal <= 0) {
        scoresArr[inningIdx] = "";
    } else {
        currentVal--;
        scoresArr[inningIdx] = currentVal > 0 ? String(currentVal) : "0";
    }

    // ダッシュボードUIの入力セルも同期
    const inputEl = document.querySelector(`.score-cell-input[data-inning="${inningIdx + 1}"][data-team="${team}"]`);
    if (inputEl) inputEl.value = scoresArr[inningIdx];

    if (typeof window.calculateTotalScores === 'function') {
        window.calculateTotalScores();
    } else {
        triggerSync();
    }
}

function setDisplayMode(mode) {
    if (!state || !state.scoreboard) return;
    state.scoreboard.displayMode = mode;
    state.scoreboard.visible = (mode !== 'hidden' && mode !== 'none');
    triggerSync();
}

function toggleLineupTelop() {
    if (!state || !state.scoreboard) return;
    const nextMode = state.scoreboard.displayMode === 'lineup' ? 'small' : 'lineup';
    setDisplayMode(nextMode);
}

function toggleBatterTelop() {
    if (typeof showPlayerTelop === 'function') {
        const list = (typeof players !== 'undefined' && players.home && players.home.length > 0) ? players.home : (state.scoreboard.homePlayers || []);
        if (list && list[0]) {
            showPlayerTelop(list[0].number);
        }
    }
}

// 野球用15キー標準アクション定義 (5x3)
const BASEBALL_STREAMDECK_ACTIONS = [
    // 1行目: ボール・ストライク・アウト・BSO一括リセット・表裏チェンジ
    { keyIndex: 0, label: "🟢 BALL", sub: "+1", bg: "#15803d", action: () => { addBall(); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "🟡 STRIKE", sub: "+1", bg: "#ca8a04", action: () => { addStrike(); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "🔴 OUT", sub: "+1", bg: "#dc2626", action: () => { addOut(); updateStreamDeckLCD(); } },
    { keyIndex: 3, label: "⚡ BSO", sub: "一括リセット", bg: "#475569", action: () => { resetBSO(); updateStreamDeckLCD(); } },
    { keyIndex: 4, label: "🔄 表/裏", sub: "チェンジ", bg: "#0284c7", action: () => { toggleInningHalf(); updateStreamDeckLCD(); } },

    // 2行目: 先攻得点(+1/-1), 後攻得点(+1/-1), ランスコON/OFF
    { keyIndex: 5, label: "🔵 先攻 +1", sub: "得点加算", bg: "#0369a1", action: () => { addRun('away'); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "🔵 先攻 -1", sub: "得点取消", bg: "#0f172a", action: () => { subRun('away'); updateStreamDeckLCD(); } },
    { keyIndex: 7, label: "🔴 後攻 +1", sub: "得点加算", bg: "#991b1b", action: () => { addRun('home'); updateStreamDeckLCD(); } },
    { keyIndex: 8, label: "🔴 後攻 -1", sub: "得点取消", bg: "#0f172a", action: () => { subRun('home'); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "📊 ランスコ", sub: "ON/OFF", bg: "#334155", action: () => { toggleRanskoScore(); updateStreamDeckLCD(); } },

    // 3行目: 大得点/小得点切替 + VS + スタメン + 打者紹介 + 全面消去
    { keyIndex: 10, label: "📺 大/小得点", sub: "得点板切替", bg: "#334155", action: () => { toggleLargeSmallScore(); updateStreamDeckLCD(); } },
    { keyIndex: 11, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { setDisplayMode(state.scoreboard.displayMode === 'vs' ? 'small' : 'vs'); updateStreamDeckLCD(); } },
    { keyIndex: 12, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { toggleLineupTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "👤 打者紹介", sub: "ON/OFF", bg: "#b45309", action: () => { toggleBatterTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 14, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { setDisplayMode('hidden'); updateStreamDeckLCD(); } }
];

// 野球用32キー拡張アクション定義 (8x4: Stream Deck XL用)
const BASEBALL_STREAMDECK_ACTIONS_32 = [
    // 1行目: BSOカウント・走者制御
    { keyIndex: 0, label: "🟢 BALL", sub: "+1", bg: "#15803d", action: () => { addBall(); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "🟡 STRIKE", sub: "+1", bg: "#ca8a04", action: () => { addStrike(); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "🔴 OUT", sub: "+1", bg: "#dc2626", action: () => { addOut(); updateStreamDeckLCD(); } },
    { keyIndex: 3, label: "⚡ BSO", sub: "一括リセット", bg: "#475569", action: () => { resetBSO(); updateStreamDeckLCD(); } },
    { keyIndex: 4, label: "🔷 1塁走者", sub: "ON/OFF", bg: "#0284c7", action: () => { toggleRunner(1); updateStreamDeckLCD(); } },
    { keyIndex: 5, label: "🔷 2塁走者", sub: "ON/OFF", bg: "#0284c7", action: () => { toggleRunner(2); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "🔷 3塁走者", sub: "ON/OFF", bg: "#0284c7", action: () => { toggleRunner(3); updateStreamDeckLCD(); } },
    { keyIndex: 7, label: "🏃 走者一掃", sub: "クリア", bg: "#334155", action: () => { clearRunners(); updateStreamDeckLCD(); } },

    // 2行目: 先攻・後攻得点加減・表裏チェンジ・イニング(1-3)
    { keyIndex: 8, label: "🔵 先攻 +1", sub: "得点加算", bg: "#0369a1", action: () => { addRun('away'); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "🔵 先攻 -1", sub: "得点取消", bg: "#0f172a", action: () => { subRun('away'); updateStreamDeckLCD(); } },
    { keyIndex: 10, label: "🔴 後攻 +1", sub: "得点加算", bg: "#991b1b", action: () => { addRun('home'); updateStreamDeckLCD(); } },
    { keyIndex: 11, label: "🔴 後攻 -1", sub: "得点取消", bg: "#0f172a", action: () => { subRun('home'); updateStreamDeckLCD(); } },
    { keyIndex: 12, label: "🔄 表/裏", sub: "チェンジ", bg: "#0284c7", action: () => { toggleInningHalf(); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "1回", sub: "イニング", bg: "#1e293b", action: () => { setInning(1); updateStreamDeckLCD(); } },
    { keyIndex: 14, label: "2回", sub: "イニング", bg: "#1e293b", action: () => { setInning(2); updateStreamDeckLCD(); } },
    { keyIndex: 15, label: "3回", sub: "イニング", bg: "#1e293b", action: () => { setInning(3); updateStreamDeckLCD(); } },

    // 3行目: イニング(4-9)・画面切替
    { keyIndex: 16, label: "4回", sub: "イニング", bg: "#1e293b", action: () => { setInning(4); updateStreamDeckLCD(); } },
    { keyIndex: 17, label: "5回", sub: "イニング", bg: "#1e293b", action: () => { setInning(5); updateStreamDeckLCD(); } },
    { keyIndex: 18, label: "6回", sub: "イニング", bg: "#1e293b", action: () => { setInning(6); updateStreamDeckLCD(); } },
    { keyIndex: 19, label: "7回", sub: "イニング", bg: "#1e293b", action: () => { setInning(7); updateStreamDeckLCD(); } },
    { keyIndex: 20, label: "8回", sub: "イニング", bg: "#1e293b", action: () => { setInning(8); updateStreamDeckLCD(); } },
    { keyIndex: 21, label: "9回", sub: "イニング", bg: "#1e293b", action: () => { setInning(9); updateStreamDeckLCD(); } },
    { keyIndex: 22, label: "📺 大/小得点", sub: "得点板切替", bg: "#334155", action: () => { toggleLargeSmallScore(); updateStreamDeckLCD(); } },
    { keyIndex: 23, label: "📊 ランスコ", sub: "ボード切替", bg: "#334155", action: () => { toggleRanskoScore(); updateStreamDeckLCD(); } },

    // 4行目: 特殊送出・選手テロップ・カメラ・消去
    { keyIndex: 24, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { setDisplayMode(state.scoreboard.displayMode === 'vs' ? 'small' : 'vs'); updateStreamDeckLCD(); } },
    { keyIndex: 25, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { toggleLineupTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 26, label: "👤 打者", sub: "紹介テロップ", bg: "#b45309", action: () => { toggleBatterTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 27, label: "👤 投手", sub: "紹介テロップ", bg: "#b45309", action: () => { toggleBatterTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 28, label: "👤 投手交代", sub: "テロップ", bg: "#0369a1", action: () => { toggleBatterTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 29, label: "👤 代打", sub: "テロップ", bg: "#0369a1", action: () => { toggleBatterTelop(); updateStreamDeckLCD(); } },
    { keyIndex: 30, label: "📷 カメラ枠", sub: "送出ON/OFF", bg: "#0d9488", action: () => {
        isCameraOverlayVisible = !isCameraOverlayVisible;
        const btnOverlay = document.getElementById('btn-toggle-camera-overlay');
        if (btnOverlay) {
            btnOverlay.innerText = isCameraOverlayVisible ? 'テロップ画面へ送出 (ON AIR中)' : 'テロップ画面へ送出 (ON)';
            btnOverlay.style.background = isCameraOverlayVisible ? '#dc2626' : '#16a34a';
        }
        updateStreamDeckLCD();
    } },
    { keyIndex: 31, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { setDisplayMode('hidden'); updateStreamDeckLCD(); } }
];

let activeKeyActions = BASEBALL_STREAMDECK_ACTIONS;

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
            activeKeyActions = BASEBALL_STREAMDECK_ACTIONS_32;
        } else {
            activeKeyActions = BASEBALL_STREAMDECK_ACTIONS;
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
        info.innerHTML = '※USBで接続されるとWeb HID経由で自動認識され、B・S・O等のキー割り振りとLCD描画が自動起動します。';
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
        if (k.label.includes('OFF') && !state.scoreboard.visible) bgColor = '#dc2626';

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

        if (k.label.includes('OFF') && !state.scoreboard.visible) {
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
