// ==========================================================================
// 状態 (State) 管理
// ==========================================================================
let state = {
  homeName: 'HOME TEAM',
  awayName: 'AWAY TEAM',
  homeColor: "#0f2746",
  awayColor: "#7f1d1d",
  homeLogo: "",
  awayLogo: "",
  homeScore: 0,
  awayScore: 0,
  homeFouls: 0,
  awayFouls: 0,
  homeTimeouts: 2,
  awayTimeouts: 2,
  period: "1Q",
  possession: "none",
  timerRunning: false,
  gameClock: 600, // 10分
  shotClock: 24,
  shotClockMode: "manual", // 'manual' または 'camera'
  clockImage: "",
  displayMode: "large",
  tournamentName: '',
  activePlayer: null,
  lineupVisible: false,
  lineupTeam: "home",
  
  // 各Qのスコア履歴 (ランニングスコア表示用)
  homeScoreQ1: 0, homeScoreQ2: 0, homeScoreQ3: 0, homeScoreQ4: 0, homeScoreOT: 0,
  awayScoreQ1: 0, awayScoreQ2: 0, awayScoreQ3: 0, awayScoreQ4: 0, awayScoreOT: 0,
  
  // 全画面スライド (静止画テロップ)
  imageTelop: {
    active: false,
    url: ""
  },

  // クロマキー背景色
  chromaKey: "transparent",

  players: {
    home: [],
    away: []
  }
};

// デフォルト選手データ
const DEFAULT_PLAYERS = {
  home: [
    { number: "4", position: "PG", name: "山田 太郎", memo: "3年", comment: "キャプテン・大黒柱", fouls: 0, starter: true },
    { number: "5", position: "SG", name: "佐藤 次郎", memo: "3年", comment: "3Pシューター", fouls: 0, starter: true },
    { number: "6", position: "SF", name: "鈴木 三郎", memo: "2年", comment: "ディフェンスの要", fouls: 0, starter: true },
    { number: "7", position: "PF", name: "高橋 四郎", memo: "2年", comment: "リバウンド王", fouls: 0, starter: true },
    { number: "8", position: "C",  name: "田中 五郎", memo: "3年", comment: "ゴール下の支配者", fouls: 0, starter: true },
    { number: "9", position: "G",  name: "渡辺 六郎", memo: "1年", comment: "期待のルーキー", fouls: 0, starter: false },
    { number: "10", position: "F", name: "伊藤 七郎", memo: "1年", comment: "切り札シックスマン", fouls: 0, starter: false }
  ],
  away: [
    { number: "4", position: "PG", name: "M. Jordan", memo: "3年", comment: "伝説の神様", fouls: 0, starter: true },
    { number: "5", position: "SG", name: "K. Bryant", memo: "3年", comment: "ブラックマンバ", fouls: 0, starter: true },
    { number: "6", position: "SF", name: "L. James", memo: "2年", comment: "キング", fouls: 0, starter: true },
    { number: "7", position: "PF", name: "K. Durant", memo: "2年", comment: "超絶スコアラー", fouls: 0, starter: true },
    { number: "8", position: "C",  name: "S. O'Neal", memo: "3年", comment: "規格外の巨人", fouls: 0, starter: true },
    { number: "9", position: "G",  name: "S. Curry", memo: "1年", comment: "3Pの革命児", fouls: 0, starter: false },
    { number: "10", position: "F", name: "L. Doncic", memo: "1年", comment: "若きジーニアス", fouls: 0, starter: false }
  ]
};

// ==========================================================================
// 同期 ＆ 通信ロジック
// ==========================================================================
let syncMode = 'local'; // 'sse' または 'local'
let broadcastChannel = null;
let sseSource = null;
const CHANNEL_NAME = 'basketball_overlay_channel';
const SERVER_URL = 'http://localhost:3004';

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

    sseSource.addEventListener('timer_toggle', (e) => {
        const data = JSON.parse(e.data);
        syncManualTimer(data);
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
            } else if (msg && msg.type === 'TIMER_TOGGLE') {
                syncManualTimer(msg.data);
            }
        }
    };
}

function updateConnectionStatus(isSSE) {
    const badge = document.getElementById('connection-status');
    if (!badge) return;
    if (isSSE) {
        badge.className = 'connection-badge connected';
        badge.innerHTML = '<span class="status-dot">●</span> サーバー接続中 (SSE/Port 3004)';
    } else {
        badge.className = 'connection-badge fallback';
        badge.innerHTML = '<span class="status-dot">●</span> ローカル同期中 (BroadcastChannel)';
    }
}

// 状態をブロードキャストする
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
        broadcastChannel.postMessage({
            type: 'UPDATE_STATE',
            state
        });
    }
}

