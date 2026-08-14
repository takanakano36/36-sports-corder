// ==========================================================================
// デュアル同期 ＆ 自動フォールバック
// ==========================================================================
let sseSource = null;
let broadcastChannel = null;
let currentState = null;

// 自立タイマー用変数
let gameClockInterval = null;
let lastTimerTick = 0;

const CHANNEL_NAME = 'basketball_overlay_channel';
const SSE_URL = 'http://localhost:3004/api/events';

// 出力モード判定 (URL引数 ?mode=fill または ?mode=key または ?mode=dual または ?mode=chroma)
let outputMode = 'normal'; // 'normal', 'fill', 'key', 'dual', 'chroma'

function initOutputMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'fill') {
        outputMode = 'fill';
        document.body.classList.add('fill-mode');
        document.body.classList.remove('key-mode', 'dual-mode');
    } else if (modeParam === 'key') {
        outputMode = 'key';
        document.body.classList.add('key-mode');
        document.body.classList.remove('fill-mode', 'dual-mode');
    } else if (modeParam === 'dual') {
        outputMode = 'dual';
        document.body.classList.add('dual-mode');
        // 3840x1080 の Side-by-Side 画面を構築 (左Fill, 右Key)
        document.body.innerHTML = `
            <div class="dual-pane fill-pane" style="width:1920px; height:1080px; position:relative; overflow:hidden;">
                <iframe src="basketball_overlay.html?mode=fill" style="width:1920px; height:1080px; border:none;"></iframe>
            </div>
            <div class="dual-pane key-pane" style="width:1920px; height:1080px; position:relative; overflow:hidden; border-left: 2px solid #334155;">
                <iframe src="basketball_overlay.html?mode=key" style="width:1920px; height:1080px; border:none;"></iframe>
            </div>
        `;
    } else if (modeParam === 'chroma') {
        outputMode = 'chroma';
        document.body.classList.remove('fill-mode', 'key-mode', 'dual-mode');
    }
}

function initSync() {
    console.log('[Sync] Initializing synchronization...');
    initOutputMode();

    // 1. SSE接続の試行
    try {
        sseSource = new EventSource(SSE_URL);

        sseSource.addEventListener('init', (e) => {
            console.log('[SSE] Connected & Initialized.');
            updateConnectionBadge('connected');
            const state = JSON.parse(e.data);
            handleStateUpdate(state);
        });

        sseSource.addEventListener('state', (e) => {
            const state = JSON.parse(e.data);
            handleStateUpdate(state);
        });

        sseSource.addEventListener('timer_toggle', (e) => {
            const data = JSON.parse(e.data);
            syncTimer(data);
        });
        sseSource.addEventListener('TIMER_TOGGLE', (e) => {
            const data = JSON.parse(e.data);
            syncTimer(data);
        });

        // 選手紹介 (大文字・小文字両対応)
        sseSource.addEventListener('show_player', (e) => {
            const player = JSON.parse(e.data);
            showPlayerCard(player);
        });
        sseSource.addEventListener('SHOW_PLAYER', (e) => {
            const player = JSON.parse(e.data);
            showPlayerCard(player);
        });

        // 選手紹介非表示 (大文字・小文字両対応)
        sseSource.addEventListener('hide_player', () => {
            hidePlayerCard();
        });
        sseSource.addEventListener('HIDE_PLAYER', () => {
            hidePlayerCard();
        });

        // カメラキャプチャ軽量画像受信
        sseSource.addEventListener('clock_image', (e) => {
            const imgData = JSON.parse(e.data);
            updateCapturedClockImage(imgData);
        });
        sseSource.addEventListener('CLOCK_IMAGE', (e) => {
            const imgData = JSON.parse(e.data);
            updateCapturedClockImage(imgData);
        });

        sseSource.onerror = (err) => {
            console.warn('[SSE] Connection error. Falling back to BroadcastChannel.', err);
            updateConnectionBadge('fallback');
            sseSource.close();
            initBroadcastChannel();
        };

    } catch (e) {
        console.warn('[SSE] Fails to instantiate EventSource. Falling back to BroadcastChannel.', e);
        updateConnectionBadge('fallback');
        initBroadcastChannel();
    }
}

