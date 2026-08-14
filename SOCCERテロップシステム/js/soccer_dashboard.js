/* ==========================================================================
   サッカー配信用ダッシュボード JavaScript
   ========================================================================== */

// グローバル状態オブジェクト
let state = {
    scoreboard: {
        visible: true,
        displayMode: 'small', // 'none', 'small', 'large', 'vs'
        homeName: 'HOME TEAM',
        homeSubName: 'HOME',
        homeColor: '#059669',
        homeLogo: '',
        awayName: 'AWAY TEAM',
        awaySubName: 'AWAY',
        awayColor: '#1d4ed8',
        awayLogo: '',
        tournamentName: '',
        homeScore: 0,
        awayScore: 0,
        period: '1st',
        time: '00:00',
        additionalTime: 0,
        halfMinutes: 45
    },
    pk: {
        visible: false,
        homeResults: [], // 'success', 'miss', or null
        awayResults: [],
        currentIndex: 0,
        currentTeam: 'home',
        firstTeam: 'home'
    },
    chromakey: 'green'
};

// タイマー管理用変数
let timerInterval = null;
let totalSeconds = 0;
let channel = null;
let sendState = null;
let updateUI = null;
let toggleTimer = null;
let broadcastMessage = null;

document.addEventListener('DOMContentLoaded', () => {

    // 選手データ
    let players = {
        home: [],
        away: []
    };
    let currentTab = 'home'; // 'home' or 'away'

    // BroadcastChannel の初期化
    channel = new BroadcastChannel('soccer_overlay_channel');

    // 開いた別窓の参照を保持する配列
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

    const labelHomeScore = document.getElementById('label-home-score');
    const labelAwayScore = document.getElementById('label-away-score');
    const labelTimer = document.getElementById('label-timer');
    const labelPeriod = document.getElementById('label-period');
    const selectPeriod = document.getElementById('select-period');
    const btnToggleTimer = document.getElementById('btn-toggle-timer');
    const btnResetTimer = document.getElementById('btn-reset-timer');
    const btnEditTime = document.getElementById('btn-edit-time');
    const inputAt = document.getElementById('input-at');
    // 表示モードボタン（プルダウンの代わりにカード選択）
    const displayModeBtns = document.querySelectorAll('.display-mode-btn');
    
    // PK関連
    const togglePkMode = document.getElementById('toggle-pk-mode');
    const radioPkFirstHome = document.getElementById('radio-pk-first-home');
    const radioPkFirstAway = document.getElementById('radio-pk-first-away');
    const pkPanelBody = document.getElementById('pk-panel-body');
    const pkCurrentStatus = document.getElementById('pk-current-status');
    const pkHomeTeamName = document.getElementById('pk-home-team-name');
    const pkAwayTeamName = document.getElementById('pk-away-team-name');
    const homePkActions = document.getElementById('home-pk-actions');
    const awayPkActions = document.getElementById('away-pk-actions');
    const btnPkSuccess = document.getElementById('btn-pk-success');
    const btnPkMiss = document.getElementById('btn-pk-miss');
    const btnPkPrev = document.getElementById('btn-pk-prev');
    const btnPkClear = document.getElementById('btn-pk-clear');

    // クロマキー背景関連
    const chromaButtons = document.querySelectorAll('.btn-chroma');

    // 選手・テロップ関連
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

    // カスタム画像テロップ関連
    const inputCustomImageUrl = document.getElementById('input-custom-image-url');
    const btnShowImageTelop = document.getElementById('btn-show-image-telop');
    const inputCustomImageFile = document.getElementById('input-custom-image-file');
    const btnShowImageFileTelop = document.getElementById('btn-show-image-file-telop');
    const btnHideImageTelop = document.getElementById('btn-hide-image-telop');
    const selectImageDuration = document.getElementById('select-image-duration');

    // 接続確認（オーバーレイ画面との疎通確認用）
    const connectionStatus = document.getElementById('connection-status');
    let pongReceived = false;
    const iframe = document.getElementById('overlay-preview');

    // サーバー同期管理用変数
    let isServerConnected = false;
    let eventSource = null;

    // メッセージ送信関数（BroadcastChannel と直接 postMessage の両方に送る）
    broadcastMessage = function(type, data) {
        const payload = { type, data };

        // 1. BroadcastChannel 経由で送信
        try {
            channel.postMessage(payload);
        } catch (e) {
            console.warn('BroadcastChannel が制限されています:', e);
        }

        // 2. プレビュー用 iframe に直接送信
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(payload, '*');
        }

        // 3. window.open で開いたすべての子ウィンドウに直接送信
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
        document.getElementById('input-home-sub').value = sb.homeSubName;
        document.getElementById('input-home-color').value = sb.homeColor;
        document.getElementById('input-away-name').value = sb.awayName;
        document.getElementById('input-away-sub').value = sb.awaySubName;
        document.getElementById('input-away-color').value = sb.awayColor;
        document.getElementById('input-tournament').value = sb.tournamentName;

        // 得点・タイマー
        labelHomeScore.textContent = sb.homeScore;
        labelAwayScore.textContent = sb.awayScore;
        labelTimer.textContent = sb.time;
        
        let periodText = '前半';
        if (sb.period === '2nd') periodText = '後半';
        else if (sb.period === 'Extra1') periodText = '延前';
        else if (sb.period === 'Extra2') periodText = '延後';
        else if (sb.period === 'PK') periodText = 'PK';
        labelPeriod.textContent = periodText;
        selectPeriod.value = sb.period;
        document.getElementById('input-at').value = sb.additionalTime;

        // 表示モードボタンのアクティブハイライト更新
        displayModeBtns.forEach(btn => {
            if (btn.getAttribute('data-mode') === sb.displayMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // クロマキー背景
        document.querySelectorAll('.btn-chroma').forEach(btn => {
            btn.classList.remove('active');
            if (btn.classList.contains(`chroma-${state.chromakey}`)) {
                btn.classList.add('active');
            }
        });

        // PK状態
        const pk = state.pk;
        document.getElementById('toggle-pk-mode').checked = pk.visible;
        if (pk.visible) {
            pkPanelBody.classList.remove('hidden');
        } else {
            pkPanelBody.classList.add('hidden');
        }
        document.getElementById('radio-pk-first-home').checked = pk.firstTeam === 'home';
        document.getElementById('radio-pk-first-away').checked = pk.firstTeam === 'away';
        
        updatePkStatusText();
        renderPkActions();
        renderPlayerTable();
    }

    // 定期的にPINGを送信して接続を確認 (スタンドアロン時のみ)
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

    // postMessage からの PONG 受信
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PONG') {
            pongReceived = true;
        }
    });

    // ==========================================================================
    // 初期セットアップ & 同期
    // ==========================================================================
    
    sendState = function() {
        if (!state) return;
        state.players = players;
        broadcastMessage('UPDATE_STATE', state);
        
        if (typeof isServerConnected !== 'undefined' && isServerConnected) {
            fetch('/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            }).catch(err => console.error("Server sync state error:", err));
        }
    };
    updateUI = updateAllUI;
    window.sendState = sendState;
    window.updateUI = updateUI;

    // プレビューのiframe読み込み完了時に初期状態を送信
    iframe.addEventListener('load', () => {
        setTimeout(sendState, 500);
    });

    // 16:9 プレビュー画面のレスポンシブスケーリング
    function scalePreview() {
        const container = document.querySelector('.preview-container');
        const containerWidth = container.clientWidth;
        // 本来の幅 1920 に対する比率
        const scale = containerWidth / 1920;
        iframe.style.transform = `scale(${scale})`;
        iframe.style.height = `${1080 * scale}px`; // 親の高さも調整
        container.style.height = `${1080 * scale}px`;
    }
    
    window.addEventListener('resize', scalePreview);
    scalePreview(); // 初回実行

    // ==========================================================================
    // チーム名・スコア・ピリオド・表示スイッチのイベント
    // ==========================================================================

    function updateTeamNames() {
        state.scoreboard.homeName = inputHomeName.value.trim() || 'HOME';
        state.scoreboard.homeSubName = inputHomeSub.value.trim() || 'HOME';
        state.scoreboard.awayName = inputAwayName.value.trim() || 'AWAY';
        state.scoreboard.awaySubName = inputAwaySub.value.trim() || 'AWAY';
        state.scoreboard.homeColor = inputHomeColor.value;
        state.scoreboard.awayColor = inputAwayColor.value;
        state.scoreboard.tournamentName = inputTournament.value.trim() || '';

        // URL入力がある場合は優先的にセット（ただしドラッグ登録テキストは除外）
        if (inputHomeLogoUrl.value.trim() && !inputHomeLogoUrl.value.includes('[ドラッグ登録:')) {
            state.scoreboard.homeLogo = inputHomeLogoUrl.value.trim();
        }
        if (inputAwayLogoUrl.value.trim() && !inputAwayLogoUrl.value.includes('[ドラッグ登録:')) {
            state.scoreboard.awayLogo = inputAwayLogoUrl.value.trim();
        }

        pkHomeTeamName.textContent = state.scoreboard.homeName;
        pkAwayTeamName.textContent = state.scoreboard.awayName;
        sendState();
    }

    inputHomeName.addEventListener('input', updateTeamNames);
    inputHomeSub.addEventListener('input', updateTeamNames);
    inputAwayName.addEventListener('input', updateTeamNames);
    inputAwaySub.addEventListener('input', updateTeamNames);
    inputHomeColor.addEventListener('input', updateTeamNames);
    inputAwayColor.addEventListener('input', updateTeamNames);
    inputTournament.addEventListener('input', updateTeamNames);
    inputHomeLogoUrl.addEventListener('input', updateTeamNames);
    inputAwayLogoUrl.addEventListener('input', updateTeamNames);

    // ロゴ画像ファイルの読み込み処理 (Canvasで120pxに自動縮小したBase64にして転送。file:///のセキュリティ制限と巨大ファイル通信バグを両防ぐ)
    function handleLogoFileUpload(fileInput, targetKey) {
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxDim = 120; // 表示サイズに合わせた十分なサイズ
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxDim) {
                        height = Math.round(height * maxDim / width);
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width = Math.round(width * maxDim / height);
                        height = maxDim;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const compressedBase64 = canvas.toDataURL('image/png');
                state.scoreboard[targetKey] = compressedBase64;
                sendState();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    inputHomeLogoFile.addEventListener('change', () => handleLogoFileUpload(inputHomeLogoFile, 'homeLogo'));
    inputAwayLogoFile.addEventListener('change', () => handleLogoFileUpload(inputAwayLogoFile, 'awayLogo'));

    // グローバル関数として公開（HTMLのonclickから呼ぶため）
    window.adjustScore = function(team, val) {
        if (team === 'home') {
            state.scoreboard.homeScore = Math.max(0, state.scoreboard.homeScore + val);
            labelHomeScore.textContent = state.scoreboard.homeScore;
        } else {
            state.scoreboard.awayScore = Math.max(0, state.scoreboard.awayScore + val);
            labelAwayScore.textContent = state.scoreboard.awayScore;
        }
        sendState();
    };

    const periodNames = {
        '1st': '前半',
        '2nd': '後半',
        'EX1': '延前',
        'EX2': '延後',
        'PK': 'PK戦',
        'End': '終了'
    };

    const selectHalfDuration = document.getElementById('select-half-duration');
    if (selectHalfDuration) {
        selectHalfDuration.addEventListener('change', () => {
            const h = parseInt(selectHalfDuration.value) || 45;
            state.scoreboard.halfMinutes = h;
            if (selectPeriod.value === '2nd') totalSeconds = h * 60;
            else if (selectPeriod.value === 'EX1') totalSeconds = h * 2 * 60;
            else if (selectPeriod.value === 'EX2') totalSeconds = (h * 2 + 15) * 60;
            updateTimerDisplay();
            sendState();
        });
    }

    selectPeriod.addEventListener('change', () => {
        const val = selectPeriod.value;
        state.scoreboard.period = periodNames[val] || val;
        labelPeriod.textContent = state.scoreboard.period;

        const h = state.scoreboard.halfMinutes || 45;
        if (val === '1st') {
            totalSeconds = 0;
        } else if (val === '2nd') {
            totalSeconds = h * 60;
        } else if (val === 'EX1') {
            totalSeconds = h * 2 * 60;
        } else if (val === 'EX2') {
            totalSeconds = (h * 2 + 15) * 60;
        } else if (val === 'PK') {
            togglePkMode.checked = true;
            enablePkMode(true);
        } else if (val === 'End') {
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
                btnToggleTimer.textContent = 'タイマー開始';
                btnToggleTimer.className = 'btn btn-primary';
            }
        }
        updateTimerDisplay();
        sendState();
    });

    inputAt.addEventListener('input', () => {
        state.scoreboard.additionalTime = parseInt(inputAt.value) || 0;
        sendState();
    });

    displayModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode');
            state.scoreboard.displayMode = mode;
            state.scoreboard.visible = (mode !== 'none');
            
            displayModeBtns.forEach(b => {
                if (b === btn) b.classList.add('active');
                else b.classList.remove('active');
            });

            sendState();
        });
    });

    // ==========================================================================
    // タイマー制御
    // ==========================================================================

    function updateTimerDisplay() {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        const displayStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        state.scoreboard.time = displayStr;
        labelTimer.textContent = displayStr;
    }

    toggleTimer = function() {
        if (timerInterval) {
            // 停止
            clearInterval(timerInterval);
            timerInterval = null;
            if (btnToggleTimer) {
                btnToggleTimer.textContent = 'タイマー開始';
                btnToggleTimer.className = 'btn btn-primary';
            }
        } else {
            // 開始
            timerInterval = setInterval(() => {
                totalSeconds++;
                updateTimerDisplay();
                sendState();
            }, 1000);
            if (btnToggleTimer) {
                btnToggleTimer.textContent = 'タイマー停止';
                btnToggleTimer.className = 'btn btn-secondary';
            }
        }
        updateTimerDisplay();
        sendState();
        if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
    };
    window.toggleTimer = toggleTimer;

    btnToggleTimer.addEventListener('click', toggleTimer);

    btnResetTimer.addEventListener('click', () => {
        if (confirm('タイマーをリセットしますか？')) {
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
                btnToggleTimer.textContent = 'タイマー開始';
                btnToggleTimer.className = 'btn btn-primary';
            }
            totalSeconds = 0;
            // ピリオドに応じた時間を再セット
            const val = selectPeriod.value;
            if (val === '2nd') totalSeconds = 45 * 60;
            else if (val === 'EX1') totalSeconds = 90 * 60;
            else if (val === 'EX2') totalSeconds = 105 * 60;

            updateTimerDisplay();
            sendState();
        }
    });

    btnEditTime.addEventListener('click', () => {
        const currentMins = Math.floor(totalSeconds / 60);
        const currentSecs = totalSeconds % 60;
        const inputStr = prompt('時間を入力してください (分:秒 または 分のみ。例: "45:00" "72")', `${currentMins}:${String(currentSecs).padStart(2, '0')}`);
        
        if (inputStr !== null) {
            let targetSeconds = 0;
            if (inputStr.includes(':')) {
                const parts = inputStr.split(':');
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                targetSeconds = (mins * 60) + secs;
            } else {
                const mins = parseInt(inputStr) || 0;
                targetSeconds = mins * 60;
            }
            totalSeconds = Math.max(0, targetSeconds);
            updateTimerDisplay();
            sendState();
        }
    });

    // ==========================================================================
    // クロマキー背景制御
    // ==========================================================================

    chromaButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            chromaButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.chromakey = btn.dataset.color;
            sendState();
        });
    });

    // ==========================================================================
    // PK戦コントロール
    // ==========================================================================

    togglePkMode.addEventListener('change', () => {
        enablePkMode(togglePkMode.checked);
    });

    // 先攻後攻の切り替えイベント
    const handleFirstTeamChange = (e) => {
        state.pk.firstTeam = e.target.value;
        // PK結果が一切入力されていない初期状態なら、現在のキッカーも先攻側に切り替える
        if (state.pk.homeResults.length === 0 && state.pk.awayResults.length === 0) {
            state.pk.currentTeam = state.pk.firstTeam;
            state.pk.currentIndex = 0;
        }
        renderPkActions();
        updatePkStatusText();
        sendState();
    };

    radioPkFirstHome.addEventListener('change', handleFirstTeamChange);
    radioPkFirstAway.addEventListener('change', handleFirstTeamChange);

    function enablePkMode(enabled) {
        state.pk.visible = enabled;
        if (enabled) {
            pkPanelBody.classList.remove('pk-disabled');
            state.scoreboard.period = 'PK戦';
            selectPeriod.value = 'PK';
            labelPeriod.textContent = 'PK戦';
            // 初期状態なら先攻チームにセットする
            if (state.pk.homeResults.length === 0 && state.pk.awayResults.length === 0) {
                state.pk.currentTeam = state.pk.firstTeam || 'home';
                state.pk.currentIndex = 0;
            }
            renderPkActions();
            updatePkStatusText();
        } else {
            pkPanelBody.classList.add('pk-disabled');
        }
        sendState();
    }

    // PKの弾（丸）と結果入力インターフェースを動的生成
    function renderPkActions() {
        homePkActions.innerHTML = '';
        awayPkActions.innerHTML = '';

        // 通常5本＋サドンデス用の追加分（最大10本）
        const maxShots = Math.max(5, state.pk.homeResults.length + 1, state.pk.awayResults.length + 1);
        const totalRender = Math.min(10, maxShots); // 最大10枠

        for (let i = 0; i < totalRender; i++) {
            const createBtn = (team, results) => {
                const btn = document.createElement('button');
                btn.className = 'pk-action-btn';
                
                const result = results[i];
                if (result === 'success') {
                    btn.classList.add('success');
                    btn.textContent = '○';
                } else if (result === 'miss') {
                    btn.classList.add('miss');
                    btn.textContent = '✕';
                } else {
                    btn.textContent = i + 1;
                }

                // 現在の選択キッカーの強調
                if (state.pk.currentTeam === team && state.pk.currentIndex === i) {
                    btn.classList.add('active');
                }

                // クリックしてそのキッカーを直接編集状態にする
                btn.addEventListener('click', () => {
                    state.pk.currentTeam = team;
                    state.pk.currentIndex = i;
                    renderPkActions();
                    updatePkStatusText();
                    sendState();
                });

                return btn;
            };

            homePkActions.appendChild(createBtn('home', state.pk.homeResults));
            awayPkActions.appendChild(createBtn('away', state.pk.awayResults));
        }
    }

    function updatePkStatusText() {
        const teamJa = state.pk.currentTeam === 'home' ? state.scoreboard.homeName : state.scoreboard.awayName;
        pkCurrentStatus.textContent = `${teamJa} (${state.pk.currentIndex + 1}人目)`;
    }

    // PK戦の結果入力
    btnPkSuccess.addEventListener('click', () => recordPkResult('success'));
    btnPkMiss.addEventListener('click', () => recordPkResult('miss'));

    function recordPkResult(result) {
        if (!state.pk.visible) return;

        const results = state.pk.currentTeam === 'home' ? state.pk.homeResults : state.pk.awayResults;
        results[state.pk.currentIndex] = result;

        // 次のキッカーへ自動進む
        const firstTeam = state.pk.firstTeam || 'home';
        const secondTeam = firstTeam === 'home' ? 'away' : 'home';

        if (state.pk.currentTeam === firstTeam) {
            // 先攻の後は後攻の同じ巡目
            state.pk.currentTeam = secondTeam;
        } else {
            // 後攻の後は先攻の次の巡目へ
            state.pk.currentTeam = firstTeam;
            state.pk.currentIndex++;
        }

        renderPkActions();
        updatePkStatusText();
        sendState();
    }

    // １つ戻す
    btnPkPrev.addEventListener('click', () => {
        if (!state.pk.visible) return;

        const firstTeam = state.pk.firstTeam || 'home';
        const secondTeam = firstTeam === 'home' ? 'away' : 'home';

        if (state.pk.currentTeam === secondTeam) {
            // 現在後攻なら、先攻の同じ巡目に戻す
            state.pk.currentTeam = firstTeam;
        } else {
            // 現在先攻なら、後攻の前の巡目に戻す
            if (state.pk.currentIndex > 0) {
                state.pk.currentTeam = secondTeam;
                state.pk.currentIndex--;
            } else {
                return; // これ以上戻せない
            }
        }

        // 戻した先のキッカー結果をクリア
        const results = state.pk.currentTeam === 'home' ? state.pk.homeResults : state.pk.awayResults;
        results[state.pk.currentIndex] = null;

        renderPkActions();
        updatePkStatusText();
        sendState();
    });

    // PKクリア
    btnPkClear.addEventListener('click', () => {
        if (confirm('PK戦の結果をすべてリセットしますか？')) {
            state.pk.homeResults = [];
            state.pk.awayResults = [];
            state.pk.currentIndex = 0;
            state.pk.currentTeam = state.pk.firstTeam || 'home';
            renderPkActions();
            updatePkStatusText();
            sendState();
        }
    });

    // ==========================================================================
    // Google スプレッドシート CSV インポート機能
    // ==========================================================================

    btnLoadSheet.addEventListener('click', () => {
        const url = inputSheetUrl.value.trim();
        if (!url) {
            alert('ウェブに公開したCSVのURLを入力してください。');
            return;
        }

        // Googleスプレッドシートの閲覧URLが入力された場合、CSVエクスポートのURLに自動変換するおもてなし
        let csvUrl = url;
        const sheetIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (sheetIdMatch && !url.includes('export?format=csv')) {
            const sheetId = sheetIdMatch[1];
            // gidが含まれているかチェック
            const gidMatch = url.match(/gid=([0-9]+)/);
            const gid = gidMatch ? gidMatch[1] : '0';
            csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        }

        btnLoadSheet.textContent = '読込中...';
        btnLoadSheet.disabled = true;

        fetch(csvUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error('ネットワークエラーが発生しました。URLと公開設定を確認してください。');
                }
                return response.text();
            })
            .then(csvText => {
                parseCsvData(csvText);
                alert('スプレッドシートから選手一覧を読み込みました！');
            })
            .catch(err => {
                console.error(err);
                alert(`読み込みエラー: ${err.message}\n※スプレッドシートが「ウェブに公開」されており、フォーマットが正しいことを確認してください。`);
            })
            .finally(() => {
                btnLoadSheet.textContent = 'URL読込';
                btnLoadSheet.disabled = false;
            });
    });

    // UTF-8 の有効なバイトシーケンスであるか検証
    function isUTF8(bytes) {
        let i = 0;
        while (i < bytes.length) {
            if (bytes[i] <= 0x7F) {
                i += 1;
            } else if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF) {
                if (i + 1 >= bytes.length) return false;
                if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF) return false;
                i += 2;
            } else if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF) {
                if (i + 2 >= bytes.length) return false;
                if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF) return false;
                if (bytes[i + 2] < 0x80 || bytes[i + 2] > 0xBF) return false;
                i += 3;
            } else if (bytes[i] >= 0xF0 && bytes[i] <= 0xF4) {
                if (i + 3 >= bytes.length) return false;
                if (bytes[i + 1] < 0x80 || bytes[i + 1] > 0xBF) return false;
                if (bytes[i + 2] < 0x80 || bytes[i + 2] > 0xBF) return false;
                if (bytes[i + 3] < 0x80 || bytes[i + 3] > 0xBF) return false;
                i += 4;
            } else {
                return false;
            }
        }
        return true;
    }

    // ファイル読込の統合管理 (CSV / Excel 対応)
    function handleFileLoad(file, teamKey) {
        if (!file) return;

        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target.result;
                if (isExcel) {
                    // Excelパース (SheetJS)
                    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    processParsedData(jsonData, teamKey);
                } else {
                    // CSVパース (文字コード自動判別)
                    const bytes = new Uint8Array(data);
                    const encoding = isUTF8(bytes) ? 'utf-8' : 'shift-jis';
                    const csvText = new TextDecoder(encoding).decode(bytes);
                    const lines = csvText.split(/\r?\n/);
                    const rows = lines.map(line => parseCsvLine(line.trim()));
                    processParsedData(rows, teamKey);
                }
                alert(`${teamKey ? teamKey.toUpperCase() : '両'}チームの選手データを読み込みました！`);
            } catch (err) {
                console.error(err);
                alert(`データ解析エラー: ${err.message}\nファイルフォーマットが正しいか確認してください。`);
            }
        };

        reader.readAsArrayBuffer(file);
    }

    // パースされた行データ（ヘッダー行＋データ行）を選手リストに反映する
    function processParsedData(rows, targetTeamKey) {
        if (!rows || rows.length < 2) return;

        const parsedList = [];
        // 1行目はヘッダーとしてスキップ
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || cols.length < 3) continue; // 最低限：背番号、ポジション、名前

            // 各列が undefined や空文字の場合の初期化
            const number = String(cols[0] !== undefined ? cols[0] : '').trim();
            const position = String(cols[1] !== undefined ? cols[1] : '').trim();
            const name = String(cols[2] !== undefined ? cols[2] : '').trim();
            if (!number || !position || !name) continue;

            const player = {
                number: number,
                position: position,
                name: name,
                team: targetTeamKey ? targetTeamKey.toUpperCase() : String(cols[5] || 'HOME').trim(),
                memo: String(cols[3] !== undefined ? cols[3] : '').trim(), // 4列目 (学年)
                comment: String(cols[4] !== undefined ? cols[4] : '').trim(), // 5列目 (一言コメント/備考)
                photoUrl: ''
            };
            parsedList.push(player);
        }

        // ソート（背番号順）
        parsedList.sort((a, b) => (parseInt(a.number) || 99) - (parseInt(b.number) || 99));

        if (targetTeamKey) {
            // 個別チームロードの場合
            players[targetTeamKey] = parsedList;
            initializeLineup(targetTeamKey);
        } else {
            // スプレッドシートURL（一括）ロードの場合
            const homeList = parsedList.filter(p => p.team.toUpperCase() !== 'AWAY');
            const awayList = parsedList.filter(p => p.team.toUpperCase() === 'AWAY');
            players.home = homeList;
            players.away = awayList;
            initializeLineup('home');
            initializeLineup('away');
        }

        renderPlayerTable();
    }

    // HOMEチーム個別ファイル読み込みのリスナー
    btnLoadSheetFileHome.addEventListener('click', () => {
        const file = inputSheetFileHome.files[0];
        if (!file) {
            alert('HOME用の選手データファイル(CSVまたはExcel)を選択してください。');
            return;
        }
        handleFileLoad(file, 'home');
    });

    // AWAYチーム個別ファイル読み込みのリスナー
    btnLoadSheetFileAway.addEventListener('click', () => {
        const file = inputSheetFileAway.files[0];
        if (!file) {
            alert('AWAY用の選手データファイル(CSVまたはExcel)を選択してください。');
            return;
        }
        handleFileLoad(file, 'away');
    });

    // スプレッドシートURL読み込み時のパース互換性維持用
    function parseCsvData(csvText) {
        const lines = csvText.split(/\r?\n/);
        const rows = lines.map(line => parseCsvLine(line.trim()));
        processParsedData(rows, null);
    }

    function parseCsvLine(line) {
        const result = [];
        let curVal = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(curVal.trim().replace(/^"|"$/g, ''));
                curVal = '';
            } else {
                curVal += char;
            }
        }
        result.push(curVal.trim().replace(/^"|"$/g, ''));
        return result;
    }

    // ==========================================================================
    // デモ（モック）データのロード機能
    // ==========================================================================

    const demoHomePlayers = [
        { number: '1', position: 'GK', name: '権田 修一', team: 'HOME', memo: '3年', comment: '守護神。圧倒的なシュートストップでゴールを守り抜く。' },
        { number: '2', position: 'DF', name: '山根 視来', team: 'HOME', memo: '3年', comment: '果敢なオーバーラップから決定機を演出する右サイドバック。' },
        { number: '3', position: 'DF', name: '谷口 彰悟', team: 'HOME', memo: '3年', comment: '冷静沈着なカバーリングと正確なビルドアップが持ち味。' },
        { number: '4', position: 'DF', name: '板倉 滉', team: 'HOME', memo: '2年', comment: '対人の強さと高いライン統率力で相手FWをシャットアウト。' },
        { number: '5', position: 'DF', name: '長友 佑都', team: 'HOME', memo: '3年', comment: '無尽蔵のスタミナと熱いパッションでチームを牽引する。' },
        { number: '6', position: 'MF', name: '遠藤 航', team: 'HOME', memo: '3年', comment: '中盤のフィルター。高いデュエル勝率を誇る大黒柱。' },
        { number: '7', position: 'MF', name: '田中 碧', team: 'HOME', memo: '2年', comment: 'ピッチ全体を走り回り、攻守のリンクマンとして機能。' },
        { number: '8', position: 'MF', name: '堂安 律', team: 'HOME', memo: '2年', comment: '強烈なカットインからの左足のシュートでゴールを狙う。' },
        { number: '10', position: 'MF', name: '南野 拓実', team: 'HOME', memo: '3年', comment: '鋭いターンとゴール前での質の高い動きで決定機を作る。' },
        { number: '9', position: 'FW', name: '前田 大然', team: 'HOME', memo: '2年', comment: '圧倒的なスプリント力で前線から激しいプレスをかけ続ける。' },
        { number: '11', position: 'FW', name: '浅野 拓磨', team: 'HOME', memo: '3年', comment: '裏への抜け出しのスピードで相手DFラインの背後を脅かす。' },
        { number: '12', position: 'GK', name: 'シュミット', team: 'HOME', memo: '1年', comment: '高身長を活かしたハイボール処理と足元の技術に優れる。' },
        { number: '15', position: 'DF', name: '伊藤 洋輝', team: 'HOME', memo: '2年', comment: '高精度な左足のフィードで前線へ決定的なパスを送る。' }
    ];

    const demoAwayPlayers = [
        { number: '1', position: 'GK', name: 'ノイアー', team: 'AWAY', memo: '3年', comment: '現代的GKの完成形。広い守備範囲と圧倒的な威圧感。' },
        { number: '2', position: 'DF', name: 'ウォーカー', team: 'AWAY', memo: '3年', comment: '圧倒的な快速を誇り、いかなる快速FWにも追いつく。' },
        { number: '3', position: 'DF', name: 'ルベン・ディアス', team: 'AWAY', memo: '3年', comment: '強固な守備力と強烈なキャプテンシーを持つCB。' },
        { number: '4', position: 'DF', name: 'ファン・ダイク', team: 'AWAY', memo: '3年', comment: '世界最高のセンターバック。空中戦でも絶対的な強さ。' },
        { number: '5', position: 'DF', name: 'デイヴィス', team: 'AWAY', memo: '2年', comment: '爆発的なスピードで左サイドを支配する快速DF。' },
        { number: '6', position: 'MF', name: 'キミッヒ', team: 'AWAY', memo: '3年', comment: '高精度なパスと類稀なる戦術眼でゲームを組み立てる。' },
        { number: '8', position: 'MF', name: 'クロース', team: 'AWAY', memo: '3年', comment: 'パスの成功率は常に9割を超えるドイツの頭脳。' },
        { number: '10', position: 'MF', name: 'モドリッチ', team: 'AWAY', memo: '3年', comment: 'アウトサイドパスの魔術師。ピッチを縦横無尽に駆ける。' },
        { number: '17', position: 'MF', name: 'デ・ブライネ', team: 'AWAY', memo: '3年', comment: '超高精度のラストパスを供給するアシストマシーン。' },
        { number: '9', position: 'FW', name: 'ハーランド', team: 'AWAY', memo: '2年', comment: '規格外 of サイズとスピード、決定力を持つ若き怪物。' },
        { number: '11', position: 'FW', name: 'ムバッペ', team: 'AWAY', memo: '2年', comment: '異次元 of スピードと高い得点力を併せ持つエース。' },
        { number: '12', position: 'GK', name: 'アリソン', team: 'AWAY', memo: '1年', comment: '抜群 of ポジショニングでシュートを難なく防ぐ守護神。' },
        { number: '14', position: 'DF', name: 'サリバ', team: 'AWAY', memo: '2年', comment: '冷静沈着な対応でピンチを未然に防ぐ実力派CB。' }
    ];

    btnLoadDemoHome.addEventListener('click', () => {
        players.home = [...demoHomePlayers];
        initializeLineup('home');
        inputHomeName.value = 'HOME TEAM';
        inputHomeSub.value = 'HOME';
        inputHomeColor.value = '#059669';
        // 仮のHOMEロゴとしてSVGプレースホルダー（nマーク風）を設定
        state.scoreboard.homeLogo = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,80 L20,30 C20,30 40,10 60,30 L60,80 M60,45 C60,40 75,30 80,45 L80,80" fill="none" stroke="%23059669" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        updateTeamNames();
        renderPlayerTable();
        alert('HOMEチームのデモ選手リストとチーム情報を読み込みました！');
    });

    btnLoadDemoAway.addEventListener('click', () => {
        players.away = [...demoAwayPlayers];
        initializeLineup('away');
        inputAwayName.value = 'AWAY TEAM';
        inputAwaySub.value = 'AWAY';
        inputAwayColor.value = '#1d4ed8';
        // 仮のAWAYロゴとしてSVGプレースホルダー（Cマーク風）を設定
        state.scoreboard.awayLogo = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M80,25 C70,12 40,12 30,25 C15,40 15,60 30,75 C40,88 70,88 80,75" fill="none" stroke="%231d4ed8" stroke-width="12" stroke-linecap="round"/></svg>';
        updateTeamNames();
        renderPlayerTable();
        alert('AWAYチームのデモ選手リストとチーム情報を読み込みました！');
    });

    // ==========================================================================
    // 選手一覧タブ＆テーブル表示・テロップ送信
    // ==========================================================================

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

    function initializeLineup(team) {
        if (!players[team]) return;
        players[team].forEach((p, index) => {
            if (p.lineup === undefined) {
                // サッカーは先発11人なので、最初の11人を先発に設定
                if (index < 11) {
                    p.lineup = 'starting';
                } else {
                    p.lineup = 'bench';
                }
            }
        });
    }

    function renderPlayerTable() {
        initializeLineup(currentTab);
        playerTableBody.innerHTML = '';
        const list = players[currentTab];

        if (list.length === 0) {
            playerTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-data">このチームの選手データはまだありません。<br>デモデータを読み込むか、スプレッドシートを連携してください。</td>
                </tr>
            `;
            return;
        }

        // 先発を上に、控えを下に配置。同ステータス内は背番号順
        const sortedList = [...list].sort((a, b) => {
            const statusA = a.lineup === 'starting' ? 0 : 1;
            const statusB = b.lineup === 'starting' ? 0 : 1;
            if (statusA !== statusB) return statusA - statusB;
            return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
        });

        sortedList.forEach(p => {
            const tr = document.createElement('tr');
            
            // 行のスタイル（スタメンと控えで色分け）
            if (p.lineup === 'starting') {
                tr.style.backgroundColor = 'rgba(16, 185, 129, 0.08)'; // 薄いグリーン
            } else {
                tr.style.backgroundColor = 'transparent';
            }

            // 1. 先発チェックボックス
            const tdStarting = document.createElement('td');
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = p.lineup === 'starting';
            chk.style.width = '20px';
            chk.style.height = '20px';
            chk.style.cursor = 'pointer';
            chk.addEventListener('change', (e) => {
                p.lineup = e.target.checked ? 'starting' : 'bench';
                renderPlayerTable();
            });
            tdStarting.appendChild(chk);
            tr.appendChild(tdStarting);
            
            // 2. 背番号
            const tdNo = document.createElement('td');
            tdNo.textContent = p.number;
            tdNo.style.fontWeight = 'bold';
            tdNo.style.fontFamily = "'Oswald', sans-serif";
            tr.appendChild(tdNo);
            
            // 3. ポジション
            const tdPos = document.createElement('td');
            tdPos.textContent = p.position;
            tr.appendChild(tdPos);
            
            // 4. 名前・詳細
            const tdName = document.createElement('td');
            tdName.innerHTML = `<div><strong>${p.name}</strong> <span style="font-size:11px;color:#38bdf8;font-weight:bold;margin-left:6px;">${p.memo || ''}</span></div><div style="font-size:11px;color:#94a3b8;margin-top:2px;">${p.comment || ''}</div>`;
            tr.appendChild(tdName);
            
            // 5. 操作
            const tdAction = document.createElement('td');
            const btn = document.createElement('button');
            btn.className = 'btn btn-action-telop';
            btn.textContent = 'テロップ表示';
            btn.addEventListener('click', () => {
                const duration = parseInt(selectTelopDuration.value);
                
                const resolvedPlayer = {
                    ...p,
                    team: p.team.toUpperCase() === 'AWAY' ? state.scoreboard.awayName : state.scoreboard.homeName,
                    teamColor: p.team.toUpperCase() === 'AWAY' ? state.scoreboard.awayColor : state.scoreboard.homeColor,
                    teamLogo: p.team.toUpperCase() === 'AWAY' ? state.scoreboard.awayLogo : state.scoreboard.homeLogo
                };

                broadcastMessage('SHOW_PLAYER_TELOP', {
                    player: resolvedPlayer,
                    duration: duration
                });
            });

            tdAction.appendChild(btn);
            tr.appendChild(tdAction);

            playerTableBody.appendChild(tr);
        });
        sendState();
    }

    // ==========================================================================
    // Googleスライド画像テロップ表示
    // ==========================================================================

    let localDragSlideDataUrl = ""; // ドラッグ＆ドロップで受け取った画像を保持

    btnShowImageTelop.addEventListener('click', () => {
        const duration = parseInt(selectImageDuration.value);

        // もしドラッグ＆ドロップされた画像があればそれを優先送信
        if (localDragSlideDataUrl) {
            broadcastMessage('SHOW_IMAGE_TELOP', {
                imageUrl: localDragSlideDataUrl,
                duration: duration
            });
            return;
        }

        const url = inputCustomImageUrl.value.trim();
        if (!url) {
            alert('表示する画像のURLを入力するか、画像をドロップしてください。');
            return;
        }

        // Googleスライドのプレビュー・編集URLが入力された場合、画像書き出し（PNG）URLに自動で変換するおもてなし
        let finalUrl = url;
        const slideIdMatch = url.match(/\/presentation\/d\/([a-zA-Z0-9-_]+)/);
        if (slideIdMatch) {
            const slideId = slideIdMatch[1];
            // pageidが含まれているかチェック
            const pageIdMatch = url.match(/slide=id\.([a-zA-Z0-9-_]+)/);
            const pageId = pageIdMatch ? pageIdMatch[1] : '';
            
            if (pageId) {
                // スライド全体の画像ではなく特定のページ画像をPNGでエクスポートするURL
                finalUrl = `https://docs.google.com/presentation/d/${slideId}/export/png?id=${slideId}&pageid=${pageId}`;
            } else {
                // pageidが取れなかった場合は最初のスライドを書き出す
                finalUrl = `https://docs.google.com/presentation/d/${slideId}/export/png`;
            }
        }

        broadcastMessage('SHOW_IMAGE_TELOP', {
            imageUrl: finalUrl,
            duration: duration
        });
    });

    // ローカル画像ファイルテロップ表示機能
    btnShowImageFileTelop.addEventListener('click', () => {
        const duration = parseInt(selectImageDuration.value);

        // ドラッグ＆ドロップされたデータがあれば優先送信
        if (localDragSlideDataUrl) {
            broadcastMessage('SHOW_IMAGE_TELOP', {
                imageUrl: localDragSlideDataUrl,
                duration: duration
            });
            return;
        }

        const file = inputCustomImageFile.files[0];
        if (!file) {
            alert('表示する画像ファイルを選択またはドロップしてください。');
            return;
        }

        btnShowImageFileTelop.textContent = '送信中...';
        btnShowImageFileTelop.disabled = true;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const dataUrl = e.target.result;

                broadcastMessage('SHOW_IMAGE_TELOP', {
                    imageUrl: dataUrl,
                    duration: duration
                });
            } catch (err) {
                console.error(err);
                alert(`エラー: ${err.message}`);
            } finally {
                btnShowImageFileTelop.textContent = 'ファイル送信';
                btnShowImageFileTelop.disabled = false;
            }
        };
        reader.onerror = (err) => {
            console.error(err);
            alert('ファイルの読み込み中にエラーが発生しました。');
            btnShowImageFileTelop.textContent = 'ファイル送信';
            btnShowImageFileTelop.disabled = false;
        };
        reader.readAsDataURL(file);
    });

    btnHideImageTelop.addEventListener('click', () => {
        broadcastMessage('HIDE_IMAGE_TELOP');
    });

    // 別窓でオーバーレイを開く
    document.getElementById('btn-open-overlay').addEventListener('click', () => {
        const win = window.open('soccer_overlay.html?v=8', 'soccer_overlay', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        if (win) {
            openedWindows.push(win);
            setTimeout(() => {
                win.postMessage({
                    type: 'UPDATE_STATE',
                    data: state
                }, '*');
            }, 500);
        }
    });

    // 初期値の適用
    inputHomeName.value = 'HOME TEAM';
    inputHomeSub.value = 'HOME';
    inputHomeColor.value = '#059669';
    inputAwayName.value = 'AWAY TEAM';
    inputAwaySub.value = 'AWAY';
    inputAwayColor.value = '#1d4ed8';
    inputTournament.value = '';

    // 初期化実行
    setupServerSync();
    updateTeamNames();
    renderPlayerTable();

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
        updateTeamNames();
    });

    // 2. アウェイロゴのドラッグ＆ドロップ
    setupDragAndDrop('away-logo-drop-zone', (dataUrl, fileName) => {
        state.scoreboard.awayLogo = dataUrl;
        const inputAwayLogoUrl = document.getElementById('input-away-logo-url');
        if (inputAwayLogoUrl) inputAwayLogoUrl.value = `[ドラッグ登録: ${fileName}]`;
        sendState();
        updateTeamNames();
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
        const winFill = window.open('soccer_overlay.html?mode=fill', 'soccer_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        const winKey = window.open('soccer_overlay.html?mode=key', 'soccer_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');

        if (!winFill || !winKey || winFill.closed || typeof winFill.closed === 'undefined' || winKey.closed || typeof winKey.closed === 'undefined') {
            alert("【お知らせ】ブラウザのポップアップブロックにより2枚目の画面が遮断されました。\n\nアドレスバー右端の「ポップアップがブロックされました」アイコンをクリックして「常に許可」を設定するか、ヘッダーの「🎬 Fill画面を開く」「🔲 Key画面を開く」ボタンをそれぞれクリックして2枚のウィンドウを開いてください。");
        }
    }

    const btnOpenDual = document.getElementById('btn-open-dual');
    if (btnOpenDual) btnOpenDual.addEventListener('click', openDualFillAndKey);

    const btnOpenFill = document.getElementById('btn-open-fill');
    if (btnOpenFill) {
        btnOpenFill.addEventListener('click', () => {
            window.open('soccer_overlay.html?mode=fill', 'soccer_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    const btnOpenKey = document.getElementById('btn-open-key');
    if (btnOpenKey) {
        btnOpenKey.addEventListener('click', () => {
            window.open('soccer_overlay.html?mode=key', 'soccer_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
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

    window.state = state;
    window.sendState = sendState;
    window.updateUI = updateUI;
    window.updateTimerDisplay = updateTimerDisplay;
    window.enablePkMode = enablePkMode;
    window.renderPkActions = renderPkActions;
    window.updatePkStatusText = updatePkStatusText;

    initStreamDeckHID();
    renderStreamDeckPreview();
    const previewEl = document.getElementById('streamdeck-keypad-preview');
    if (previewEl) previewEl.classList.remove('hidden');
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
// 🎮 Stream Deck USB直接接続 ＆ 自動認識・実機LCD描画 (サッカー完全対応)
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

function addPkTeamResult(team, result) {
    if (!state.pk) state.pk = { visible: true, homeResults: [], awayResults: [] };
    state.pk.visible = true;
    
    const togglePkModeEl = document.getElementById('toggle-pk-mode');
    if (togglePkModeEl) togglePkModeEl.checked = true;
    const pkPanelBody = document.getElementById('pk-panel-body');
    if (pkPanelBody) pkPanelBody.classList.remove('pk-disabled');

    const results = (team === 'home') ? state.pk.homeResults : state.pk.awayResults;
    results.push(result);

    if (typeof renderPkActions === 'function') renderPkActions();
    if (typeof updatePkStatusText === 'function') updatePkStatusText();
    sendState();
    updateUI();
    updateStreamDeckLCD();
}

// サッカー用15キー標準アクション定義 (5x3)
const SOCCER_STREAMDECK_ACTIONS = [
    // 1行目: HOME得点・PK・時計
    { keyIndex: 0, label: "HOME +1", sub: "GOAL!", bg: "#0369a1", action: () => { state.scoreboard.homeScore++; sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "HOME -1", sub: "取消", bg: "#0f172a", action: () => { state.scoreboard.homeScore = Math.max(0, state.scoreboard.homeScore - 1); sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "⚪ PK成功", sub: "HOME", bg: "#0284c7", action: () => { addPkTeamResult('home', 'success'); } },
    { keyIndex: 3, label: "❌ PK失敗", sub: "HOME", bg: "#0f172a", action: () => { addPkTeamResult('home', 'miss'); } },
    { keyIndex: 4, label: "⏱ START", sub: "STOP切替", bg: "#15803d", action: () => { if (typeof toggleTimer === 'function') toggleTimer(); } },

    // 2行目: AWAY得点・PK・ハーフ切替
    { keyIndex: 5, label: "AWAY +1", sub: "GOAL!", bg: "#991b1b", action: () => { state.scoreboard.awayScore++; sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "AWAY -1", sub: "取消", bg: "#0f172a", action: () => { state.scoreboard.awayScore = Math.max(0, state.scoreboard.awayScore - 1); sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 7, label: "⚪ PK成功", sub: "AWAY", bg: "#dc2626", action: () => { addPkTeamResult('away', 'success'); } },
    { keyIndex: 8, label: "❌ PK失敗", sub: "AWAY", bg: "#0f172a", action: () => { addPkTeamResult('away', 'miss'); } },
    { keyIndex: 9, label: "⚽ 前/後半", sub: "ハーフ切替", bg: "#4338ca", action: () => { togglePeriod(); } },

    // 3行目: 表示モード切替 + スタメン + 選手紹介 + 全面消去
    { keyIndex: 10, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { 
        state.scoreboard.displayMode = (state.scoreboard.displayMode === 'large' ? 'small' : 'large');
        state.scoreboard.visible = true;
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 11, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { 
        state.scoreboard.displayMode = (state.scoreboard.displayMode === 'vs' ? 'small' : 'vs');
        state.scoreboard.visible = true;
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 12, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { toggleLineupTelop('home'); } },
    { keyIndex: 13, label: "🚫 PK OFF", sub: "通常復帰", bg: "#0284c7", action: () => { disablePkMode(); } },
    { keyIndex: 14, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { 
        state.scoreboard.displayMode = 'none';
        state.scoreboard.visible = false;
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } }
];

// サッカー用32キー拡張アクション定義 (8x4: Stream Deck XL用)
const SOCCER_STREAMDECK_ACTIONS_32 = [
    // 1行目: HOME操作・PK・時計・AT
    { keyIndex: 0, label: "HOME +1", sub: "GOAL!", bg: "#0369a1", action: () => { state.scoreboard.homeScore++; sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "HOME -1", sub: "取消", bg: "#0f172a", action: () => { state.scoreboard.homeScore = Math.max(0, state.scoreboard.homeScore - 1); sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "⚪ PK成功", sub: "HOME", bg: "#0284c7", action: () => { addPkTeamResult('home', 'success'); } },
    { keyIndex: 3, label: "❌ PK失敗", sub: "HOME", bg: "#0f172a", action: () => { addPkTeamResult('home', 'miss'); } },
    { keyIndex: 4, label: "⏱ START", sub: "STOP切替", bg: "#15803d", action: () => { if (typeof toggleTimer === 'function') toggleTimer(); } },
    { keyIndex: 5, label: "⏱ AT +1", sub: "アディショナル", bg: "#334155", action: () => { 
        state.scoreboard.additionalTime = (state.scoreboard.additionalTime || 0) + 1; 
        const atEl = document.getElementById('input-at'); if (atEl) atEl.value = state.scoreboard.additionalTime;
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 6, label: "⏱ AT -1", sub: "アディショナル", bg: "#334155", action: () => { 
        state.scoreboard.additionalTime = Math.max(0, (state.scoreboard.additionalTime || 0) - 1); 
        const atEl = document.getElementById('input-at'); if (atEl) atEl.value = state.scoreboard.additionalTime;
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 7, label: "⏱ 後半開始", sub: "時間セット", bg: "#1e293b", action: () => { 
        const h = state.scoreboard.halfMinutes || 45;
        totalSeconds = h * 60; state.scoreboard.period = '2nd'; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = '2nd';
        updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },

    // 2行目: AWAY操作・PK・ピリオド
    { keyIndex: 8, label: "AWAY +1", sub: "GOAL!", bg: "#991b1b", action: () => { state.scoreboard.awayScore++; sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "AWAY -1", sub: "取消", bg: "#0f172a", action: () => { state.scoreboard.awayScore = Math.max(0, state.scoreboard.awayScore - 1); sendState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 10, label: "⚪ PK成功", sub: "AWAY", bg: "#dc2626", action: () => { addPkTeamResult('away', 'success'); } },
    { keyIndex: 11, label: "❌ PK失敗", sub: "AWAY", bg: "#0f172a", action: () => { addPkTeamResult('away', 'miss'); } },
    { keyIndex: 12, label: "⚽ 前/後半", sub: "ハーフ切替", bg: "#4338ca", action: () => { togglePeriod(); } },
    { keyIndex: 13, label: "前半", sub: "ピリオド", bg: "#1e293b", action: () => { 
        state.scoreboard.period = '1st'; totalSeconds = 0; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = '1st';
        updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 14, label: "後半", sub: "ピリオド", bg: "#1e293b", action: () => { 
        const h = state.scoreboard.halfMinutes || 45;
        state.scoreboard.period = '2nd'; totalSeconds = h * 60; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = '2nd';
        updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 15, label: "PK戦", sub: "PKモード", bg: "#4338ca", action: () => { 
        state.scoreboard.period = 'PK'; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = 'PK';
        if (typeof enablePkMode === 'function') enablePkMode(true); 
        updateStreamDeckLCD(); 
    } },

    // 3行目: 延長・表示画面切替
    { keyIndex: 16, label: "延前", sub: "延長前半", bg: "#1e293b", action: () => { 
        const h = state.scoreboard.halfMinutes || 45;
        state.scoreboard.period = 'EX1'; totalSeconds = h * 2 * 60; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = 'EX1';
        updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 17, label: "延後", sub: "延長後半", bg: "#1e293b", action: () => { 
        const h = state.scoreboard.halfMinutes || 45;
        state.scoreboard.period = 'EX2'; totalSeconds = (h * 2 + 15) * 60; 
        const sp = document.getElementById('select-period'); if (sp) sp.value = 'EX2';
        updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 18, label: "📺 得点(大)", sub: "画面切替", bg: "#334155", action: () => { 
        state.scoreboard.displayMode = 'large'; state.scoreboard.visible = true; 
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 19, label: "📺 得点(小)", sub: "画面切替", bg: "#334155", action: () => { 
        state.scoreboard.displayMode = 'small'; state.scoreboard.visible = true; 
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 20, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { 
        state.scoreboard.displayMode = 'vs'; state.scoreboard.visible = true; 
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 21, label: "📋 HOME名簿", sub: "スタメン", bg: "#047857", action: () => { toggleLineupTelop('home'); } },
    { keyIndex: 22, label: "📋 AWAY名簿", sub: "スタメン", bg: "#047857", action: () => { toggleLineupTelop('away'); } },
    { keyIndex: 23, label: "🖼 スライド", sub: "全画面静止画", bg: "#0d9488", action: () => { updateStreamDeckLCD(); } },

    // 4行目: 特殊送出・選手テロップ・消去
    { keyIndex: 24, label: "🚫 PK OFF", sub: "通常復帰", bg: "#0284c7", action: () => { disablePkMode(); } },
    { keyIndex: 25, label: "👤 注目選手2", sub: "AWAY紹介", bg: "#b45309", action: () => { toggleFirstPlayerTelop('away'); } },
    { keyIndex: 26, label: "🔄 選手交代", sub: "テロップ", bg: "#0284c7", action: () => { toggleFirstPlayerTelop('home'); } },
    { keyIndex: 27, label: "👤 HOME交代", sub: "テロップ", bg: "#0284c7", action: () => { toggleFirstPlayerTelop('home'); } },
    { keyIndex: 28, label: "👤 AWAY交代", sub: "テロップ", bg: "#0284c7", action: () => { toggleFirstPlayerTelop('away'); } },
    { keyIndex: 29, label: "⏱ リセット", sub: "時計00:00", bg: "#7f1d1d", action: () => { 
        totalSeconds = 0; updateTimerDisplay(); sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 30, label: "🚫 テロップOFF", sub: "選手消去", bg: "#334155", action: () => { 
        if (broadcastMessage) broadcastMessage('HIDE_PLAYER_TELOP');
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 31, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { 
        state.scoreboard.displayMode = 'none'; state.scoreboard.visible = false; 
        sendState(); updateUI(); updateStreamDeckLCD(); 
    } }
];

let activeKeyActions = SOCCER_STREAMDECK_ACTIONS;

function disablePkMode() {
    if (state.pk) {
        state.pk.visible = false;
        state.pk.homeResults = [];
        state.pk.awayResults = [];
        state.pk.currentIndex = 0;
        state.pk.currentTeam = state.pk.firstTeam || 'home';
    }
    if (typeof enablePkMode === 'function') enablePkMode(false);
    const togglePkModeEl = document.getElementById('toggle-pk-mode');
    if (togglePkModeEl) togglePkModeEl.checked = false;
    const pkPanelBody = document.getElementById('pk-panel-body');
    if (pkPanelBody) pkPanelBody.classList.add('pk-disabled');
    if (state.scoreboard && state.scoreboard.period === 'PK') {
        state.scoreboard.period = '1st';
        const sp = document.getElementById('select-period');
        if (sp) sp.value = '1st';
    }
    if (typeof renderPkActions === 'function') renderPkActions();
    if (typeof updatePkStatusText === 'function') updatePkStatusText();
    sendState();
    updateUI();
    updateStreamDeckLCD();
}

function togglePeriod() {
    if (!state || !state.scoreboard) return;
    const p = state.scoreboard.period;
    const h = state.scoreboard.halfMinutes || 45;
    if (p === '1st' || p === '前半') {
        state.scoreboard.period = '2nd';
        totalSeconds = h * 60;
    } else if (p === '2nd' || p === '後半') {
        state.scoreboard.period = 'EX1';
        totalSeconds = h * 2 * 60;
    } else if (p === 'EX1' || p === '延前') {
        state.scoreboard.period = 'EX2';
        totalSeconds = (h * 2 + 15) * 60;
    } else if (p === 'EX2' || p === '延後') {
        state.scoreboard.period = 'PK';
        if (typeof enablePkMode === 'function') enablePkMode(true);
    } else {
        state.scoreboard.period = '1st';
        totalSeconds = 0;
    }
    const selectPeriodEl = document.getElementById('select-period');
    if (selectPeriodEl) selectPeriodEl.value = state.scoreboard.period;
    if (typeof updateTimerDisplay === 'function') updateTimerDisplay();
    sendState();
    updateUI();
    updateStreamDeckLCD();
}

function toggleLineupTelop(teamKey = 'home') {
    if (!state || !state.scoreboard) return;
    const targetMode = teamKey === 'away' ? 'lineup-away' : 'lineup-home';
    if (state.scoreboard.displayMode === targetMode) {
        state.scoreboard.displayMode = 'small';
    } else {
        state.scoreboard.displayMode = targetMode;
        state.scoreboard.visible = true;
    }
    sendState();
    updateUI();
    updateStreamDeckLCD();
}

function toggleFirstPlayerTelop(teamKey = 'home') {
    const pList = (players && players[teamKey] && players[teamKey].length > 0) ? players[teamKey] : [];
    if (pList.length === 0) return;
    const p = pList[0];
    const resolvedPlayer = {
        ...p,
        team: teamKey === 'away' ? state.scoreboard.awayName : state.scoreboard.homeName,
        teamColor: teamKey === 'away' ? state.scoreboard.awayColor : state.scoreboard.homeColor,
        teamLogo: teamKey === 'away' ? state.scoreboard.awayLogo : state.scoreboard.homeLogo
    };
    if (typeof broadcastMessage === 'function') {
        broadcastMessage('SHOW_PLAYER_TELOP', {
            player: resolvedPlayer,
            duration: 10
        });
    }
    updateStreamDeckLCD();
}

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
            activeKeyActions = SOCCER_STREAMDECK_ACTIONS_32;
        } else {
            activeKeyActions = SOCCER_STREAMDECK_ACTIONS;
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
        info.innerHTML = '※USBで接続されるとWeb HID経由で自動認識され、GOAL・タイマー等のキー割り振りとLCD描画が自動起動します。';
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
        if (k.label.includes('START') && typeof timerInterval !== 'undefined' && timerInterval !== null) bgColor = '#16a34a';
        if (k.label.includes('OFF') && state && state.scoreboard && (state.scoreboard.displayMode === 'hidden' || state.scoreboard.displayMode === 'none')) bgColor = '#dc2626';

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

        if (k.label.includes('START') && typeof timerInterval !== 'undefined' && timerInterval !== null) {
            keyBtn.style.background = '#15803d';
            keyBtn.style.borderColor = '#22c55e';
        }
        if (k.label.includes('OFF') && state && state.scoreboard && (state.scoreboard.displayMode === 'hidden' || state.scoreboard.displayMode === 'none')) {
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
