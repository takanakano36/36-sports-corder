// volleyball_overlay.js

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

// ==========================================================================
// デュアル同期 ＆ 自動フォールバック (SSE & BroadcastChannel)
// ==========================================================================
let sseSource = null;
let broadcastChannel = null;
let currentState = null;

const CHANNEL_NAME = 'sports_overlay_channel_volleyball';
const SSE_URL = 'http://localhost:3005/api/events';

function initSync() {
    console.log('[Sync] Initializing synchronization...');

    // 1. SSE接続の試行
    try {
        sseSource = new EventSource(SSE_URL);

        sseSource.addEventListener('init', (e) => {
            console.log('[SSE] Connected & Initialized.');
            const state = JSON.parse(e.data);
            handleStateUpdate(state);
        });

        sseSource.addEventListener('state', (e) => {
            const state = JSON.parse(e.data);
            handleStateUpdate(state);
        });

        sseSource.onerror = (err) => {
            console.warn('[SSE] Connection error. Falling back to BroadcastChannel.', err);
            sseSource.close();
            initBroadcastChannel();
        };

    } catch (e) {
        console.warn('[SSE] Failed to instantiate EventSource. Falling back to BroadcastChannel.', e);
        initBroadcastChannel();
    }
}

function initBroadcastChannel() {
    if (broadcastChannel) return; // すでに初期化済みの場合はスキップ
    
    console.log('[Sync] BroadcastChannel fallback active.');
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
        handleMessage(event.data);
    };
}

// ページ間 postMessage 受信
window.addEventListener('message', (event) => {
    if (event.data) {
        if (event.data.type === 'CHROMAKEY') {
            setChromakey(event.data.key);
        } else {
            handleMessage(event.data);
        }
    }
});

function handleMessage(msg) {
    if (!msg) return;
    try {
        if (msg.type === 'UPDATE_STATE') {
            handleStateUpdate(msg.state);
        } else if (msg.type === 'SHOW_PLAYER') {
            showPlayerCard(msg.data);
        } else if (msg.type === 'HIDE_PLAYER') {
            hidePlayerCard();
        }
    } catch (e) {
        console.error("handleMessage Error:", e);
    }
}

// 相対輝度に基づくコントラスト判定関数 (スタメン等の可読性を最大化)
function getContrastColor(hexColor) {
    if (!hexColor || hexColor.charAt(0) !== '#') return '#ffffff';
    const hex = hexColor.substring(1);
    if (hex.length !== 6) return '#ffffff';

    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.75 ? '#000000' : '#ffffff';
}

// ポジション順ソートの順位定義
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

