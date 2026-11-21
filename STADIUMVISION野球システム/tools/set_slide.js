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
    for (let i = 0; i < args.length; i += 2) {
        const no = norm(args[i]);
        const rel = args[i + 1].replace(/\\/g, '/').replace(/^slides\//, '');
        if (!fs.existsSync(path.join(APP, 'slides', rel))) console.log(`  ⚠ ${rel} が slides にありません（先にスライドを入れてください）。セットだけはします`);
        const sc = scenes.find(s => s.script && norm(s.script.no) === no);
        if (!sc) { console.log(`  ✕ ${args[i]}：この番号のシーンがありません（［台本から作る］をしてから実行してください）`); continue; }
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
    if (!ok) return console.log('セットできたシーンはありませんでした');
    await call('POST', { scenes });
    console.log(`${ok}個のシーンにセットしました。管理画面に反映されています`);
})().catch(e => { console.log('止めました: ' + e.message); process.exit(1); });