// ==========================================================================
// 操作画面 UI 反映
// ==========================================================================
function updateUI() {
    // チーム名
    document.getElementById('home-name-in').value = state.homeName;
    document.getElementById('away-name-in').value = state.awayName;
    
    // カラー
    document.getElementById('home-color-in').value = state.homeColor;
    document.getElementById('away-color-in').value = state.awayColor;

    // ロゴURLの復元
    const inputHomeLogoUrl = document.getElementById('input-home-logo-url');
    const inputAwayLogoUrl = document.getElementById('input-away-logo-url');
    if (inputHomeLogoUrl && !inputHomeLogoUrl.value.includes('[ドラッグ登録:') && !inputHomeLogoUrl.value.includes('[ファイル選択:')) {
        inputHomeLogoUrl.value = state.homeLogo || '';
    }
    if (inputAwayLogoUrl && !inputAwayLogoUrl.value.includes('[ドラッグ登録:') && !inputAwayLogoUrl.value.includes('[ファイル選択:')) {
        inputAwayLogoUrl.value = state.awayLogo || '';
    }

    // スコア
    document.getElementById('home-score-num').innerText = state.homeScore;
    document.getElementById('away-score-num').innerText = state.awayScore;

    // ファウル
    document.getElementById('home-foul-num').innerText = state.homeFouls;
    document.getElementById('away-foul-num').innerText = state.awayFouls;
    
    const homeFoulCtrl = document.getElementById('home-foul-ctrl');
    const awayFoulCtrl = document.getElementById('away-foul-ctrl');
    if (state.homeFouls >= 5) homeFoulCtrl.classList.add('penalty');
    else homeFoulCtrl.classList.remove('penalty');
    if (state.awayFouls >= 5) awayFoulCtrl.classList.add('penalty');
    else awayFoulCtrl.classList.remove('penalty');

    // ピリオド別得点入力
    document.getElementById('home-score-q1').value = state.homeScoreQ1;
    document.getElementById('home-score-q2').value = state.homeScoreQ2;
    document.getElementById('home-score-q3').value = state.homeScoreQ3;
    document.getElementById('home-score-q4').value = state.homeScoreQ4;
    document.getElementById('home-score-ot').value = state.homeScoreOT;

    document.getElementById('away-score-q1').value = state.awayScoreQ1;
    document.getElementById('away-score-q2').value = state.awayScoreQ2;
    document.getElementById('away-score-q3').value = state.awayScoreQ3;
    document.getElementById('away-score-q4').value = state.awayScoreQ4;
    document.getElementById('away-score-ot').value = state.awayScoreOT;

    // タイムアウト残数ドット (ピリオドによって最大表示数が変わる)
    let maxTO = 2;
    if (state.period === '3Q' || state.period === '4Q') {
        maxTO = 3;
    } else if (state.period === 'OT') {
        maxTO = 1;
    }
    // タイムアウト値が最大値を超えている場合は自動補正
    if (state.homeTimeouts > maxTO) state.homeTimeouts = maxTO;
    if (state.awayTimeouts > maxTO) state.awayTimeouts = maxTO;

    renderTimeoutDotsEditor('home-timeout-dots-editor', state.homeTimeouts, maxTO, 'home');
    renderTimeoutDotsEditor('away-timeout-dots-editor', state.awayTimeouts, maxTO, 'away');

    // ピリオド
    document.querySelectorAll('.period-btn').forEach(btn => {
        if (btn.getAttribute('data-period') === state.period) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // ポゼッション
    document.querySelectorAll('.possession-btn').forEach(btn => {
        if (btn.getAttribute('data-poss') === state.possession) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // ディスプレイモード
    document.querySelectorAll('.display-mode-btn').forEach(btn => {
        if (btn.getAttribute('data-mode') === state.displayMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 大会名
    document.getElementById('tournament-name-in').value = state.tournamentName || "";

    // クロック表示モード
    const shotClockModeSel = document.getElementById('shot-clock-mode-select');
    if (shotClockModeSel) shotClockModeSel.value = state.shotClockMode;

    const manualTimerBox = document.getElementById('manual-timer-box');
    const cameraCaptureBox = document.getElementById('camera-capture-box');
    if (state.shotClockMode === 'camera') {
        manualTimerBox.classList.add('hidden');
        cameraCaptureBox.classList.remove('hidden');
    } else {
        manualTimerBox.classList.remove('hidden');
        cameraCaptureBox.classList.add('hidden');
    }

    // 選手一覧の表示
    renderPlayerListEditor();

    // スタメン表示の切り替えボタン
    const lineupBtn = document.getElementById('btn-toggle-lineup');
    if (lineupBtn) {
        if (state.lineupVisible) {
            lineupBtn.innerText = `スタメン一覧非表示 (ON AIR中: ${state.lineupTeam.toUpperCase()})`;
            lineupBtn.className = 'btn-danger';
        } else {
            lineupBtn.innerText = 'スタメン一覧表示 (ON AIR)';
            lineupBtn.className = 'btn-primary';
        }
    }
}

// タイムアウト残数ドットゲージの描画 (操作用クリック可能)
function renderTimeoutDotsEditor(containerId, count, max, team) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < max; i++) {
        const btn = document.createElement('button');
        btn.className = 'timeout-dot-btn';
        if (i < count) {
            btn.className += ' active';
        }
        btn.addEventListener('click', () => {
            // クリックされた位置に基づいて残数を設定
            const newCount = (i === count - 1) ? i : i + 1;
            if (team === 'home') {
                state.homeTimeouts = newCount;
            } else {
                state.awayTimeouts = newCount;
            }
            broadcastState();
            updateUI();
        });
        container.appendChild(btn);
    }
}

// ==========================================================================
// 予備マニュアルタイマー制御
// ==========================================================================
let timerInterval = null;
let lastTick = 0;

function startManualTimer() {
    if (state.timerRunning) return;
    state.timerRunning = true;
    lastTick = performance.now();
    timerInterval = setInterval(tickTimer, 100);

    sendTimerToggleEvent(true);
}

function stopManualTimer() {
    if (!state.timerRunning) return;
    state.timerRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;

    sendTimerToggleEvent(false);
}

function tickTimer() {
    if (!state.timerRunning) {
        clearInterval(timerInterval);
        timerInterval = null;
        return;
    }
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;

    if (state.gameClock > 0) {
        state.gameClock = Math.max(0, state.gameClock - dt);
    } else {
        state.gameClock = 0;
        stopManualTimer();
    }

    if (state.shotClock > 0) {
        state.shotClock = Math.max(0, state.shotClock - dt);
    } else {
        state.shotClock = 0;
    }

    updateTimerDisplay();
}

function updateTimerDisplay() {
    // 操作画面のタイマー表示の更新
    const minutes = Math.floor(state.gameClock / 60);
    const seconds = Math.floor(state.gameClock % 60);
    
    let gameStr = "";
    if (state.gameClock < 60) {
        const deciseconds = Math.floor((state.gameClock % 1) * 10);
        gameStr = `${String(seconds).padStart(2, '0')}.${deciseconds}`;
    } else {
        gameStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    document.getElementById('dash-game-clock').innerText = gameStr;
    document.getElementById('dash-shot-clock').innerText = Math.ceil(state.shotClock);
}

function syncManualTimer(data) {
    state.timerRunning = data.running;
    state.gameClock = data.gameClock;
    state.shotClock = data.shotClock;
    updateTimerDisplay();

    // 他のウィンドウからタイマースタートされた場合の追従
    if (state.timerRunning) {
        if (!timerInterval) {
            lastTick = performance.now();
            timerInterval = setInterval(tickTimer, 100);
        }
    } else {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function sendTimerToggleEvent(running) {
    const data = { running, gameClock: state.gameClock, shotClock: state.shotClock };
    if (syncMode === 'sse') {
        fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'TIMER_TOGGLE', data })
        }).catch(() => {
            broadcastChannel.postMessage({ type: 'TIMER_TOGGLE', data });
        });
    } else {
        broadcastChannel.postMessage({ type: 'TIMER_TOGGLE', data });
    }
    broadcastState();
}

// ==========================================================================
// カメラキャプチャ ＆ クロップ制御
// ==========================================================================
let mediaStream = null;
let captureInterval = null;
let cropX = 100;
let cropY = 100;
let cropW = 320;
let cropH = 80;

async function initCamera() {
    const deviceSelect = document.getElementById('camera-device-select');
    if (!deviceSelect) return;

    // カメラデバイスリストの取得
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        deviceSelect.innerHTML = '';
        videoDevices.forEach((device, index) => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.text = device.label || `Camera ${index + 1}`;
            deviceSelect.appendChild(opt);
        });

        if (videoDevices.length > 0) {
            startCameraStream(videoDevices[0].deviceId);
        }

        deviceSelect.addEventListener('change', (e) => {
            startCameraStream(e.target.value);
        });

    } catch (err) {
        console.error('[Capture] Failed to enumerate devices:', err);
    }
}

async function startCameraStream(deviceId) {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        const videoEl = document.getElementById('capture-video');
        if (videoEl) {
            videoEl.srcObject = mediaStream;
            videoEl.play();
        }

        // 定期的なキャプチャ＆クロップ処理の開始 (200ms間隔に最適化してCPU負荷を軽減)
        if (captureInterval) clearInterval(captureInterval);
        captureInterval = setInterval(processCaptureCrop, 200);

    } catch (err) {
        console.error('[Capture] Failed to start video stream:', err);
    }
}

// クロップ調整用スライダー変更イベント
function initCropSliders() {
    const sX = document.getElementById('crop-x');
    const sY = document.getElementById('crop-y');
    const sW = document.getElementById('crop-w');
    const sH = document.getElementById('crop-h');

    sX.addEventListener('input', (e) => { cropX = parseInt(e.target.value); });
    sY.addEventListener('input', (e) => { cropY = parseInt(e.target.value); });
    sW.addEventListener('input', (e) => { cropW = parseInt(e.target.value); });
    sH.addEventListener('input', (e) => { cropH = parseInt(e.target.value); });
}

function processCaptureCrop() {
    const video = document.getElementById('capture-video');
    const canvas = document.getElementById('crop-preview-canvas');
    if (!video || !canvas || video.paused || video.ended || state.shotClockMode !== 'camera') return;

    const ctx = canvas.getContext('2d');
    
    // キャンバス解像度設定 (最大幅240pxに固定して軽量化)
    const targetW = 240;
    const targetH = Math.round((cropH / cropW) * targetW);
    canvas.width = targetW;
    canvas.height = targetH;

    // クロップ部分の描画
    const vidW = video.videoWidth || 1280;
    const vidH = video.videoHeight || 720;
    const dispW = video.clientWidth || 1280;
    const dispH = video.clientHeight || 720;
    
    const scaleX = vidW / dispW;
    const scaleY = vidH / dispH;

    const physX = cropX * scaleX;
    const physY = cropY * scaleY;
    const physW = cropW * scaleX;
    const physH = cropH * scaleY;

    ctx.drawImage(video, physX, physY, physW, physH, 0, 0, targetW, targetH);

    // JPEG品質0.65に圧縮して軽量Base64化
    const imgData = canvas.toDataURL('image/jpeg', 0.65);
    state.clockImage = imgData;

    // 全Stateを毎回送出せず、軽量画像イベントのみを送信（負荷軽減・通信最適化）
    if (syncMode === 'sse') {
        fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'CLOCK_IMAGE', data: imgData })
        }).catch(() => {
            if (broadcastChannel) broadcastChannel.postMessage({ type: 'CLOCK_IMAGE', data: imgData });
        });
    } else {
        if (broadcastChannel) broadcastChannel.postMessage({ type: 'CLOCK_IMAGE', data: imgData });
    }
}