// ==========================================================================
// 状態反映 (UI更新)
// ==========================================================================
function handleStateUpdate(state) {
    currentState = state;

    // クロマキー背景
    try {
        setChromakey(state.chromakey);
    } catch (e) { console.error("setChromakey Error:", e); }

    // 大会名
    try {
        document.querySelectorAll('.tournament-display-text').forEach(el => {
            el.innerText = state.tournamentName || "CHAMPIONSHIP";
        });
    } catch (e) { console.error("Tournament Name Error:", e); }

    // チーム名
    try {
        document.querySelectorAll('.team-home-name-display').forEach(el => {
            el.innerText = state.homeName;
            adjustTeamNameFontSize(el);
        });
        document.querySelectorAll('.team-away-name-display').forEach(el => {
            el.innerText = state.awayName;
            adjustTeamNameFontSize(el);
        });
    } catch (e) { console.error("Team Names Error:", e); }

    // チームカラーバー
    try {
        document.querySelectorAll('.team-home-color-bar').forEach(el => {
            el.style.backgroundColor = state.homeColor;
        });
        document.querySelectorAll('.team-away-color-bar').forEach(el => {
            el.style.backgroundColor = state.awayColor;
        });
    } catch (e) { console.error("Color Bars Error:", e); }

    // 得点
    try {
        document.querySelectorAll('.team-home-score-display').forEach(el => el.innerText = state.homeScore);
        document.querySelectorAll('.team-away-score-display').forEach(el => el.innerText = state.awayScore);
    } catch (e) { console.error("Scores Error:", e); }

    // ロゴ画像＆未登録時のno-logo＆自動伸縮 (バスケ最新移植)
    try {
        updateLogosAndNoLogo(state);
    } catch (e) { console.error("Logos Error:", e); }

    // サーブ権
    try {
        updateServeIndicators(state);
    } catch (e) { console.error("Serve Indicators Error:", e); }

    // 獲得セットドット
    try {
        updateSetDots(state);
    } catch (e) { console.error("Set Dots Error:", e); }

    // タイムアウト＆チャレンジ
    try {
        updateTimeoutAndChallengeDots(state);
    } catch (e) { console.error("TO/Challenge Error:", e); }

    // 得点経過タイムライン
    try {
        updateScoreHistoryTimeline(state);
    } catch (e) { console.error("Timeline Error:", e); }

    // ランニングスコア
    try {
        if (state.displayMode === 'ransko') {
            renderRunningScoreTable(state);
        }
    } catch (e) { console.error("Ransko Table Error:", e); }

    // スタメン
    try {
        const lineupBoard = document.getElementById('overlay-lineup');
        if (lineupBoard) {
            if (state.lineupVisible) {
                renderLineup(state);
                lineupBoard.classList.remove('hidden');
            } else {
                lineupBoard.classList.add('hidden');
            }
        }
    } catch (e) { console.error("Lineup Error:", e); }

    // 全画面スライド
    try {
        const slideBoard = document.getElementById('overlay-fullscreen-slide');
        if (slideBoard) {
            if (state.displayMode === 'fullscreen_slide' && state.fullscreenSlide) {
                slideBoard.style.backgroundImage = `url(${state.fullscreenSlide})`;
                slideBoard.style.backgroundSize = 'contain';
                slideBoard.style.backgroundPosition = 'center';
                slideBoard.style.backgroundRepeat = 'no-repeat';
                slideBoard.classList.remove('hidden');
            } else {
                slideBoard.classList.add('hidden');
            }
        }
    } catch (e) { console.error("Slide Error:", e); }

    // 表示モード
    try {
        switchDisplayMode(state.displayMode);
    } catch (e) { console.error("Display Mode Error:", e); }
}

function setChromakey(key) {
    document.body.classList.remove('chromakey-green', 'chromakey-blue', 'chromakey-magenta');
    const bg = document.getElementById('chromakey-bg');
    if (bg) {
        bg.className = 'chromakey-bg transparent';
        if (key === 'green') {
            document.body.classList.add('chromakey-green');
            bg.className = 'chromakey-bg green';
        } else if (key === 'blue') {
            document.body.classList.add('chromakey-blue');
            bg.className = 'chromakey-bg blue';
        } else if (key === 'magenta') {
            document.body.classList.add('chromakey-magenta');
            bg.className = 'chromakey-bg magenta';
        }
    }
}

function switchDisplayMode(mode) {
    const large = document.getElementById('overlay-large-board');
    const small = document.getElementById('overlay-small-board');
    const ransko = document.getElementById('overlay-ransko');
    const vs = document.getElementById('overlay-vs');

    large.classList.add('hidden');
    small.classList.add('hidden');
    ransko.classList.add('hidden');
    vs.classList.add('hidden');

    if (mode === 'large') {
        large.classList.remove('hidden');
    } else if (mode === 'small') {
        small.classList.remove('hidden');
    } else if (mode === 'ransko') {
        ransko.classList.remove('hidden');
    } else if (mode === 'vs') {
        vs.classList.remove('hidden');
    }
}

