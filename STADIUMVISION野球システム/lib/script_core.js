/* ==========================================================================
   台本・キューの共通部品（サーバーと管理画面の両方で使う）
   - どのキューが「次」か／キューから本線の画面を作る／台本の文字からキューを提案する
   - 提案は「前の行との差分」だけを出す（左・右・BGM・ダックのどれも変わらない行には出さない）
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScriptCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const FUTA_FOLDER = 'slides/フタ/';
    const IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
    const SLIDE_EXT = '(?:png|jpe?g|webp|gif|svg|mp4|webm)';

    const norm = s => String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    // 曲名・ファイル名の照合用（全角半角・空白・_ の違いは無視）
    const normKey = s => norm(s).replace(/[_＿]/g, '');

    // 台本の行のうち、キューを付けられる行（章の行は除く）
    const isCueable = r => r.kind !== 'chapter';

    // キューの付いた行の番号（0から）の一覧
    function cueRows(script) {
        const out = [];
        (script.rows || []).forEach((r, i) => { if (r.cue) out.push(i); });
        return out;
    }
    // idx より後で最初のキュー付きの行（無ければ -1）
    function nextCueAfter(script, idx) {
        for (let i = idx + 1; i < script.rows.length; i++) if (script.rows[i].cue) return i;
        return -1;
    }
    // 「いま本線に出している行（onair）」より後で最初のキュー付きの行（NEXT で出す行）
    function nextCueRow(script) { return nextCueAfter(script, script.onair); }
    // 「いま本線に出している行」より前で最後のキュー付きの行（PREV で出し直す行）
    function prevCueRow(script) {
        for (let i = Math.min(script.onair, script.rows.length) - 1; i >= 0; i--) if (script.rows[i].cue) return i;
        return -1;
    }

    // フタ（ロゴ）の画像の場所。設定が空なら slides/フタ/ の中の最初の画像（slideList は /api/slides の結果）。無ければ ''
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
            case 'camera': return face.fit ? { type: 'camera', cam: face.cam, fit: face.fit } : { type: 'camera', cam: face.cam };
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
    const DASH_RE = /^[—―–ー-]+$/;
    const FADE_RE = /fadeout|フェードアウト|(^|[^a-z])f\.?o\.?([^a-z]|$)/;
    const STOP_RE = /stop|停止|無音/;
    const LOOP_RE = /ループ|loop|リピート|繰り返し|くり返し/;
    const ONCE_RE = /1回のみ|一回のみ|1回だけ/;
    const KEEP_RE = /継続|同上/;
    const DUCK_ON_RE = /小さめ|小さく|音量ダウン|フェードダウン|下げる|下げて|下げおく|ダウン/;
    const DUCK_ON_PLAY_RE = /小さめ|小さく/;
    const DUCK_OFF_RE = /フェードアップ|上げる|戻す|音量アップ|アップ/;
    const PLACEHOLDER_RE = /\(背番号\)|\(氏名\)|nn_|\(優勝チーム\)|\(準優勝チーム\)|\(3位チーム|\(チーム名\)/;

    function slideKey(name) { return norm(String(name).replace(/^\d+[_\-.\s　]*/, '')); }
    const normPath = p => String(p).normalize('NFKC').toLowerCase().replace(/\\/g, '/').replace(/\s+/g, '').replace(/^\.?\/+/, '').replace(/^slides\//, '');

    function prepare(ctx) {
        if (!ctx._songs) ctx._songs = (ctx.music || []).map(s => ({ s, k: normKey(s.name) })).filter(x => x.k.length >= 1);
        if (!ctx._slides) ctx._slides = (ctx.slides || []).filter(s => !s.path.startsWith(FUTA_FOLDER)).map(s => ({ s, k: slideKey(s.name) })).filter(x => x.k);
        if (!ctx._allSlides) ctx._allSlides = (ctx.slides || []).map(s => ({ s, np: normPath(s.path) }));
    }

    // 『』が無く曲名だけのセル：「再生／演奏／ループ再生／1回のみ／小さめ／（…）」や空白を除いた全体が曲名と一致するとき（部分一致はしない）
    function plainSong(text, songs) {
        const strip = t => t.replace(/[\s・、,，。.:：\-ー]+/g, '');
        const k = strip(normKey(text)
            .replace(/[（(][^）)]*[）)]/g, '')
            .replace(/ループ再生|くり返し再生|繰り返し再生|1回のみ|一回のみ|小さめで|小さめ|小さく|でループ|ループ|再生|演奏|リピート|loop/g, ''));
        if (!k) return null;
        return songs.find(x => strip(x.k) === k) || null;
    }

    // ビジョン列の文字からスライドのパスを取り出す。「→」で区切られた順に [{ path, seg }]
    function extractPaths(text) {
        const out = [];
        String(text).split('→').forEach(seg => {
            seg.split(/[\s　]+/).forEach(tok => {
                const re = new RegExp('\\.' + SLIDE_EXT + '(?![A-Za-z0-9])', 'ig');
                let end = -1, m;
                while ((m = re.exec(tok))) end = m.index + m[0].length;
                if (end > 0) out.push({ path: tok.slice(0, end), seg: seg.trim(), note: tok.slice(end) + ' ' + seg.slice(seg.indexOf(tok) + tok.length) });
            });
        });
        return out;
    }
    const isPlaceholder = p => PLACEHOLDER_RE.test(String(p).normalize('NFKC').toLowerCase());
    // フォルダ部分（かっこの入った「当日決まる」部分より前まで。例：選手/（優勝チーム）/x.png → 選手/）
    const folderOf = p => {
        const segs = String(p).split('/').slice(0, -1);
        const out = [];
        for (const sg of segs) { if (isPlaceholder(sg + '/x')) break; out.push(sg); }
        return out.length ? out.join('/') + '/' : '';
    };

    function findSlide(p, ctx) {
        const w = normPath(p);
        if (!w) return null;
        let best = null;
        ctx._allSlides.forEach(x => {
            if (x.np === w || x.np.endsWith('/' + w)) { if (!best || x.s.path.length < best.s.path.length) best = x; }
        });
        return best ? best.s : null;
    }

    // BGM 列の1区切り（「→」の前後）を読む
    function analyzeSeg(seg, ctx) {
        const n = norm(seg);
        const r = { fade: FADE_RE.test(n), stop: STOP_RE.test(n), keep: KEEP_RE.test(n), song: null, miss: '', loop: null, duckOn: false, duckOff: false };
        const hasExt = /\.(mp3|wav|m4a|aac|ogg|flac)/.test(n);
        // 『曲名』（昨年までの形）
        const titles = [];
        const re = /『([^』]+)』/g;
        let m;
        while ((m = re.exec(seg))) titles.push(m[1]);
        if (titles.length) {
            for (const t of titles) {
                const k = normKey(t);
                const hit = ctx._songs.find(x => x.k === k) || ctx._songs.find(x => k.length >= 2 && (x.k.includes(k) || (x.k.length >= 2 && k.includes(x.k))));
                if (hit) { r.song = hit; break; }
            }
            if (!r.song) r.miss = titles[0];
        } else if (hasExt) {
            // ファイル名：拡張子・先頭の番号を除いた名前で照合（文の中に曲名が入っていればよい）
            const k = normKey(seg);
            let best = null;
            ctx._songs.forEach(x => { if (x.k.length >= 2 && k.includes(x.k) && (!best || x.k.length > best.k.length)) best = x; });
            if (best) r.song = best;
            else {
                const fm = /([^→（）()「」『』]*?\.(?:mp3|wav|m4a|aac|ogg|flac))/i.exec(seg);
                let nm = fm ? fm[1] : seg;
                nm = nm.replace(/^\d{1,2}:\d{2}\s+/, '').replace(/^.*[：）)]\s*/, '').replace(/^.*[でを]\s+(?=\S)/, '').trim();
                r.miss = nm;
            }
        } else {
            r.song = plainSong(seg, ctx._songs);
        }
        if (LOOP_RE.test(n)) r.loop = true;
        else if (ONCE_RE.test(n)) r.loop = false;
        const playing = !!r.song && !r.fade && !r.stop;
        r.play = playing && !r.keep;
        r.duckOn = (playing ? DUCK_ON_PLAY_RE : DUCK_ON_RE).test(n);
        r.duckOff = DUCK_OFF_RE.test(n) && !r.duckOn;
        return r;
    }

    // 「→」で区切る（かっこの中の「→」では区切らない）
    function splitArrows(text) {
        return String(text).replace(/[（(][^）)]*[）)]/g, g => g.replace(/→/g, '＞')).split('→').map(s => s.replace(/＞/g, '→'));
    }

    // キューが付いている行のあとの「いまの状態」
    function applyCueToState(st, cue) {
        if (cue.scene) { st.left = null; st.right = null; } else {
            if (cue.left) st.left = cue.left.type === 'slide' ? cue.left.file : cue.left.type;
            if (cue.right) st.right = cue.right.type === 'camera' ? cue.right.cam : cue.right.type;
        }
        const b = cue.bgm;
        if (b) {
            if (b.action === 'play') { st.bgm = 'play:' + normKey(b.name); st.loop = b.loop; st.duck = cue.duck === true; }
            else if (b.action === 'fade') { st.bgm = 'faded'; st.duck = false; }
            else if (b.action === 'stop') { st.bgm = 'stopped'; st.duck = false; }
        }
        if (typeof cue.duck === 'boolean') st.duck = cue.duck;
    }

    // 台本の1行から、キューの「提案」を作る（st は前の行までの状態で、この行のあとの状態に更新する）
    // 戻り値：{ cue, reasons[], hints[], pick[] } または null（変えるものも知らせることも無いとき）
    function suggestRow(row, ctx, st) {
        prepare(ctx);
        const cue = { left: null, right: null, band: null, bgm: null, memo: '' };
        const reasons = [], hints = [], pick = [];

        // ---- 左面 ----
        const vis = row.vision || '';
        const paths = vis && !isSame(vis) ? extractPaths(vis) : [];
        if (paths.length) {
            const first = paths[0];
            const cont = /[（(](継続|同上)[）)]|〃/.test(first.seg) || KEEP_RE.test(norm(first.note));
            if (isPlaceholder(first.path)) {
                hints.push(`当日に選ぶ：${folderOf(first.path)}`);
                pick.push(folderOf(first.path));
                st.left = null;
            } else {
                const sl = findSlide(first.path, ctx);
                if (sl) {
                    if (!(cont && st.left) && st.left !== sl.path) {
                        cue.left = { type: 'slide', file: sl.path };
                        reasons.push(`左面 スライド「${sl.name}」`);
                    }
                    st.left = sl.path;
                    if (/^ロゴ\//.test(normPath(first.path)) && /960x686/.test(normPath(sl.path)) && !ctx.futaLeft && !ctx._logoHinted) {
                        ctx._logoHinted = true;
                        hints.push(`左フタの画像の候補：${sl.path}（設定タブで選べます）`);
                    }
                } else {
                    hints.push(`スライドが見つかりません：${first.path}`);
                    st.left = null;
                }
            }
            paths.slice(1).forEach(p => hints.push(`このあと → ${p.path}（手で切り替え）`));
        } else if (vis && !isSame(vis)) {
            // 昨年までの形：ビジョン列の文字（ロゴ・カメラ）
            const n = norm(vis);
            if (n.includes('ロゴ')) {
                if (n.includes('全面')) { cue.band = { type: 'futa' }; reasons.push('全面フタ'); }
                else if (!titleSlide(row, ctx) && st.left !== 'futa') { cue.left = { type: 'futa' }; reasons.push('左フタ'); st.left = 'futa'; }
            }
        }
        if (!cue.left && !cue.band && !paths.length) {
            const best = titleSlide(row, ctx);
            if (best && st.left !== best.path) { cue.left = { type: 'slide', file: best.path }; reasons.push(`左面 スライド「${best.name}」`); st.left = best.path; }
        }

        // ---- 右面 ----
        const vr = row.visionR || '';
        const rightText = vr ? (isSame(vr) ? '' : vr) : (!paths.length && vis && !isSame(vis) ? vis : '');
        if (rightText && norm(rightText).includes('カメラ') && !cue.band && st.right !== 'cam1') {
            cue.right = { type: 'camera', cam: 'cam1' };
            reasons.push('右面 カメラ');
            st.right = 'cam1';
        }

        // ---- BGM・小さく（ダック） ----
        const bgmText = row.bgm || '';
        if (bgmText && !isSame(bgmText) && !DASH_RE.test(bgmText.trim())) bgmFromText(bgmText, ctx, st, cue, reasons, hints);

        if (!cue.left && !cue.right && !cue.band && !cue.bgm && typeof cue.duck !== 'boolean') {
            return hints.length ? { cue: null, reasons, hints, pick } : null;
        }
        return { cue, reasons, hints, pick };
    }

    function bgmFromText(text, ctx, st, cue, reasons, hints) {
        const infos = splitArrows(text).map(s => analyzeSeg(s, ctx));
        const playIdx = infos.findIndex(x => x.play);
        let duck = null;       // true=小さく / false=戻す / null=指定なし
        if (playIdx >= 0) {
            const p = infos[playIdx];
            const key = 'play:' + normKey(p.song.s.name);
            duck = p.duckOn ? true : null;
            infos.slice(playIdx + 1).forEach(x => {
                if (x.fade) hints.push('このあと：フェードアウト（手で）');
                else if (x.stop) hints.push('このあと：停止（手で）');
            });
            const same = st.bgm === key && (p.loop === null || p.loop === st.loop);
            if (!same) {
                cue.bgm = { action: 'play', path: p.song.s.path, name: p.song.s.name, loop: p.loop === true };
                reasons.push(`BGM「${p.song.s.name}」${p.loop === true ? '（くり返し）' : p.loop === false ? '（1回のみ）' : ''}`);
                st.loop = p.loop === true;
                st.duck = false;       // 曲を新しく鳴らすときは、ふつうの音量に戻る（小さくは別に指定）
            }
            st.bgm = key;
            if (duck === true) { cue.duck = true; reasons.push('BGM 小さく'); st.duck = true; }
            else if (st.duck === true && same) { /* 同じ曲が小さいまま鳴り続ける */ }
            return;
        }
        // 鳴らさない行：フェードアウト／停止／継続／小さく・戻す
        const fade = infos.find(x => x.fade), stop = infos.find(x => x.stop), keep = infos.find(x => x.keep);
        if (keep && fade && keep === fade) {
            // 「継続（曲の終わりでフェードアウト）」：いまは変えず、あとで手で
            hints.push('このあと：フェードアウト（手で）');
            if (keep.song && !st.bgm) st.bgm = 'play:' + normKey(keep.song.s.name);
            return;
        }
        if (fade) {
            cue.bgm = { action: 'fade' }; reasons.push('BGM フェードアウト'); st.bgm = 'faded'; st.duck = false;
            return;
        }
        if (stop) {
            if (st.bgm !== 'stopped') { cue.bgm = { action: 'stop' }; reasons.push('BGM 停止'); }
            st.bgm = 'stopped'; st.duck = false;
            return;
        }
        if (keep && keep.song && !st.bgm) st.bgm = 'play:' + normKey(keep.song.s.name);
        infos.forEach(x => { if (x.miss && !x.song) hints.push(`曲が見つかりません：${x.miss}`); });
        if (infos.some(x => x.duckOn)) duck = true;
        else if (infos.some(x => x.duckOff)) duck = false;
        if (duck === true && st.duck !== true) { cue.duck = true; reasons.push('BGM 小さく'); st.duck = true; }
        else if (duck === false && st.duck !== false) { cue.duck = false; reasons.push('BGM 小さくを戻す'); st.duck = false; }
    }

    // 台本全体の提案。同じセクションの中で、前の行との差分だけを出す。戻り値 { 行の番号: 提案 }
    function suggestAll(script, ctx) {
        prepare(ctx);
        const out = {};
        let sec = -1, st = null;
        (script.rows || []).forEach((r, i) => {
            if (r.sec !== sec) { sec = r.sec; st = { left: null, right: null, bgm: null, loop: null, duck: null }; }
            if (!isCueable(r)) return;
            if (r.cue) {
                applyCueToState(st, r.cue);
                // 「当日に選ぶ」行は、キューを付けたあとも選び直せるよう、フォルダだけ覚えておく
                const ps = r.vision && !isSame(r.vision) ? extractPaths(r.vision) : [];
                if (ps.length && isPlaceholder(ps[0].path)) out[i] = { cue: null, reasons: [], hints: [], pick: [folderOf(ps[0].path)], hasCue: true };
                return;
            }
            if (!(r.bgm || r.vision || r.visionR || r.title)) return;
            const sg = suggestRow(r, ctx, st);
            if (sg) out[i] = sg;
        });
        return out;
    }

    // 1行だけの提案（前の行が無いものとして）
    function suggestCue(row, ctx) {
        return suggestRow(row, ctx, { left: null, right: null, bgm: null, loop: null, duck: null });
    }

    function titleSlide(row, ctx) {
        const title = row.title || '';
        if (!title || isSame(title)) return null;
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
        return best;
    }

    function describeFace(f) {
        if (!f) return '';
        if (f.type === 'slide') return 'スライド ' + String(f.file).split('/').pop().replace(/\.[^.]+$/, '');
        if (f.type === 'camera') return 'カメラ' + (f.cam === 'cam2' ? '2' : '1') + (f.fit === 'contain' ? '（16:9のまま）' : '');
        if (f.type === 'futa') return 'フタ';
        return '黒';
    }

    return { cueRows, nextCueRow, nextCueAfter, prevCueRow, resolveLogo, buildScene, suggestCue, suggestAll, describeFace, isSame, norm, normPath, FUTA_FOLDER };
}));
