/* ==========================================================================
   サッカー配信用オーバーレイ JavaScript
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // 出力モード判定 (URL引数 ?mode=fill または ?mode=key または ?mode=chroma)
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'fill') {
        document.body.classList.add('fill-mode');
        document.body.classList.remove('key-mode');
    } else if (modeParam === 'key') {
        document.body.classList.add('key-mode');
        document.body.classList.remove('fill-mode');
    }

    // DOM要素の取得
    const body = document.body;
    
    // 表示モード用コンテナ
    const scoreboardSmall = document.getElementById('scoreboard-small');
    const scoreboardLarge = document.getElementById('scoreboard-large');
    const overlayVs = document.getElementById('overlay-vs');
    const overlayLineup = document.getElementById('overlay-lineup');

    // PK関連
    const pkContainer = document.getElementById('pk-container');
    const homePkBalls = document.querySelectorAll('#home-pk-balls .pk-ball');
    const awayPkBalls = document.querySelectorAll('#away-pk-balls .pk-ball');

    // 選手テロップ関連
    const telopWrapper = document.getElementById('telop-wrapper');
    const playerPhoto = document.getElementById('player-photo');
    const playerPhotoPlaceholder = document.getElementById('player-photo-placeholder');
    const playerNumber = document.getElementById('player-number');
    const playerPosition = document.getElementById('player-position');
    const playerTeam = document.getElementById('player-team');
    const playerNameJa = document.getElementById('player-name-ja');
    const playerMemo = document.getElementById('player-memo');
    const playerComment = document.getElementById('player-comment');

    // カスタム画像テロップ関連
    const imageTelopWrapper = document.getElementById('image-telop-wrapper');
    const imageTelopSrc = document.getElementById('image-telop-src');

    // サーバー同期管理用変数
    let isServerConnected = false;
    let eventSource = null;

    // テロップの自動非表示タイマー
    let telopTimeoutId = null;
    let latestState = null;

    // BroadcastChannel の初期化
    let channel = null;
    try {
        channel = new BroadcastChannel('soccer_overlay_channel');
        channel.onmessage = (event) => {
            if (isServerConnected) return;
            handleIncomingMessage(event.data, event.source);
        };
    } catch (e) {
        console.warn('BroadcastChannel の初期化に失敗しました。直接通信(postMessage)を使用します:', e);
    }

    // 直接通信 (postMessage) の受信処理
    window.addEventListener('message', (event) => {
        if (isServerConnected) return;
        if (event.data && event.data.type) {
            handleIncomingMessage(event.data, event.source);
        }
    });

    // 共通のメッセージ処理関数
    function handleIncomingMessage(messageData, source) {
        const { type, data } = messageData;

        switch (type) {
            case 'UPDATE_STATE':
                latestState = data;
                updateScoreboard(data.scoreboard);
                updatePk(data.pk);
                updateChromakey(data.chromakey);
                if (data.scoreboard.displayMode === 'lineup-home' || data.scoreboard.displayMode === 'lineup-away') {
                    renderLineup(data.scoreboard.displayMode === 'lineup-home' ? 'home' : 'away');
                }
                break;
            case 'SHOW_PLAYER_TELOP':
                showPlayerTelop(data.player, data.duration);
                break;
            case 'HIDE_PLAYER_TELOP':
                hidePlayerTelop();
                break;
            case 'SHOW_IMAGE_TELOP':
                showImageTelop(data.imageUrl, data.duration);
                break;
            case 'HIDE_IMAGE_TELOP':
                hideImageTelop();
                break;
            case 'PING':
                const pongPayload = { type: 'PONG' };
                if (source) {
                    try { source.postMessage(pongPayload, '*'); } catch(e){}
                } else {
                    if (window.opener) {
                        try { window.opener.postMessage(pongPayload, '*'); } catch(e){}
                    }
                    if (window.parent && window.parent !== window) {
                        try { window.parent.postMessage(pongPayload, '*'); } catch(e){}
                    }
                }
                if (channel) {
                    try { channel.postMessage(pongPayload); } catch(e){}
                }
                break;
        }
    }

    // サーバーからの同期受信設定
    function setupServerSync() {
        if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            eventSource = new EventSource('/events');

            eventSource.onopen = () => {
                isServerConnected = true;
            };

            eventSource.addEventListener('UPDATE_STATE', (event) => {
                try {
                    const newState = JSON.parse(event.data);
                    if (JSON.stringify(latestState) !== JSON.stringify(newState)) {
                        latestState = newState;
                        updateScoreboard(newState.scoreboard);
                        updatePk(newState.pk);
                        updateChromakey(newState.chromakey);
                        if (newState.scoreboard.displayMode === 'lineup-home' || newState.scoreboard.displayMode === 'lineup-away') {
                            renderLineup(newState.scoreboard.displayMode === 'lineup-home' ? 'home' : 'away');
                        }
                    }
                } catch (e) {
                    console.error("SSE parse error:", e);
                }
            });

            eventSource.addEventListener('EVENT', (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    handleIncomingMessage(payload, null);
                } catch (e) {
                    console.error("SSE EVENT parse error:", e);
                }
            });

            eventSource.onerror = () => {
                isServerConnected = false;
            };
        }
    }

    setupServerSync();

    // スコアボードの更新
    function updateScoreboard(boardState) {
        const mode = boardState.displayMode || 'none';

        // すべて非表示にする
        scoreboardSmall.classList.add('hidden');
        scoreboardLarge.classList.add('hidden');
        overlayVs.classList.add('hidden');
        overlayLineup.classList.add('hidden');

        // PK戦インジケーターの位置クラスをクリア
        pkContainer.classList.remove('under-small', 'under-large');

        if (mode === 'none' || !boardState.visible) {
            return;
        }

        // アクティブなモードのみ表示
        if (mode === 'small') {
            scoreboardSmall.classList.remove('hidden');
            pkContainer.classList.add('under-small');
        } else if (mode === 'large') {
            scoreboardLarge.classList.remove('hidden');
            pkContainer.classList.add('under-large');
        } else if (mode === 'vs') {
            overlayVs.classList.remove('hidden');
        } else if (mode === 'lineup-home' || mode === 'lineup-away') {
            overlayLineup.classList.remove('hidden');
        }

        // チームカラーの動的適用 (CSS変数)
        document.documentElement.style.setProperty('--home-color', boardState.homeColor || '#059669');
        document.documentElement.style.setProperty('--away-color', boardState.awayColor || '#1d4ed8');

        // 各表示部への流し込み
        // チーム名
        document.querySelectorAll('.team-home-name-display').forEach(el => el.textContent = boardState.homeName);
        document.querySelectorAll('.team-away-name-display').forEach(el => el.textContent = boardState.awayName);
        
        // 英語サブ名
        document.querySelectorAll('.team-home-sub-display').forEach(el => el.textContent = boardState.homeSubName || '');
        document.querySelectorAll('.team-away-sub-display').forEach(el => el.textContent = boardState.awaySubName || '');

        // 大会名
        document.querySelectorAll('.tournament-display-text').forEach(el => el.textContent = boardState.tournamentName || '');

        // スコア
        document.querySelectorAll('.team-home-score-display').forEach(el => {
            const formattedScore = (mode === 'large') ? String(boardState.homeScore).padStart(2, '0') : boardState.homeScore;
            updateValueWithAnimation(el, formattedScore);
        });
        document.querySelectorAll('.team-away-score-display').forEach(el => {
            const formattedScore = (mode === 'large') ? String(boardState.awayScore).padStart(2, '0') : boardState.awayScore;
            updateValueWithAnimation(el, formattedScore);
        });

        // ピリオド
        document.querySelectorAll('.period-display-text').forEach(el => el.textContent = boardState.period);

        // 時間
        document.querySelectorAll('.time-display-text').forEach(el => el.textContent = boardState.time);

        // アディショナルタイム
        document.querySelectorAll('.at-display-text').forEach(el => {
            if (boardState.additionalTime > 0) {
                el.textContent = `+${boardState.additionalTime}`;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // ロゴ画像の反映
        const hasHomeLogo = boardState.homeLogo && !boardState.homeLogo.startsWith('data:image/svg+xml');
        const hasAwayLogo = boardState.awayLogo && !boardState.awayLogo.startsWith('data:image/svg+xml');

        document.querySelectorAll('.team-home-logo-display').forEach(img => {
            const logoBox = img.closest('.logo-box');
            if (hasHomeLogo) {
                img.src = boardState.homeLogo;
                img.style.opacity = '1';
                img.style.display = 'block';
                if (logoBox) logoBox.style.display = 'flex';
            } else {
                img.style.opacity = '0';
                img.style.display = 'none';
                if (logoBox) logoBox.style.display = 'none';
            }
        });
        document.querySelectorAll('.team-away-logo-display').forEach(img => {
            const logoBox = img.closest('.logo-box');
            if (hasAwayLogo) {
                img.src = boardState.awayLogo;
                img.style.opacity = '1';
                img.style.display = 'block';
                if (logoBox) logoBox.style.display = 'flex';
            } else {
                img.style.opacity = '0';
                img.style.display = 'none';
                if (logoBox) logoBox.style.display = 'none';
            }
        });

        // 対戦（VS）用ロゴボックスおよびラッパーの処理（自動伸縮）
        const vsTeamHome = document.querySelector('.vs-team.vs-home');
        const vsTeamAway = document.querySelector('.vs-team.vs-away');
        if (vsTeamHome) {
            if (hasHomeLogo) vsTeamHome.classList.remove('no-logo');
            else vsTeamHome.classList.add('no-logo');
        }
        if (vsTeamAway) {
            if (hasAwayLogo) vsTeamAway.classList.remove('no-logo');
            else vsTeamAway.classList.add('no-logo');
        }
    }

    // 数値変更時のフリックアニメーション
    function updateValueWithAnimation(element, newValue) {
        const currentValue = element.textContent;
        if (currentValue !== String(newValue)) {
            element.style.transform = 'scale(1.3)';
            element.style.color = '#38bdf8';
            element.textContent = newValue;
            setTimeout(() => {
                element.style.transform = 'scale(1)';
                element.style.color = '#ffffff';
            }, 300);
        }
    }

    // PKインジケーターの更新
    function updatePk(state) {
        if (!state.visible) {
            pkContainer.classList.add('hidden');
            return;
        }
        pkContainer.classList.remove('hidden');

        // 各チームのボール状態を反映
        updateTeamPkBalls(homePkBalls, state.homeResults, state.currentTeam === 'home' ? state.currentIndex : -1);
        updateTeamPkBalls(awayPkBalls, state.awayResults, state.currentTeam === 'away' ? state.currentIndex : -1);
    }

    function updateTeamPkBalls(ballElements, results, currentIndex) {
        ballElements.forEach((ball, idx) => {
            // クラスを初期化
            ball.className = 'pk-ball';
            if (idx >= 5) {
                ball.classList.add('extra');
            }

            // サドンデス用の表示制御
            // 通常5本を超える場合、またはそのインデックスが結果として埋まっているか、現在のキッカーである場合表示する
            if (idx >= 5) {
                if (idx < results.length || idx === currentIndex) {
                    ball.classList.add('active');
                } else {
                    ball.classList.remove('active');
                }
            }

            // 状態の適用
            const result = results[idx];
            if (result === 'success') {
                ball.classList.add('success');
            } else if (result === 'miss') {
                ball.classList.add('miss');
            }

            // 現在のキッカーを強調
            if (idx === currentIndex) {
                ball.classList.add('current');
            }
        });
    }

    // クロマキー背景の更新
    function updateChromakey(color) {
        body.className = `chromakey-${color}`;
    }

    // 選手紹介テロップの顔写真アイコン (photos/未設置・ロゴ未設定時の最終フォールバック)
    const SPORT_FALLBACK_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="46" fill="#e5e7eb" stroke="#94a3b8" stroke-width="3"/>' +
        '<polygon points="50,30 61,38 57,51 43,51 39,38" fill="#334155"/>' +
        '<path d="M50 30 L50 12 M61 38 L76 28 M57 51 L68 64 M43 51 L32 64 M39 38 L24 28" stroke="#334155" stroke-width="3" fill="none"/>' +
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

    // 選手テロップ（ワンショットテロップ）の表示
    function showPlayerTelop(player, duration) {
        // 既存のタイマーをクリア
        if (telopTimeoutId) {
            clearTimeout(telopTimeoutId);
        }

        // データをセット
        playerNumber.textContent = player.number || '-';
        playerPosition.textContent = player.position || '-';
        playerTeam.textContent = player.team || '';
        playerNameJa.textContent = player.name || '選手名';
        playerMemo.textContent = player.memo || '';
        if (playerComment) {
            playerComment.textContent = player.comment || '';
            playerComment.style.fontSize = '18px'; // 初期フォントサイズにリセット
        }

        // チームカラーの適用 (CSS変数)
        if (player.teamColor) {
            document.documentElement.style.setProperty('--player-team-color', player.teamColor);
        } else {
            document.documentElement.style.setProperty('--player-team-color', '#059669');
        }

        // 選手紹介画像の適用 (顔写真 > チームロゴ > 競技アイコン)
        const playerTeamLogo = document.getElementById('player-team-logo');
        setPlayerIntroImage(playerTeamLogo, player.team, player.number, player.teamLogo);

        // カスタム画像テロップが表示されている場合は非表示に
        imageTelopWrapper.classList.add('hidden');

        // テロップ表示
        telopWrapper.classList.remove('hidden');

        // 表示後にフォントサイズを自動調整して1行(最大480px)に収める
        if (playerComment && player.comment) {
            let fontSize = 18;
            const maxCommentWidth = 480;
            // はみ出している間、フォントサイズを縮小 (最小10px)
            while (playerComment.scrollWidth > maxCommentWidth && fontSize > 10) {
                fontSize -= 0.5;
                playerComment.style.fontSize = `${fontSize}px`;
            }
        }

        // 自動非表示タイマー
        if (duration && duration > 0) {
            telopTimeoutId = setTimeout(() => {
                hidePlayerTelop();
            }, duration * 1000);
        }
    }

    // 選手テロップ非表示
    function hidePlayerTelop() {
        telopWrapper.classList.add('hidden');
        if (telopTimeoutId) {
            clearTimeout(telopTimeoutId);
            telopTimeoutId = null;
        }
    }

    // スライド画像テロップの表示
    function showImageTelop(imageUrl, duration) {
        if (telopTimeoutId) {
            clearTimeout(telopTimeoutId);
        }

        // 画像URLをセット
        imageTelopSrc.src = imageUrl;

        // 選手テロップを隠す
        telopWrapper.classList.add('hidden');

        // スライド画像を表示
        imageTelopWrapper.classList.remove('hidden');

        if (duration && duration > 0) {
            telopTimeoutId = setTimeout(() => {
                hideImageTelop();
            }, duration * 1000);
        }
    }

    // スライド画像テロップ非表示
    function hideImageTelop() {
        imageTelopWrapper.classList.add('hidden');
        if (telopTimeoutId) {
            clearTimeout(telopTimeoutId);
            telopTimeoutId = null;
        }
    }

    // ウィンドウサイズに合わせた自動スケーリング (1920x1080 / 1280x720対応)
    function adjustScale() {
        const baseWidth = 1920;
        const baseHeight = 1080;
        const container = document.getElementById('overlay-container');
        if (!container) return;

        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        // アスペクト比を維持してスケーリング
        const scale = Math.min(winWidth / baseWidth, winHeight / baseHeight);

        container.style.width = `${baseWidth}px`;
        container.style.height = `${baseHeight}px`;
        container.style.transform = `scale(${scale})`;
        container.style.transformOrigin = 'top left';
    }

    // スタメン一覧 (Lineup) の描画
    function renderLineup(team) {
        const sb = latestState ? latestState.scoreboard : {};
        const lineupTeamName = document.getElementById('lineup-team-name');
        const lineupTeamLogo = document.getElementById('lineup-team-logo');
        const lineupLogoBox = document.getElementById('lineup-header-logo-box');
        const lineupPlayersList = document.getElementById('lineup-players-list');
        const lineupHeaderBg = document.getElementById('lineup-header-bg');

        if (!lineupPlayersList) return;

        // 1. チーム情報の設定
        const tName = team === 'home' ? sb.homeName : sb.awayName;
        const tLogo = team === 'home' ? sb.homeLogo : sb.awayLogo;
        const tColor = team === 'home' ? sb.homeColor : sb.awayColor;

        if (lineupTeamName) lineupTeamName.innerText = tName || (team === 'home' ? 'HOME' : 'AWAY');
        if (lineupHeaderBg) {
            document.documentElement.style.setProperty('--lineup-team-color', tColor || '#1e293b');
        }

        // ロゴの表示・非表示
        if (tLogo) {
            if (lineupTeamLogo) {
                lineupTeamLogo.src = tLogo;
                lineupTeamLogo.style.opacity = '1';
            }
            if (lineupLogoBox) lineupLogoBox.style.display = 'flex';
        } else {
            if (lineupTeamLogo) lineupTeamLogo.src = '';
            if (lineupLogoBox) lineupLogoBox.style.display = 'none';
        }

        // 2. 選手リストの抽出と描画
        lineupPlayersList.innerHTML = '';
        const allPlayers = latestState && latestState.players ? (team === 'home' ? latestState.players.home : latestState.players.away) : [];
        
        if (!allPlayers || allPlayers.length === 0) {
            lineupPlayersList.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">選手データがありません。</div>';
            return;
        }

        // スタメン（lineup === 'starting'）のみを抽出
        const starters = allPlayers.filter(p => p.lineup === 'starting');
        
        // サッカー: ポジション順 (GK -> DF -> MF -> FW) ソート。同ポジション内は背番号順
        function getPosRank(pos) {
            if (!pos) return 99;
            const p = pos.toUpperCase();
            if (p.includes('GK')) return 1;
            if (p.includes('DF')) return 2;
            if (p.includes('MF')) return 3;
            if (p.includes('FW')) return 4;
            return 99;
        }

        starters.sort((a, b) => {
            const ra = getPosRank(a.position);
            const rb = getPosRank(b.position);
            if (ra !== rb) return ra - rb;
            return (parseInt(a.number) || 99) - (parseInt(b.number) || 99);
        });

        // 11選手を描画
        starters.forEach(p => {
            const row = document.createElement('div');
            row.className = 'lineup-player-row';
            
            const pos = p.position || '控え';
            const num = p.number || '-';
            const name = p.name || '';
            const grade = p.memo || ''; // サッカー選手データの「学年」は「memo」キーに格納されている

            row.innerHTML = `
                <div class="lineup-left-block">
                    <div class="lineup-pos-label">${pos}</div>
                    <div class="lineup-num-label">${num}</div>
                </div>
                <div class="lineup-right-block">
                    <div class="lineup-name-label">${name}</div>
                    <div class="lineup-grade-tag">${grade}</div>
                </div>
            `;
            lineupPlayersList.appendChild(row);

            // 氏名のフォントサイズ自動スケーリング (長い海外選手等の対策)
            const nameEl = row.querySelector('.lineup-name-label');
            if (nameEl) {
                let fontSize = 24; // 初期値 24px
                nameEl.style.fontSize = `${fontSize}px`;
                // 表示幅上限 180px に収まるまで 0.5px ずつ縮小
                while (nameEl.scrollWidth > 180 && fontSize > 11) {
                    fontSize -= 0.5;
                    nameEl.style.fontSize = `${fontSize}px`;
                }
            }
        });
    }

    // 初期実行とリサイズイベントの監視
    adjustScale();
    window.addEventListener('resize', adjustScale);

    // ==========================================================================
    // フルスクリーン ＆ マウスアイドル非表示制御 (HDMI/スイッチャー出力用)
    // ==========================================================================
    // --- フルスクリーン ＆ マウスアイドル非表示制御 (HDMI/スイッチャー出力用) ---
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
});
