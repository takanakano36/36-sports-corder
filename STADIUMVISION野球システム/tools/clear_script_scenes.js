/* ==========================================================================
   台本から作ったシーンを全部消す（「いつでも」など手で作ったシーンは残す）
   使い方（サーバーを起動したまま、STADIUMVISION野球システム フォルダで）：
     node tools/clear_script_scenes.js
   このあと管理画面の［台本から作る］で台本を読み込むと、台本どおりに作り直される
   ========================================================================== */
const http = require('http');
const PORT = Number(process.env.PORT) || 3007;

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
    const keep = state.scenes.filter(sc => !(sc.script && typeof sc.script === 'object'));
    const removed = state.scenes.length - keep.length;
    if (!removed) return console.log('台本から作ったシーンはありません');
    const ids = new Set(keep.map(sc => sc.id));
    const patch = { scenes: keep, sceneOrder: (state.sceneOrder || []).filter(id => ids.has(id)) };
    if (state.preview && !ids.has(state.preview)) patch.preview = keep.length ? keep[0].id : null;
    await call('POST', patch);
    console.log(`台本から作ったシーンを ${removed} 個消しました（残したシーン ${keep.length} 個）。`);
    console.log('管理画面の［台本から作る］で台本を読み込み直してください');
})().catch(e => { console.log('止めました: ' + e.message); process.exit(1); });
