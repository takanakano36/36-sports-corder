/* ==========================================================================
   シーン（レイヤーを重ねた画面）の共通部品（サーバーと管理画面の両方で使う）
   - 帯（1920×686 など）に対する割合（0〜1）で、レイヤーの位置と大きさを持つ
   - 置き場所のプリセット（左半分・右半分・全面・中央16:9）／レイヤーの作り方
   - 旧い画面（layout＋slots）・台本のキューからシーンへの変換
   - 台本の提案（script_core.js）から、キューの付く行ごとにシーンを作る
   ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const ALWAYS_GROUP = 'いつでも';
    const LAYER_TYPES = ['image', 'camera', 'color', 'text', 'logo', 'video', 'test'];
    const VIDEO_RE = /\.(mp4|webm|m4v|mov)$/i;

    let seq = 0;
    function uid(prefix) {
        seq++;
        return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4) + seq.toString(36);
    }

    // 出力の形 → ステージ（素材を並べる面）の大きさ
    function stageOf(output) {
        return output && output.mode === 'sdi' ? { w: 1920, h: output.bandH } : { w: 3840, h: 1080 };
    }

    // 置き場所のプリセット（帯に対する割合）
    function presets(stage) {
        const w16 = Math.min(1, (stage.h * 16 / 9) / stage.w);
        return {
            left: { x: 0, y: 0, w: 0.5, h: 1 },
            right: { x: 0.5, y: 0, w: 0.5, h: 1 },
            full: { x: 0, y: 0, w: 1, h: 1 },
            center: { x: (1 - w16) / 2, y: 0, w: w16, h: 1 }
        };
    }
    const PRESET_NAMES = { left: '左半分', right: '右半分', full: '全面', center: '中央 16:9' };

    const near = (a, b, e) => Math.abs(a - b) <= e;
    // いまの位置・大きさがどのプリセットに当たるか（無ければ ''）
    function presetOf(l, stage) {
        const P = presets(stage);
        for (const k of Object.keys(P)) {
            const p = P[k];
            if (near(l.x, p.x, 0.004) && near(l.y, p.y, 0.004) && near(l.w, p.w, 0.004) && near(l.h, p.h, 0.004)) return k;
        }
        return '';
    }

    function overlapFrac(a, b) {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w <= 0 || h <= 0) return 0;
        return (w * h) / (b.w * b.h);
    }

    // 足したレイヤーの置き場所：画像・動画・ロゴは左から、カメラは右から、空いている半分に置く（空きが無ければ全面）。文字・色は全面
    function defaultRect(layers, type, stage) {
        const P = presets(stage);
        if (type === 'text' || type === 'color' || type === 'test') return P.full;
        const used = (layers || []).filter(l => l.visible && l.type !== 'color');
        const order = type === 'camera' ? ['right', 'left'] : ['left', 'right'];
        for (const k of order) if (!used.some(l => overlapFrac(l, P[k]) > 0.3)) return P[k];
        return P.full;
    }

    function newLayer(type, opts, rect) {
        const r = rect || { x: 0, y: 0, w: 1, h: 1 };
        const l = { id: uid('l'), type, x: r.x, y: r.y, w: r.w, h: r.h, visible: true, fit: type === 'logo' ? 'contain' : 'cover', opacity: 1 };
        return Object.assign(l, opts || {});
    }

    // ---- 素材の名前 ----------------------------------------------------------------
    const baseName = p => String(p || '').split('/').pop();
    const stem = p => baseName(p).replace(/\.[^.]+$/, '');
    function layerLabel(l) {
        if (l.name) return l.name;
        switch (l.type) {
            case 'image': return l.src ? stem(l.src) : '（画像なし）';
            case 'video': return l.src ? stem(l.src) : '（動画なし）';
            case 'logo': return l.src ? 'ロゴ ' + stem(l.src) : 'ロゴ';
            case 'camera': return l.cam === 'cam2' ? 'カメラ2' : '遊撃カメラ';
            case 'color': return l.color === '#000000' ? '背景（黒）' : '色 ' + (l.color || '');
            case 'text': return String(l.text || '').replace(/\s*\n\s*/g, ' ') || '（文字）';
            case 'test': return 'テスト画面';
        }
        return l.type;
    }
    const LAYER_ICONS = { image: '🖼', video: '🎞', logo: '◆', camera: '📹', color: '■', text: 'Ａ', test: '▦' };

    // ---- 旧い形（layout＋slots）・キューの顔 → レイヤー ----------------------------------
    function mediaLayer(file, rect, fit) {
        const isVideo = VIDEO_RE.test(file);
        return newLayer(isVideo ? 'video' : 'image', { src: file, fit: fit || 'cover' }, rect);
    }

    function srcToLayers(src, rect) {
        if (!src) return [];
        switch (src.type) {
            case 'slide': return src.file ? [mediaLayer(src.file, rect, src.fit)] : [];
            case 'camera': return [newLayer('camera', { cam: src.cam === 'cam2' ? 'cam2' : 'cam1', fit: src.fit || 'cover' }, rect)];
            case 'color': return /^#[0-9a-fA-F]{6}$/.test(src.color || '') ? [newLayer('color', { color: src.color }, rect)] : [];
            case 'text': {
                const out = [];
                if (/^#[0-9a-fA-F]{6}$/.test(src.color || '')) out.push(newLayer('color', { color: src.color }, rect));
                const t = String(src.title || '') + (src.sub ? '\n' + src.sub : '');
                out.push(newLayer('text', { text: t.slice(0, 300), color: /^#[0-9a-fA-F]{6}$/.test(src.textColor || '') ? src.textColor : '#ffffff' }, rect));
                return out;
            }
            case 'test': return [newLayer('test', {}, rect)];
            default: return [];     // black / player / lineup / url は、レイヤーにはしない（黒は何も置かない）
        }
    }

    // 旧い画面（layout＋slots）→ レイヤーの並び（下から順）
    function legacySceneToLayers(sc, stage) {
        if (!sc || !sc.slots) return [];
        const P = presets(stage);
        const s = sc.slots;
        if (sc.layout === 'split') return srcToLayers(s.left, P.left).concat(srcToLayers(s.right, P.right));
        if (sc.layout === 'single') {
            const w = P.center.w;
            const x = (1 - w) * (isFinite(sc.singleX) ? sc.singleX : 50) / 100;
            return srcToLayers(s.bg, P.full).concat(srcToLayers(s.single, { x, y: 0, w, h: 1 }));
        }
        return srcToLayers(s.wide, P.full);
    }

    // 台本のキューの「顔」（slide / futa / camera / black）→ レイヤー。logoKind = 'left' | 'full'
    function faceToLayers(face, rect, logoKind) {
        if (!face) return [];
        switch (face.type) {
            case 'slide': return face.file ? [mediaLayer(face.file, rect)] : [];
            case 'futa': return [newLayer('logo', { src: '', logo: logoKind }, rect)];
            case 'camera': return [newLayer('camera', { cam: face.cam === 'cam2' ? 'cam2' : 'cam1', fit: face.fit || 'cover' }, rect)];
            default: return [];
        }
    }

    // いまの絵の状態（pic）から、シーンのレイヤーを作る。右の既定は遊撃カメラ（cam1）
    function pictureLayers(pic, stage) {
        const P = presets(stage);
        if (pic.band) return faceToLayers(pic.band, P.full, 'full');
        const right = pic.right || { type: 'camera', cam: 'cam1' };
        return faceToLayers(pic.left, P.left, 'left').concat(faceToLayers(right, P.right, 'left'));
    }

    // 台本の行のキュー（旧い形）→ シーン
    function sceneFromCue(cue, name, group, stage, base) {
        let layers;
        if (cue.scene) layers = legacySceneToLayers(cue.scene, stage);
        else {
            const pic = { band: cue.band || null, left: cue.left || null, right: cue.right || null };
            if (!pic.band && !pic.left && !pic.right && base) { pic.left = base.left; pic.right = base.right; }
            layers = pictureLayers(pic, stage);
        }
        return {
            id: uid('s'), name, group, layers,
            bgm: cue.bgm || null,
            duck: typeof cue.duck === 'boolean' ? cue.duck : null,
            pick: null, script: null, warn: ''
        };
    }

    // ---- 初期のシーン（「いつでも」） ----------------------------------------------------
    function defaultScenes(stage, slideList) {
        const P = presets(stage);
        const mk = (name, layers) => ({ id: uid('s'), name, group: ALWAYS_GROUP, layers, bgm: null, duck: null, pick: null, script: null, warn: '' });
        const soon = (slideList || []).find(s => s.kind === 'image' && /^slides\/全面\//.test(s.path) && /まもなく|開会式/.test(s.path));
        const soonLayers = soon
            ? [newLayer('image', { src: soon.path }, P.full)]
            : [newLayer('color', { color: '#0b2a6f' }, P.full), newLayer('text', { text: 'まもなく開会式', color: '#ffffff' }, P.full)];
        return [
            mk('全面 ロゴ', [newLayer('logo', { src: '', logo: 'full' }, P.full)]),
            mk('全面 まもなく開会式', soonLayers),
            mk('カメラ全面', [newLayer('camera', { cam: 'cam1' }, P.full)]),
            mk('左ロゴ＋右カメラ', [newLayer('logo', { src: '', logo: 'left' }, P.left), newLayer('camera', { cam: 'cam1' }, P.right)]),
            mk('黒', [newLayer('color', { color: '#000000' }, P.full)])
        ];
    }

    // ---- 本線に出す形 ------------------------------------------------------------------
    // ロゴのレイヤーの画像（src が空なら、フタの設定どおり）を決める。logos = { left, full }
    function resolveLayers(layers, logos) {
        return (layers || []).map(l => {
            const c = JSON.parse(JSON.stringify(l));
            if (c.type === 'logo' && !c.src) c.src = (c.logo === 'full' ? logos.full : logos.left) || '';
            return c;
        });
    }
    function programFromScene(sc, logos) {
        return { sceneId: sc.id, name: sc.name, layers: resolveLayers(sc.layers, logos) };
    }

    // 「流れ」のシーン（NEXT・PREV の対象）：いつでも以外
    const isFlow = sc => !!sc && sc.group !== ALWAYS_GROUP;
    function flowIds(st) {
        const byId = new Map(st.scenes.map(s => [s.id, s]));
        return st.sceneOrder.filter(id => isFlow(byId.get(id)));
    }
    function flowAfter(st, id) {
        const f = flowIds(st);
        const i = f.indexOf(id);
        return i >= 0 ? (f[i + 1] || '') : '';
    }

    // ---- 台本 → シーン -------------------------------------------------------------------
    const oneLine = t => String(t || '').replace(/\s*\n\s*/g, ' ').trim();
    const collapse = t => String(t || '').replace(/\s+/g, '');

    // script = { sections:[{name}], rows:[{sec, kind, no, title, ...}] }、sugg = ScriptCore.suggestAll の結果
    // 戻り値：[{ key, scene }]（台本の順）。key はシートの名前＋番号（番号が無ければ内容）で、読み直したときの照合に使う
    // opts.mergePicks … 「当日に選ぶ」の行が、同じフォルダのまま続くとき（音・画面の変化が無いとき）は、1つのシーンにまとめる
    function buildScenesFromScript(script, sugg, stage, opts) {
        const merge = !opts || opts.mergePicks !== false;
        const out = [];
        const used = new Map();
        let sec = -1, pic = null, last = null;
        script.rows.forEach((r, i) => {
            if (r.sec !== sec) { sec = r.sec; pic = { band: null, left: null, right: null }; last = null; }
            if (r.kind === 'chapter') return;
            const sg = sugg[i];
            if (!sg) return;
            const cue = sg.cue || null;
            const pick = sg.pick && sg.pick[0] ? sg.pick[0] : '';
            if (cue) {
                if (cue.band) pic.band = cue.band;
                else if (cue.left || cue.right) {
                    pic.band = null;
                    if (cue.left) pic.left = cue.left;
                    if (cue.right) pic.right = cue.right;
                }
            }
            if (pick) { pic.band = null; pic.left = null; }
            if (merge && pick && !cue && last && last.pick && last.pick.folder === pick.slice(0, 200)) return;
            const missing = (sg.hints || []).filter(h => /^スライドが見つかりません/.test(h));
            if (!cue && !pick && !missing.length) return;
            const secName = script.sections[r.sec].name;
            const no = collapse(r.no);
            let key = `${collapse(secName)}\u0000${no ? 'no:' + no : 't:' + collapse(r.title).slice(0, 60)}`;
            const n = (used.get(key) || 0) + 1;
            used.set(key, n);
            if (n > 1) key += `#${n}`;
            const warn = (sg.hints || []).filter(h => !/^当日に選ぶ/.test(h) && !(opts && opts.songWarn === false && /^曲が見つかりません/.test(h))).join(' ／ ').slice(0, 500);
            const scene = {
                id: uid('s'),
                name: (oneLine((r.no ? r.no + ' ' : '') + oneLine(r.title)) || `${i + 1}行目`).slice(0, 100),
                group: secName.slice(0, 60),
                layers: pictureLayers(pic, stage),
                bgm: cue && cue.bgm ? cue.bgm : null,
                duck: cue && typeof cue.duck === 'boolean' ? cue.duck : null,
                pick: pick ? { folder: pick.slice(0, 200) } : null,
                script: { sec: secName.slice(0, 100), no: r.no ? String(r.no).slice(0, 40) : '', edited: false },
                warn
            };
            last = scene;
            out.push({ key, scene });
        });
        return out;
    }

    // 既存のシーンの照合キー（buildScenesFromScript の key と同じ作り）。scenes は state.scenes
    function sceneKeys(scenes) {
        const used = new Map();
        const map = new Map();
        scenes.forEach(sc => {
            if (!sc.script) return;
            const no = collapse(sc.script.no);
            let key = `${collapse(sc.script.sec)}\u0000${no ? 'no:' + no : 't:' + collapse(sc.name).slice(0, 60)}`;
            const n = (used.get(key) || 0) + 1;
            used.set(key, n);
            if (n > 1) key += `#${n}`;
            map.set(key, sc);
        });
        return map;
    }

    return {
        ALWAYS_GROUP, LAYER_TYPES, PRESET_NAMES, LAYER_ICONS, VIDEO_RE,
        uid, stageOf, presets, presetOf, overlapFrac, defaultRect, newLayer, layerLabel,
        mediaLayer, legacySceneToLayers, faceToLayers, pictureLayers, sceneFromCue, defaultScenes,
        resolveLayers, programFromScene, isFlow, flowIds, flowAfter, buildScenesFromScript, sceneKeys, oneLine, collapse
    };
}));
