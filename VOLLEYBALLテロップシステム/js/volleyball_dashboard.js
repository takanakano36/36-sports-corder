// volleyball_dashboard.js

// ==========================================================================
// 状態管理 (State) - デフォルトは3セットマッチ
// ==========================================================================
let state = {
    gameMode: 'indoor', // 'indoor' | 'beach'
    matchType: '3set',  // デフォルト3セットマッチ
    challengeVisible: true, // チャレンジインジケーター表示ON/OFF
    timelineVisible: false, // 得点経過タイムライン表示ON/OFF (デフォルトOFF)
    homeName: 'HOME TEAM',
    awayName: 'AWAY TEAM',
    homeColor: '#0ea5e9',
    awayColor: '#f97316',
    homeLogo: '',
    awayLogo: '',
    homeScore: 0,
    awayScore: 0,
    homeSets: 0,
    awaySets: 0,
    homeTO: 2,         // インドアは初期値2、ビーチは1
    awayTO: 2,
    homeChallenge: 2,
    awayChallenge: 2,
    serve: null,       // 'home' | 'away' | null
    displayMode: 'large', // 'large' | 'small' | 'ransko' | 'vs' | 'hidden'
    lineupVisible: false, // スタメン表示
    lineupTeam: 'home',   // スタメン表示対象
    tournamentName: '',
    chromakey: 'transparent',
    fullscreenSlide: '',
    
    // セット別のランニングスコア内訳
    homeScoreS1: 0, homeScoreS2: 0, homeScoreS3: 0, homeScoreS4: 0, homeScoreS5: 0,
    awayScoreS1: 0, awayScoreS2: 0, awayScoreS3: 0, awayScoreS4: 0, awayScoreS5: 0,
    
    // 得点経過スタック（最大15個）
    scoreHistory: [],  // [{team: 'home'|'away', points: number}]
    
    courtSwitchAlert: false,
    courtSwitchCount: 0,
    
    // 選手データ (一言コメント: comment を追加)
    players: {
        home: [],
        away: []
    }
};

// デフォルト選手データ
const DEFAULT_PLAYERS = {
    home: [
        { number: '1', position: 'S', name: '山田 太郎', comment: '正確なトスワーク', memo: '大4', starter: true },
        { number: '3', position: 'OH', name: '佐藤 次郎', comment: '豪快なスパイク', memo: '大3', starter: true },
        { number: '5', position: 'OH', name: '鈴木 三郎', comment: '堅実なレシーブ', memo: '大2', starter: true },
        { number: '7', position: 'MB', name: '高橋 四郎', comment: '鉄壁のブロック', memo: '大4', starter: true },
        { number: '9', position: 'MB', name: '田中 五郎', comment: '俊敏なクイック', memo: '大3', starter: true },
        { number: '11', position: 'OP', name: '渡辺 六郎', comment: '強力なサーブ', memo: '大1', starter: true },
        { number: '12', position: 'L', name: '伊藤 七郎', comment: '守護神リベロ', memo: '大2', starter: true }
    ],
    away: [
        { number: '2', position: 'S', name: 'スミス ジョン', comment: '冷静沈着な司令塔', memo: '大3', starter: true },
        { number: '4', position: 'OH', name: 'ブラウン アレックス', comment: '高さのあるスパイク', memo: '大4', starter: true },
        { number: '6', position: 'OH', name: 'マーフィー クリス', comment: '変幻自在のサーブ', memo: '大3', starter: true },
        { number: '8', position: 'MB', name: 'デイビス ジョージ', comment: '鋭いブロック', memo: '大2', starter: true },
        { number: '10', position: 'MB', name: 'ミラー ケビン', comment: '高い守備範囲', memo: '大4', starter: true },
        { number: '12', position: 'OP', name: 'ジョーンズ マイケル', comment: 'スピードアタッカー', memo: '大1', starter: true },
        { number: '14', position: 'L', name: 'ウイルソン ポール', comment: '驚異の反応速度', memo: '大2', starter: true }
    ]
};

// ==========================================================================
// 同期通信 (SSE & BroadcastChannel ハイブリッド)
// ==========================================================================
const CHANNEL_NAME = 'sports_overlay_channel_volleyball';
const SERVER_URL = 'http://localhost:3005';
let syncMode = 'local'; // 'sse' | 'local'
let broadcastChannel = null;
let sseSource = null;
let overlayWindow = null;

function initSync() {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

    // SSEの接続テスト
    sseSource = new EventSource(`${SERVER_URL}/api/events`);
    
    sseSource.addEventListener('init', (e) => {
        console.log('[Dashboard] SSE Connected (init).');
        syncMode = 'sse';
        updateConnectionStatus(true);
        // サーバー側の初期stateを読み込む
        state = JSON.parse(e.data);
        updateUI();
    });

    sseSource.addEventListener('state', (e) => {
        state = JSON.parse(e.data);
        updateUI();
    });

    sseSource.onerror = () => {
        console.warn('[Dashboard] SSE connection failed. Fallback to Local/BroadcastChannel.');
        syncMode = 'local';
        updateConnectionStatus(false);
        if (sseSource) sseSource.close();
    };

    // BroadcastChannel からの受信 (他画面やローカルでの同期受信用)
    broadcastChannel.onmessage = (event) => {
        if (syncMode === 'local') {
            const msg = event.data;
            if (msg && msg.type === 'UPDATE_STATE') {
                state = { ...state, ...msg.state };
                updateUI();
            }
        }
    };
}

function updateConnectionStatus(isSSE) {
    const badge = document.getElementById('connection-status');
    if (!badge) return;
    if (isSSE) {
        badge.className = 'connection-badge connected';
        badge.innerHTML = '<span class="status-dot">●</span> サーバー接続中 (SSE/Port 3005)';
    } else {
        badge.className = 'connection-badge fallback';
        badge.innerHTML = '<span class="status-dot">●</span> ローカル同期中 (BroadcastChannel)';
    }
}

function broadcastState() {
    if (syncMode === 'sse') {
        fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'UPDATE_STATE', state })
        }).catch(err => {
            console.error('[Dashboard] Failed to send state to server:', err);
            // サーバーエラー時はローカルフォールバック
            syncMode = 'local';
            updateConnectionStatus(false);
            broadcastLocalState();
        });
    } else {
        broadcastLocalState();
    }
}

function broadcastLocalState() {
    if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'UPDATE_STATE', state });
    }
    const iframe = document.getElementById('preview-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'UPDATE_STATE', state }, '*');
    }
    if (overlayWindow && !overlayWindow.closed) {
        overlayWindow.postMessage({ type: 'UPDATE_STATE', state }, '*');
    }
}

function openOverlay() {
    overlayWindow = window.open('volleyball_overlay.html', 'volleyball_overlay', 'width=1920,height=1080');
    setTimeout(syncAll, 500);
}