function initBroadcastChannel() {
    if (broadcastChannel) return;
    
    console.log('[Sync] BroadcastChannel fallback active.');
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        
        if (msg.type === 'UPDATE_STATE') {
            handleStateUpdate(msg.state);
        } else if (msg.type === 'TIMER_TOGGLE' || msg.type === 'timer_toggle') {
            syncTimer(msg.data);
        } else if (msg.type === 'SHOW_PLAYER' || msg.type === 'show_player') {
            showPlayerCard(msg.data);
        } else if (msg.type === 'HIDE_PLAYER' || msg.type === 'hide_player') {
            hidePlayerCard();
        } else if (msg.type === 'CLOCK_IMAGE' || msg.type === 'clock_image') {
            updateCapturedClockImage(msg.data);
        }
    };
}

function updateCapturedClockImage(imgData) {
    if (!currentState) currentState = {};
    currentState.clockImage = imgData;
    const clockImgs = document.querySelectorAll('.captured-clock-img');
    clockImgs.forEach(img => {
        if (imgData) {
            img.src = imgData;
            img.style.opacity = '1';
        } else {
            img.style.opacity = '0';
        }
    });
}

function updateConnectionBadge(status) {
    console.log(`[Sync Status] ${status}`);
}

// ==========================================================================
// 状態反映 (UI更新)
// ==========================================================================
function handleStateUpdate(state) {
    currentState = state;

    // --- クロマキー背景色の更新 ---
    const chromaBg = document.getElementById("chromakey-bg");
    if (chromaBg) {
        chromaBg.className = `chromakey-bg ${state.chromaKey || 'transparent'}`;
    }

    // --- チーム名 ＆ カラーの更新 ---
    const homeNames = document.querySelectorAll('.team-home-name-display');
    const awayNames = document.querySelectorAll('.team-away-name-display');
    
    homeNames.forEach(el => {
        // 小得点（small-name）の場合は5文字に制限
        let name = state.homeName;
        if (el.classList.contains('small-name')) {
            name = (state.homeName || "").substring(0, 5);
        }
        el.innerText = name;
        adjustTeamNameFontSize(el);
        // コントラスト調整
        el.style.color = getContrastColor(state.homeColor);
    });
    awayNames.forEach(el => {
        // 小得点（small-name）の場合は5文字に制限
        let name = state.awayName;
        if (el.classList.contains('small-name')) {
            name = (state.awayName || "").substring(0, 5);
        }
        el.innerText = name;
        adjustTeamNameFontSize(el);
        // コントラスト調整
        el.style.color = getContrastColor(state.awayColor);
    });

    // チームカラーバー等の更新
    document.querySelectorAll('.team-home-color-bar').forEach(el => {
        el.style.backgroundColor = state.homeColor;
    });
    document.querySelectorAll('.team-away-color-bar').forEach(el => {
        el.style.backgroundColor = state.awayColor;
    });

    // スコアの更新
    document.querySelectorAll('.team-home-score-display').forEach(el => el.innerText = state.homeScore);
    document.querySelectorAll('.team-away-score-display').forEach(el => el.innerText = state.awayScore);

    // 大得点板用ロゴの更新
    const largeLogoHome = document.getElementById('large-logo-box-home');
    const largeLogoAway = document.getElementById('large-logo-box-away');
    const largeLogoImgHome = document.getElementById('large-logo-img-home');
    const largeLogoImgAway = document.getElementById('large-logo-img-away');

    const hasHomeLogo = state.homeLogo && !state.homeLogo.startsWith('data:image/svg+xml');
    if (largeLogoHome && largeLogoImgHome) {
        if (hasHomeLogo) {
            largeLogoImgHome.setAttribute('src', state.homeLogo);
            largeLogoImgHome.style.display = 'block';
            largeLogoHome.style.setProperty('display', 'flex', 'important');
        } else {
            largeLogoImgHome.removeAttribute('src');
            largeLogoImgHome.style.display = 'none';
            largeLogoHome.style.setProperty('display', 'none', 'important');
        }
    }

    const hasAwayLogo = state.awayLogo && !state.awayLogo.startsWith('data:image/svg+xml');
    if (largeLogoAway && largeLogoImgAway) {
        if (hasAwayLogo) {
            largeLogoImgAway.setAttribute('src', state.awayLogo);
            largeLogoImgAway.style.display = 'block';
            largeLogoAway.style.setProperty('display', 'flex', 'important');
        } else {
            largeLogoImgAway.removeAttribute('src');
            largeLogoImgAway.style.display = 'none';
            largeLogoAway.style.setProperty('display', 'none', 'important');
        }
    }

    // チームファウルの更新
    const homeFoulsBox = document.getElementById('home-fouls-box');
    const awayFoulsBox = document.getElementById('away-fouls-box');
    if (homeFoulsBox) {
        document.getElementById('home-fouls-num').innerText = state.homeFouls;
        if (state.homeFouls >= 5) {
            homeFoulsBox.classList.add('penalty');
        } else {
            homeFoulsBox.classList.remove('penalty');
        }
    }
    if (awayFoulsBox) {
        document.getElementById('away-fouls-num').innerText = state.awayFouls;
        if (state.awayFouls >= 5) {
            awayFoulsBox.classList.add('penalty');
        } else {
            awayFoulsBox.classList.remove('penalty');
        }
    }

    // タイムアウト残数の更新 (ピリオドによって最大表示数が変わる)
    let maxTO = 2; // 前半(1Q, 2Q)
    if (state.period === '3Q' || state.period === '4Q') {
        maxTO = 3; // 後半(3Q, 4Q)
    } else if (state.period === 'OT') {
        maxTO = 1; // OT
    }

    updateTimeoutDots('home-timeout-dots', state.homeTimeouts, maxTO);
    updateTimeoutDots('away-timeout-dots', state.awayTimeouts, maxTO);
    updateTimeoutDots('small-home-timeout-dots', state.homeTimeouts, maxTO);
    updateTimeoutDots('small-away-timeout-dots', state.awayTimeouts, maxTO);

    // ピリオドの更新
    document.querySelectorAll('.period-display-text').forEach(el => el.innerText = state.period);

    // ポゼッションの更新
    const homePoss = document.getElementById('home-poss-arrow');
    const awayPoss = document.getElementById('away-poss-arrow');
    if (homePoss && awayPoss) {
        homePoss.classList.remove('active');
        awayPoss.classList.remove('active');
        if (state.possession === 'home') {
            homePoss.classList.add('active');
        } else if (state.possession === 'away') {
            awayPoss.classList.add('active');
        }
    }

    // クロック表示モードの切り替え (カメラキャプチャ vs マニュアル)
    const manualClockElements = document.querySelectorAll('.manual-clock-elem');
    const cameraClockElements = document.querySelectorAll('.camera-clock-elem');

    if (state.shotClockMode === 'camera') {
        manualClockElements.forEach(el => el.classList.add('hidden'));
        cameraClockElements.forEach(el => el.classList.remove('hidden'));
        // キャプチャ画像の反映 (onerror 属性は使わず、JS側でバグ対策と安全表示を行う)
        const clockImgs = document.querySelectorAll('.captured-clock-img');
        clockImgs.forEach(img => {
            if (state.clockImage) {
                img.src = state.clockImage;
                img.style.opacity = '1';
            } else {
                img.style.opacity = '0';
            }
        });
    } else {
        manualClockElements.forEach(el => el.classList.remove('hidden'));
        cameraClockElements.forEach(el => el.classList.add('hidden'));
        updateManualClockDisplay();
    }

    // --- 各種ディスプレイモードの切り替え ---
    const largeBoard = document.getElementById('overlay-large-board');
    const smallBoard = document.getElementById('overlay-small-board');
    const ranskoBoard = document.getElementById('overlay-ransko');
    const vsBoard = document.getElementById('overlay-vs');
    const imageTelopWrapper = document.getElementById('image-telop-wrapper');
    const imageTelopSrc = document.getElementById('image-telop-src');

    if (largeBoard) largeBoard.classList.add('hidden');
    if (smallBoard) smallBoard.classList.add('hidden');
    if (ranskoBoard) ranskoBoard.classList.add('hidden');
    if (vsBoard) vsBoard.classList.add('hidden');
    if (imageTelopWrapper) imageTelopWrapper.classList.add('hidden');

    if (state.displayMode === 'large') {
        if (largeBoard) largeBoard.classList.remove('hidden');
    } else if (state.displayMode === 'small') {
        if (smallBoard) smallBoard.classList.remove('hidden');
    } else if (state.displayMode === 'ransko') {
        if (ranskoBoard) {
            ranskoBoard.classList.remove('hidden');
            renderRunningScoreTable(state);
        }
    } else if (state.displayMode === 'vs') {
        if (vsBoard) {
            vsBoard.classList.remove('hidden');
            renderVSTelop(state);
        }
    } else if (state.displayMode === 'image') {
        if (imageTelopWrapper && imageTelopSrc && state.imageTelop && state.imageTelop.url) {
            imageTelopSrc.setAttribute('src', state.imageTelop.url);
            imageTelopSrc.style.display = 'block';
            imageTelopWrapper.classList.remove('hidden');
        }
    }

    // --- スタメン一覧 (Lineup) 送出制御 ---
    const lineupBoard = document.getElementById('overlay-lineup');
    if (lineupBoard) {
        if (state.lineupVisible) {
            renderLineup(state);
            lineupBoard.classList.remove('hidden');
        } else {
            lineupBoard.classList.add('hidden');
        }
    }

    // --- 大会名 ---
    document.querySelectorAll('.tournament-display-text').forEach(el => {
        el.innerText = state.tournamentName || "CHAMPIONSHIP";
    });
}