// ==========================================================================
// 選手データ管理 ＆ エディタ
// ==========================================================================
let currentMgmtTeam = 'home'; // 'home' または 'away'

function initPlayerEditor() {
    // ローカルストレージからロード
    const stored = localStorage.getItem('basketball_players');
    if (stored) {
        state.players = JSON.parse(stored);
    } else {
        state.players = JSON.parse(JSON.stringify(DEFAULT_PLAYERS));
        savePlayersToStorage();
    }

    const tabHome = document.getElementById('tab-home');
    const tabAway = document.getElementById('tab-away');
    
    const csvTargetLabel = document.getElementById('csv-import-target-label');

    tabHome.addEventListener('click', () => {
        currentMgmtTeam = 'home';
        tabHome.classList.add('active');
        tabAway.classList.remove('active');
        if (csvTargetLabel) csvTargetLabel.textContent = 'HOME';
        renderPlayerListEditor();
    });

    tabAway.addEventListener('click', () => {
        currentMgmtTeam = 'away';
        tabAway.classList.add('active');
        tabHome.classList.remove('active');
        if (csvTargetLabel) csvTargetLabel.textContent = 'AWAY';
        renderPlayerListEditor();
    });

    document.getElementById('btn-add-player').addEventListener('click', () => {
        state.players[currentMgmtTeam].push({
            number: "99",
            position: "G",
            name: "新規選手",
            memo: "1年",
            comment: "",
            fouls: 0,
            starter: false
        });
        savePlayersToStorage();
        renderPlayerListEditor();
        broadcastState();
    });

    const btnLoadPlayerCsv = document.getElementById('btn-load-player-csv');
    const inputPlayerCsv = document.getElementById('input-player-csv');
    if (btnLoadPlayerCsv && inputPlayerCsv) {
        btnLoadPlayerCsv.addEventListener('click', () => {
            const file = inputPlayerCsv.files[0];
            if (!file) {
                alert('CSVファイルを選択してください。');
                return;
            }
            readCSVFileAuto(file, (text) => {
                const players = parsePlayerCSV(text);
                if (players.length === 0) {
                    alert('有効な選手データが見つかりませんでした。\n形式: 背番号,ポジション,氏名,学年,コメント');
                    return;
                }
                state.players[currentMgmtTeam] = players;
                savePlayersToStorage();
                renderPlayerListEditor();
                broadcastState();
                alert(`${currentMgmtTeam === 'home' ? 'HOME' : 'AWAY'}チームの選手データを${players.length}件読み込みました！`);
            });
        });
    }
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

// 選手名簿CSVパース (背番号,ポジション,氏名,学年,コメント の5列形式)
function parsePlayerCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    const players = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim());
        if (cols.length < 3) continue;
        if (cols[0].includes('背番号') || cols[2].includes('氏名')) continue; // ヘッダー行スキップ

        const number = cols[0] || '';
        const position = cols[1] || '';
        const name = cols[2] || '';
        if (!number || !name) continue;

        players.push({
            number,
            position,
            name,
            memo: cols[3] || '',
            comment: cols[4] || '',
            fouls: 0,
            starter: false
        });
    }

    return players;
}

function savePlayersToStorage() {
    localStorage.setItem('basketball_players', JSON.stringify(state.players));
}