function syncAll() {
    broadcastState();
    updateUI();
}

const POSITION_RANK = {
    'S': 1, 'セッター': 1,
    'OH': 2, 'アウトサイドヒッター': 2, 'レフト': 2,
    'OP': 3, 'オポジット': 3, 'ライト': 3,
    'MB': 4, 'ミドルブロッカー': 4, 'センター': 4,
    'L': 5, 'リベロ': 5,
    '': 99
};

function getPositionRank(pos) {
    if (!pos) return 99;
    const p = pos.toUpperCase();
    return POSITION_RANK[p] || 99;
}

function resizePreviewIframe() {
    const wrap = document.querySelector('.iframe-container');
    const iframe = document.getElementById('preview-iframe');
    if (!wrap || !iframe) return;
    
    const wrapW = wrap.clientWidth;
    const wrapH = wrapW * (9 / 16);
    wrap.style.height = `${wrapH}px`;
    
    const scale = wrapW / 1920;
    
    iframe.style.width = '1920px';
    iframe.style.height = '1080px';
    iframe.style.transform = `scale(${scale})`;
    iframe.style.transformOrigin = 'top left';
}

// ==========================================================================
// 初期化 ＆ イベント登録
// ==========================================================================
let currentTabTeam = 'home';

document.addEventListener('DOMContentLoaded', () => {
    initSync();
    window.addEventListener('resize', resizePreviewIframe);
    setInterval(resizePreviewIframe, 500);

    const stored = localStorage.getItem('volleyball_players');
    if (stored) {
        state.players = JSON.parse(stored);
    } else {
        state.players = JSON.parse(JSON.stringify(DEFAULT_PLAYERS));
        savePlayers();
    }

    document.getElementById('btn-open-overlay').addEventListener('click', openOverlay);

    // 競技・マッチ切替
    document.getElementById('btn-mode-indoor').addEventListener('click', () => setGameMode('indoor'));
    document.getElementById('btn-mode-beach').addEventListener('click', () => setGameMode('beach'));
    document.getElementById('btn-match-3set').addEventListener('click', () => setMatchType('3set'));
    document.getElementById('btn-match-5set').addEventListener('click', () => setMatchType('5set'));

    // チャレンジ表示切替
    document.getElementById('btn-challenge-on').addEventListener('click', () => toggleChallengeVisible(true));
    document.getElementById('btn-challenge-off').addEventListener('click', () => toggleChallengeVisible(false));

    // 得点経過表示切替 (デフォルトOFF)
    const btnTimelineToggle = document.getElementById('btn-timeline-toggle');
    if (btnTimelineToggle) {
        btnTimelineToggle.addEventListener('click', () => {
            toggleTimelineVisible(!state.timelineVisible);
        });
    }
    const btnTimeOn = document.getElementById('btn-timeline-on');
    const btnTimeOff = document.getElementById('btn-timeline-off');
    if (btnTimeOn) btnTimeOn.addEventListener('click', () => toggleTimelineVisible(true));
    if (btnTimeOff) btnTimeOff.addEventListener('click', () => toggleTimelineVisible(false));

    // チーム名・大会名
    document.getElementById('home-name-in').addEventListener('input', (e) => { state.homeName = e.target.value; broadcastState(); updateUI(); });
    document.getElementById('away-name-in').addEventListener('input', (e) => { state.awayName = e.target.value; broadcastState(); updateUI(); });
    document.getElementById('tournament-name-in').addEventListener('input', (e) => { state.tournamentName = e.target.value; broadcastState(); updateUI(); });

    // チームカラー
    document.getElementById('home-color-in').addEventListener('input', (e) => { state.homeColor = e.target.value; broadcastState(); });
    document.getElementById('away-color-in').addEventListener('input', (e) => { state.awayColor = e.target.value; broadcastState(); });

    // スコア加算/減算
    setupScoreCounter('home');
    setupScoreCounter('away');

    // 獲得セット数
    document.getElementById('btn-home-set-add').addEventListener('click', () => { state.homeSets = Math.min(5, state.homeSets + 1); broadcastState(); updateUI(); });
    document.getElementById('btn-home-set-sub').addEventListener('click', () => { state.homeSets = Math.max(0, state.homeSets - 1); broadcastState(); updateUI(); });
    document.getElementById('btn-away-set-add').addEventListener('click', () => { state.awaySets = Math.min(5, state.awaySets + 1); broadcastState(); updateUI(); });
    document.getElementById('btn-away-set-sub').addEventListener('click', () => { state.awaySets = Math.max(0, state.awaySets - 1); broadcastState(); updateUI(); });

    updateTimeoutEditor();

    // サーブ権
    document.getElementById('btn-home-serve').addEventListener('click', () => toggleServe('home'));
    document.getElementById('btn-away-serve').addEventListener('click', () => toggleServe('away'));

    // コートチェンジクリア
    document.getElementById('btn-clear-court-alert').addEventListener('click', () => {
        state.courtSwitchAlert = false;
        state.courtSwitchCount++;
        broadcastState();
        updateUI();
        logAction(`コートチェンジ完了確認 (通算 ${state.courtSwitchCount} 回目)`);
    });

    // 得点経過タイムライン操作
    document.getElementById('btn-undo-score').addEventListener('click', undoLatestScore);
    document.getElementById('btn-reset-timeline').addEventListener('click', () => {
        state.scoreHistory = [];
        broadcastState();
        updateUI();
        logAction('得点経過履歴をリセットしました');
    });

    // セットスコア確定
    document.getElementById('btn-add-set-score').addEventListener('click', commitCurrentSetScore);
    document.getElementById('btn-clear-set-score').addEventListener('click', clearAllSetScores);

    bindSetScoreInputs();

    // ドラッグ＆ドロップによるロゴ登録 (即時プレビュー対応)
    setupLogoDragAndDrop('home');
    setupLogoDragAndDrop('away');

    setupSlideDragAndDrop();

    document.getElementById('btn-send-slide').addEventListener('click', () => {
        if (state.fullscreenSlide) {
            state.displayMode = 'fullscreen_slide';
            broadcastState();
            updateUI();
            logAction('スライド画像を送出しました');
        } else {
            alert('ドロップされた画像がありません。');
        }
    });
    document.getElementById('btn-clear-slide').addEventListener('click', () => {
        state.displayMode = 'hidden';
        broadcastState();
        updateUI();
        logAction('スライド画像を非表示にしました');
    });

    // クロマキー背景制御
    const chromaBtns = document.querySelectorAll('.btn-chroma');
    chromaBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            chromaBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.chromakey = btn.dataset.chroma;
            
            const iframe = document.getElementById('preview-iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({ type: 'CHROMAKEY', key: state.chromakey }, '*');
            }
            broadcastState();
            logAction(`クロマキー背景変更: ${state.chromakey}`);
        });
    });

    // ディスプレイモード切替ボタン
    document.querySelectorAll('.display-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.displayMode = btn.getAttribute('data-mode');
            broadcastState();
            updateUI();
            logAction(`表示モード変更: ${state.displayMode}`);
        });
    });

    // スタメン制御
    document.getElementById('btn-toggle-lineup').addEventListener('click', () => {
        state.lineupVisible = !state.lineupVisible;
        state.lineupTeam = document.getElementById('lineup-team-select').value;
        broadcastState();
        updateUI();
        logAction(`スタメン表示トグル: ${state.lineupVisible ? 'ON AIR' : 'OFF'}`);
    });
    document.getElementById('lineup-team-select').addEventListener('change', (e) => {
        state.lineupTeam = e.target.value;
        if (state.lineupVisible) {
            broadcastState();
            updateUI();
        }
    });

    // 選手紹介手動非表示 (OFF) イベントのバインド
    document.getElementById('btn-hide-player').addEventListener('click', () => {
        bc.postMessage({ type: 'HIDE_PLAYER', data: {} });
        if (overlayWindow && !overlayWindow.closed) {
            overlayWindow.postMessage({ type: 'HIDE_PLAYER', data: {} }, '*');
        }
        logAction('[ワンショット] 選手紹介非表示にしました');
    });

    // 選手エディタのタブ切り替え
    const tabHome = document.getElementById('tab-home');
    const tabAway = document.getElementById('tab-away');
    tabHome.addEventListener('click', () => {
        currentTabTeam = 'home';
        tabHome.classList.add('active');
        tabAway.classList.remove('active');
        renderPlayerListEditor();
    });
    tabAway.addEventListener('click', () => {
        currentTabTeam = 'away';
        tabAway.classList.add('active');
        tabHome.classList.remove('active');
        renderPlayerListEditor();
    });

    // 選手追加 (一言欄 comment: '' を追加)
    document.getElementById('btn-add-player').addEventListener('click', () => {
        state.players[currentTabTeam].push({
            number: '99',
            position: 'OH',
            name: '新規選手',
            comment: '',
            memo: '1年',
            starter: false
        });
        savePlayers();
        renderPlayerListEditor();
        broadcastState();
    });

    // EXCELインポート処理
    document.getElementById('btn-excel-import').addEventListener('click', executeExcelImport);

    // CSV/Excelファイル読込 & ドラッグ&ドロップ
    const btnLoadPlayerFile = document.getElementById('btn-load-player-file');
    const inputPlayerFile = document.getElementById('input-player-file');
    if (btnLoadPlayerFile && inputPlayerFile) {
        btnLoadPlayerFile.addEventListener('click', () => {
            const file = inputPlayerFile.files[0];
            if (!file) {
                alert('CSV/Excelファイルを選択してください。');
                return;
            }
            processVolleyballPlayerFile(file);
        });
    }
    const playerFileDropZone = document.getElementById('player-file-drop-zone');
    if (playerFileDropZone) {
        playerFileDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            playerFileDropZone.style.borderColor = '#38bdf8';
            playerFileDropZone.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
        });
        playerFileDropZone.addEventListener('dragleave', () => {
            playerFileDropZone.style.borderColor = '#475569';
            playerFileDropZone.style.backgroundColor = 'transparent';
        });
        playerFileDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            playerFileDropZone.style.borderColor = '#475569';
            playerFileDropZone.style.backgroundColor = 'transparent';
            const file = e.dataTransfer.files[0];
            if (file) processVolleyballPlayerFile(file);
        });
    }

    // 初期起動 (デフォルトを3セットマッチに変更)
    setGameMode('indoor');
    setMatchType('3set');
    updateUI();
    logAction('バレーボールシステムが起動しました。');

    window.state = state;
    window.broadcastState = broadcastState;
    window.syncState = broadcastState;
    window.updateUI = updateUI;
    window.addPoint = addPoint;
    window.subPoint = subPoint;
    window.addSet = addSet;
    window.subSet = subSet;
    window.triggerTimeout = triggerTimeout;
    window.triggerChallenge = triggerChallenge;

    initStreamDeckHID();
    renderStreamDeckPreview();
    const previewEl = document.getElementById('streamdeck-keypad-preview');
    if (previewEl) previewEl.classList.remove('hidden');
});