// ==========================================================================
// マニュアルタイマー自立制御 ＆ 同期
// ==========================================================================
function syncTimer(data) {
    if (!currentState) return;
    currentState.timerRunning = data.running;
    currentState.gameClock = data.gameClock;
    currentState.shotClock = data.shotClock;

    updateManualClockDisplay();

    if (currentState.timerRunning) {
        if (!gameClockInterval) {
            lastTimerTick = performance.now();
            gameClockInterval = setInterval(tickTimer, 100); // 100msごとに時間経過を処理
        }
    } else {
        clearInterval(gameClockInterval);
        gameClockInterval = null;
    }
}

function tickTimer() {
    if (!currentState || !currentState.timerRunning) {
        clearInterval(gameClockInterval);
        gameClockInterval = null;
        return;
    }

    const now = performance.now();
    const dt = (now - lastTimerTick) / 1000; // 経過時間(秒)
    lastTimerTick = now;

    // ゲームクロックの減算
    if (currentState.gameClock > 0) {
        currentState.gameClock = Math.max(0, currentState.gameClock - dt);
    } else {
        currentState.timerRunning = false;
        clearInterval(gameClockInterval);
        gameClockInterval = null;
    }

    // ショットクロックの減算
    if (currentState.shotClock > 0) {
        currentState.shotClock = Math.max(0, currentState.shotClock - dt);
    }

    updateManualClockDisplay();
}