function updateLogosAndNoLogo(state) {
    // 大得点用ロゴマーク (バスケ最新移植: display-flex ＆ display-none 自動伸縮対応)
    const largeLogoHome = document.getElementById('large-logo-box-home');
    const largeLogoAway = document.getElementById('large-logo-box-away');
    const largeLogoImgHome = document.querySelector('#large-logo-box-home img');
    const largeLogoImgAway = document.querySelector('#large-logo-box-away img');

    const hasHomeLogo = state.homeLogo && state.homeLogo.length > 100;
    if (largeLogoHome && largeLogoImgHome) {
        if (hasHomeLogo) {
            largeLogoImgHome.src = state.homeLogo;
            largeLogoImgHome.style.display = 'block';
            largeLogoHome.style.setProperty('display', 'flex', 'important');
        } else {
            largeLogoImgHome.src = '';
            largeLogoImgHome.style.display = 'none';
            largeLogoHome.style.setProperty('display', 'none', 'important');
        }
    }

    const hasAwayLogo = state.awayLogo && state.awayLogo.length > 100;
    if (largeLogoAway && largeLogoImgAway) {
        if (hasAwayLogo) {
            largeLogoImgAway.src = state.awayLogo;
            largeLogoImgAway.style.display = 'block';
            largeLogoAway.style.setProperty('display', 'flex', 'important');
        } else {
            largeLogoImgAway.src = '';
            largeLogoImgAway.style.display = 'none';
            largeLogoAway.style.setProperty('display', 'none', 'important');
        }
    }

    // VS等のロゴ画像更新
    const vsLogoHome = document.querySelector('#vs-logo-box-left img');
    const vsLogoAway = document.querySelector('#vs-logo-box-right img');
    if (vsLogoHome) vsLogoHome.src = hasHomeLogo ? state.homeLogo : '';
    if (vsLogoAway) vsLogoAway.src = hasAwayLogo ? state.awayLogo : '';

    const vsLeft = document.getElementById('vs-team-left');
    const vsRight = document.getElementById('vs-team-right');
    const vsLogoBoxLeft = document.getElementById('vs-logo-box-left');
    const vsLogoBoxRight = document.getElementById('vs-logo-box-right');

    if (vsLeft && vsLogoBoxLeft) {
        if (hasHomeLogo) {
            vsLogoBoxLeft.style.display = 'flex';
            vsLeft.classList.remove('no-logo');
        } else {
            vsLogoBoxLeft.style.display = 'none';
            vsLeft.classList.add('no-logo');
        }
    }

    if (vsRight && vsLogoBoxRight) {
        if (hasAwayLogo) {
            vsLogoBoxRight.style.display = 'flex';
            vsRight.classList.remove('no-logo');
        } else {
            vsLogoBoxRight.style.display = 'none';
            vsRight.classList.add('no-logo');
        }
    }
}

function updateServeIndicators(state) {
    const serveLargeH = document.getElementById('sb-large-home-serve');
    const serveLargeA = document.getElementById('sb-large-away-serve');
    const serveSmallH = document.getElementById('sb-small-home-serve');
    const serveSmallA = document.getElementById('sb-small-away-serve');

    serveLargeH.className = 'serve-indicator' + (state.serve === 'home' ? ' active home' : '');
    serveLargeA.className = 'serve-indicator' + (state.serve === 'away' ? ' active away' : '');
    serveSmallH.className = 'small-serve-indicator' + (state.serve === 'home' ? ' active home' : '');
    serveSmallA.className = 'small-serve-indicator' + (state.serve === 'away' ? ' active away' : '');
}

function updateSetDots(state) {
    const hContainer = document.getElementById('sb-large-home-set-dots');
    const aContainer = document.getElementById('sb-large-away-set-dots');
    const sText = document.getElementById('sb-small-sets-val');

    hContainer.innerHTML = '';
    aContainer.innerHTML = '';

    const maxSets = state.matchType === '3set' ? 2 : 3;

    for (let i = 0; i < maxSets; i++) {
        const dot = document.createElement('div');
        dot.className = 'set-dot' + (i < state.homeSets ? ' active home' : '');
        hContainer.appendChild(dot);
    }
    for (let i = 0; i < maxSets; i++) {
        const dot = document.createElement('div');
        dot.className = 'set-dot' + (i < state.awaySets ? ' active away' : '');
        aContainer.appendChild(dot);
    }

    if (sText) {
        sText.innerHTML = `<span style="color:#38bdf8;">${state.homeSets}</span> - <span style="color:#f97316;">${state.awaySets}</span>`;
    }
}

function updateTimeoutAndChallengeDots(state) {
    const renderDots = (containerId, count, max, activeClass) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < max; i++) {
            const dot = document.createElement('div');
            dot.className = 'timeout-dot' + (i < count ? ` active ${activeClass}` : '');
            container.appendChild(dot);
        }
    };

    const maxTO = state.gameMode === 'indoor' ? 2 : 1;
    
    renderDots('sb-large-home-to-dots', state.homeTO, maxTO, 'home');
    renderDots('sb-large-away-to-dots', state.awayTO, maxTO, 'away');
    renderDots('sb-large-home-challenge-dots', state.homeChallenge, 2, 'home');
    renderDots('sb-large-away-challenge-dots', state.awayChallenge, 2, 'away');

    renderDots('sb-small-home-to-dots', state.homeTO, maxTO, 'home');
    renderDots('sb-small-away-to-dots', state.awayTO, maxTO, 'away');

    const homeChgGroup = document.getElementById('sb-large-home-challenge-group');
    const awayChgGroup = document.getElementById('sb-large-away-challenge-group');
    if (homeChgGroup && awayChgGroup) {
        if (state.challengeVisible) {
            homeChgGroup.style.display = 'flex';
            awayChgGroup.style.display = 'flex';
        } else {
            homeChgGroup.style.display = 'none';
            awayChgGroup.style.display = 'none';
        }
    }
}