// ==========================================================================
// コア操作処理
// ==========================================================================

function logAction(msg, isScore = false) {
    const box = document.getElementById('op-log-box');
    const time = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'op-log-entry' + (isScore ? ' score' : '');
    div.textContent = `[${time}] ${msg}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function savePlayers() {
    localStorage.setItem('volleyball_players', JSON.stringify(state.players));
}

function setGameMode(mode) {
    state.gameMode = mode;
    if (mode === 'indoor') {
        document.getElementById('btn-mode-indoor').classList.add('active');
        document.getElementById('btn-mode-beach').classList.remove('active');
        state.homeTO = 2;
        state.awayTO = 2;
        logAction('競技モード: インドアバレーボールに切り替えました');
    } else {
        document.getElementById('btn-mode-indoor').classList.remove('active');
        document.getElementById('btn-mode-beach').classList.add('active');
        state.homeTO = 1;
        state.awayTO = 1;
        logAction('競技モード: ビーチバレーに切り替えました');
    }
    state.courtSwitchAlert = false;
    state.courtSwitchCount = 0;
    updateUI();
    broadcastState();
}

function setMatchType(type) {
    state.matchType = type;
    if (type === '3set') {
        document.getElementById('btn-match-3set').classList.add('active');
        document.getElementById('btn-match-5set').classList.remove('active');
    } else {
        document.getElementById('btn-match-3set').classList.remove('active');
        document.getElementById('btn-match-5set').classList.add('active');
    }
    updateUI();
    broadcastState();
}

function toggleChallengeVisible(visible) {
    state.challengeVisible = visible;
    if (visible) {
        document.getElementById('btn-challenge-on').classList.add('active');
        document.getElementById('btn-challenge-off').classList.remove('active');
        document.getElementById('home-challenge-ctrl-row').style.display = 'flex';
        document.getElementById('away-challenge-ctrl-row').style.display = 'flex';
    } else {
        document.getElementById('btn-challenge-on').classList.remove('active');
        document.getElementById('btn-challenge-off').classList.add('active');
        document.getElementById('home-challenge-ctrl-row').style.display = 'none';
        document.getElementById('away-challenge-ctrl-row').style.display = 'none';
    }
    logAction(`チャレンジ表示: ${visible ? 'ON' : 'OFF'}`);
    updateUI();
    broadcastState();
}

function toggleTimelineVisible(visible) {
    state.timelineVisible = visible;
    const btnOn = document.getElementById('btn-timeline-on');
    const btnOff = document.getElementById('btn-timeline-off');
    if (btnOn && btnOff) {
        if (visible) {
            btnOn.classList.add('active');
            btnOff.classList.remove('active');
        } else {
            btnOn.classList.remove('active');
            btnOff.classList.add('active');
        }
    }
    logAction(`得点推移表示: ${visible ? 'ON' : 'OFF'}`);
    updateUI();
    broadcastState();
}

// スコア増減操作
function addPoint(team) {
    const pKey = team === 'home' ? 'homeScore' : 'awayScore';
    state[pKey]++;
    state.serve = team;
    
    state.scoreHistory.push({
        team: team,
        points: state[pKey]
    });
    if (state.scoreHistory.length > 15) {
        state.scoreHistory.shift();
    }
    
    logAction(`${team === 'home' ? state.homeName : state.awayName} が得点: ${state[pKey]}点`, true);
    checkBeachCourtSwitch();
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function subPoint(team) {
    const pKey = team === 'home' ? 'homeScore' : 'awayScore';
    if (state[pKey] > 0) {
        state[pKey]--;
        state.scoreHistory.pop();
        logAction(`${team === 'home' ? state.homeName : state.awayName} の得点取消: ${state[pKey]}点`);
    }
    state.courtSwitchAlert = false;
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function addSet(team) {
    const sKey = team === 'home' ? 'homeSets' : 'awaySets';
    state[sKey] = (state[sKey] || 0) + 1;
    logAction(`${team === 'home' ? state.homeName : state.awayName} がセット獲得: ${state[sKey]}セット`);
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function subSet(team) {
    const sKey = team === 'home' ? 'homeSets' : 'awaySets';
    state[sKey] = Math.max(0, (state[sKey] || 0) - 1);
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function triggerTimeout(team) {
    const toKey = team === 'home' ? 'homeTO' : 'awayTO';
    if (state[toKey] > 0) {
        state[toKey]--;
        logAction(`${team === 'home' ? state.homeName : state.awayName} がタイムアウト使用 (残り${state[toKey]}回)`);
    } else {
        state[toKey] = state.gameMode === 'indoor' ? 2 : 1;
    }
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function triggerChallenge(team) {
    const cKey = team === 'home' ? 'homeChallenge' : 'awayChallenge';
    if (state[cKey] > 0) {
        state[cKey]--;
        logAction(`${team === 'home' ? state.homeName : state.awayName} がチャレンジ使用 (残り${state[cKey]}回)`);
    } else {
        state[cKey] = 2;
    }
    broadcastState();
    updateUI();
    if (typeof updateStreamDeckLCD === 'function') updateStreamDeckLCD();
}

function setupScoreCounter(team) {
    document.getElementById(`btn-${team}-p1`).addEventListener('click', () => addPoint(team));
    document.getElementById(`btn-${team}-m1`).addEventListener('click', () => subPoint(team));
}

function updateTimeoutEditor() {
    const renderTODots = (containerId, count, max, propertyKey) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < max; i++) {
            const btn = document.createElement('button');
            btn.className = 'timeout-dot-btn' + (i < count ? ' active' : '');
            btn.addEventListener('click', () => {
                const newCount = (i === count - 1) ? i : i + 1;
                state[propertyKey] = newCount;
                broadcastState();
                updateUI();
            });
            container.appendChild(btn);
        }
    };

    const maxTO = state.gameMode === 'indoor' ? 2 : 1;
    renderTODots('home-timeout-dots-editor', state.homeTO, maxTO, 'homeTO');
    renderTODots('away-timeout-dots-editor', state.awayTO, maxTO, 'awayTO');

    renderTODots('home-challenge-dots-editor', state.homeChallenge, 2, 'homeChallenge');
    renderTODots('away-challenge-dots-editor', state.awayChallenge, 2, 'awayChallenge');
}

function toggleServe(team) {
    if (state.serve === team) {
        state.serve = null;
        logAction('サーブ権クリア');
    } else {
        state.serve = team;
        logAction(`サーブ権: ${team === 'home' ? state.homeName : state.awayName}`);
    }
    broadcastState();
    updateUI();
}

function checkBeachCourtSwitch() {
    if (state.gameMode !== 'beach') return;
    const total = state.homeScore + state.awayScore;
    if (total === 0) return;
    
    const setNum = state.homeSets + state.awaySets + 1;
    const isFinal = (state.matchType === '3set' && setNum === 3) || (state.matchType === '5set' && setNum === 5);
    const divisor = isFinal ? 5 : 7;
    
    if (total % divisor === 0) {
        state.courtSwitchAlert = true;
        logAction(`【コートチェンジ警告】合計得点 ${total} 点 (${divisor}の倍数)`);
    }
}

function undoLatestScore() {
    if (state.scoreHistory.length === 0) return;
    const last = state.scoreHistory.pop();
    if (last.team === 'home' && state.homeScore > 0) {
        state.homeScore--;
    } else if (last.team === 'away' && state.awayScore > 0) {
        state.awayScore--;
    }
    state.courtSwitchAlert = false;
    broadcastState();
    updateUI();
    logAction(`1点戻しました (元に戻す: ${last.team.toUpperCase()})`);
}

function commitCurrentSetScore() {
    const currentSet = state.homeSets + state.awaySets + 1;
    if (currentSet > 5) {
        alert('最大セット上限を超えています。');
        return;
    }
    
    state[`homeScoreS${currentSet}`] = state.homeScore;
    state[`awayScoreS${currentSet}`] = state.awayScore;
    
    if (state.homeScore > state.awayScore) {
        state.homeSets++;
    } else if (state.awayScore > state.homeScore) {
        state.awaySets++;
    }
    
    state.homeScore = 0;
    state.awayScore = 0;
    state.scoreHistory = [];
    state.courtSwitchAlert = false;
    
    state.homeTO = state.gameMode === 'indoor' ? 2 : 1;
    state.awayTO = state.gameMode === 'indoor' ? 2 : 1;
    
    broadcastState();
    updateUI();
    logAction(`第 ${currentSet} セット終了スコアを確定し、次のセットへ進みます。`);
}

function clearAllSetScores() {
    for (let i = 1; i <= 5; i++) {
        state[`homeScoreS${i}`] = 0;
        state[`awayScoreS${i}`] = 0;
    }
    state.homeSets = 0;
    state.awaySets = 0;
    state.homeScore = 0;
    state.awayScore = 0;
    state.scoreHistory = [];
    state.courtSwitchAlert = false;
    
    broadcastState();
    updateUI();
    logAction('セット履歴とスコアをすべてクリアしました');
}

function bindSetScoreInputs() {
    const bindInput = (id, key, team) => {
        const el = document.getElementById(id);
        el.addEventListener('change', (e) => {
            const val = parseInt(e.target.value) || 0;
            state[key] = val;
            recalculateSetsCount();
            broadcastState();
            updateUI();
        });
    };

    for (let i = 1; i <= 5; i++) {
        bindInput(`home-score-s${i}`, `homeScoreS${i}`, 'home');
        bindInput(`away-score-s${i}`, `awayScoreS${i}`, 'away');
    }
}

function recalculateSetsCount() {
    let homeS = 0;
    let awayS = 0;
    for (let i = 1; i <= 5; i++) {
        const hVal = state[`homeScoreS${i}`];
        const aVal = state[`awayScoreS${i}`];
        if (hVal === 0 && aVal === 0) continue;
        if (hVal > aVal) homeS++;
        else if (aVal > hVal) awayS++;
    }
    state.homeSets = homeS;
    state.awaySets = awayS;
}

// Excelインポート (コメント comment / 学年 memo の双方をパースできるように拡張)
function executeExcelImport() {
    const area = document.getElementById('excel-import-area');
    const text = area.value;
    if (!text.trim()) {
        alert('インポートするデータが入力されていません。');
        return;
    }

    const lines = text.split('\n');
    const imported = [];
    
    lines.forEach(line => {
        if (!line.trim()) return;
        const cols = line.split(/\t|,/);
        if (cols.length >= 3) {
            let number = cols[0]?.trim() || '99';
            let position = cols[1]?.trim() || 'OH';
            let name = cols[2]?.trim() || '選手名';
            let comment = '';
            let memo = '';

            if (cols.length === 4) {
                // 4列の場合は一言メッセージとする
                comment = cols[3]?.trim() || '';
            } else if (cols.length >= 5) {
                // 5列以上の場合は 4列目一言, 5列目学年
                comment = cols[3]?.trim() || '';
                memo = cols[4]?.trim() || '';
            }

            imported.push({
                number: number,
                position: position,
                name: name,
                comment: comment,
                memo: memo,
                starter: false
            });
        }
    });

    if (imported.length > 0) {
        state.players[currentTabTeam] = imported;
        savePlayers();
        renderPlayerListEditor();
        broadcastState();
        area.value = '';
        logAction(`【インポート完了】Excelデータから ${imported.length} 名の選手を登録しました。`);
    } else {
        alert('正しい形式（背番号 ポジション 氏名 [一言] [学年/備考]）の行が見つかりませんでした。');
    }
}

// 行データ配列(CSV/Excel共通)から選手リストを組み立てる (列順: 背番号,ポジション,氏名,[一言],[学年/備考])
function buildVolleyballPlayersFromRows(rows) {
    const imported = [];
    rows.forEach(cols => {
        if (!cols || cols.length < 3) return;
        const number = String(cols[0] !== undefined && cols[0] !== null ? cols[0] : '').trim() || '99';
        const position = String(cols[1] !== undefined && cols[1] !== null ? cols[1] : '').trim() || 'OH';
        const name = String(cols[2] !== undefined && cols[2] !== null ? cols[2] : '').trim() || '選手名';
        let comment = '';
        let memo = '';

        if (cols.length === 4) {
            comment = String(cols[3] !== undefined && cols[3] !== null ? cols[3] : '').trim();
        } else if (cols.length >= 5) {
            comment = String(cols[3] !== undefined && cols[3] !== null ? cols[3] : '').trim();
            memo = String(cols[4] !== undefined && cols[4] !== null ? cols[4] : '').trim();
        }

        imported.push({ number, position, name, comment, memo, starter: false });
    });
    return imported;
}

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

// 選手データファイル(CSVまたはExcel)を処理して現在のタブに反映する
// 拡張子だけでなく、実際のファイル中身の先頭バイト(ZIP形式の目印 "PK")も見て
// Excel(.xlsx)かどうかを判定する。拡張子が.csvのまま保存されたExcelファイルにも対応。
async function isExcelFile(file, ext) {
    if (ext === 'xlsx' || ext === 'xls') return true;
    try {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        return head[0] === 0x50 && head[1] === 0x4B; // "PK" = ZIP/xlsx signature
    } catch (e) {
        return false;
    }
}

async function processVolleyballPlayerFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    const applyImported = (imported) => {
        if (imported.length === 0) {
            alert('正しい形式（背番号 ポジション 氏名 [一言] [学年/備考]）の行が見つかりませんでした。');
            return;
        }
        state.players[currentTabTeam] = imported;
        savePlayers();
        renderPlayerListEditor();
        broadcastState();
        logAction(`【インポート完了】ファイルから ${imported.length} 名の選手を登録しました。`);
    };

    const looksLikeExcel = await isExcelFile(file, ext);
    if (looksLikeExcel) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' })
                .filter(r => !(String(r[0] || '').includes('背番号')));
            applyImported(buildVolleyballPlayersFromRows(rows));
        };
        reader.readAsArrayBuffer(file);
    } else {
        readCSVFileAuto(file, (text) => {
            const rows = text.split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.includes('背番号'))
                .map(l => l.split(/\t|,/));
            applyImported(buildVolleyballPlayersFromRows(rows));
        });
    }
}

// ==========================================================================
// ドラッグ＆ドロップ登録
// ==========================================================================
function setupLogoDragAndDrop(team) {
    const area = document.getElementById(`drag-${team}-logo`);
    const preview = document.getElementById(`preview-${team}-logo`);
    const label = document.querySelector(`#drag-${team}-logo .drag-text`);
    const urlDisplay = document.getElementById(`in-${team}-logo-url`);
    
    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });
    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                resizeImage(event.target.result, 120, (base64) => {
                    state[`${team}Logo`] = base64;
                    preview.src = base64;
                    preview.style.display = 'block';
                    if (label) label.style.display = 'none';
                    urlDisplay.value = `[ドラッグ登録: ${file.name}]`;
                    
                    broadcastState();
                    updateUI();
                    logAction(`${team === 'home' ? 'HOME' : 'AWAY'}のロゴを登録しました: ${file.name}`);
                });
            };
            reader.readAsDataURL(file);
        }
    });

    area.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    resizeImage(event.target.result, 120, (base64) => {
                        state[`${team}Logo`] = base64;
                        preview.src = base64;
                        preview.style.display = 'block';
                        if (label) label.style.display = 'none';
                        urlDisplay.value = `[ドラッグ登録: ${file.name}]`;
                        
                        broadcastState();
                        updateUI();
                        logAction(`${team === 'home' ? 'HOME' : 'AWAY'}のロゴを登録しました: ${file.name}`);
                    });
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    });
}