function updateManualClockDisplay() {
    if (!currentState) return;

    // ゲームクロック表示 (分:秒.ミリ)
    const minutes = Math.floor(currentState.gameClock / 60);
    const seconds = Math.floor(currentState.gameClock % 60);
    
    let timeStr = "";
    if (currentState.gameClock < 60) {
        // 残り1分未満は秒と1/10秒 (例 58.4)
        const deciseconds = Math.floor((currentState.gameClock % 1) * 10);
        timeStr = `${String(seconds).padStart(2, '0')}.${deciseconds}`;
    } else {
        timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    document.querySelectorAll('.game-clock-text').forEach(el => el.innerText = timeStr);

    // ショットクロック表示 (秒)
    const shotClockText = Math.ceil(currentState.shotClock);
    const shotClockBoxes = document.querySelectorAll('.shot-clock-text');
    shotClockBoxes.forEach(el => {
        el.innerText = shotClockText > 0 ? shotClockText : "00";
        // 5秒以下は警告スタイル
        if (currentState.shotClock <= 5) {
            el.classList.add('under-5');
        } else {
            el.classList.remove('under-5');
        }
    });
}

// ==========================================================================
// UIコンポーネントレンダリング
// ==========================================================================

// タイムアウト残数インジケータードットの描画
function updateTimeoutDots(containerId, count, max) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < max; i++) {
        const dot = document.createElement('div');
        dot.className = 'timeout-dot';
        if (i < count) {
            dot.className += ' active';
        }
        container.appendChild(dot);
    }
}