let lastTimelineLength = 0;

function updateScoreHistoryTimeline(state) {
    const container = document.getElementById('timeline-rows-area');
    const panel = document.getElementById('overlay-score-timeline');
    
    container.innerHTML = '';

    if (!state.timelineVisible) {
        panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');

    const homeTitle = panel.querySelector('.timeline-grid-team-title.home');
    const awayTitle = panel.querySelector('.timeline-grid-team-title.away');
    if (homeTitle) homeTitle.innerText = state.homeSub || state.homeName || 'HOME';
    if (awayTitle) awayTitle.innerText = state.awaySub || state.awayName || 'AWAY';

    if (!state.scoreHistory || state.scoreHistory.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.fontSize = '10px';
        emptyMsg.style.color = '#94a3b8';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.padding = '8px 0';
        emptyMsg.innerText = '0 - 0';
        container.appendChild(emptyMsg);
        return;
    }

    state.scoreHistory.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'timeline-row';

        const homeCell = document.createElement('div');
        homeCell.className = 'timeline-cell';
        const awayCell = document.createElement('div');
        awayCell.className = 'timeline-cell';

        const circle = document.createElement('div');
        circle.className = `history-circle ${item.team}`;
        circle.textContent = item.points;

        if (item.team === 'home') {
            circle.style.background = `radial-gradient(circle, ${state.homeColor || '#0ea5e9'} 0%, rgba(0,0,0,0.8) 100%)`;
            circle.style.borderColor = state.homeColor || '#0ea5e9';
            homeCell.appendChild(circle);
        } else {
            circle.style.background = `radial-gradient(circle, ${state.awayColor || '#f97316'} 0%, rgba(0,0,0,0.8) 100%)`;
            circle.style.borderColor = state.awayColor || '#f97316';
            awayCell.appendChild(circle);
        }

        if (index === state.scoreHistory.length - 1 && state.scoreHistory.length > lastTimelineLength) {
            circle.classList.add('fade-in-up');
        }

        row.appendChild(homeCell);
        row.appendChild(awayCell);
        container.appendChild(row);
    });

    lastTimelineLength = state.scoreHistory.length;
}