function setupSlideDragAndDrop() {
    const area = document.getElementById('drag-slide-panel');
    const preview = document.getElementById('slide-preview');
    const label = document.querySelector('#drag-slide-panel .slide-text');

    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.classList.add('dragover');
    });
    area.addEventListener('dragleave', () => {
        area.classList.remove('dragover');
    });
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.classList.remove('dragover');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                resizeImage(event.target.result, 1280, (base64) => {
                    state.fullscreenSlide = base64;
                    preview.src = base64;
                    preview.style.display = 'block';
                    if (label) label.style.display = 'none';
                    updateUI();
                });
            };
            reader.readAsDataURL(file);
        }
    });

    area.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    resizeImage(event.target.result, 1280, (base64) => {
                        state.fullscreenSlide = base64;
                        preview.src = base64;
                        preview.style.display = 'block';
                        if (label) label.style.display = 'none';
                        updateUI();
                    });
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    });
}

function resizeImage(dataUrl, maxDimension, callback) {
    const img = new Image();
    img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
            if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
            } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
}

// ==========================================================================
// 選手管理リスト描画とワンショット制御
// ==========================================================================
function renderPlayerListEditor() {
    const list = document.getElementById('player-list-editor');
    if (!list) return;
    list.innerHTML = '';

    const players = state.players[currentTabTeam] || [];
    players.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'player-row-edit';
        row.innerHTML = `
            <input type="text" class="p-num-in" value="${p.number}" style="width:25px;" title="背番号">
            <input type="text" class="p-pos-in" value="${p.position}" style="width:35px;" title="ポジション">
            <input type="text" class="p-name-in" value="${p.name}" style="width:75px;" title="選手名">
            <input type="text" class="p-comment-in" value="${p.comment || ''}" style="width:110px;" placeholder="一言欄" title="一言メッセージ">
            <input type="text" class="p-grade-in" value="${p.memo}" style="width:40px;" title="学年/備考">
            <label style="display:flex; align-items:center; gap:2px; font-size:11px; flex-shrink:0;">
                <input type="checkbox" class="p-starter-check" ${p.starter ? 'checked' : ''}>先発
            </label>
            <button class="btn-warning btn-onair" title="選手紹介テロップを送出 (ワンショット)">ON AIR</button>
            <button class="btn-danger btn-delete" title="選手削除">削除</button>
        `;

        row.querySelector('.p-num-in').addEventListener('change', (e) => { p.number = e.target.value; savePlayers(); broadcastState(); });
        row.querySelector('.p-pos-in').addEventListener('change', (e) => { p.position = e.target.value; savePlayers(); sortPlayers(); });
        row.querySelector('.p-name-in').addEventListener('change', (e) => { p.name = e.target.value; savePlayers(); broadcastState(); });
        row.querySelector('.p-comment-in').addEventListener('change', (e) => { p.comment = e.target.value; savePlayers(); broadcastState(); });
        row.querySelector('.p-grade-in').addEventListener('change', (e) => { p.memo = e.target.value; savePlayers(); broadcastState(); });
        row.querySelector('.p-starter-check').addEventListener('change', (e) => { p.starter = e.target.checked; savePlayers(); broadcastState(); });

        // ON AIR クリック時にタイマーを排除し、手動で非表示にするように修正
        row.querySelector('.btn-onair').addEventListener('click', () => {
            const payload = {
                team: currentTabTeam,
                number: p.number,
                position: p.position,
                name: p.name,
                comment: p.comment || '',
                memo: p.memo,
                starter: p.starter,
                teamName: currentTabTeam === 'home' ? state.homeName : state.awayName,
                teamColor: currentTabTeam === 'home' ? state.homeColor : state.awayColor,
                teamLogo: currentTabTeam === 'home' ? state.homeLogo : state.awayLogo
            };
            
            bc.postMessage({ type: 'SHOW_PLAYER', data: payload });
            if (overlayWindow && !overlayWindow.closed) {
                overlayWindow.postMessage({ type: 'SHOW_PLAYER', data: payload }, '*');
            }
            logAction(`[ワンショット] 選手紹介表示: ${p.name} (No.${p.number}) - 手動で「紹介非表示(OFF)」を押すまで表示されます。`);
        });

        row.querySelector('.btn-delete').addEventListener('click', () => {
            state.players[currentTabTeam].splice(idx, 1);
            savePlayers();
            renderPlayerListEditor();
            broadcastState();
        });

        list.appendChild(row);
    });
}

