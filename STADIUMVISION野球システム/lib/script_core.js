/* ==========================================================================
   台本・キューの共通部品（サーバーと管理画面の両方で使う）
   - どのキューが「次」か／キューから本線の画面を作る／台本の文字からキューを提案する
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScriptCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const FUTA_FOLDER = 'slides/フタ/';
    const IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;

    const norm = s => String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

    // キューの付いた行の番号（0から）の一覧
    function cueRows(script) {
        const out = [];
        (script.rows || []).forEach((r, i) => { if (r.cue) out.push(i); });
        return out;
    }
    // 読み位置より後で最初のキュー付きの行（無ければ -1）
    function nextCueRow(script) {
        for (let i = script.pos + 1; i < script.rows.length; i++) if (script.rows[i].cue) return i;
        return -1;
    }
    // 読み位置より前で最後のキュー付きの行（無ければ -1）
    function prevCueRow(script) {
        for (let i = Math.min(script.pos, script.rows.length) - 1; i >= 0; i--) if (script.rows[i].cue) return i;
        return -1;
    }

    // フタの画像の場所。設定が空なら slides/フタ/ の中の最初の画像（slideList は /api/slides の結果）。無ければ ''
    function resolveLogo(futa, kind, slideList) {
        const set = futa && futa[kind];
        if (set) return set;
        const inFolder = (slideList || []).filter(s => s.kind === 'image' && s.path.startsWith(FUTA_FOLDER) && IMG_RE.test(s.path));
        if (inFolder.length === 0) return '';
        const hint = kind === 'left' ? ['左', 'left'] : ['全面', 'full', '帯'];
        const hit = inFolder.find(s => hint.some(h => s.path.toLowerCase().includes(h)));
        return (hit || inFolder[0]).path;
    }

    function faceToSrc(face, logoPath) {
        if (!face) return null;
        switch (face.type) {
            case 'slide': return { type: 'slide', file: face.file };
            case 'camera': return { type: 'camera', cam: face.cam };
            case 'futa': return logoPath ? { type: 'slide', file: logoPath } : { type: 'black' };
            default: return { type: 'black' };
        }
    }

    // キューを出したあとの本線の画面（base は出す前の本線）。logos = { left, full }
    function buildScene(cue, base, logos) {
        if (cue.scene) return JSON.parse(JSON.stringify(cue.scene));
        const sc = JSON.parse(JSON.stringify(base));
        if (cue.band) {
            sc.layout = 'wide';
            sc.slots.wide = faceToSrc(cue.band, logos.full);
        } else if (cue.left || cue.right) {
            sc.layout = 'split';
            if (cue.left) sc.slots.left = faceToSrc(cue.left, logos.left);
            if (cue.right) sc.slots.right = faceToSrc(cue.right, logos.left);
        }
        return sc;
    }

    // ---- 提案 -----------------------------------------------------------------
    const SAME_RE = /^(↓|⇓|〃|以下[、,，]?(繰り返し|くり返し|同じ|同様))$/;
    const isSame = t => SAME_RE.test(norm(t));
    const FADE_RE = /fadeout|フェードアウト|フェード|(^|[^a-z])f\.?o\.?([^a-z]|$)/;
    const STOP_RE = /stop|停止|無音/;
    const LOOP_RE = /ループ|loop|リピート|繰り返し|くり返し/;

    function slideKey(name) { return norm(String(name).replace(/^\d+[_\-.\s　]*/, '')); }

    // 台本の1行から、キューの「提案」を作る。ctx = { music: [{path,name}], slides: [{path,name,folder}] }
    // 戻り値：{ cue, reasons[], hints[] } または null
    function suggestCue(row, ctx) {
        const cue = { left: null, right: null, band: null, bgm: null, memo: '' };
        const reasons = [], hints = [];

        // 曲・スライドの名前の正規化は1回だけ（台本が3000行でも速くするため）
        if (!ctx._songs) ctx._songs = (ctx.music || []).map(s => ({ s, k: norm(s.name) })).filter(x => x.k.length >= 1);
        if (!ctx._slides) ctx._slides = (ctx.slides || []).filter(s => !s.path.startsWith(FUTA_FOLDER)).map(s => ({ s, k: slideKey(s.name) })).filter(x => x.k);

        const bgmText = row.bgm || '';
        if (bgmText && !isSame(bgmText)) {
            const titles = [];
            const re = /『([^』]+)』/g;
            let m;
            while ((m = re.exec(bgmText))) titles.push(m[1]);
            const n = norm(bgmText);
            if (titles.length) {
                const songs = ctx._songs;
                let hit = null;
                for (const t of titles) {
                    const k = norm(t);
                    hit = songs.find(x => x.k === k) || songs.find(x => k.length >= 2 && (x.k.includes(k) || (x.k.length >= 2 && k.includes(x.k))));
                    if (hit) break;
                }
                if (hit) {
                    cue.bgm = { action: 'play', path: hit.s.path, name: hit.s.name, loop: LOOP_RE.test(n) };
                    reasons.push(`BGM「${hit.s.name}」${cue.bgm.loop ? '（くり返し）' : ''}`);
                } else {
                    hints.push(`曲が見つかりません：${titles[0]}`);
                }
            } else if (FADE_RE.test(n)) {
                cue.bgm = { action: 'fade' };
                reasons.push('BGM フェードアウト');
            } else if (STOP_RE.test(n)) {
                cue.bgm = { action: 'stop' };
                reasons.push('BGM 停止');
            }
        }

        const vis = row.vision || '';
        if (vis && !isSame(vis)) {
            const n = norm(vis);
            if (n.includes('ロゴ')) {
                if (n.includes('全面')) { cue.band = { type: 'futa' }; reasons.push('全面フタ'); }
                else { cue.left = { type: 'futa' }; reasons.push('左フタ'); }
            }
            if (!cue.band && (n.includes('ライブカメラ') || n.includes('カメラ'))) {
                cue.right = { type: 'camera', cam: 'cam1' };
                reasons.push('右面 カメラ');
            }
        }

        // 内容がスライドのファイル名（番号・拡張子を除く）と合うとき、左面のスライドを提案
        const title = row.title || '';
        if (title && !isSame(title) && !cue.left && !cue.band) {
            const lines = [title, ...title.split('\n')].map(norm).filter(Boolean);
            let best = null, bestScore = 0;
            ctx._slides.forEach(({ s, k }) => {
                lines.forEach(l => {
                    let score = 0;
                    if (l === k) score = 1000 + k.length;
                    else if (k.length >= 3 && l.includes(k)) score = k.length;
                    else if (l.length >= 3 && k.includes(l)) score = l.length - 0.5;
                    if (score > bestScore) { best = s; bestScore = score; }
                });
            });
            if (best) { cue.left = { type: 'slide', file: best.path }; reasons.push(`左面 スライド「${best.name}」`); }
        }

        if (!cue.left && !cue.right && !cue.band && !cue.bgm) return hints.length ? { cue: null, reasons, hints } : null;
        return { cue, reasons, hints };
    }

    function describeFace(f) {
        if (!f) return '';
        if (f.type === 'slide') return 'スライド ' + String(f.file).split('/').pop().replace(/\.[^.]+$/, '');
        if (f.type === 'camera') return 'カメラ' + (f.cam === 'cam2' ? '2' : '1');
        if (f.type === 'futa') return 'フタ';
        return '黒';
    }

    return { cueRows, nextCueRow, prevCueRow, resolveLogo, buildScene, suggestCue, describeFace, isSame, norm, FUTA_FOLDER };
}));
