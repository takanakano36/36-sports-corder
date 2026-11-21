/* ==========================================================================
   台本の番号のシーンを2つに分け、左の画像をそれぞれにセットする
   使い方（サーバーを起動したまま、STADIUMVISION野球システム フォルダで）：
     node tools/split_scene.js O-33 ゲスト/01_マック鈴木.png ゲスト/02_川﨑宗則.png
   → 「O-33 …①」（1枚目）と、そのすぐ後ろに「O-33 …②」（2枚目）。NEXT で①→②の順に出せる
   - 右のカメラ・フタ・音などは①と同じものを②にも付ける
   - どちらも「手で直した」扱いになり、台本を読み直しても上書きされない
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3007;
const APP = path.join(__dirname, '..');
const [noArg, file1, file2] = process.argv.slice(2);
if (!noArg || !file1 || !file2) {
    console.log('使い方: node tools/split_scene.js <番号> <1枚目の場所> <2枚目の場所>');
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

const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s || '').normalize('NFKC').trim().toUpperCase();

function setLeft(sc, rel) {
    const src = 'slides/' + rel.replace(/\\/g, '/').replace(/^slides\//, '');
    const left = sc.layers.find(l => (l.type === 'image' || l.type === 'logo') && l.x < 0.5) || sc.layers.find(l => l.type === 'image');
    if (left) { left.type = 'image'; left.src = src; delete left.logo; return; }
    const base = sc.layers.find(l => l.type === 'camera') || sc.layers[0] || {};
    const layer = Object.assign({}, base, { id: rid('L'), type: 'image', src, x: 0, y: 0, w: 0.5, h: 1, visible: true, fit: 'cover', opacity: 1 });
    ['cam', 'lidFor', 'noLid', 'color', 'text'].forEach(k => delete layer[k]);
    sc.layers.unshift(layer);
}

(async () => {
    for (const f of [file1, file2]) {
        if (!fs.existsSync(path.join(APP, 'slides', f.replace(/^slides\//, '')))) console.log(`  ⚠ ${f} が slides にありません（先にスライドを入れてください）。セットだけはします`);
    }
    const state = await call('GET');
    const scenes = JSON.parse(JSON.stringify(state.scenes));
    const order = (state.sceneOrder || scenes.map(s => s.id)).slice();
    const a = scenes.find(s => s.script && norm(s.script.no) === norm(noArg));
    if (!a) throw new Error(`${noArg} のシーンがありません（［台本から作る］をしてから実行してください）`);
    const baseName = a.name.replace(/[①②]$/, '');
    if (scenes.some(s => s.name === baseName + '②')) throw new Error(`${baseName}② はもうあります（分け済み）`);
    // ② を①の写しとして作る（レイヤーの id とフタの対応を付け直す）
    const b = JSON.parse(JSON.stringify(a));
    b.id = rid('S');
    const idMap = {};
    b.layers.forEach(l => { const n = rid('L'); idMap[l.id] = n; l.id = n; });
    b.layers.forEach(l => { if (l.lidFor && idMap[l.lidFor]) l.lidFor = idMap[l.lidFor]; });
    a.name = baseName + '①'; b.name = baseName + '②';
    if (a.script) a.script.edited = true;
    if (b.script) b.script = Object.assign({}, b.script, { no: String(a.script.no) + '②', edited: true });
    if ('pick' in a) a.pick = null; if ('pick' in b) b.pick = null;
    setLeft(a, file1); setLeft(b, file2);
    scenes.splice(scenes.indexOf(a) + 1, 0, b);
    const at = order.indexOf(a.id);
    order.splice(at >= 0 ? at + 1 : order.length, 0, b.id);
    await call('POST', { scenes, sceneOrder: order });
    console.log(`  ○ ${a.name} ← ${file1}`);
    console.log(`  ○ ${b.name} ← ${file2}`);
    console.log('2つに分けました。NEXT で①→②の順に出せます');
})().catch(e => { console.log('止めました: ' + e.message); process.exit(1); });