// チーム名のオートスケーリング (8文字までは等倍、それ以上は縮小)
function adjustTeamNameFontSize(element) {
    let fontSize = 28; // CSSのデフォルトフォントサイズ
    if (element.classList.contains('vs-team-name')) {
        fontSize = 42; // VS用
    } else if (element.classList.contains('small-name')) {
        fontSize = 16; // Small用
    }
    
    element.style.fontSize = `${fontSize}px`;
    
    // 最大表示幅 (親コンテナサイズからはみ出さないかチェック. 大得点はロゴ追加により制限幅240pxへ変更)
    const maxWidth = element.classList.contains('vs-team-name') ? 480 : 240;
    if (element.scrollWidth > maxWidth) {
        while (element.scrollWidth > maxWidth && fontSize > 12) {
            fontSize -= 0.5;
            element.style.fontSize = `${fontSize}px`;
        }
    }
}

// W3C相対輝度アルゴリズムに基づく自動コントラスト調整
function getContrastColor(hexColor) {
    if (!hexColor || hexColor.charAt(0) !== '#') return '#ffffff';
    const hex = hexColor.substring(1);
    if (hex.length !== 6) return '#ffffff';

    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    // 相対輝度計算式
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.75 ? '#000000' : '#ffffff';
}

// ランニングスコア (表) のレンダリング
function renderRunningScoreTable(state) {
    const tbody = document.getElementById('ransko-table-body');
    if (!tbody) return;

    // 大会名更新
    const ranskoTournament = document.getElementById("ransko-tournament-name");
    if (ranskoTournament && state.tournamentName) {
        ranskoTournament.textContent = state.tournamentName;
    }

    // 前半(1Q, 2Q)、後半(3Q, 4Q)などの履歴を生成
    const pHeaders = ['1Q', '2Q', '3Q', '4Q'];
    if (state.period === 'OT' || state.homeScoreOT > 0 || state.awayScoreOT > 0) {
        pHeaders.push('OT');
    }

    const history = {
        home: [state.homeScoreQ1 || 0, state.homeScoreQ2 || 0, state.homeScoreQ3 || 0, state.homeScoreQ4 || 0, state.homeScoreOT || 0],
        away: [state.awayScoreQ1 || 0, state.awayScoreQ2 || 0, state.awayScoreQ3 || 0, state.awayScoreQ4 || 0, state.awayScoreOT || 0]
    };

    // テーブルヘッダーの同期
    const headerRow = document.getElementById('ransko-header-row');
    if (headerRow) {
        headerRow.innerHTML = '<th class="ransko-team-logo-cell"></th><th class="ransko-team-name-cell">TEAM</th>';
        pHeaders.forEach(p => {
            const th = document.createElement('th');
            th.innerText = p;
            headerRow.appendChild(th);
        });
        const thTotal = document.createElement('th');
        thTotal.innerText = 'TOTAL';
        headerRow.appendChild(thTotal);
    }

    tbody.innerHTML = '';

    // HOMEチーム行
    let homeTr = document.createElement('tr');
    const hasHomeLogo = state.homeLogo && !state.homeLogo.startsWith('data:image/svg+xml');
    const homeLogoHtml = hasHomeLogo ? `<div class="ransko-logo-circle"><img src="${state.homeLogo}"></div>` : `<div class="ransko-color-bar-indicator" style="background-color: ${state.homeColor}"></div>`;
    
    homeTr.innerHTML = `
        <td class="ransko-team-logo-cell">${homeLogoHtml}</td>
        <td class="ransko-team-name-cell" style="color: ${state.homeColor}">${state.homeName}</td>
    `;
    // 現在のピリオドのインデックスを特定
    let currentPeriodIdx = 0;
    if (state.period === '2Q') currentPeriodIdx = 1;
    else if (state.period === '3Q') currentPeriodIdx = 2;
    else if (state.period === '4Q') currentPeriodIdx = 3;
    else if (state.period === 'OT') currentPeriodIdx = 4;

    pHeaders.forEach((p, idx) => {
        const isFuture = idx > currentPeriodIdx;
        const val = isFuture ? "" : (history.home[idx] || 0);
        homeTr.innerHTML += `<td class="ransko-score-cell">${val}</td>`;
    });
    homeTr.innerHTML += `<td class="ransko-total-cell">${state.homeScore}</td>`;
    tbody.appendChild(homeTr);

    // AWAYチーム行
    let awayTr = document.createElement('tr');
    const hasAwayLogo = state.awayLogo && !state.awayLogo.startsWith('data:image/svg+xml');
    const awayLogoHtml = hasAwayLogo ? `<div class="ransko-logo-circle"><img src="${state.awayLogo}"></div>` : `<div class="ransko-color-bar-indicator" style="background-color: ${state.awayColor}"></div>`;
    
    awayTr.innerHTML = `
        <td class="ransko-team-logo-cell">${awayLogoHtml}</td>
        <td class="ransko-team-name-cell" style="color: ${state.awayColor}">${state.awayName}</td>
    `;
    pHeaders.forEach((p, idx) => {
        const isFuture = idx > currentPeriodIdx;
        const val = isFuture ? "" : (history.away[idx] || 0);
        awayTr.innerHTML += `<td class="ransko-score-cell">${val}</td>`;
    });
    awayTr.innerHTML += `<td class="ransko-total-cell">${state.awayScore}</td>`;
    tbody.appendChild(awayTr);
}

