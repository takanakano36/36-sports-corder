/* ==========================================================================
   台本の取り込み（見出し行の自動検出・列の役割の割り当て・行の取り出し）
   ========================================================================== */
const ROLES = ['no', 'time', 'dur', 'title', 'bgm', 'vision', 'visionR', 'mic', 'speaker', 'script', 'note'];
const ROLE_NAMES = { no: '番号', visionR: 'ビジョン右', time: '時刻', dur: '経過', title: '内容', bgm: 'BGM', vision: 'ビジョン', mic: 'MIC', speaker: '話者', script: 'セリフ', note: '備考' };
const VOCAB = {
    time: ['時刻', 'time', '時間'],
    dur: ['経過', '尺', '所要'],
    title: ['内容', '項目', '進行', '場面'],
    bgm: ['bgm', 'music', '音源', '音響', '音楽'],
    vision: ['ビジョン', 'vision', '映像', '大型ビジョン'],
    mic: ['mic', 'マイク'],
    speaker: ['mc', '話者', '担当'],
    script: ['script', 'セリフ', '台詞', '原稿', 'コメント'],
    note: ['備考', '動線', '演出'],
    visionR: [],
    no: []
};
// 番号の見出しは、完全に一致したときだけ（「no」は他の語に入りやすいため）
const NO_WORDS = ['no.', 'no', '番号', '#', '№'];
const CONTAINS_ROLES = ['time', 'dur', 'title', 'bgm', 'vision', 'mic', 'speaker', 'script', 'note'];
const HEADER_SCAN_ROWS = 20;

const norm = s => String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

// 見出しの文字 → 役割（合わなければ ''）
function roleOfHeader(cell) {
    const t = norm(cell);
    if (!t) return '';
    if (NO_WORDS.includes(t)) return 'no';
    if (t === '左') return 'vision';
    if (t === '右') return 'visionR';
    for (const r of CONTAINS_ROLES) if (VOCAB[r].includes(t)) return r === 'vision' ? sideOfVision(t) : r;
    if (t.length <= 60) {
        // 「MIC（有線）」「備考（動線・MC・演者）」のように語を含むもの：最も前に現れる語（同じ位置なら長い語）で決める
        let best = '', bestPos = Infinity, bestLen = 0;
        for (const r of CONTAINS_ROLES) for (const w of VOCAB[r]) {
            if (w.length < 2) continue;
            const pos = t.indexOf(w);
            if (pos < 0) continue;
            if (pos < bestPos || (pos === bestPos && w.length > bestLen)) { best = r; bestPos = pos; bestLen = w.length; }
        }
        return best === 'vision' ? sideOfVision(t) : best;
    }
    return '';
}

// ビジョンの列：【右】（右）などが付いていれば右面（visionR）、それ以外は左面（vision）
function sideOfVision(t) {
    if (/[【\[（(]右[】\]）)]/.test(t)) return 'visionR';
    if (/[【\[（(]左[】\]）)]/.test(t)) return 'vision';
    if (t.includes('右') && !t.includes('左')) return 'visionR';
    return 'vision';
}

function avgLen(grid, from, col) {
    let sum = 0, n = 0;
    for (let i = from; i < grid.length; i++) { const v = grid[i][col]; if (v) { sum += v.length; n++; } }
    return n ? sum / n : 0;
}
function countCells(grid, from, col) {
    let n = 0;
    for (let i = from; i < grid.length; i++) if (grid[i][col]) n++;
    return n;
}

function findHeaderRow(grid) {
    for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, grid.length); i++) {
        const roles = new Set(grid[i].map(roleOfHeader).filter(Boolean));
        if (roles.size >= 2) return i;
    }
    return -1;
}

// 列の役割を決める。headerRow = -1 は「見出しなし」
function assignRoles(grid, headerRow) {
    const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
    const roles = new Array(width).fill('');
    const from = headerRow + 1;
    if (headerRow < 0) {
        if (width === 0) return roles;
        roles[0] = 'title';
        let best = -1, bestLen = 0;
        for (let c = 0; c < width; c++) { const a = avgLen(grid, 0, c); if (a > bestLen) { best = c; bestLen = a; } }
        if (best > 0) roles[best] = 'script';
        else if (best === 0 && width > 1) {
            // 1列目が最長なら、1列目をセリフ扱いにして内容は付けない
            roles[0] = 'script';
        }
        return roles;
    }
    const used = new Set();
    for (let c = 0; c < width; c++) {
        const r = roleOfHeader(grid[headerRow][c]);
        if (r && !used.has(r)) { roles[c] = r; used.add(r); }
        else if (r && r === 'script') roles[c] = 'script';    // コメントが複数あるとき
    }
    // セリフの候補（「セリフ」系の見出し ＋ 見出しが空でデータのある列）が複数あるとき：最長＝セリフ、短い方＝話者
    const cands = [];
    for (let c = 0; c < width; c++) {
        const blank = !norm(grid[headerRow][c]) && !roles[c] && countCells(grid, from, c) > 0;
        if (roles[c] === 'script' || blank) cands.push(c);
    }
    if (cands.length >= 2) {
        const sorted = cands.slice().sort((a, b) => avgLen(grid, from, b) - avgLen(grid, from, a));
        roles[sorted[0]] = 'script';
        let speakerFree = !roles.includes('speaker');
        sorted.slice(1).forEach(c => {
            if (speakerFree) { roles[c] = 'speaker'; speakerFree = false; }
            else roles[c] = '';
        });
    }
    return roles;
}