function renderPlayerListEditor() {
    const list = document.getElementById('player-list-editor');
    if (!list) return;

    list.innerHTML = '';
    const players = state.players[currentMgmtTeam] || [];

    players.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'player-row-edit';

        row.innerHTML = `
            <input type="text" class="p-num-in" value="${p.number}" title="背番号" style="width: 35px !important;">
            <input type="text" class="p-pos-in" value="${p.position}" title="ポジション" style="width: 45px !important;">
            <input type="text" class="p-name-in" value="${p.name}" title="選手名" style="width: 90px !important;">
            <input type="text" class="p-grade-in" value="${p.memo}" title="学年/備考" style="width: 50px !important;">
            <input type="text" class="p-comment-in" value="${p.comment || ''}" placeholder="一言コメント" title="一言コメント" style="width: 140px !important;">
            <input type="number" class="p-foul-in" min="0" max="5" value="${p.fouls}" title="個人ファウル" style="width: 35px !important;">
            <label style="display:flex; align-items:center; gap:2px; font-size:11px;">
                <input type="checkbox" class="p-starter-check" ${p.starter ? 'checked' : ''}>先発
            </label>
            <button class="btn-warning btn-onair" title="選手紹介テロップを送出">ON AIR</button>
            <button class="btn-danger btn-delete" title="選手削除">削除</button>
        `;

        // 編集イベントのバインド
        row.querySelector('.p-num-in').addEventListener('change', (e) => { p.number = e.target.value; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-pos-in').addEventListener('change', (e) => { p.position = e.target.value; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-name-in').addEventListener('change', (e) => { p.name = e.target.value; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-grade-in').addEventListener('change', (e) => { p.memo = e.target.value; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-comment-in').addEventListener('change', (e) => { p.comment = e.target.value; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-foul-in').addEventListener('change', (e) => { p.fouls = parseInt(e.target.value) || 0; savePlayersToStorage(); broadcastState(); });
        row.querySelector('.p-starter-check').addEventListener('change', (e) => { p.starter = e.target.checked; savePlayersToStorage(); broadcastState(); });

        // 個別選手紹介 (ON AIR) トグル送出 (1回押すと表示、もう1回押すと消去)
        row.querySelector('.btn-onair').addEventListener('click', () => {
            const isCurrentlyShown = state.activePlayer && 
                                     state.activePlayer.team === currentMgmtTeam && 
                                     state.activePlayer.number === p.number;

            if (isCurrentlyShown) {
                // すでに表示中なら消去 (OFF)
                state.activePlayer = null;
                if (syncMode === 'sse') {
                    fetch(`${SERVER_URL}/api/event`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'HIDE_PLAYER' })
                    }).catch(() => {
                        if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' });
                    });
                } else {
                    if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' });
                }
            } else {
                // 未表示なら送出 (ON)
                const playerPayload = {
                    team: currentMgmtTeam,
                    number: p.number,
                    position: p.position,
                    name: p.name,
                    memo: p.memo,
                    comment: p.comment || "",
                    fouls: p.fouls,
                    teamName: currentMgmtTeam === 'home' ? state.homeName : state.awayName,
                    teamColor: currentMgmtTeam === 'home' ? state.homeColor : state.awayColor
                };
                state.activePlayer = playerPayload;

                if (syncMode === 'sse') {
                    fetch(`${SERVER_URL}/api/event`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'SHOW_PLAYER', data: playerPayload })
                    }).catch(() => {
                        if (broadcastChannel) broadcastChannel.postMessage({ type: 'SHOW_PLAYER', data: playerPayload });
                    });
                } else {
                    if (broadcastChannel) broadcastChannel.postMessage({ type: 'SHOW_PLAYER', data: playerPayload });
                }
            }
        });

        // 削除
        row.querySelector('.btn-delete').addEventListener('click', () => {
            state.players[currentMgmtTeam].splice(idx, 1);
            savePlayersToStorage();
            renderPlayerListEditor();
            broadcastState();
        });

        list.appendChild(row);
    });
}