// 対戦カード (VS) テロップの描画
function renderVSTelop(state) {
    // チーム名
    document.querySelectorAll('.team-left-name-display').forEach(el => {
        el.innerText = state.homeName;
        adjustTeamNameFontSize(el);
    });
    document.querySelectorAll('.team-right-name-display').forEach(el => {
        el.innerText = state.awayName;
        adjustTeamNameFontSize(el);
    });

    // ロゴの有無による表示切り替え (プレースホルダー除外)
    const leftLogoBox = document.getElementById('vs-logo-box-left');
    const rightLogoBox = document.getElementById('vs-logo-box-right');
    const vsTeamLeft = document.getElementById('vs-team-left');
    const vsTeamRight = document.getElementById('vs-team-right');

    const leftImg = leftLogoBox ? leftLogoBox.querySelector('img') : null;
    const rightImg = rightLogoBox ? rightLogoBox.querySelector('img') : null;

    const hasHomeLogo = state.homeLogo && !state.homeLogo.startsWith('data:image/svg+xml');
    const hasAwayLogo = state.awayLogo && !state.awayLogo.startsWith('data:image/svg+xml');

    if (hasHomeLogo) {
        if (leftImg) {
            leftImg.setAttribute('src', state.homeLogo);
            leftImg.style.display = 'block';
        }
        if (leftLogoBox) {
            leftLogoBox.style.setProperty('display', 'flex', 'important');
        }
        if (vsTeamLeft) vsTeamLeft.classList.remove('no-logo');
    } else {
        if (leftImg) {
            leftImg.removeAttribute('src');
            leftImg.style.display = 'none';
        }
        if (leftLogoBox) {
            leftLogoBox.style.setProperty('display', 'none', 'important');
        }
        if (vsTeamLeft) vsTeamLeft.classList.add('no-logo');
    }

    if (hasAwayLogo) {
        if (rightImg) {
            rightImg.setAttribute('src', state.awayLogo);
            rightImg.style.display = 'block';
        }
        if (rightLogoBox) {
            rightLogoBox.style.setProperty('display', 'flex', 'important');
        }
        if (vsTeamRight) vsTeamRight.classList.remove('no-logo');
    } else {
        if (rightImg) {
            rightImg.removeAttribute('src');
            rightImg.style.display = 'none';
        }
        if (rightLogoBox) {
            rightLogoBox.style.setProperty('display', 'none', 'important');
        }
        if (vsTeamRight) vsTeamRight.classList.add('no-logo');
    }
}

