/* ==========================================================================
   台本の番号のシーンに、左の画像（スライド）をまとめてセットする
   使い方（サーバーを起動したまま、STADIUMVISION野球システム フォルダで）：
     node tools/set_slide.js O-29 ゲスト/03_森中高史.png O-31 ゲスト/01_マック鈴木.png ...
   - 番号（O-29 など）が台本の番号と同じシーンを探し、左側の画像のレイヤーを差し替える
     （左側に画像が無ければ、左半分に画像のレイヤーを足す）
   - 差し替えたシーンは「手で直した」扱いになり、台本を読み直しても上書きされない
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3007;
const APP = path.join(__dirname, '..');
const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
    console.log('使い方: node tools/set_slide.js <番号> <slides からの場所> [<番号> <場所> ...]');
    process.exit(1);
}

function call(method, body) {
    return new Promise((resolve, reject) => {
        const data = body ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
        const req = http.request({ host: 'localhost', port: PORT, path: '/api/state', method,
            headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const j = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
                res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || res.statusCode));
            });
        });
        req.on('error', () => reject(new Error(`サーバー（${PORT}番）につながりません。先に「野球ビジョン 管理画面」を起動してください`)));
        if (data) req.write(data);
        req.end();
    });
}

(async () => {
    const state = await call('GET');
    const scenes = JSON.parse(JSON.stringify(state.scenes));
    const norm = s => String(s || '').normalize('NFKC').trim().toUpperCase();
    let ok = 0;
    const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const keyOf = n => { const m = /^([A-Z]+)-?(\d+)/.exec(norm(n)); return m ? [m[1], Number(m[2])] : null; };
    // ファイル名の打ち間違い・文字の違い（﨑と崎など）があっても、同じフォルダの「先頭の番号が同じ」ファイルを探して使う
    function resolveFile(rel) {
        if (fs.existsSync(path.join(APP, 'slides', rel))) return rel;
        const dir = path.posix.dirname(rel), base = path.posix.basename(rel);
        const full = path.join(APP, 'slides', dir);
        if (!fs.existsSync(full)) return null;
        const files = fs.readdirSync(full);
        const nfkc = s => s.normalize('NFKC').replace(/[﨑]/g, '崎').toLowerCase();
        let hit = files.find(f => nfkc(f) === nfkc(base));
        const m = /^(\d+)_/.exec(base);
        if (!hit && m) { const c = files.filter(f => f.startsWith(m[1] + '_')); if (c.length === 1) hit = c[0]; }
        return hit ? (dir === '.' ? hit : dir + '/' + hit) : null;
    }
    for (let i = 0; i < args.length; i += 2) {
        const no = norm(args[i]);
        let rel = args[i + 1].replace(/\\/g, '/').replace(/^slides\//, '');
        const found = resolveFile(rel);
        if (found) rel = found;
        else console.log(`  ⚠ ${rel} が slides にありません（先にスライドを入れてください）。セットだけはします`);
        // 2つに分けたシーン（①②）は1つに戻す
        for (let j = scenes.length - 1; j >= 0; j--) if (scenes[j].script && norm(scenes[j].script.no) === norm(args[i] + '②')) scenes.splice(j, 1);
        let sc = scenes.find(s => s.script && norm(s.script.no) === no);
        if (sc) sc.name = sc.name.replace(/①$/, '');
        if (!sc) {
            // 台本の行に変化がなくシーンが作られていない番号は、近い番号のシーンをもとに新しく作る
            const k = keyOf(no);
            const near = k && scenes.filter(s => s.script && keyOf(s.script.no) && keyOf(s.script.no)[0] === k[0])
                .sort((a, b) => Math.abs(keyOf(a.script.no)[1] - k[1]) - Math.abs(keyOf(b.script.no)[1] - k[1]))[0];
            if (!near) { console.log(`  ✕ ${args[i]}：この番号のシーンも、同じ記号の近いシーンもありません（［台本から作る］をしてから実行してください）`); continue; }
            sc = JSON.parse(JSON.stringify(near));
            sc.id = rid('S');
            const idMap = {};
            sc.layers.forEach(l => { const n = rid('L'); idMap[l.id] = n; l.id = n; });
            sc.layers.forEach(l => { if (l.lidFor && idMap[l.lidFor]) l.lidFor = idMap[l.lidFor]; });
            sc.name = `${args[i]} ${path.posix.basename(rel).replace(/\.[^.]+$/, '').replace(/^\d+_/, '')}`;
            sc.script = Object.assign({}, near.script, { no: args[i] });
            if ('bgm' in sc) sc.bgm = null;
            if ('duck' in sc) sc.duck = null;
            scenes.push(sc);
            console.log(`  ＋ ${sc.name}（シーンが無かったので作りました）`);
        }
        const src = 'slides/' + rel;
        const left = sc.layers.find(l => (l.type === 'image' || l.type === 'logo') && l.x < 0.5)
            || sc.layers.find(l => l.type === 'image');
        if (left) {
            left.type = 'image'; left.src = src; delete left.logo;
        } else {
            const base = sc.layers.find(l => l.type === 'camera') || sc.layers[0] || {};
            const layer = Object.assign({}, base, { id: 'L' + Date.now().toString(36) + i, type: 'image', src, x: 0, y: 0, w: 0.5, h: 1, visible: true, fit: 'cover', opacity: 1 });
            delete layer.cam; delete layer.lidFor; delete layer.noLid; delete layer.color; delete layer.text;
            sc.layers.unshift(layer);
        }
        if (sc.script) sc.script.edited = true;
        if ("pick" in sc) sc.pick = null;
        console.log(`  ○ ${sc.name} ← ${rel}`);
        ok++;
    }
    // 同じ番号のシーンが2つ以上あるときは知らせる（古いシーンが残っている）
    const count = {};
    scenes.forEach(s => { if (s.script && s.script.no) count[norm(s.script.no)] = (count[norm(s.script.no)] || 0) + 1; });
    const dup = Object.keys(count).filter(k => count[k] > 1);
    if (dup.length) console.log(`  ⚠ 同じ番号のシーンが2つ以上あります：${dup.join('、')}（node tools\\clear_script_scenes.js → ［台本から作る］で作り直してください）`);
    // 台本のシーンを、シートの順・番号の順に並べ直す（「いつでも」などは後ろ）
    const key = no => { const m = /^([A-Z]+)-?(\d+)(.*)$/.exec(norm(no)); return m ? [m[1], Number(m[2]), m[3]] : [norm(no), 0, '']; };
    const byId = new Map(scenes.map(s => [s.id, s]));
    const order = (state.sceneOrder && state.sceneOrder.length ? state.sceneOrder : scenes.map(s => s.id)).filter(id => byId.has(id));
    scenes.forEach(s => { if (!order.includes(s.id)) order.push(s.id); });
    const secs = [];
    order.forEach(id => { const s = byId.get(id); if (s.script && !secs.includes(s.script.sec)) secs.push(s.script.sec); });
    const scriptIds = order.filter(id => byId.get(id).script).sort((a, b) => {
        const A = byId.get(a).script, B = byId.get(b).script;
        if (A.sec !== B.sec) return secs.indexOf(A.sec) - secs.indexOf(B.sec);
        const ka = key(A.no), kb = key(B.no);
        return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
    });
    const sceneOrder = scriptIds.concat(order.filter(id => !byId.get(id).script));
    await call('POST', { scenes, sceneOrder });
    console.log(`${ok}個のシーンにセットし、シーンを台本の順に並べ直しました。管理画面に反映されています`);
})().catch(e => { console.log('止めました: ' + e.message); process.exit(1); });