// ランスコ (バスケ最新 1200px 移植: ロゴサークル ＆ カラーバー配置)
function renderRunningScoreTable(state) {
    const titleText = document.getElementById('ransko-tournament-name');
    if (titleText) {
        titleText.innerText = state.tournamentName || 'RUNNING SCORE';
    }

    const tbody = document.getElementById('ransko-table-body');
    const headerRow = document.getElementById('ransko-header-row');
    if (!tbody || !headerRow) return;

    const maxSets = state.matchType === '3set' ? 3 : 5;
    const setHeaders = [];
    for (let i = 1; i <= maxSets; i++) {
        setHeaders.push(`SET ${i}`);
    }

    // ヘッダー (チーム名セル手前にロゴ、カラーバー用セルを2つ追加)
    headerRow.innerHTML = `
        <th style="width: 84px;"></th>
        <th style="width: 15px;"></th>
        <th class="ransko-team-name-cell">TEAM</th>
    `;
    setHeaders.forEach(sh => {
        const th = document.createElement('th');
        th.innerText = sh;
        headerRow.appendChild(th);
    });
    const thTotal = document.createElement('th');
    thTotal.innerText = 'SETS';
    headerRow.appendChild(thTotal);

    tbody.innerHTML = '';

    // HOMEチーム行
    const trH = document.createElement('tr');
    const hasHomeLogo = state.homeLogo && state.homeLogo.length > 100;
    trH.innerHTML = `
        <td class="ransko-team-logo-cell">
            <div class="ransko-logo-circle" style="${hasHomeLogo ? '' : 'display:none;'}">
                <img src="${hasHomeLogo ? state.homeLogo : ''}" alt="">
            </div>
        </td>
        <td style="padding: 0; vertical-align: middle;">
            <div class="ransko-color-bar-indicator" style="background-color: ${state.homeColor};"></div>
        </td>
        <td class="ransko-team-name-cell">${state.homeName}</td>
    `;
    for (let i = 1; i <= maxSets; i++) {
        const score = state[`homeScoreS${i}`] || 0;
        trH.innerHTML += `<td class="ransko-score-cell">${score > 0 ? score : '-'}</td>`;
    }
    trH.innerHTML += `<td class="ransko-total-cell">${state.homeSets}</td>`;
    tbody.appendChild(trH);

    // AWAYチーム行
    const trA = document.createElement('tr');
    const hasAwayLogo = state.awayLogo && state.awayLogo.length > 100;
    trA.innerHTML = `
        <td class="ransko-team-logo-cell">
            <div class="ransko-logo-circle" style="${hasAwayLogo ? '' : 'display:none;'}">
                <img src="${hasAwayLogo ? state.awayLogo : ''}" alt="">
            </div>
        </td>
        <td style="padding: 0; vertical-align: middle;">
            <div class="ransko-color-bar-indicator" style="background-color: ${state.awayColor};"></div>
        </td>
        <td class="ransko-team-name-cell">${state.awayName}</td>
    `;
    for (let i = 1; i <= maxSets; i++) {
        const score = state[`awayScoreS${i}`] || 0;
        trA.innerHTML += `<td class="ransko-score-cell">${score > 0 ? score : '-'}</td>`;
    }
    trA.innerHTML += `<td class="ransko-total-cell">${state.awaySets}</td>`;
    tbody.appendChild(trA);
}

// スタメン (先発のチェック starter === true がついているメンバーのみを表記、チームカラー連動のグラデーションヘッダー移植)
function renderLineup(state) {
    const list = document.getElementById('lineup-rows-container');
    const header = document.getElementById('lineup-header-container');
    const teamLogo = document.querySelector('#lineup-logo-box img');
    const teamName = document.getElementById('lineup-team-name');

    if (!list || !header || !teamName) return;

    list.innerHTML = '';

    const isHome = state.lineupTeam === 'home';
    const players = (state.players && isHome) ? (state.players.home || []) : ((state.players && state.players.away) || []);
    const color = isHome ? state.homeColor : state.awayColor;
    const logo = isHome ? state.homeLogo : state.awayLogo;
    const nameStr = isHome ? state.homeName : state.awayName;

    // バスケと同一のヘッダーチームカラーグラデーション適用 ＆ コントラストカラー自動設定
    header.style.background = `linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.4) 100%), ${color}`;
    header.style.color = getContrastColor(color);
    
    if (teamName) {
        teamName.innerText = nameStr;
        teamName.style.color = getContrastColor(color);
    }
    
    if (teamLogo) {
        if (logo && logo.length > 100) {
            teamLogo.src = logo;
            teamLogo.style.opacity = '1';
            const logoBox = document.getElementById('lineup-logo-box');
            if (logoBox) logoBox.style.display = 'flex';
            header.classList.remove('no-logo');
        } else {
            teamLogo.src = '';
            teamLogo.style.opacity = '0';
            const logoBox = document.getElementById('lineup-logo-box');
            if (logoBox) logoBox.style.display = 'none';
            header.classList.add('no-logo');
        }
    }

    // 先発のみフィルタリング
    const sorted = [...players].filter(p => p.name && p.starter).sort((a, b) => {
        const rankA = getPositionRank(a.position);
        const rankB = getPositionRank(b.position);
        if (rankA !== rankB) return rankA - rankB;
        return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
    });

    sorted.forEach(p => {
        const row = document.createElement('div');
        row.className = 'lineup-row';
        row.innerHTML = `
            <div class="lineup-left-block">
                <span class="lineup-pos-tag">${p.position || '-'}</span>
                <span class="lineup-number-tag">${p.number || ''}</span>
            </div>
            <div class="lineup-right-block">
                <span class="lineup-name-label">${p.name}</span>
                ${p.memo ? `<span class="lineup-grade-tag">${p.memo}</span>` : ''}
            </div>
        `;
        list.appendChild(row);

        const label = row.querySelector('.lineup-name-label');
        if (label) {
            adjustLineupNameFontSize(label);
        }
    });
}