// スタメン一覧 (Lineup) の描画
function renderLineup(state) {
    const lineupHeader = document.getElementById('lineup-header-container');
    const lineupRows = document.getElementById('lineup-rows-container');
    if (!lineupHeader || !lineupRows) return;

    const teamType = state.lineupTeam; // 'home' または 'away'
    const teamColor = teamType === 'home' ? state.homeColor : state.awayColor;
    const teamName = teamType === 'home' ? state.homeName : state.awayName;
    const teamLogo = teamType === 'home' ? state.homeLogo : state.awayLogo;

    // ヘッダーデザイン設定 (チームカラー連動のグラデーション)
    lineupHeader.style.background = `linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 100%), ${teamColor}`;
    lineupHeader.style.color = getContrastColor(teamColor);

    // ロゴとチーム名
    const headerTeamLabel = lineupHeader.querySelector('.lineup-header-team-name');
    if (headerTeamLabel) {
        headerTeamLabel.innerText = teamName;
        headerTeamLabel.style.color = getContrastColor(teamColor);
    }

    const logoBox = document.getElementById('lineup-logo-box');
    const logoImg = logoBox ? logoBox.querySelector('img') : null;
    const hasLineupLogo = teamLogo && !teamLogo.startsWith('data:image/svg+xml');
    if (hasLineupLogo) {
        if (logoImg) logoImg.src = teamLogo;
        if (logoBox) logoBox.style.display = 'flex';
    } else {
        if (logoBox) logoBox.style.display = 'none'; // 自動伸縮
    }

    // 選手データのソートと取得
    // バスケは「スターティング5」が基本。先発チェックされている5名を優先し、残りはベンチとする。
    // ポジション順（PG->SG->SF->PF->C）に優先ソート。
    const playersList = state.players ? (state.players[teamType] || []).filter(p => p.starter === true) : [];
    
    function getPosRank(pos) {
        if (!pos) return 99;
        const p = pos.toUpperCase();
        if (p.includes('PG')) return 1;
        if (p.includes('SG')) return 2;
        if (p.includes('SF')) return 3;
        if (p.includes('PF')) return 4;
        if (p.includes('C')) return 5;
        return 99;
    }

    // コピーしてソート
    const sortedPlayers = [...playersList].sort((a, b) => {
        // 先発優先
        const aStart = a.starter ? 1 : 0;
        const bStart = b.starter ? 1 : 0;
        if (aStart !== bStart) return bStart - aStart; // 先発が上

        const ra = getPosRank(a.position);
        const rb = getPosRank(b.position);
        if (ra !== rb) return ra - rb;

        return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
    });

    lineupRows.innerHTML = '';
    
    // スタメンまたは指定リストを描画
    sortedPlayers.forEach(p => {
        const row = document.createElement('div');
        row.className = 'lineup-row';

        // 個人ファウルのバッジ表記 (ファウル数が多い場合に赤警告など)
        const foulBadgeClass = p.fouls > 0 ? (p.fouls >= 5 ? 'lineup-foul-badge penalty' : 'lineup-foul-badge') : 'lineup-foul-badge none';
        const foulText = p.fouls > 0 ? `${p.fouls}F` : '';

        row.innerHTML = `
            <div class="lineup-left-block">
                <span class="lineup-pos-tag">${p.position || ""}</span>
                <span class="lineup-number-tag">${p.number || ""}</span>
            </div>
            <div class="lineup-right-block">
                <span class="lineup-name-label">${p.name || ""}</span>
                <span class="${foulBadgeClass}">${foulText}</span>
                <span class="lineup-grade-tag">${p.memo || ""}</span>
            </div>
        `;

        lineupRows.appendChild(row);

        // 氏名のオートスケーリング
        const nameEl = row.querySelector('.lineup-name-label');
        if (nameEl) {
            let fontSize = 24; // デフォルト (24px)
            nameEl.style.fontSize = `${fontSize}px`;
            
            // 最大幅 180px に収まるまで縮小
            while (nameEl.scrollWidth > 180 && fontSize > 11) {
                fontSize -= 0.5;
                nameEl.style.fontSize = `${fontSize}px`;
            }
        }
    });
}