function sortPlayers() {
    const list = state.players[currentTabTeam];
    list.sort((a, b) => {
        const rankA = getPositionRank(a.position);
        const rankB = getPositionRank(b.position);
        if (rankA !== rankB) return rankA - rankB;
        return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
    });
    savePlayers();
    renderPlayerListEditor();
    broadcastState();
}

// ==========================================================================
// UI更新処理
// ==========================================================================
function updateUI() {
    document.getElementById('home-name-in').value = state.homeName;
    document.getElementById('away-name-in').value = state.awayName;
    document.getElementById('tournament-name-in').value = state.tournamentName;

    document.getElementById('home-color-in').value = state.homeColor;
    document.getElementById('away-color-in').value = state.awayColor;

    document.getElementById('home-score-num').textContent = state.homeScore;
    document.getElementById('away-score-num').textContent = state.awayScore;

    document.getElementById('home-set-num').textContent = state.homeSets;
    document.getElementById('away-set-num').textContent = state.awaySets;

    updateTimeoutEditor();

    const hServe = document.getElementById('btn-home-serve');
    const aServe = document.getElementById('btn-away-serve');
    hServe.className = 'btn-serve' + (state.serve === 'home' ? ' active home' : '');
    aServe.className = 'btn-serve' + (state.serve === 'away' ? ' active away' : '');

    for (let i = 1; i <= 5; i++) {
        document.getElementById(`home-score-s${i}`).value = state[`homeScoreS${i}`];
        document.getElementById(`away-score-s${i}`).value = state[`awayScoreS${i}`];
    }

    // 得点経過タイムライン (2行書き)
    const timelineHomeOp = document.getElementById('timeline-home-row-op');
    const timelineAwayOp = document.getElementById('timeline-away-row-op');
    timelineHomeOp.innerHTML = '';
    timelineAwayOp.innerHTML = '';

    state.scoreHistory.forEach(item => {
        const circle = document.createElement('div');
        circle.className = `history-circle ${item.team}`;
        circle.textContent = item.points;

        const spacer = document.createElement('div');
        spacer.style.width = '24px';
        spacer.style.height = '24px';

        if (item.team === 'home') {
            timelineHomeOp.appendChild(circle);
            timelineAwayOp.appendChild(spacer);
        } else {
            timelineHomeOp.appendChild(spacer);
            timelineAwayOp.appendChild(circle);
        }
    });

    const btnTimelineToggle = document.getElementById('btn-timeline-toggle');
    if (btnTimelineToggle) {
        if (state.timelineVisible) {
            btnTimelineToggle.innerText = '表示: ON';
            btnTimelineToggle.className = 'btn-primary';
        } else {
            btnTimelineToggle.innerText = '表示: OFF';
            btnTimelineToggle.className = 'btn-danger';
        }
    }

    const btnTimelineOn = document.getElementById('btn-timeline-on');
    const btnTimelineOff = document.getElementById('btn-timeline-off');
    if (btnTimelineOn && btnTimelineOff) {
        if (state.timelineVisible) {
            btnTimelineOn.classList.add('active');
            btnTimelineOff.classList.remove('active');
        } else {
            btnTimelineOn.classList.remove('active');
            btnTimelineOff.classList.add('active');
        }
    }

    const alertBox = document.getElementById('court-switch-alert-box');
    const alertText = document.getElementById('court-alert-text');
    if (state.courtSwitchAlert && state.gameMode === 'beach') {
        alertBox.style.display = 'flex';
        alertText.textContent = `コートチェンジ警告: 両チーム合計 ${state.homeScore + state.awayScore} 得点に達しました。`;
    } else {
        alertBox.style.display = 'none';
    }

    // ロゴプレビュー (D&D後の即時反映)
    const hPreview = document.getElementById('preview-home-logo');
    const hLabel = document.querySelector('#drag-home-logo .drag-text');
    const hUrl = document.getElementById('in-home-logo-url');
    if (state.homeLogo) {
        hPreview.src = state.homeLogo;
        hPreview.style.display = 'block';
        if (hLabel) hLabel.style.display = 'none';
    } else {
        hPreview.src = '';
        hPreview.style.display = 'none';
        if (hLabel) hLabel.style.display = 'block';
        hUrl.value = '';
    }

    const aPreview = document.getElementById('preview-away-logo');
    const aLabel = document.querySelector('#drag-away-logo .drag-text');
    const aUrl = document.getElementById('in-away-logo-url');
    if (state.awayLogo) {
        aPreview.src = state.awayLogo;
        aPreview.style.display = 'block';
        if (aLabel) aLabel.style.display = 'none';
    } else {
        aPreview.src = '';
        aPreview.style.display = 'none';
        if (aLabel) aLabel.style.display = 'block';
        aUrl.value = '';
    }

    const slidePreview = document.getElementById('slide-preview');
    const slideLabel = document.querySelector('#drag-slide-panel .slide-text');
    if (state.fullscreenSlide) {
        slidePreview.src = state.fullscreenSlide;
        slidePreview.style.display = 'block';
        if (slideLabel) slideLabel.style.display = 'none';
    } else {
        slidePreview.src = '';
        slidePreview.style.display = 'none';
        if (slideLabel) slideLabel.style.display = 'block';
    }

    document.querySelectorAll('.display-mode-btn').forEach(btn => {
        if (btn.getAttribute('data-mode') === state.displayMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderPlayerListEditor();

    const lineupBtn = document.getElementById('btn-toggle-lineup');
    if (lineupBtn) {
        if (state.lineupVisible) {
            lineupBtn.innerText = `スタメン非表示 (ON AIR中)`;
            lineupBtn.className = 'btn-danger';
        } else {
            lineupBtn.innerText = `スタメン表示 (ON AIR)`;
            lineupBtn.className = 'btn-primary';
        }
    }
}

// 放送出力ウィンドウ起動
const btnOpenDual = document.getElementById('btn-open-dual');
if (btnOpenDual) {
    btnOpenDual.addEventListener('click', () => {
        const winFill = window.open('volleyball_overlay.html?mode=fill', 'volleyball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        const winKey = window.open('volleyball_overlay.html?mode=key', 'volleyball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        if (!winFill || !winKey || winFill.closed || typeof winFill.closed === 'undefined' || winKey.closed || typeof winKey.closed === 'undefined') {
            alert("【お知らせ】ブラウザのポップアップブロックにより2枚目の画面が遮断されました。\n\nアドレスバー右端の「ポップアップがブロックされました」アイコンをクリックして「常に許可」を設定するか、ヘッダーの「🎬 Fill画面を開く」「🔲 Key画面を開く」ボタンをそれぞれクリックして2枚のウィンドウを開いてください。");
        }
    });
}

const btnOpenFill = document.getElementById('btn-open-fill');
if (btnOpenFill) {
    btnOpenFill.addEventListener('click', () => {
        window.open('volleyball_overlay.html?mode=fill', 'volleyball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
    });
}

const btnOpenKey = document.getElementById('btn-open-key');
if (btnOpenKey) {
    btnOpenKey.addEventListener('click', () => {
        window.open('volleyball_overlay.html?mode=key', 'volleyball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
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
    syncState();
}

// ==========================================================================
// 🎮 Stream Deck USB直接接続 ＆ 自動認識・実機LCD描画 (バレーボール完全対応)
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

// バレーボール用15キー標準アクション定義 (5x3)
const VOLLEYBALL_STREAMDECK_ACTIONS = [
    // 1行目: HOME得点 + セット + TO
    { keyIndex: 0, label: "HOME +1", sub: "得点加算", bg: "#0369a1", action: () => { addPoint('home'); } },
    { keyIndex: 1, label: "HOME -1", sub: "得点取消", bg: "#0f172a", action: () => { subPoint('home'); } },
    { keyIndex: 2, label: "HOME SET", sub: "セット獲得", bg: "#0284c7", action: () => { addSet('home'); } },
    { keyIndex: 3, label: "HOME TO", sub: "タイムアウト", bg: "#ca8a04", action: () => { triggerTimeout('home'); } },
    { keyIndex: 4, label: "🔍 判定", sub: "チャレンジ", bg: "#4338ca", action: () => { triggerChallenge('home'); } },

    // 2行目: AWAY得点 + セット + TO
    { keyIndex: 5, label: "AWAY +1", sub: "得点加算", bg: "#991b1b", action: () => { addPoint('away'); } },
    { keyIndex: 6, label: "AWAY -1", sub: "得点取消", bg: "#0f172a", action: () => { subPoint('away'); } },
    { keyIndex: 7, label: "AWAY SET", sub: "セット獲得", bg: "#dc2626", action: () => { addSet('away'); } },
    { keyIndex: 8, label: "AWAY TO", sub: "タイムアウト", bg: "#ca8a04", action: () => { triggerTimeout('away'); } },
    { keyIndex: 9, label: "🔍 判定", sub: "チャレンジ", bg: "#4338ca", action: () => { triggerChallenge('away'); } },

    // 3行目: 表示モード切替 + スタメン + 選手紹介 + 全面消去
    { keyIndex: 10, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { 
        state.displayMode = state.displayMode === 'large' ? 'small' : 'large'; 
        broadcastState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 11, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { 
        state.displayMode = state.displayMode === 'vs' ? 'small' : 'vs'; 
        broadcastState(); updateUI(); updateStreamDeckLCD(); 
    } },
    { keyIndex: 12, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { toggleLineupTelop('home'); } },
    { keyIndex: 13, label: "👤 選手紹介", sub: "ON/OFF", bg: "#b45309", action: () => { toggleFirstPlayerTelop('home'); } },
    { keyIndex: 14, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { 
        state.displayMode = 'hidden'; 
        state.lineupVisible = false;
        broadcastState(); updateUI(); updateStreamDeckLCD(); 
    } }
];

// バレーボール用32キー拡張アクション定義 (8x4: Stream Deck XL用)
const VOLLEYBALL_STREAMDECK_ACTIONS_32 = [
    // 1行目: HOME得点・セット・TO・チャレンジ・サーブ
    { keyIndex: 0, label: "HOME +1", sub: "得点加算", bg: "#0369a1", action: () => { addPoint('home'); } },
    { keyIndex: 1, label: "HOME -1", sub: "得点取消", bg: "#0f172a", action: () => { subPoint('home'); } },
    { keyIndex: 2, label: "HOME SET+", sub: "セット加算", bg: "#0284c7", action: () => { addSet('home'); } },
    { keyIndex: 3, label: "HOME SET-", sub: "セット減算", bg: "#0f172a", action: () => { subSet('home'); } },
    { keyIndex: 4, label: "HOME TO 1", sub: "タイムアウト", bg: "#ca8a04", action: () => { state.homeTO = 1; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 5, label: "HOME TO 2", sub: "タイムアウト", bg: "#ca8a04", action: () => { state.homeTO = 2; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "🔍 判定 H", sub: "チャレンジ", bg: "#4338ca", action: () => { triggerChallenge('home'); } },
    { keyIndex: 7, label: "🏐 Hサーブ", sub: "サーブ権", bg: "#0284c7", action: () => { state.serve = 'home'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },

    // 2行目: AWAY得点・セット・TO・チャレンジ・サーブ
    { keyIndex: 8, label: "AWAY +1", sub: "得点加算", bg: "#991b1b", action: () => { addPoint('away'); } },
    { keyIndex: 9, label: "AWAY -1", sub: "得点取消", bg: "#0f172a", action: () => { subPoint('away'); } },
    { keyIndex: 10, label: "AWAY SET+", sub: "セット加算", bg: "#dc2626", action: () => { addSet('away'); } },
    { keyIndex: 11, label: "AWAY SET-", sub: "セット減算", bg: "#0f172a", action: () => { subSet('away'); } },
    { keyIndex: 12, label: "AWAY TO 1", sub: "タイムアウト", bg: "#ca8a04", action: () => { state.awayTO = 1; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "AWAY TO 2", sub: "タイムアウト", bg: "#ca8a04", action: () => { state.awayTO = 2; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 14, label: "🔍 判定 A", sub: "チャレンジ", bg: "#4338ca", action: () => { triggerChallenge('away'); } },
    { keyIndex: 15, label: "🏐 Aサーブ", sub: "サーブ権", bg: "#dc2626", action: () => { state.serve = 'away'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },

    // 3行目: セット指定・コートチェンジ・画面切替
    { keyIndex: 16, label: "第1セット", sub: "Set 1", bg: "#1e293b", action: () => { commitCurrentSetScore(); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 17, label: "第2セット", sub: "Set 2", bg: "#1e293b", action: () => { commitCurrentSetScore(); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 18, label: "第3セット", sub: "Set 3", bg: "#1e293b", action: () => { commitCurrentSetScore(); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 19, label: "第4セット", sub: "Set 4", bg: "#1e293b", action: () => { commitCurrentSetScore(); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 20, label: "第5セット", sub: "Set 5", bg: "#1e293b", action: () => { commitCurrentSetScore(); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 21, label: "🔄 コート", sub: "チェンジ", bg: "#0284c7", action: () => { broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 22, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { state.displayMode = state.displayMode === 'large' ? 'small' : 'large'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 23, label: "📺 ランスコ", sub: "セット別得点", bg: "#334155", action: () => { state.displayMode = 'ransko'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },

    // 4行目: 特殊送出・選手テロップ・消去
    { keyIndex: 24, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { state.displayMode = 'vs'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 25, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { toggleLineupTelop('home'); } },
    { keyIndex: 26, label: "📈 推移", sub: "得点ライン", bg: "#0d9488", action: () => { broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 27, label: "👤 HOME #1", sub: "紹介", bg: "#b45309", action: () => { toggleFirstPlayerTelop('home'); } },
    { keyIndex: 28, label: "👤 HOME #2", sub: "紹介", bg: "#b45309", action: () => { toggleFirstPlayerTelop('home'); } },
    { keyIndex: 29, label: "👤 AWAY #1", sub: "紹介", bg: "#b45309", action: () => { toggleFirstPlayerTelop('away'); } },
    { keyIndex: 30, label: "🖼 スライド", sub: "静止画送出", bg: "#0d9488", action: () => { updateStreamDeckLCD(); } },
    { keyIndex: 31, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { 
        state.displayMode = 'hidden'; 
        state.lineupVisible = false;
        broadcastState(); updateUI(); updateStreamDeckLCD(); 
    } }
];

let activeKeyActions = VOLLEYBALL_STREAMDECK_ACTIONS;

function toggleLineupTelop(teamKey = 'home') {
    state.lineupVisible = !state.lineupVisible;
    state.lineupTeam = teamKey;
    broadcastState();
    updateUI();
    updateStreamDeckLCD();
}

function toggleFirstPlayerTelop(teamKey = 'home') {
    const list = (state.players && state.players[teamKey] && state.players[teamKey].length > 0) ? state.players[teamKey] : [];
    if (list.length === 0) return;
    const target = list[0];

    const payload = {
        type: 'SHOW_PLAYER',
        data: {
            player: {
                photo: target.photo || '',
                number: target.number,
                position: target.position,
                name: target.name,
                team: teamKey === 'home' ? state.homeName : state.awayName,
                memo: target.grade ? `${target.grade}年` : (target.memo || ''),
                comment: target.comment || ''
            },
            duration: 10
        }
    };

    if (broadcastChannel) broadcastChannel.postMessage(payload);
    const iframe = document.getElementById('preview-iframe');
    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(payload, '*');
    if (overlayWindow && !overlayWindow.closed) overlayWindow.postMessage(payload, '*');

    logAction(`選手紹介送出: #${target.number} ${target.name}`);
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
            activeKeyActions = VOLLEYBALL_STREAMDECK_ACTIONS_32;
        } else {
            activeKeyActions = VOLLEYBALL_STREAMDECK_ACTIONS;
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
        info.innerHTML = '※USBで接続されるとWeb HID経由で自動認識され、得点・セット等のキー割り振りとLCD描画が自動起動します。';
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

// 初期化実行
document.addEventListener('DOMContentLoaded', () => {
    initStreamDeckHID();
});