function adjustLineupNameFontSize(nameEl) {
    let fontSize = 24;
    nameEl.style.fontSize = `${fontSize}px`;
    while (nameEl.scrollWidth > 180 && fontSize > 11) {
        fontSize -= 0.5;
        nameEl.style.fontSize = `${fontSize}px`;
    }
}

function adjustTeamNameFontSize(element) {
    let fontSize = 28;
    let maxWidth = 250;
    
    if (element.classList.contains('vs-team-name')) {
        fontSize = 42;
        maxWidth = 480;
    } else if (element.classList.contains('small-name')) {
        fontSize = 16;
        maxWidth = 180;
    }
    
    element.style.fontSize = `${fontSize}px`;
    while (element.scrollWidth > maxWidth && fontSize > 12) {
        fontSize -= 0.5;
        element.style.fontSize = `${fontSize}px`;
    }
}

// 選手紹介カード (ON AIR用 ワンショット - バスケ最新 960px 移植、右ズレ対策の card-fade-in-up クラス適用)
function showPlayerCard(player) {
    try {
        const card = document.getElementById('overlay-player-card');
        if (!card) return;

        const teamColorBox = card.querySelector('#player-team-color-box');
        if (teamColorBox) {
            teamColorBox.style.setProperty('--player-team-color', player.teamColor);
            teamColorBox.style.backgroundColor = player.teamColor;
        }

        const logoImg = card.querySelector('#player-team-logo');
        if (logoImg) {
            if (player.teamLogo && player.teamLogo.length > 100) {
                logoImg.src = player.teamLogo;
                logoImg.style.display = 'block';
            } else {
                logoImg.src = '';
                logoImg.style.display = 'none';
            }
        }

        const teamName = card.querySelector('#player-team');
        if (teamName) {
            teamName.innerText = player.teamName;
            teamName.style.color = getContrastColor(player.teamColor);
        }

        const pos = card.querySelector('#player-position');
        if (pos) pos.innerText = player.position || '-';

        const num = card.querySelector('#player-number');
        if (num) num.innerText = player.number;

        const nameJa = card.querySelector('#player-name-ja');
        if (nameJa) nameJa.innerText = player.name;

        const comment = card.querySelector('#player-comment');
        if (comment) comment.innerText = player.comment || '';

        const memo = card.querySelector('#player-memo');
        if (memo) {
            memo.innerText = player.memo || '';
        }

        card.classList.remove('hidden');
        card.classList.remove('fade-in-up'); // 競合による右ズレを防ぐため、通常のクラスを削除
        card.classList.add('card-fade-in-up'); // 専用のセンタリングアニメーションクラスを追加！
    } catch (e) {
        console.error("showPlayerCard Error:", e);
    }
}

function hidePlayerCard() {
    try {
        const card = document.getElementById('overlay-player-card');
        if (card) {
            card.classList.add('hidden');
            card.classList.remove('card-fade-in-up');
        }
    } catch (e) {
        console.error("hidePlayerCard Error:", e);
    }
}

// フルスクリーン制御 (通常時は常時露出、全画面時のみ隠す仕様)
window.addEventListener('DOMContentLoaded', () => {
    initSync();
    const fsBtn = document.getElementById('btn-fullscreen-toggle');

    if (fsBtn) {
        fsBtn.style.display = 'block';
        fsBtn.style.opacity = '0.8';
        fsBtn.style.pointerEvents = 'auto';
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`フルスクリーンエラー: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    }

    if (fsBtn) {
        fsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFullscreen();
        });
        window.addEventListener('dblclick', toggleFullscreen);
    }

    document.addEventListener('fullscreenchange', () => {
        if (fsBtn) {
            if (document.fullscreenElement) {
                fsBtn.style.setProperty('display', 'none', 'important');
            } else {
                fsBtn.style.setProperty('display', 'block');
                fsBtn.style.opacity = '0.8';
                fsBtn.style.pointerEvents = 'auto';
                document.body.classList.remove('mouse-idle');
            }
        }
    });

    // マウスアイドル時のカーソル非表示 (放送事故防止・スイッチャーHDMI出力対応)
    let idleTimer = null;
    window.addEventListener('mousemove', () => {
        document.body.classList.remove('mouse-idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (document.fullscreenElement) {
                document.body.classList.add('mouse-idle');
            }
        }, 3000);
    });
});
