/* ==========================================================================
   「いつでも」に、画像1枚を帯全体（全面）に出すシーンを足す
   使い方（サーバーを起動したまま、STADIUMVISION野球システム フォルダで）：
     node tools/add_scene.js "全面 開会式" 全面/12_開会式.png "全面 HRダービー" 全面/20_ホームランダービー.png
   - 同じ名前のシーンがあれば、画像を差し替える（増やさない）
   - 「いつでも」の先頭に並べる
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3007;
const APP = path.join(__dirname, '..');
const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
    console.log('使い方: node tools/add_scene.js "<シーンの名前>" <slides からの場所> [...]');
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

(async () => {
    const state = await call('GET');
    const scenes = JSON.parse(JSON.stringify(state.scenes));
    const byId = new Map(scenes.map(s => [s.id, s]));
    let order = (state.sceneOrder && state.sceneOrder.length ? state.sceneOrder : scenes.map(s => s.id)).filter(id => byId.has(id));
    const added = [];
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i].trim();
        const rel = args[i + 1].replace(/\\/g, '/').replace(/^slides\//, '');
        if (!fs.existsSync(path.join(APP, 'slides', rel))) console.log(`  ⚠ ${rel} が slides にありません（先にスライドを入れてください）。セットだけはします`);
        const layer = { id: rid('l'), type: 'image', src: 'slides/' + rel, x: 0, y: 0, w: 1, h: 1, visible: true, fit: 'cover', opacity: 1 };
        const old = scenes.find(s => s.name === name);
        if (old) {
            old.layers = [layer];
            console.log(`  ○ ${name} の画像を差し替えました ← ${rel}`);
        } else {
            const sc = { id: rid('s'), name, group: 'いつでも', layers: [layer], bgm: null, duck: null, pick: null, script: null, warn: '' };
            scenes.push(sc);
            added.push(sc.id);
            console.log(`  ＋ ${name} ← ${rel}`);
        }
    }
    // 新しいシーンは「いつでも」の先頭に置く
    if (added.length) {
        const firstAlways = order.findIndex(id => byId.get(id) && byId.get(id).group === 'いつでも' && !byId.get(id).script);
        const at = firstAlways >= 0 ? firstAlways : order.length;
        order = order.slice(0, at).concat(added, order.slice(at));
    }
    await call('POST', { scenes, sceneOrder: order });
    console.log('「いつでも」にセットしました。管理画面に反映されています');
})().catch(e => { console.log('止めました: ' + e.message); process.exit(1); });