// 選手紹介カード (showPlayer) の描画 (アメフトプレミアム仕様のID構造へバインド)
function showPlayerCard(player) {
    const card = document.getElementById('overlay-player-card');
    if (!card) return;

    const teamNameEl = document.getElementById("player-team");
    const colorBox = document.getElementById("player-team-color-box");
    const logoEl = document.getElementById("player-team-logo");
    const posEl = document.getElementById("player-position");
    const numEl = document.getElementById("player-number");
    const nameEl = document.getElementById("player-name-ja");
    const commentEl = document.getElementById("player-comment");
    const memoEl = document.getElementById("player-memo");

    // チーム名
    if (teamNameEl) teamNameEl.textContent = player.teamName;

    // チームカラー背景
    if (colorBox) {
        colorBox.style.setProperty('--player-team-color', player.teamColor);
        colorBox.style.backgroundColor = player.teamColor;
        // 文字のコントラスト調整
        const contrastColor = getContrastColor(player.teamColor);
        if (teamNameEl) teamNameEl.style.color = contrastColor;
    }

    // チームロゴ (currentStateから取得)
    if (logoEl) {
        const teamLogo = player.team === 'home' ? (currentState?.homeLogo || '') : (currentState?.awayLogo || '');
        const hasLogo = teamLogo && !teamLogo.startsWith('data:image/svg+xml');
        if (hasLogo) {
            logoEl.src = teamLogo;
            logoEl.style.display = "block";
            logoEl.style.opacity = "1";
        } else {
            logoEl.src = "";
            logoEl.style.display = "none";
        }
    }

    // 各データバインド
    if (posEl) posEl.textContent = player.position;
    if (numEl) numEl.textContent = player.number;
    if (nameEl) nameEl.textContent = player.name;
    
    // コメント (バスケの紹介文は無ければ空、もしあればその内容)
    if (commentEl) commentEl.textContent = player.comment || "";

    // メモ (学年とファウル数。5ファウルでFOUL OUT表示をここに混ぜる)
    if (memoEl) {
        const gradeStr = player.memo ? (String(player.memo).includes("年") ? player.memo : `${player.memo}年`) : "";
        // PもFも完全に不要。数字だけにします。
        const foulStr = player.fouls >= 5 ? "FOUL OUT" : `${player.fouls}`;
        memoEl.textContent = gradeStr ? `${gradeStr} / ${foulStr}` : foulStr;
    }

    card.classList.remove('hidden');
}

function hidePlayerCard() {
    const card = document.getElementById('overlay-player-card');
    if (card) {
        card.classList.add('hidden');
    }
}

// ==========================================================================
// ページ初期化
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initSync();
});