// ==========================================================================
// イベントハンドラ登録 ＆ ページロード初期化
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initSync();
    initPlayerEditor();
    initCamera();
    initCropSliders();

    // チーム名変更イベント
    document.getElementById('home-name-in').addEventListener('change', (e) => { state.homeName = e.target.value; broadcastState(); });
    document.getElementById('away-name-in').addEventListener('change', (e) => { state.awayName = e.target.value; broadcastState(); });

    // カラー変更イベント
    document.getElementById('home-color-in').addEventListener('change', (e) => { state.homeColor = e.target.value; broadcastState(); });
    document.getElementById('away-color-in').addEventListener('change', (e) => { state.awayColor = e.target.value; broadcastState(); });

    // スコア加算/減算 (ピリオド内訳とトータルスコアを完全同期)
    document.getElementById('btn-home-p3').addEventListener('click', () => { addPeriodScore('home', 3); broadcastState(); updateUI(); });
    document.getElementById('btn-home-p2').addEventListener('click', () => { addPeriodScore('home', 2); broadcastState(); updateUI(); });
    document.getElementById('btn-home-p1').addEventListener('click', () => { addPeriodScore('home', 1); broadcastState(); updateUI(); });
    document.getElementById('btn-home-m1').addEventListener('click', () => { addPeriodScore('home', -1); broadcastState(); updateUI(); });

    document.getElementById('btn-away-p3').addEventListener('click', () => { addPeriodScore('away', 3); broadcastState(); updateUI(); });
    document.getElementById('btn-away-p2').addEventListener('click', () => { addPeriodScore('away', 2); broadcastState(); updateUI(); });
    document.getElementById('btn-away-p1').addEventListener('click', () => { addPeriodScore('away', 1); broadcastState(); updateUI(); });
    document.getElementById('btn-away-m1').addEventListener('click', () => { addPeriodScore('away', -1); broadcastState(); updateUI(); });

    // チームファウル操作
    document.getElementById('btn-home-foul-add').addEventListener('click', () => { state.homeFouls = Math.min(9, state.homeFouls + 1); broadcastState(); updateUI(); });
    document.getElementById('btn-home-foul-sub').addEventListener('click', () => { state.homeFouls = Math.max(0, state.homeFouls - 1); broadcastState(); updateUI(); });
    document.getElementById('btn-away-foul-add').addEventListener('click', () => { state.awayFouls = Math.min(9, state.awayFouls + 1); broadcastState(); updateUI(); });
    document.getElementById('btn-away-foul-sub').addEventListener('click', () => { state.awayFouls = Math.max(0, state.awayFouls - 1); broadcastState(); updateUI(); });

    // ランニングスコア手動編集イベント
    const bindPeriodScoreInput = (id, key, team) => {
        document.getElementById(id).addEventListener('change', (e) => {
            const val = parseInt(e.target.value) || 0;
            state[key] = val;
            
            // 全合計を再計算して親スコアに反映
            if (team === 'home') {
                state.homeScore = state.homeScoreQ1 + state.homeScoreQ2 + state.homeScoreQ3 + state.homeScoreQ4 + state.homeScoreOT;
            } else {
                state.awayScore = state.awayScoreQ1 + state.awayScoreQ2 + state.awayScoreQ3 + state.awayScoreQ4 + state.awayScoreOT;
            }
            
            broadcastState();
            updateUI();
        });
    };

    bindPeriodScoreInput('home-score-q1', 'homeScoreQ1', 'home');
    bindPeriodScoreInput('home-score-q2', 'homeScoreQ2', 'home');
    bindPeriodScoreInput('home-score-q3', 'homeScoreQ3', 'home');
    bindPeriodScoreInput('home-score-q4', 'homeScoreQ4', 'home');
    bindPeriodScoreInput('home-score-ot', 'homeScoreOT', 'home');

    bindPeriodScoreInput('away-score-q1', 'awayScoreQ1', 'away');
    bindPeriodScoreInput('away-score-q2', 'awayScoreQ2', 'away');
    bindPeriodScoreInput('away-score-q3', 'awayScoreQ3', 'away');
    bindPeriodScoreInput('away-score-q4', 'awayScoreQ4', 'away');
    bindPeriodScoreInput('away-score-ot', 'awayScoreOT', 'away');

    // ピリオド切り替え
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.period = btn.getAttribute('data-period');
            // ピリオド変更時に最大タイムアウト回数の整合性を保つためUI更新
            broadcastState();
            updateUI();
        });
    });

    // ポゼッション矢印
    document.querySelectorAll('.possession-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.possession = btn.getAttribute('data-poss');
            broadcastState();
            updateUI();
        });
    });

    // 大会名変更イベント
    document.getElementById('tournament-name-in').addEventListener('change', (e) => { state.tournamentName = e.target.value; broadcastState(); });

    // ディスプレイモード変更イベント
    document.querySelectorAll('.display-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.displayMode = btn.getAttribute('data-mode');
            broadcastState();
            updateUI();
        });
    });

    // タイマーモード変更イベント
    document.getElementById('shot-clock-mode-select').addEventListener('change', (e) => {
        state.shotClockMode = e.target.value;
        broadcastState();
        updateUI();
    });

    // マニュアルタイマー操作イベント
    document.getElementById('btn-timer-start').addEventListener('click', startManualTimer);
    document.getElementById('btn-timer-stop').addEventListener('click', stopManualTimer);
    document.getElementById('btn-timer-reset-10m').addEventListener('click', () => {
        stopManualTimer();
        state.gameClock = 600;
        state.shotClock = 24;
        updateTimerDisplay();
        sendTimerToggleEvent(false);
    });
    
    // ショットクロック24秒/14秒リセット
    document.getElementById('btn-shot-reset-24').addEventListener('click', () => {
        state.shotClock = 24;
        updateTimerDisplay();
        sendTimerToggleEvent(state.timerRunning);
    });
    document.getElementById('btn-shot-reset-14').addEventListener('click', () => {
        state.shotClock = 14;
        updateTimerDisplay();
        sendTimerToggleEvent(state.timerRunning);
    });

    // 時間の手動補正
    document.getElementById('btn-adjust-game').addEventListener('click', () => {
        const str = document.getElementById('adjust-game-in').value; // '分:秒'
        const parts = str.split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0]) || 0;
            const s = parseFloat(parts[1]) || 0;
            state.gameClock = m * 60 + s;
            updateTimerDisplay();
            sendTimerToggleEvent(state.timerRunning);
        }
    });

    document.getElementById('btn-adjust-shot').addEventListener('click', () => {
        const val = parseFloat(document.getElementById('adjust-shot-in').value) || 0;
        state.shotClock = val;
        updateTimerDisplay();
        sendTimerToggleEvent(state.timerRunning);
    });

    // スタメン一覧表示トグル
    document.getElementById('btn-toggle-lineup').addEventListener('click', () => {
        state.lineupVisible = !state.lineupVisible;
        state.lineupTeam = document.getElementById('lineup-team-select').value;
        broadcastState();
        updateUI();
    });

    document.getElementById('lineup-team-select').addEventListener('change', (e) => {
        state.lineupTeam = e.target.value;
        if (state.lineupVisible) {
            broadcastState();
            updateUI();
        }
    });

    // --- 追加: チームロゴのイベントハンドラ ---
    const inputHomeLogoUrl = document.getElementById('input-home-logo-url');
    const inputAwayLogoUrl = document.getElementById('input-away-logo-url');
    if (inputHomeLogoUrl) {
        inputHomeLogoUrl.addEventListener('change', (e) => {
            state.homeLogo = e.target.value;
            broadcastState();
        });
    }
    if (inputAwayLogoUrl) {
        inputAwayLogoUrl.addEventListener('change', (e) => {
            state.awayLogo = e.target.value;
            broadcastState();
        });
    }

    // チームロゴファイル選択イベント
    const inputHomeLogoFile = document.getElementById('input-home-logo-file');
    const inputAwayLogoFile = document.getElementById('input-away-logo-file');
    if (inputHomeLogoFile) {
        inputHomeLogoFile.addEventListener('change', () => {
            const file = inputHomeLogoFile.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    state.homeLogo = event.target.result;
                    if (inputHomeLogoUrl) inputHomeLogoUrl.value = `[ファイル選択: ${file.name}]`;
                    broadcastState();
                };
                reader.readAsDataURL(file);
            }
        });
    }
    if (inputAwayLogoFile) {
        inputAwayLogoFile.addEventListener('change', () => {
            const file = inputAwayLogoFile.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    state.awayLogo = event.target.result;
                    if (inputAwayLogoUrl) inputAwayLogoUrl.value = `[ファイル選択: ${file.name}]`;
                    broadcastState();
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // --- 追加: ドラッグ＆ドロップ登録ロジック ---
    const setupDragAndDrop = (dropZoneId, successCallback) => {
        const zone = document.getElementById(dropZoneId);
        if (!zone) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.style.borderColor = '#38bdf8';
            zone.style.backgroundColor = 'rgba(56, 189, 248, 0.05)';
        });

        const resetStyle = () => {
            zone.style.borderColor = '#475569';
            zone.style.backgroundColor = 'rgba(15, 23, 42, 0.4)';
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

    setupDragAndDrop('home-logo-drop-zone', (dataUrl, fileName) => {
        state.homeLogo = dataUrl;
        if (inputHomeLogoUrl) inputHomeLogoUrl.value = `[ドラッグ登録: ${fileName}]`;
        broadcastState();
    });

    setupDragAndDrop('away-logo-drop-zone', (dataUrl, fileName) => {
        state.awayLogo = dataUrl;
        if (inputAwayLogoUrl) inputAwayLogoUrl.value = `[ドラッグ登録: ${fileName}]`;
        broadcastState();
    });

    // --- 別窓で配信画面(Overlay)を開く ---
    function openDualFillAndKey() {
        // 独立した2つのウィンドウ（Fill用 1枚 ＋ Key用 1枚）を開く
        const winFill = window.open('basketball_overlay.html?mode=fill', 'basketball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        const winKey = window.open('basketball_overlay.html?mode=key', 'basketball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');

        if (!winFill || !winKey || winFill.closed || typeof winFill.closed === 'undefined' || winKey.closed || typeof winKey.closed === 'undefined') {
            alert("【お知らせ】ブラウザのポップアップブロックにより2枚目の画面が遮断されました。\n\nアドレスバー右端の「ポップアップがブロックされました」アイコンをクリックして「常に許可」を設定するか、ヘッダーの「🎬 Fill画面を開く」「🔲 Key画面を開く」ボタンをそれぞれクリックして2枚のウィンドウを開いてください。");
        }
    }

    const btnOpenDual = document.getElementById('btn-open-dual');
    if (btnOpenDual) btnOpenDual.addEventListener('click', openDualFillAndKey);

    const btnOpenDualPanel = document.getElementById('btn-open-dual-panel');
    if (btnOpenDualPanel) btnOpenDualPanel.addEventListener('click', openDualFillAndKey);

    const btnOpenOverlay = document.getElementById('btn-open-overlay');
    if (btnOpenOverlay) {
        btnOpenOverlay.addEventListener('click', () => {
            window.open('basketball_overlay.html', 'basketball_overlay', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    const btnOpenFill = document.getElementById('btn-open-fill');
    if (btnOpenFill) {
        btnOpenFill.addEventListener('click', () => {
            window.open('basketball_overlay.html?mode=fill', 'basketball_overlay_fill', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    const btnOpenKey = document.getElementById('btn-open-key');
    if (btnOpenKey) {
        btnOpenKey.addEventListener('click', () => {
            window.open('basketball_overlay.html?mode=key', 'basketball_overlay_key', 'width=1920,height=1080,menubar=no,toolbar=no,location=no');
        });
    }

    // --- プレビュー用iframeの縮小フィット（16:9 100%表示）制御 ---
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
    initSlideTelopDragAndDrop();
    initStreamDeckHID();

    // 選手紹介テロップの手動非表示 (OFF) のバインド
    const btnHidePlayer = document.getElementById('btn-hide-player');
    if (btnHidePlayer) {
        btnHidePlayer.addEventListener('click', () => {
            state.activePlayer = null;
            if (syncMode === 'sse') {
                fetch(`${SERVER_URL}/api/event`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'HIDE_PLAYER' })
                }).catch(() => {
                    if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' });
                });
            } else {
                if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' });
            }
        });
    }
});

// 現在アクティブなピリオドに対してスコアを加算/減算する関数 (合計とピリオド内訳を完全整合)
function addPeriodScore(team, val) {
    const p = state.period; // '1Q', '2Q', '3Q', '4Q', 'OT'
    const prefix = team === 'home' ? 'homeScore' : 'awayScore';
    let key = `${prefix}Q1`;
    if (p === '1Q') key = `${prefix}Q1`;
    else if (p === '2Q') key = `${prefix}Q2`;
    else if (p === '3Q') key = `${prefix}Q3`;
    else if (p === '4Q') key = `${prefix}Q4`;
    else if (p === 'OT') key = `${prefix}OT`;

    if (state[key] !== undefined) {
        state[key] = Math.max(0, (state[key] || 0) + val);
    }

    // ピリオド別合計からトータルスコアを自動再算出（ズレを完全防止）
    state.homeScore = (state.homeScoreQ1 || 0) + (state.homeScoreQ2 || 0) + (state.homeScoreQ3 || 0) + (state.homeScoreQ4 || 0) + (state.homeScoreOT || 0);
    state.awayScore = (state.awayScoreQ1 || 0) + (state.awayScoreQ2 || 0) + (state.awayScoreQ3 || 0) + (state.awayScoreQ4 || 0) + (state.awayScoreOT || 0);
}

// ==========================================================================
// 全画面スライド (静止画テロップ) 送出 ＆ D&D制御
// ==========================================================================
let localDragSlideDataUrl = null;
let prevDisplayModeBeforeSlide = 'large';

function sendSlideTelop(active, dataUrl = null) {
    if (!state.imageTelop) {
        state.imageTelop = { active: false, url: "" };
    }
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

        // 表示前のモードを記憶
        if (state.displayMode !== 'image') {
            prevDisplayModeBeforeSlide = state.displayMode || 'large';
        }

        state.imageTelop.url = finalUrl;
        state.displayMode = "image"; // スライド画像モードへ切り替え
    } else {
        // オフにする時は直前の表示モード（小得点板、VS、ランニングスコア等）を復元！
        state.displayMode = prevDisplayModeBeforeSlide || "large";
    }

    broadcastState();
    updateUI();
}

function initSlideTelopDragAndDrop() {
    const urlInput = document.getElementById('slide-input-url');
    if (!urlInput) return;

    urlInput.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        urlInput.style.borderColor = '#0095ff';
        urlInput.style.boxShadow = '0 0 8px rgba(0, 149, 255, 0.5)';
    });

    urlInput.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        urlInput.style.borderColor = '#475569';
        urlInput.style.boxShadow = 'none';
    });

    urlInput.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        urlInput.style.borderColor = '#475569';
        urlInput.style.boxShadow = 'none';

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    localDragSlideDataUrl = event.target.result;
                    urlInput.value = `[ローカル画像ドロップ完了] ${file.name}`;
                };
                reader.readAsDataURL(file);
            } else {
                alert("画像ファイルのみドロップ可能です。");
            }
        }
    });

    const slideFileInput = document.getElementById('slide-file-input');
    if (slideFileInput) {
        slideFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    localDragSlideDataUrl = event.target.result;
                    urlInput.value = `[ローカル画像選択完了] ${file.name}`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    const btnSlideOn = document.getElementById('btn-slide-on');
    const btnSlideOff = document.getElementById('btn-slide-off');
    if (btnSlideOn) btnSlideOn.addEventListener('click', () => sendSlideTelop(true));
    if (btnSlideOff) btnSlideOff.addEventListener('click', () => sendSlideTelop(false));
}

