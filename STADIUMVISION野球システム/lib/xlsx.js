/* ==========================================================================
   .xlsx の読み取り（Node 標準の zlib だけで動く。npm パッケージは使わない）
   - ZIP のセントラルディレクトリからサイズを読む（data descriptor つきのファイルにも対応）
   - sharedStrings（rich text・ふりがな）／inlineStr／str／数値／真偽値を読む
   - 戻り値：{ sheets: [{ name, grid: [[文字, ...], ...] }] }（grid は行・列の順、空セルは ''）
   ========================================================================== */
const zlib = require('zlib');

const LIMITS = { fileBytes: 20 * 1024 * 1024, sheets: 30, rows: 3000, cellChars: 5000, cols: 200, entryBytes: 200 * 1024 * 1024 };

class XlsxError extends Error {}

// ---- ZIP ------------------------------------------------------------------
function readZip(buf) {
    if (buf.length < 22) throw new XlsxError('ファイルが小さすぎます。Excel のファイル（.xlsx）ではありません');
    if (buf.readUInt32LE(0) === 0xe011cfd0 || buf.readUInt32BE(0) === 0xd0cf11e0) {
        throw new XlsxError('古い形式（.xls）またはパスワード付きのファイルです。Excel で「名前を付けて保存」→「Excel ブック（.xlsx）」にして、パスワードを外してから読み込んでください');
    }
    if (buf.readUInt16LE(0) !== 0x4b50) throw new XlsxError('Excel のファイル（.xlsx）ではありません。拡張子が .xlsx のファイルを選んでください');
    // 末尾から「セントラルディレクトリ終端」を探す
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new XlsxError('ファイルが壊れています（ZIP の終端が見つかりません）。Excel で開き直して保存し直してください');
    const total = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new XlsxError('大きすぎる形式（ZIP64）のファイルは読み込めません');
    const entries = new Map();
    let p = cdOff;
    for (let n = 0; n < total; n++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('ファイルが壊れています（ファイル一覧を読めません）');
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const usize = buf.readUInt32LE(p + 24);
        const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
        const lho = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nlen);
        entries.set(name, { method, csize, usize, lho });
        p += 46 + nlen + elen + clen;
    }
    return {
        has: name => entries.has(name),
        names: () => [...entries.keys()],
        read(name) {
            const e = entries.get(name);
            if (!e) return null;
            if (e.usize > LIMITS.entryBytes) throw new XlsxError(`ファイルの中身が大きすぎます（${name}）`);
            const o = e.lho;
            if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new XlsxError(`ファイルが壊れています（${name}）`);
            // ローカルヘッダのサイズは 0 のことがあるので、サイズはセントラルディレクトリのものを使う
            const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
            if (start + e.csize > buf.length) throw new XlsxError(`ファイルが途中で切れています（${name}）`);
            const raw = buf.subarray(start, start + e.csize);
            if (e.method === 0) return raw;
            if (e.method === 8) {
                try { return zlib.inflateRawSync(raw, { maxOutputLength: LIMITS.entryBytes }); }
                catch (err) { throw new XlsxError(`ファイルが壊れています（${name} を解凍できません）`); }
            }
            throw new XlsxError(`対応していない圧縮方式です（${name}）`);
        }
    };
}

// ---- XML ------------------------------------------------------------------
function decodeEntities(s) {
    return s
        .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safeChar(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (m, d) => safeChar(parseInt(d, 10)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => safeChar(parseInt(h, 16)));
}
function safeChar(n) { try { return String.fromCodePoint(n); } catch (e) { return ''; } }

function attrs(s) {
    const o = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(s))) o[m[1] || m[3]] = decodeEntities(m[2] !== undefined ? m[2] : m[4]);
    return o;
}

// <t>…</t> を全部つなぐ（ふりがな rPh は除く）
function textOf(xml) {
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '';
    const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
    let m;
    while ((m = re.exec(xml))) if (m[1] !== undefined) out += m[1];
    return decodeEntities(out);
}