function sampleOf(grid, from, col, n = 3) {
    const out = [];
    for (let i = Math.max(0, from); i < grid.length && out.length < n; i++) { const v = grid[i][col]; if (v) out.push(v.length > 40 ? v.slice(0, 40) + '…' : v); }
    return out;
}

// シートの見出し行・列の割り当てを調べる（forcedHeader が数値ならその行を見出しにする）
function analyzeSheet(grid, forcedHeader) {
    let headerRow = Number.isInteger(forcedHeader) ? forcedHeader : findHeaderRow(grid);
    if (headerRow >= grid.length) headerRow = -1;
    const roles = assignRoles(grid, headerRow);
    const columns = roles.map((role, c) => ({
        index: c,
        header: headerRow >= 0 ? (grid[headerRow][c] || '') : '',
        role,
        sample: sampleOf(grid, headerRow + 1, c)
    }));
    let dataRows = 0;
    for (let i = headerRow + 1; i < grid.length; i++) if (grid[i].some(Boolean)) dataRows++;
    // 台本のシートらしいか：セリフの列があり、BGM・ビジョンのどれかもある（表紙・キュー表・名簿などは既定でOFF）
    const has = r => roles.includes(r);
    const suggestInclude = dataRows > 0 && has('script') && (has('bgm') || has('vision') || has('visionR'));
    return { headerRow, headerFound: headerRow >= 0, columns, rowCount: dataRows, suggestInclude };
}

// Excel の時刻値（数値）を読める形にする。小数を含む数値だけが対象（「10」などの整数はそのまま）
function numToTime(v, asDuration) {
    const s = String(v).trim();
    if (!/^-?\d+\.\d+$/.test(s) && !/^-?\d+(\.\d+)?e-?\d+$/i.test(s)) return v;
    const n = Math.abs(Number(s));
    if (!isFinite(n)) return v;
    let sec = Math.round((n - Math.floor(n)) * 86400);
    if (sec >= 86400) sec = 0;
    const days = Math.floor(n);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
    const p2 = x => String(x).padStart(2, '0');
    if (asDuration) {
        const totalH = days * 24 + h;
        return totalH > 0 ? `${totalH}:${p2(m)}:${p2(ss)}` : `${m}:${p2(ss)}`;
    }
    return ss ? `${p2(h)}:${p2(m)}:${p2(ss)}` : `${p2(h)}:${p2(m)}`;
}

const SAME_RE = /^(↓|⇓|〃|以下[、,，]?\s*(繰り返し|くり返し|同じ|同様))$/;
function isSameMark(text) { return SAME_RE.test(norm(text)); }

// シートの設定どおりに行を取り出す
const NUMBER_RE = /^[A-Za-z]{1,4}[-－ー]?\d+$/;
function extractRows(grid, headerRow, roles) {
    const out = [];
    // 章の行：番号の列（無ければ、役割の無い1列目）だけに文字があり、他が空
    let noCol = roles.indexOf('no');
    if (noCol < 0 && roles.length && roles[0] === '') noCol = 0;
    for (let i = headerRow + 1; i < grid.length; i++) {
        const row = grid[i];
        const o = { no: '', time: '', dur: '', title: '', bgm: '', vision: '', visionR: '', mic: '', speaker: '', script: '', note: '', kind: 'row' };
        let any = false;
        if (noCol >= 0 && row[noCol] && String(row[noCol]).trim() && !NUMBER_RE.test(String(row[noCol]).trim())
            && row.every((c, k) => k === noCol || !String(c || '').trim())) {
            o.kind = 'chapter';
            o.title = String(row[noCol]).trim();
            out.push(o);
            continue;
        }
        roles.forEach((role, c) => {
            if (!role || !row[c]) return;
            let v = String(row[c]).trim();
            if (!v) return;
            if (role === 'time') v = numToTime(v, false);
            else if (role === 'dur') v = numToTime(v, true);
            o[role] = o[role] ? `${o[role]}\n${v}` : v;
            any = true;
        });
        if (any) out.push(o);
    }
    return out;
}

// ---- CSV / TSV / 貼り付け ------------------------------------------------------
function parseDelimited(text, delim) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
            else cell += c;
        } else if (c === '"' && cell === '') q = true;
        else if (c === delim) { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    return rows.map(r => { while (r.length < width) r.push(''); return r; }).filter(r => r.some(c => c.trim() !== ''));
}

function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) {
        try { return new TextDecoder('shift_jis').decode(buf); } catch (e2) { return buf.toString('utf8'); }
    }
}

module.exports = { ROLES, ROLE_NAMES, analyzeSheet, extractRows, parseDelimited, decodeText, isSameMark, numToTime, roleOfHeader, norm };