// クロマキー背景色切り替え
function setChromaKey(color) {
    state.chromaKey = color;
    const btns = document.querySelectorAll(".chromakey-selector .btn-chroma");
    btns.forEach(btn => btn.classList.remove("active"));
    
    const targetClass = `.chroma-${color}`;
    const btn = document.querySelector(targetClass);
    if (btn) btn.classList.add("active");
    broadcastState();
}

// ==========================================================================
// 🎮 Stream Deck USB直接接続 ＆ 自動認識・実機LCD描画 (Web HID API 完全対応)
// ==========================================================================
let streamDeckDevice = null;
let currentDeckProfile = null;

// Elgato Vendor ID
const ELGATO_VENDOR_ID = 0x0fd9;

// Stream Deck 機種別定義テーブル
const STREAMDECK_MODELS = {
    // Standard V2 / MK.2 (15 keys: 5x3)
    0x006d: { name: "Stream Deck V2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4 },
    0x0080: { name: "Stream Deck MK.2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4 },
    // Standard V1 (15 keys: 5x3)
    0x0060: { name: "Stream Deck Original V1", cols: 5, rows: 3, keyCount: 15, imgFormat: "bmp", iconSize: 72, inputOffset: 1 },
    // Mini (6 keys: 3x2)
    0x0063: { name: "Stream Deck Mini", cols: 3, rows: 2, keyCount: 6, imgFormat: "bmp", iconSize: 80, inputOffset: 1 },
    0x0090: { name: "Stream Deck Mini V2", cols: 3, rows: 2, keyCount: 6, imgFormat: "jpeg", iconSize: 80, inputOffset: 4 },
    // XL (32 keys: 8x4)
    0x006c: { name: "Stream Deck XL", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4 },
    0x008f: { name: "Stream Deck XL V2", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4 },
    // Plus (8 keys + 4 dials)
    0x0084: { name: "Stream Deck +", cols: 4, rows: 2, keyCount: 8, imgFormat: "jpeg", iconSize: 120, inputOffset: 4 },
    // Pedal (3 pedals)
    0x0086: { name: "Stream Deck Pedal", cols: 3, rows: 1, keyCount: 3, imgFormat: "none", iconSize: 0, inputOffset: 4 }
};

// 15キー用標準アクション定義 (5x3 レイアウト)
const STREAMDECK_15KEY_ACTIONS = [
    // 1行目: HOMEスコア + タイマー
    { keyIndex: 0, label: "HOME +3", sub: "3Pシュート", bg: "#0369a1", action: () => { addPeriodScore('home', 3); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 1, label: "HOME +2", sub: "2Pシュート", bg: "#0369a1", action: () => { addPeriodScore('home', 2); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 2, label: "HOME +1", sub: "フリースロー", bg: "#0369a1", action: () => { addPeriodScore('home', 1); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 3, label: "HOME -1", sub: "スコア取消", bg: "#0f172a", action: () => { addPeriodScore('home', -1); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 4, label: "⏱ START", sub: "STOP切替", bg: "#15803d", action: () => { if (state.timerRunning) stopManualTimer(); else startManualTimer(); updateStreamDeckLCD(); } },

    // 2行目: AWAYスコア + 24秒リセット
    { keyIndex: 5, label: "AWAY +3", sub: "3Pシュート", bg: "#991b1b", action: () => { addPeriodScore('away', 3); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 6, label: "AWAY +2", sub: "2Pシュート", bg: "#991b1b", action: () => { addPeriodScore('away', 2); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 7, label: "AWAY +1", sub: "フリースロー", bg: "#991b1b", action: () => { addPeriodScore('away', 1); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 8, label: "AWAY -1", sub: "スコア取消", bg: "#0f172a", action: () => { addPeriodScore('away', -1); broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 9, label: "🏀 24s", sub: "ショットリセット", bg: "#d97706", action: () => { state.shotClock = 24; updateTimerDisplay(); sendTimerToggleEvent(state.timerRunning); updateStreamDeckLCD(); } },

    // 3行目: 画面モード切替 + 選手紹介 + 全面消去
    { keyIndex: 10, label: "📺 大/小", sub: "得点板切替", bg: "#334155", action: () => { state.displayMode = state.displayMode === 'large' ? 'small' : 'large'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 11, label: "⚔️ VS", sub: "対戦カード", bg: "#4338ca", action: () => { state.displayMode = state.displayMode === 'vs' ? 'large' : 'vs'; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 12, label: "📋 スタメン", sub: "一覧送出", bg: "#047857", action: () => { state.lineupVisible = !state.lineupVisible; broadcastState(); updateUI(); updateStreamDeckLCD(); } },
    { keyIndex: 13, label: "👤 選手紹介", sub: "ON/OFF", bg: "#b45309", action: () => { toggleFirstStarterPlayer(); updateStreamDeckLCD(); } },
    { keyIndex: 14, label: "🚫 OFF", sub: "全面消去", bg: "#7f1d1d", action: () => { state.displayMode = 'hidden'; state.activePlayer = null; state.lineupVisible = false; broadcastState(); updateUI(); updateStreamDeckLCD(); } }
];

let activeKeyActions = STREAMDECK_15KEY_ACTIONS;

function initStreamDeckHID() {
    const btnConnect = document.getElementById('btn-connect-streamdeck');
    const btnDisconnect = document.getElementById('btn-disconnect-streamdeck');

    if (!navigator.hid) {
        const info = document.getElementById('streamdeck-device-info');
        if (info) info.innerHTML = '<span style="color:#ef4444;">※お使いのブラウザはWeb HID APIに対応していません (Google ChromeまたはMicrosoft Edgeをご使用ください)。</span>';
        if (btnConnect) btnConnect.disabled = true;
        return;
    }

    // USB接続・切断イベントの自動監視
    navigator.hid.addEventListener('connect', (e) => {
        if (e.device && e.device.vendorId === ELGATO_VENDOR_ID) {
            console.log('[StreamDeck] USB Device automatically detected:', e.device.productName);
            connectStreamDeckDevice(e.device);
        }
    });

    navigator.hid.addEventListener('disconnect', (e) => {
        if (streamDeckDevice && e.device === streamDeckDevice) {
            console.log('[StreamDeck] Device disconnected.');
            disconnectStreamDeck();
        }
    });

    // 接続ボタン
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
                console.error('[StreamDeck] Connection request error:', err);
            }
        });
    }

    const btnShiftLeft = document.getElementById('btn-shift-left');
    if (btnShiftLeft) {
        btnShiftLeft.addEventListener('click', () => {
            streamDeckKeyOffset = Math.max(0, streamDeckKeyOffset - 1);
            console.log('[StreamDeck] Offset shifted left to:', streamDeckKeyOffset);
        });
    }

    const btnShiftRight = document.getElementById('btn-shift-right');
    if (btnShiftRight) {
        btnShiftRight.addEventListener('click', () => {
            streamDeckKeyOffset++;
            console.log('[StreamDeck] Offset shifted right to:', streamDeckKeyOffset);
        });
    }

    const btnFlip = document.getElementById('btn-flip-streamdeck');
    if (btnFlip) {
        btnFlip.addEventListener('click', () => {
            streamDeckFlipVertical = !streamDeckFlipVertical;
            btnFlip.style.background = streamDeckFlipVertical ? '#0284c7' : '#475569';
            btnFlip.innerText = streamDeckFlipVertical ? '🔄 上下反転中' : '🔄 上下反転';
            updateStreamDeckLCD();
            renderStreamDeckPreview();
        });
    }

    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', () => {
            disconnectStreamDeck();
        });
    }

    // 起動時に既に認可済みのUSBデバイスがあれば自動接続
    navigator.hid.getDevices().then(devices => {
        const streamDecks = devices.filter(d => d.vendorId === ELGATO_VENDOR_ID);
        if (streamDecks.length > 0) {
            console.log('[StreamDeck] Found authorized device on startup:', streamDecks[0].productName);
            connectStreamDeckDevice(streamDecks[0]);
        }
    });
}

async function connectStreamDeckDevice(device) {
    try {
        if (!device.opened) {
            await device.open();
        }
        streamDeckDevice = device;
        
        // 機種の自動判別 (PIDによる照合)
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

        console.log(`[StreamDeck] Model Identified: ${currentDeckProfile.name} (${currentDeckProfile.cols}x${currentDeckProfile.rows}, PID: 0x${pid.toString(16)})`);

        // UI表示の更新
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
            info.innerHTML = `✅ <b>${currentDeckProfile.name} (${currentDeckProfile.cols}×${currentDeckProfile.rows}キー)</b> を自動認識しました。各ボタンに文字とカラーが送信され、物理ボタンから直接操作できます。`;
        }
        if (btnConnect) btnConnect.classList.add('hidden');
        if (btnDisconnect) btnDisconnect.classList.remove('hidden');
        if (preview) {
            preview.classList.remove('hidden');
            preview.style.gridTemplateColumns = `repeat(${currentDeckProfile.cols}, 1fr)`;
        }

        // 入力レポートリスナー登録
        device.oninputreport = handleStreamDeckInput;
        
        // 仮想キーパッド描画 ＆ 実機LCDへの画像送信
        renderStreamDeckPreview();
        setTimeout(updateStreamDeckLCD, 200);

    } catch (err) {
        console.error('[StreamDeck] Open failed:', err);
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
        info.innerHTML = '※USBで接続されるとWeb HID経由で自動認識され、スコア(+3/+2/+1/-1)・タイマースタート/ストップ・選手紹介等のキー割り振りが自動起動します。';
    }
    if (btnConnect) btnConnect.classList.remove('hidden');
    if (btnDisconnect) btnDisconnect.classList.add('hidden');
    if (preview) preview.classList.add('hidden');
}

// Stream Deckのレイアウト方向設定 ＆ オフセット調整
let streamDeckFlipVertical = false; // 上下反転フラグ
let streamDeckKeyOffset = 3; // キーオフセット (右に1個ずれているため 4 -> 3 に補正)

// 論理キー（0〜14）から実機の物理キーインデックスへの変換
function getPhysicalKeyIndex(logicKeyIndex) {
    if (!currentDeckProfile) return logicKeyIndex;
    const cols = currentDeckProfile.cols || 5;
    const rows = currentDeckProfile.rows || 3;
    
    if (streamDeckFlipVertical) {
        const r = Math.floor(logicKeyIndex / cols);
        const c = logicKeyIndex % cols;
        const invertedRow = (rows - 1) - r;
        return invertedRow * cols + c;
    }
    return logicKeyIndex;
}

// 物理キーインデックスから論理キー（0〜14）への逆変換
function getLogicalKeyIndex(physicalKeyIndex) {
    if (!currentDeckProfile) return physicalKeyIndex;
    const cols = currentDeckProfile.cols || 5;
    const rows = currentDeckProfile.rows || 3;
    
    if (streamDeckFlipVertical) {
        const r = Math.floor(physicalKeyIndex / cols);
        const c = physicalKeyIndex % cols;
        const invertedRow = (rows - 1) - r;
        return invertedRow * cols + c;
    }
    return physicalKeyIndex;
}

// ボタン入力レポート解析 (ズレを完全補正)
let previousButtonStates = new Array(64).fill(false);

function handleStreamDeckInput(event) {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const keyCount = currentDeckProfile ? currentDeckProfile.keyCount : 15;
    
    // 現在のオフセットを使用
    let offset = streamDeckKeyOffset;

    for (let i = 0; i < keyCount; i++) {
        const byteIdx = offset + i;
        if (byteIdx < data.length) {
            const isPressed = (data[byteIdx] === 1 || data[byteIdx] === 0x01);
            const wasPressed = previousButtonStates[i];
            
            // 押下された瞬間（KeyDown）にアクション実行
            if (isPressed && !wasPressed) {
                const logicalIndex = getLogicalKeyIndex(i);
                console.log(`[StreamDeck WebHID] RawByte: ${byteIdx} -> PhysicalKey: ${i} -> LogicalKey: ${logicalIndex}`);
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

// キー押下時の視覚的フラッシュ効果
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

// Stream Deck実機のLCD画面へ各ボタンの画像（文字・カラー）を送信 (180度正立補正)
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

        // 背景色
        let bgColor = k.bg || '#1e293b';
        if (k.label.includes('START') && state.timerRunning) bgColor = '#16a34a';
        if (k.label.includes('OFF') && state.displayMode === 'hidden') bgColor = '#dc2626';

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, iconSize, iconSize);

        // 枠線
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, iconSize - 4, iconSize - 4);

        // メインラベル
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(iconSize * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(k.label, iconSize / 2, iconSize * 0.38);

        // サブラベル
        if (k.sub) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = `${Math.round(iconSize * 0.14)}px sans-serif`;
            ctx.fillText(k.sub, iconSize / 2, iconSize * 0.68);
        }

        // Stream Deckハードウェアのパネル向きに合わせた180度回転キャンバスを生成
        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = iconSize;
        rotatedCanvas.height = iconSize;
        const rCtx = rotatedCanvas.getContext('2d');
        rCtx.translate(iconSize, iconSize);
        rCtx.rotate(Math.PI); // 180度回転
        rCtx.drawImage(canvas, 0, 0);

        // 画像の生成とStream Deckへのチャンク送信
        try {
            const blob = await new Promise(resolve => rotatedCanvas.toBlob(resolve, 'image/jpeg', 0.9));
            if (blob) {
                const arrayBuffer = await blob.arrayBuffer();
                const uint8 = new Uint8Array(arrayBuffer);
                await sendKeyImageToDevice(targetPhysicalKey, uint8);
            }
        } catch (e) {
            console.warn(`[StreamDeck LCD] Key ${targetPhysicalKey} send failed:`, e);
        }
    }
}

// Stream Deck MK.2 / V2 / XL への 1024バイト分割パケット送信
async function sendKeyImageToDevice(keyIndex, imageBytes) {
    if (!streamDeckDevice) return;

    const PAGE_PACKET_SIZE = 1024;
    const NUM_FIRST_PAGE_PIXELS = 1016; // 1024 - 8 (header)
    let pageNumber = 0;
    let bytesRemaining = imageBytes.length;

    while (bytesRemaining > 0) {
        const isLastPage = bytesRemaining <= NUM_FIRST_PAGE_PIXELS;
        const bytesToSend = Math.min(bytesRemaining, NUM_FIRST_PAGE_PIXELS);
        const chunk = new Uint8Array(PAGE_PACKET_SIZE);

        // MK.2 / V2 / XL ヘッダー:
        // byte 0: 0x02 (Report ID)
        // byte 1: 0x07 (SetKeyImage command)
        // byte 2: keyIndex
        // byte 3: isLastPage (1 or 0)
        // byte 4-5: payload length (little-endian)
        // byte 6-7: pageNumber (little-endian)
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

        // Report ID: 0x02 で送信
        try {
            await streamDeckDevice.sendReport(0x02, chunk.slice(1)); // sendReportの第1引数はReportId、第2引数はデータ部
        } catch (err) {
            // エラー時はスキップ
            break;
        }

        bytesRemaining -= bytesToSend;
        pageNumber++;
    }
}

// 仮想キーレイアウトのプレビュー描画
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
        
        // 画面上からクリックしても動作するように設定
        keyBtn.addEventListener('click', () => {
            k.action();
            flashKeypadPreview(k.keyIndex);
        });

        container.appendChild(keyBtn);
    });
}

// 先頭スタメン選手トグル送出関数 (Stream Deck用)
function toggleFirstStarterPlayer() {
    const players = state.players ? (state.players[currentMgmtTeam] || []) : [];
    const target = players.find(p => p.starter) || players[0];
    if (!target) return;

    const isShown = state.activePlayer && state.activePlayer.number === target.number;
    if (isShown) {
        state.activePlayer = null;
        if (syncMode === 'sse') {
            fetch(`${SERVER_URL}/api/event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'HIDE_PLAYER' })
            }).catch(() => { if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' }); });
        } else {
            if (broadcastChannel) broadcastChannel.postMessage({ type: 'HIDE_PLAYER' });
        }
    } else {
        const payload = {
            team: currentMgmtTeam,
            number: target.number,
            position: target.position,
            name: target.name,
            memo: target.memo,
            comment: target.comment || "",
            fouls: target.fouls,
            teamName: currentMgmtTeam === 'home' ? state.homeName : state.awayName,
            teamColor: currentMgmtTeam === 'home' ? state.homeColor : state.awayColor
        };
        state.activePlayer = payload;
        if (syncMode === 'sse') {
            fetch(`${SERVER_URL}/api/event`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'SHOW_PLAYER', data: payload })
            }).catch(() => { if (broadcastChannel) broadcastChannel.postMessage({ type: 'SHOW_PLAYER', data: payload }); });
        } else {
            if (broadcastChannel) broadcastChannel.postMessage({ type: 'SHOW_PLAYER', data: payload });
        }
    }
}