function colIndex(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function parseSharedStrings(xml) {
    const list = [];
    const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
    let m;
    while ((m = re.exec(xml))) list.push(m[1] === undefined ? '' : textOf(m[1]));
    return list;
}

function parseSheet(xml, shared, sheetName) {
    const rows = new Map();      // 行番号 → [セル]
    let seqRow = 0;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
        const ra = attrs(rm[1]);
        const rowNo = ra.r ? parseInt(ra.r, 10) - 1 : seqRow;
        seqRow = rowNo + 1;
        if (!rm[2]) continue;
        const cells = [];
        let seqCol = 0;
        const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cm;
        while ((cm = cre.exec(rm[2]))) {
            const ca = attrs(cm[1]);
            let col = seqCol;
            if (ca.r) { const mm = /^([A-Za-z]+)/.exec(ca.r); if (mm) col = colIndex(mm[1]); }
            seqCol = col + 1;
            if (cm[2] === undefined) continue;
            const body = cm[2];
            let val = '';
            const t = ca.t || 'n';
            if (t === 'inlineStr') {
                const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
                val = is ? textOf(is[1]) : '';
            } else {
                const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
                const raw = v ? decodeEntities(v[1]) : '';
                if (t === 's') val = shared[parseInt(raw, 10)] !== undefined ? shared[parseInt(raw, 10)] : '';
                else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
                else val = raw;
            }
            val = val.replace(/\r\n?/g, '\n');
            if (val === '') continue;
            if (val.length > LIMITS.cellChars) {
                throw new XlsxError(`シート「${sheetName}」の ${rowNo + 1} 行目に ${LIMITS.cellChars} 文字を超えるセルがあります。分けてから読み込んでください`);
            }
            if (col >= LIMITS.cols) continue;
            cells[col] = val;
        }
        if (cells.some(c => c !== undefined)) rows.set(rowNo, cells);
    }
    if (rows.size > LIMITS.rows) {
        throw new XlsxError(`シート「${sheetName}」の行が多すぎます（${rows.size}行。1シート${LIMITS.rows}行まで）`);
    }
    const nos = [...rows.keys()].sort((a, b) => a - b);
    const grid = [];
    let width = 0;
    nos.forEach(n => { width = Math.max(width, rows.get(n).length); });
    nos.forEach(n => {
        const r = rows.get(n);
        const row = [];
        for (let i = 0; i < width; i++) row.push(r[i] === undefined ? '' : r[i]);
        grid.push(row);
    });
    return grid;
}

function resolveTarget(t) {
    t = String(t || '');
    if (t.startsWith('/')) return t.slice(1);
    const parts = ('xl/' + t).split('/');
    const out = [];
    parts.forEach(p => { if (p === '..') out.pop(); else if (p !== '.') out.push(p); });
    return out.join('/');
}

function parseXlsx(buf) {
    if (!Buffer.isBuffer(buf)) throw new XlsxError('ファイルを受け取れませんでした');
    if (buf.length > LIMITS.fileBytes) throw new XlsxError('ファイルが大きすぎます（20MBまで）');
    const zip = readZip(buf);
    const wbBuf = zip.read('xl/workbook.xml');
    if (!wbBuf) throw new XlsxError('Excel のブックとして読めません（xl/workbook.xml がありません）');
    const wb = wbBuf.toString('utf8');
    const sheetDefs = [];
    const sre = /<sheet\b([^>]*?)\/?>/g;
    let m;
    while ((m = sre.exec(wb))) {
        const a = attrs(m[1]);
        sheetDefs.push({ name: a.name || `シート${sheetDefs.length + 1}`, rid: a['r:id'] || a.id });
    }
    if (sheetDefs.length === 0) throw new XlsxError('シートが1つもありません');
    if (sheetDefs.length > LIMITS.sheets) throw new XlsxError(`シートが多すぎます（${sheetDefs.length}枚。${LIMITS.sheets}枚まで）`);

    const relMap = {};
    const relBuf = zip.read('xl/_rels/workbook.xml.rels');
    if (relBuf) {
        const rre = /<Relationship\b([^>]*?)\/?>/g;
        let rm;
        while ((rm = rre.exec(relBuf.toString('utf8')))) { const a = attrs(rm[1]); if (a.Id) relMap[a.Id] = a.Target; }
    }
    const ssBuf = zip.read('xl/sharedStrings.xml');
    const shared = ssBuf ? parseSharedStrings(ssBuf.toString('utf8')) : [];

    const sheets = [];
    sheetDefs.forEach((d, i) => {
        let file = relMap[d.rid] ? resolveTarget(relMap[d.rid]) : `xl/worksheets/sheet${i + 1}.xml`;
        if (!zip.has(file)) file = `xl/worksheets/sheet${i + 1}.xml`;
        const x = zip.read(file);
        if (!x) return;    // グラフシートなどは飛ばす
        sheets.push({ name: d.name, grid: parseSheet(x.toString('utf8'), shared, d.name) });
    });
    if (sheets.length === 0) throw new XlsxError('読めるシートがありません');
    return { sheets };
}

module.exports = { parseXlsx, XlsxError, LIMITS, decodeEntities };
