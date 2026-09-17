/* ==========================================================================
   配信画面用オーバーレイ JavaScript
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // 出力モード判定 (URL引数 ?mode=fill または ?mode=key)
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'fill') {
        document.body.classList.add('fill-mode');
        document.body.classList.remove('key-mode');
    } else if (modeParam === 'key') {
        document.body.classList.add('key-mode');
        document.body.classList.remove('fill-mode');
    }

    // 状態の初期化
    let state = {
        scoreboard: {
            visible: true,
            displayMode: 'small',
            homeName: 'HOME TEAM',
            homeSubName: 'HOME',
            homeColor: '#059669',
            homeLogo: '',
            awayName: 'AWAY TEAM',
            awaySubName: 'AWAY',
            awayColor: '#1d4ed8',
            awayLogo: '',
            tournamentName: '',
            inningNum: 1,
            inningHalf: 'top',
            homeInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''],
            awayInningScores: ['', '', '', '', '', '', '', '', '', '', '', ''],
            homeScore: 0,
            awayScore: 0,
            homeHits: 0,
            awayHits: 0,
            homeErrors: 0,
            awayErrors: 0,
            balls: 0,
            strikes: 0,
            outs: 0,
            runner1st: false,
            runner2nd: false,
            runner3rd: false,
            batterName: '',
            batterNumber: '',
            pitcherName: '',
            pitcherNumber: '',
            pitchCount: 0,
            speedImage: '',
            pitchImage: ''
        },
        chromakey: 'green'
    };

    // BroadcastChannel
    const channel = new BroadcastChannel('baseball_overlay_channel');

    // タイマー管理用
    let playerTelopTimer = null;
    let imageTelopTimer = null;

    // DOM要素のキャッシュ
    const body = document.body;
    const scoreboardSmall = document.getElementById('scoreboard-small');
    const overlayVs = document.getElementById('overlay-vs');
    const scoreboardLarge = document.getElementById('scoreboard-large');
    const scoreboardLargeSoccer = document.getElementById('scoreboard-large-soccer');
    const overlayLineup = document.getElementById('overlay-lineup');
    const telopWrapper = document.getElementById('telop-wrapper');
    const imageTelopWrapper = document.getElementById('image-telop-wrapper');

    // ==========================================================================
    // UI 更新メイン処理
    // ==========================================================================
    
    function updateUI() {
        const sb = state.scoreboard;

        // 1. クロマキー背景の更新
        body.className = '';
        if (state.chromakey === 'green') body.classList.add('chromakey-green');
        else if (state.chromakey === 'blue') body.classList.add('chromakey-blue');
        else if (state.chromakey === 'magenta') body.classList.add('chromakey-magenta');
        else if (state.chromakey === 'transparent') body.classList.add('chromakey-transparent');

        // 2. 表示モードの更新
        scoreboardSmall.classList.add('hidden');
        overlayVs.classList.add('hidden');
        scoreboardLarge.classList.add('hidden');
        scoreboardLargeSoccer.classList.add('hidden');
        overlayLineup.classList.add('hidden');

        if (sb.displayMode === 'small') {
            scoreboardSmall.classList.remove('hidden');
        } else if (sb.displayMode === 'vs') {
            overlayVs.classList.remove('hidden');
        } else if (sb.displayMode === 'large') {
            scoreboardLarge.classList.remove('hidden');
        } else if (sb.displayMode === 'large-soccer') {
            scoreboardLargeSoccer.classList.remove('hidden');
        } else if (sb.displayMode === 'lineup-home' || sb.displayMode === 'lineup-away') {
            overlayLineup.classList.remove('hidden');
            renderLineup(sb.displayMode === 'lineup-home' ? 'home' : 'away');
        }

        // 3. チーム名などのテキスト反映
        document.querySelectorAll('.team-home-name-display').forEach(el => el.innerText = sb.homeName);
        document.querySelectorAll('.team-away-name-display').forEach(el => el.innerText = sb.awayName);
        document.querySelectorAll('.team-home-score-display').forEach(el => el.innerText = sb.homeScore);
        document.querySelectorAll('.team-away-score-display').forEach(el => el.innerText = sb.awayScore);

        // 英語サブ名
        document.querySelectorAll('.team-home-sub-display').forEach(el => el.innerText = sb.homeSubName || '');
        document.querySelectorAll('.team-away-sub-display').forEach(el => el.innerText = sb.awaySubName || '');

        // 大会名
        document.querySelectorAll('.tournament-display-text').forEach(el => el.innerText = sb.tournamentName);
        const ltitle = document.getElementById('large-tournament-title');
        if (ltitle) ltitle.innerText = sb.tournamentName;

        const hasHomeLogo = sb.homeLogo && !sb.homeLogo.startsWith('data:image/svg+xml');
        const hasAwayLogo = sb.awayLogo && !sb.awayLogo.startsWith('data:image/svg+xml');

        // ロゴ画像
        document.querySelectorAll('.team-home-logo-display').forEach(img => {
            const logoBox = img.closest('.logo-box');
            if (hasHomeLogo) {
                img.src = sb.homeLogo;
                img.style.opacity = '1';
                if (logoBox) logoBox.style.display = 'flex';
            } else {
                img.style.opacity = '0';
                if (logoBox) logoBox.style.display = 'none';
            }
        });
        document.querySelectorAll('.team-away-logo-display').forEach(img => {
            const logoBox = img.closest('.logo-box');
            if (hasAwayLogo) {
                img.src = sb.awayLogo;
                img.style.opacity = '1';
                if (logoBox) logoBox.style.display = 'flex';
            } else {
                img.style.opacity = '0';
                if (logoBox) logoBox.style.display = 'none';
            }
        });

        // 対戦（VS）用ロゴボックスおよびラッパーの処理
        const vsTeamHome = document.getElementById('vs-team-home');
        const vsTeamAway = document.getElementById('vs-team-away');
        const vsLogoBoxHome = document.getElementById('vs-logo-box-home');
        const vsLogoBoxAway = document.getElementById('vs-logo-box-away');

        if (hasHomeLogo) {
            if (vsLogoBoxHome) vsLogoBoxHome.style.display = 'flex';
            if (vsTeamHome) vsTeamHome.classList.remove('no-logo');
        } else {
            if (vsLogoBoxHome) vsLogoBoxHome.style.display = 'none';
            if (vsTeamHome) vsTeamHome.classList.add('no-logo');
        }

        if (hasAwayLogo) {
            if (vsLogoBoxAway) vsLogoBoxAway.style.display = 'flex';
            if (vsTeamAway) vsTeamAway.classList.remove('no-logo');
        } else {
            if (vsLogoBoxAway) vsLogoBoxAway.style.display = 'none';
            if (vsTeamAway) vsTeamAway.classList.add('no-logo');
        }

        // 4. チームカラーの反映 (CSS変数とカラーライン)
        document.documentElement.style.setProperty('--home-color', sb.homeColor || '#059669');
        document.documentElement.style.setProperty('--away-color', sb.awayColor || '#1d4ed8');

        const smallHomeColor = document.getElementById('small-home-color-bar');
        const smallAwayColor = document.getElementById('small-away-color-bar');
        if (smallHomeColor) smallHomeColor.style.backgroundColor = sb.homeColor;
        if (smallAwayColor) smallAwayColor.style.backgroundColor = sb.awayColor;

        const largeHomeColor = document.getElementById('large-home-color-bar');
        const largeAwayColor = document.getElementById('large-away-color-bar');
        if (largeHomeColor) largeHomeColor.style.backgroundColor = sb.homeColor;
        if (largeAwayColor) largeAwayColor.style.backgroundColor = sb.awayColor;

        // ==========================================
        // 大得点（サッカー風）モード特有の更新
        // ==========================================
        if (sb.displayMode === 'large-soccer') {
            const lSoccerInning = document.getElementById('large-soccer-inning-text');
            if (lSoccerInning) {
                if (sb.inningHalf === 'end') {
                    lSoccerInning.innerText = '終了';
                } else {
                    const halfKanji = sb.inningHalf === 'top' ? '表' : '裏';
                    lSoccerInning.innerText = `${sb.inningNum}回${halfKanji}`;
                }
            }
        }

        // ==========================================
        // 小得点モード特有の更新
        // ==========================================
        if (sb.displayMode === 'small') {
            // イニング漢字表示
            const inText = document.getElementById('small-inning-text');
            if (inText) {
                if (sb.inningHalf === 'end') {
                    inText.innerText = '終了';
                } else {
                    const halfKanji = sb.inningHalf === 'top' ? '表' : '裏';
                    inText.innerText = `${sb.inningNum}回${halfKanji}`;
                }
            }

            // ランナー
            const r1 = document.getElementById('runner-1st');
            const r2 = document.getElementById('runner-2nd');
            const r3 = document.getElementById('runner-3rd');
            if (sb.runner1st) r1.classList.add('active'); else r1.classList.remove('active');
            if (sb.runner2nd) r2.classList.add('active'); else r2.classList.remove('active');
            if (sb.runner3rd) r3.classList.add('active'); else r3.classList.remove('active');

            // BSOランプ
            for (let i = 1; i <= 3; i++) {
                const lamp = document.getElementById(`lamp-b${i}`);
                if (i <= sb.balls) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }
            for (let i = 1; i <= 2; i++) {
                const lamp = document.getElementById(`lamp-s${i}`);
                if (i <= sb.strikes) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }
            for (let i = 1; i <= 2; i++) {
                const lamp = document.getElementById(`lamp-o${i}`);
                if (i <= sb.outs) lamp.classList.add('active');
                else lamp.classList.remove('active');
            }

            // 投球数フォールバック（カメラ画像が無いとき用）
            const plPitch = document.getElementById('placeholder-pitch');
            if (plPitch) plPitch.innerText = sb.pitchCount;

            // クロップ画像更新
            drawCropImages(sb.speedImage, sb.pitchImage);
        }

        // ==========================================
        // 大得点モード特有の更新
        // ==========================================
        if (sb.displayMode === 'large') {
            // 1. 既存の動的延長列をすべて削除 (クリーンアップ)
            document.querySelectorAll('.dynamic-extra-col').forEach(el => el.remove());

            // 2. 最大表示イニングの決定 (1〜9回は固定、10回以降はデータが存在するか現在イニングまで自動拡張)
            let maxDisplayInning = 9;
            for (let i = 9; i < 12; i++) { // 最大12回まで
                if ((sb.awayInningScores[i] !== '' && sb.awayInningScores[i] !== undefined) ||
                    (sb.homeInningScores[i] !== '' && sb.homeInningScores[i] !== undefined)) {
                    maxDisplayInning = i + 1;
                }
            }
            if (sb.inningNum >= 10 && sb.inningNum <= 12) {
                maxDisplayInning = Math.max(maxDisplayInning, sb.inningNum);
            }

            // 3. 10回以上の列を動的に作成・挿入
            if (maxDisplayInning > 9) {
                const theadRow = document.querySelector('.running-score-board thead tr');
                const th9 = theadRow.children[9]; // TEAMが0番目、1〜9回が1〜9番目のため、9回はインデックス9

                const tdAway9 = document.getElementById('lscore-away-9');
                const tdHome9 = document.getElementById('lscore-home-9');

                let currentThRef = th9;
                let currentTdAwayRef = tdAway9;
                let currentTdHomeRef = tdHome9;

                for (let inn = 10; inn <= maxDisplayInning; inn++) {
                    // ヘッダー th 作成・挿入
                    const thExtra = document.createElement('th');
                    thExtra.className = 'dynamic-extra-col';
                    thExtra.innerText = inn;
                    currentThRef.parentNode.insertBefore(thExtra, currentThRef.nextSibling);
                    currentThRef = thExtra;

                    // AWAY得点 td 作成・挿入
                    const tdAwayExtra = document.createElement('td');
                    tdAwayExtra.className = 'dynamic-extra-col';
                    tdAwayExtra.id = `lscore-away-${inn}`;
                    currentTdAwayRef.parentNode.insertBefore(tdAwayExtra, currentTdAwayRef.nextSibling);
                    currentTdAwayRef = tdAwayExtra;

                    // HOME得点 td 作成・挿入
                    const tdHomeExtra = document.createElement('td');
                    tdHomeExtra.className = 'dynamic-extra-col';
                    tdHomeExtra.id = `lscore-home-${inn}`;
                    currentTdHomeRef.parentNode.insertBefore(tdHomeExtra, currentTdHomeRef.nextSibling);
                    currentTdHomeRef = tdHomeExtra;
                }
            }

            // 4. 得点値の流し込み (未済の回はブランク)
            for (let i = 1; i <= maxDisplayInning; i++) {
                const aCell = document.getElementById(`lscore-away-${i}`);
                const hCell = document.getElementById(`lscore-home-${i}`);
                
                const aVal = sb.awayInningScores[i - 1];
                const hVal = sb.homeInningScores[i - 1];
                if (aCell) aCell.innerText = (aVal !== undefined && aVal !== null && aVal !== '') ? aVal : '';
                if (hCell) hCell.innerText = (hVal !== undefined && hVal !== null && hVal !== '') ? hVal : '';
            }
            
            // H, E
            const lhHomeH = document.getElementById('large-home-h');
            const lhAwayH = document.getElementById('large-away-h');
            const lhHomeE = document.getElementById('large-home-e');
            const lhAwayE = document.getElementById('large-away-e');
            
            if (lhHomeH) lhHomeH.innerText = sb.homeHits;
            if (lhAwayH) lhAwayH.innerText = sb.awayHits;
            if (lhHomeE) lhHomeE.innerText = sb.homeErrors;
            if (lhAwayE) lhAwayE.innerText = sb.awayErrors;
        }

        // 5. 大得点での H/E 表示切り替え
        const showHE = sb.showHE !== false; // デフォルトは true
        document.querySelectorAll('.he-col').forEach(el => {
            if (showHE) {
                el.classList.remove('hide-col');
            } else {
                el.classList.add('hide-col');
            }
        });
    }

    // スタメン一覧 (Lineup) の描画
    function renderLineup(team) {
        const sb = state.scoreboard;
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

        if (lineupTeamName) lineupTeamName.innerText = tName;
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
        const allPlayers = state.players ? (team === 'home' ? state.players.home : state.players.away) : [];
        
        if (!allPlayers || allPlayers.length === 0) {
            lineupPlayersList.innerHTML = '<div style="color: #ffffff; text-align: center; padding: 10px;">選手データがありません。</div>';
            return;
        }

        // スタメン（lineup === 'starting'）のみを抽出
        const starters = allPlayers.filter(p => p.lineup === 'starting');
        
        // 野球: 打順順（order）にソート (1〜9番)
        starters.sort((a, b) => {
            const oa = parseInt(a.order) || 99;
            const ob = parseInt(b.order) || 99;
            return oa - ob;
        });

        // 選手行を描画
        starters.forEach(p => {
            const row = document.createElement('div');
            row.className = 'lineup-player-row';
            
            const pos = p.position || '指';
            const num = p.number || '-';
            const name = p.name || '';
            const grade = p.grade || '';

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

    // カメラクロップ画像の描画処理
    function drawCropImages(speedBase64, pitchBase64) {
        const speedImg = document.getElementById('cam-speed-image');
        const pitchImg = document.getElementById('cam-pitch-image');
        const speedPl = document.getElementById('placeholder-speed');
        const pitchPl = document.getElementById('placeholder-pitch');

        if (speedBase64) {
            speedImg.src = speedBase64;
            speedImg.style.display = 'block';
            if (speedPl) speedPl.style.display = 'none';
        } else {
            speedImg.src = '';
            speedImg.style.display = 'none';
            if (speedPl) speedPl.style.display = 'block';
        }

        if (pitchBase64) {
            pitchImg.src = pitchBase64;
            pitchImg.style.display = 'block';
            if (pitchPl) pitchPl.style.display = 'none';
        } else {
            pitchImg.src = '';
            pitchImg.style.display = 'none';
            if (pitchPl) pitchPl.style.display = 'block';
        }
    }

    // ==========================================================================
    // 選手紹介テロップ (ワンショットテロップ) & はみ出し防止
    // ==========================================================================
    
    // 選手紹介テロップの顔写真アイコン (photos/未設置・ロゴ未設定時の最終フォールバック)
    const SPORT_FALLBACK_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="46" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>' +
        '<path d="M30 20 Q50 50 30 80" stroke="#dc2626" stroke-width="3" fill="none"/>' +
        '<path d="M70 20 Q50 50 70 80" stroke="#dc2626" stroke-width="3" fill="none"/>' +
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

    function showPlayerTelop(player, duration, displayAs) {
        // タイマーのリセット
        if (playerTelopTimer) {
            clearTimeout(playerTelopTimer);
        }

        // テロップ内容の書き換え
        document.getElementById('player-team').innerText = player.teamName;
        document.getElementById('player-position').innerText = player.position;
        document.getElementById('player-number').innerText = player.number;
        
        const nameEl = document.getElementById('player-name-ja');
        nameEl.innerText = player.name;
        nameEl.style.fontSize = '42px'; // サッカー基準 (初期値 42px)

        const commentEl = document.getElementById('player-comment');
        commentEl.innerText = player.comment;
        commentEl.style.fontSize = '18px'; // サッカー基準 (初期値 18px)

        document.getElementById('player-memo').innerText = player.grade;

        // 選手紹介画像の適用 (顔写真 > チームロゴ > 競技アイコン)
        const logoImg = document.getElementById('player-team-logo');
        setPlayerIntroImage(logoImg, player.teamName, player.number, player.teamLogo);
        document.getElementById('player-team-color-box').style.backgroundColor = player.teamColor;

        // 野球成績表示
        const statsBox = document.getElementById('player-stats-box');
        const showAsPitcher = displayAs ? (displayAs === 'pitcher') : (player.position.indexOf('投') !== -1);
        
        if (showAsPitcher) {
            // 投手の成績
            document.getElementById('stats-lbl-1').innerText = '防御率';
            document.getElementById('stats-val-1').innerText = player.era || '0.00';
            
            document.getElementById('stats-lbl-2').innerText = '球数';
            document.getElementById('stats-val-2').innerText = player.pitches || '0';
            
            document.getElementById('stats-field-3').style.display = 'none';
        } else {
            // 打者の成績
            document.getElementById('stats-lbl-1').innerText = '打率';
            document.getElementById('stats-val-1').innerText = player.avg || '.000';
            
            document.getElementById('stats-lbl-2').innerText = '本塁打';
            document.getElementById('stats-val-2').innerText = player.hr || '0';
            
            document.getElementById('stats-field-3').style.display = 'flex';
            document.getElementById('stats-lbl-3').innerText = '打点';
            document.getElementById('stats-val-3').innerText = player.rbi || '0';
        }

        // 表示アニメーション
        telopWrapper.classList.remove('hidden');

        // 文字はみ出し防止ロジック (Auto-scaling)
        let nameFontSize = 42;
        while (nameEl.scrollWidth > 320 && nameFontSize > 20) {
            nameFontSize -= 0.5;
            nameEl.style.fontSize = `${nameFontSize}px`;
        }

        let commentFontSize = 18;
        while (commentEl.scrollWidth > 320 && commentFontSize > 10) {
            commentFontSize -= 0.5;
            commentEl.style.fontSize = `${commentFontSize}px`;
        }

        // 表示時間タイマー (0の時は手動消去)
        if (duration > 0) {
            playerTelopTimer = setTimeout(() => {
                telopWrapper.classList.add('hidden');
            }, duration * 1000);
        }
    }

    // ==========================================================================
    // メッセージハンドラ
    // ==========================================================================
    
    // サーバー同期管理用変数
    let isServerConnected = false;
    let eventSource = null;

    function handleMessage(event) {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'PING') {
            channel.postMessage({ type: 'PONG' });
            if (window.opener) {
                window.opener.postMessage({ type: 'PONG' }, '*');
            }
        } else if (msg.type === 'UPDATE_STATE') {
            state = msg.data;
            updateUI();
        } else if (msg.type === 'CLOCK_IMAGE') {
            const cropWrapper = document.getElementById('camera-crop-overlay-wrapper');
            const cropImg = document.getElementById('camera-crop-img');
            if (cropWrapper && cropImg) {
                if (msg.visible && msg.image) {
                    cropImg.src = msg.image;
                    cropWrapper.classList.remove('hidden');
                } else {
                    cropWrapper.classList.add('hidden');
                }
            }
        } else if (msg.type === 'UPDATE_CROP_IMAGES') {
            drawCropImages(msg.data.speedImage, msg.data.pitchImage);
        } else if (msg.type === 'SHOW_PLAYER_TELOP') {
            showPlayerTelop(msg.data.player, msg.data.duration, msg.data.displayAs);
        } else if (msg.type === 'HIDE_PLAYER_TELOP') {
            if (playerTelopTimer) clearTimeout(playerTelopTimer);
            telopWrapper.classList.add('hidden');
        } else if (msg.type === 'SHOW_IMAGE_TELOP') {
            if (imageTelopTimer) clearTimeout(imageTelopTimer);
            
            const img = document.getElementById('image-telop-src');
            img.src = msg.data.url;
            imageTelopWrapper.classList.remove('hidden');
            
            if (msg.data.duration > 0) {
                imageTelopTimer = setTimeout(() => {
                    imageTelopWrapper.classList.add('hidden');
                }, msg.data.duration * 1000);
            }
        } else if (msg.type === 'HIDE_IMAGE_TELOP') {
            if (imageTelopTimer) clearTimeout(imageTelopTimer);
            imageTelopWrapper.classList.add('hidden');
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
                    if (JSON.stringify(state) !== JSON.stringify(newState)) {
                        state = newState;
                        updateUI();
                    }
                } catch (e) {
                    console.error("SSE parse error:", e);
                }
            });

            eventSource.addEventListener('EVENT', (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    handleMessage({ data: payload });
                } catch (e) {
                    console.error("SSE EVENT parse error:", e);
                }
            });

            eventSource.onerror = () => {
                isServerConnected = false;
            };
        }
    }

    channel.onmessage = (event) => {
        if (isServerConnected) return;
        handleMessage(event);
    };

    window.addEventListener('message', (event) => {
        if (isServerConnected) return;
        handleMessage(event);
    });

    setupServerSync();

    if (window.opener) {
        window.opener.postMessage({ type: 'PONG' }, '*');
    }

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