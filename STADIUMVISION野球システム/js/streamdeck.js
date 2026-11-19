/* ==========================================================================
   スタジアムビジョン野球システム - Stream Deck USB直結（WebHID）
   - 「BASEBALLテロップシステム」の Stream Deck 直結と同じ方式（Chrome / Edge）。機種の表・LCDの描画・
     キー入力の読み取り・上下反転・つなぎ直しをここにまとめた（あちらのファイルは読み込まない）
   - キーの割り当ては「操作の一覧（優先順位つき）」から機種のキー数に合わせて自動で決める
       15キー … 決まった並び（下の LAYOUTS。中段3番目は「BGM 小さく⇔戻す」） ／ 32キー … 15キー＋BGM4〜12＋グループ（セクション）のジャンプ
       6・8キーなど … 優先順位の高いものから詰める
   - 操作の中身（run）と表示（describe）は dashboard.js が渡す。画面のボタンと同じ関数を呼ぶ
   ※ 実機での確認は MK.2（15キー・JPEG）を想定。BMP方式の機種（初代・Mini）は画像の向きが未確認（上下反転ボタン・位置ずれ調整で合わせる）
   ========================================================================== */
const StreamDeck = (() => {
    const VENDOR_ID = 0x0fd9;
    // 機種の表。inputOffset は「レポートID込み」の読み取り位置（WebHID はIDを除いて渡すので、使うときは -1）
    //   proto v2 … 1024バイトのパケット（ヘッダ8バイト）／ v1 … ヘッダ16バイトのパケット（packet = 1パケットの大きさ）
    //   transform … 画像を送る前の向きの補正（rot180 / flipX / rot90 / none）。keyDir rtl … キー番号が右から左
    const MODELS = {
        0x006d: { name: "Stream Deck V2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" },
        0x0080: { name: "Stream Deck MK.2", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" },
        0x0060: { name: "Stream Deck Original V1", cols: 5, rows: 3, keyCount: 15, imgFormat: "bmp", iconSize: 72, inputOffset: 1, proto: "v1", packet: 8191, transform: "flipX", keyDir: "rtl" },
        0x0063: { name: "Stream Deck Mini", cols: 3, rows: 2, keyCount: 6, imgFormat: "bmp", iconSize: 80, inputOffset: 1, proto: "v1", packet: 1024, transform: "rot90", keyDir: "ltr" },
        0x0090: { name: "Stream Deck Mini V2", cols: 3, rows: 2, keyCount: 6, imgFormat: "jpeg", iconSize: 80, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" },
        0x006c: { name: "Stream Deck XL", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" },
        0x008f: { name: "Stream Deck XL V2", cols: 8, rows: 4, keyCount: 32, imgFormat: "jpeg", iconSize: 96, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" },
        0x0084: { name: "Stream Deck +", cols: 4, rows: 2, keyCount: 8, imgFormat: "jpeg", iconSize: 120, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" }
    };
    const DEFAULT_MODEL = { name: "Stream Deck", cols: 5, rows: 3, keyCount: 15, imgFormat: "jpeg", iconSize: 72, inputOffset: 4, proto: "v2", transform: "rot180", keyDir: "ltr" };

    // 決まった並び（操作の id。左上から右へ・下へ）。ここに無いキー数は、優先順位の高い順に詰める
    const LAYOUTS = {
        15: ["next", "prev", "readUp", "readDown", "take",
            "futaLeft", "futaFull", "bgmDuck", "swap", "black",
            "bgm1", "bgm2", "bgm3", "bgmFade", "bgmStop"],
        // 32キー（8×4）：左の5列は15キーと同じ。右の3列と最下段に BGM4〜12・セクションのジャンプ
        32: ["next", "prev", "readUp", "readDown", "take", "sec1", "sec2", "sec3",
            "futaLeft", "futaFull", "sec8", "swap", "black", "sec4", "sec5", "sec6",
            "bgm1", "bgm2", "bgm3", "bgmFade", "bgmStop", "bgm4", "bgm5", "bgm6",
            "bgm7", "bgm8", "bgm9", "bgm10", "bgm11", "bgm12", "sec7", "bgmDuck"]
    };

    const PREF_KEY = "stadiumvision-baseball.streamdeck";
    let defs = [];            // 操作の一覧（優先順位順）
    let device = null;
    let profile = null;
    let flipVertical = false;
    let keyShift = 0;         // キー入力の読み取り位置のずれ調整
    let brightness = 80;
    let previewCount = 15;    // 実機がないときに画面で見せるキー数
    let onStatus = () => {};
    let inputHandler = null;
    let sendChain = Promise.resolve();
    let sigCache = [];
    let prevPressed = [];
    let renderTimer = null;
    let rendering = false, renderAgain = false;

    function loadPrefs() {
        try {
            const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
            if (typeof p.flipVertical === "boolean") flipVertical = p.flipVertical;
            if (Number.isInteger(p.keyShift)) keyShift = p.keyShift;
            if (Number.isInteger(p.brightness)) brightness = Math.max(0, Math.min(100, p.brightness));
            if ([6, 8, 15, 32].includes(p.previewCount)) previewCount = p.previewCount;
        } catch (e) { /* 保存領域が使えないときは、その回だけの設定 */ }
    }
    function savePrefs() {
        try { localStorage.setItem(PREF_KEY, JSON.stringify({ flipVertical, keyShift, brightness, previewCount })); } catch (e) { /* 何もしない */ }
    }

    // ---- キーの割り当て（機種のキー数 → 操作） --------------------------------------
    // 戻り値：長さ keyCount の配列（割り当てのないキーは null）
    function assignKeys(list, keyCount) {
        const byId = new Map(list.map(d => [d.id, d]));
        const out = new Array(keyCount).fill(null);
        const layout = LAYOUTS[keyCount];
        if (layout) {
            layout.forEach((id, i) => { if (i < keyCount) out[i] = byId.get(id) || null; });
            // 使わない操作（BGMを鳴らさない設定のとき）で空いたキューは、まだ置いていない操作を優先順位の順に詰める
            const placed = new Set(out.filter(Boolean));
            const rest = list.filter(d => !placed.has(d));
            for (let i = 0; i < keyCount; i++) if (!out[i] && rest.length && layout[i] && !byId.has(layout[i])) out[i] = rest.shift();
        } else {
            list.slice(0, keyCount).forEach((d, i) => { out[i] = d; });
        }
        return out;
    }

    // ---- キーの位置（画面上の番号 ⇔ 機器の番号） ----------------------------------------
    function colsRows() { return profile ? { cols: profile.cols, rows: profile.rows } : { cols: 5, rows: 3 }; }
    // 画面の並び（左上が0）の番号 → 機器の番号
    function toPhysical(logical) {
        if (!profile) return logical;
        const { cols, rows } = colsRows();
        let r = Math.floor(logical / cols), c = logical % cols;
        if (flipVertical) r = rows - 1 - r;
        if (profile.keyDir === "rtl") c = cols - 1 - c;
        return r * cols + c;
    }
    function toLogical(physical) {
        if (!profile) return physical;
        const { cols, rows } = colsRows();
        let r = Math.floor(physical / cols), c = physical % cols;
        if (profile.keyDir === "rtl") c = cols - 1 - c;
        if (flipVertical) r = rows - 1 - r;
        return r * cols + c;
    }

    function assigned() { return assignKeys(defs, profile ? profile.keyCount : previewCount); }

    // ---- 描画 -----------------------------------------------------------------------
    function shade(hex, f) {
        const n = parseInt(String(hex).replace("#", ""), 16) || 0;
        const ch = v => Math.max(0, Math.min(255, Math.round(v * f)));
        return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    }

    // 1つのキーの見た目を決める（ON は明るい色＋白い枠、OFF は暗い色）
    function look(d) {
        const x = d ? d.describe() : null;
        if (!x) return { label: "", sub: "", bg: "#05070c", on: false, empty: true };
        const base = x.color || "#334155";
        let bg = base;
        if (x.toggle) bg = x.on ? (x.onColor || base) : shade(base, 0.45);
        return { label: String(x.label || ""), sub: String(x.sub || ""), bg, on: !!(x.toggle && x.on), empty: false };
    }

    function fitFont(ctx, text, size, maxW, bold) {
        let fs = size;
        while (fs > 8) {
            ctx.font = `${bold ? "bold " : ""}${fs}px "Noto Sans JP","Yu Gothic","Hiragino Sans",sans-serif`;
            if (ctx.measureText(text).width <= maxW) break;
            fs -= 1;
        }
        return fs;
    }
    const fontOf = (fs, bold) => `${bold ? "bold " : ""}${fs}px "Noto Sans JP","Yu Gothic","Hiragino Sans",sans-serif`;
    function ellipsize(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
        return t + "…";
    }
    // ラベルの折り返し：空白（全角含む）で優先して改行 → 入りきらなければ文字を縮める → それでも入らなければ末尾を「…」にする
    // 戻り値 { lines, fs }
    function layoutLabel(ctx, label, maxW, baseFs) {
        if (label.includes("\n")) {
            const lines = label.split("\n").slice(0, 2);
            const fs = Math.min(...lines.map(t => fitFont(ctx, t, baseFs * 0.85, maxW, true)));
            return { lines, fs };
        }
        const text = label.trim();
        const minFs = Math.max(10, Math.round(baseFs * 0.6));
        // 空白の位置で2行に分ける案（幅の大きい方がいちばん小さくなる位置）
        const words = text.split(/[\s\u3000]+/).filter(Boolean);
        const spaced = words.length >= 2;
        // 1) まず1行で収まるか（元の大きさから7割まで縮めて測る）。収まるなら改行しない
        for (let fs = Math.round(baseFs); fs >= Math.round(baseFs * 0.7); fs--) {
            ctx.font = fontOf(fs, true);
            if (ctx.measureText(text).width <= maxW) return { lines: [text], fs };
        }
        // 2) 収まらないときだけ、空白で2行にする（元の大きさから縮めながら）
        for (let fs = Math.round(baseFs); fs >= minFs && spaced; fs--) {
            ctx.font = fontOf(fs, true);
            let best = null, bestW = Infinity;
            for (let i = 1; i < words.length; i++) {
                const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
                const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
                if (w < bestW) { bestW = w; best = [a, b]; }
            }
            if (best && bestW <= maxW) return { lines: best, fs };
        }
        // 3) 空白が無いときは、最小の大きさまで縮めて1行
        for (let fs = Math.round(baseFs * 0.7) - 1; fs >= minFs && !spaced; fs--) {
            ctx.font = fontOf(fs, true);
            if (ctx.measureText(text).width <= maxW) return { lines: [text], fs };
        }
        ctx.font = fontOf(minFs, true);
        if (spaced) {
            let best = null, bestW = Infinity;
            for (let i = 1; i < words.length; i++) {
                const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
                const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
                if (w < bestW) { bestW = w; best = [a, b]; }
            }
            return { lines: best.map(t => ellipsize(ctx, t, maxW)), fs: minFs };
        }
        return { lines: [ellipsize(ctx, text, maxW)], fs: minFs };
    }
    function wrapChars(ctx, text, maxW, maxLines) {
        const lines = [];
        let cur = "";
        for (const ch of String(text).replace(/\n/g, " ")) {
            if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; if (lines.length >= maxLines) break; }
            else cur += ch;
        }
        if (lines.length < maxLines && cur) lines.push(cur);
        return lines;
    }

    function drawKey(lk, size) {
        const cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = lk.bg;
        ctx.fillRect(0, 0, size, size);
        if (lk.empty) return cv;
        ctx.strokeStyle = lk.on ? "#ffffff" : "rgba(255,255,255,0.22)";
        ctx.lineWidth = lk.on ? 5 : 2;
        ctx.strokeRect(2, 2, size - 4, size - 4);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const hasSub = !!lk.sub;
        const { lines, fs } = layoutLabel(ctx, lk.label, size - 10, size * 0.24);
        const step = fs * 1.15;
        const sfs = Math.round(size * 0.15);
        let sl = [];
        if (hasSub) {
            ctx.font = `${sfs}px "Noto Sans JP","Yu Gothic",sans-serif`;
            sl = wrapChars(ctx, lk.sub, size - 10, 2);
        }
        const gap = sl.length ? size * 0.05 : 0;
        // ラベル＋サブ全体の高さがキーの内側に収まらないときは、サブを1行にする
        if (sl.length > 1 && lines.length * step + gap + sl.length * sfs * 1.2 > size - 8) sl = [ellipsize(ctx, sl.join(""), size - 10)];
        const total = lines.length * step + gap + sl.length * sfs * 1.2;
        let y = (size - total) / 2;
        ctx.fillStyle = "#ffffff";
        ctx.font = fontOf(fs, true);
        lines.forEach((t, i) => ctx.fillText(t, size / 2, y + step * (i + 0.5)));
        y += lines.length * step + gap;
        if (sl.length) {
            ctx.font = `${sfs}px "Noto Sans JP","Yu Gothic",sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            sl.forEach((t, i) => ctx.fillText(t, size / 2, y + sfs * 1.2 * (i + 0.5)));
        }
        return cv;
    }

    function transformCanvas(src, kind) {
        if (!kind || kind === "none") return src;
        const s = src.width;
        const cv = document.createElement("canvas");
        cv.width = s; cv.height = s;
        const c = cv.getContext("2d");
        if (kind === "rot180") { c.translate(s, s); c.rotate(Math.PI); }
        else if (kind === "flipX") { c.translate(s, 0); c.scale(-1, 1); }
        else if (kind === "rot90") { c.translate(s, 0); c.rotate(Math.PI / 2); }
        c.drawImage(src, 0, 0);
        return cv;
    }

    // 24ビットのBMP（下の行から並べる／色は青・緑・赤の順）
    function encodeBmp(cv) {
        const w = cv.width, h = cv.height;
        const px = cv.getContext("2d").getImageData(0, 0, w, h).data;
        const stride = (w * 3 + 3) & ~3;
        const size = 54 + stride * h;
        const out = new Uint8Array(size);
        const dv = new DataView(out.buffer);
        out[0] = 0x42; out[1] = 0x4d;
        dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
        dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
        dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
        dv.setUint32(34, stride * h, true); dv.setUint32(38, 3780, true); dv.setUint32(42, 3780, true);
        for (let y = 0; y < h; y++) {
            const row = 54 + (h - 1 - y) * stride;
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4, o = row + x * 3;
                out[o] = px[i + 2]; out[o + 1] = px[i + 1]; out[o + 2] = px[i];
            }
        }
        return out;
    }

    async function encodeImage(cv) {
        if (profile.imgFormat === "bmp") return encodeBmp(cv);
        const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.9));
        if (!blob) throw new Error("画像を作れませんでした");
        return new Uint8Array(await blob.arrayBuffer());
    }

    // ---- 機器への送信（順番に1つずつ。送信が混ざらないようにする） -------------------------
    function enqueue(fn) {
        sendChain = sendChain.then(fn).catch(e => { console.warn("[StreamDeck] 送信に失敗しました", e); });
        return sendChain;
    }

    async function sendKeyImage(physicalKey, bytes) {
        const dev = device;
        if (!dev) return;
        if (profile.proto === "v1") {
            const PACKET = profile.packet || 1024, HEAD = 16, room = PACKET - HEAD;
            let page = 0, off = 0;
            while (off < bytes.length) {
                const len = Math.min(room, bytes.length - off);
                const pk = new Uint8Array(PACKET);
                pk.set([0x02, 0x01, page + 1, 0x00, off + len >= bytes.length ? 1 : 0, physicalKey + 1], 0);
                pk.set(bytes.subarray(off, off + len), HEAD);
                await dev.sendReport(0x02, pk.slice(1));
                off += len; page++;
            }
            return;
        }
        const PACKET = 1024, HEAD = 8, room = PACKET - HEAD;
        let page = 0, off = 0;
        while (off < bytes.length) {
            const len = Math.min(room, bytes.length - off);
            const pk = new Uint8Array(PACKET);
            pk[0] = 0x02; pk[1] = 0x07; pk[2] = physicalKey; pk[3] = off + len >= bytes.length ? 1 : 0;
            pk[4] = len & 0xff; pk[5] = (len >> 8) & 0xff; pk[6] = page & 0xff; pk[7] = (page >> 8) & 0xff;
            pk.set(bytes.subarray(off, off + len), HEAD);
            await dev.sendReport(0x02, pk.slice(1));
            off += len; page++;
        }
    }

    async function setBrightness(pct) {
        if (!device || !device.sendFeatureReport) return;
        try {
            if (profile.proto === "v1") {
                const d = new Uint8Array(16); d.set([0x55, 0xaa, 0xd1, 0x01, pct]);
                await device.sendFeatureReport(0x05, d);
            } else {
                const d = new Uint8Array(31); d.set([0x08, pct]);
                await device.sendFeatureReport(0x03, d);
            }
        } catch (e) { console.warn("[StreamDeck] 明るさを変えられませんでした", e); }
    }

    // 変化のあったキーだけ描き直す
    async function renderNow(force) {
        if (!device || !profile) return;
        if (rendering) { renderAgain = true; return; }
        rendering = true;
        try {
            if (force) sigCache = [];
            const list = assigned();
            for (let logical = 0; logical < profile.keyCount; logical++) {
                const lk = look(list[logical]);
                const sig = JSON.stringify([lk.label, lk.sub, lk.bg, lk.on, lk.empty]);
                const phys = toPhysical(logical);
                if (sigCache[phys] === sig) continue;
                sigCache[phys] = sig;
                const cv = transformCanvas(drawKey(lk, profile.iconSize), profile.transform);
                const bytes = await encodeImage(cv);
                await enqueue(() => sendKeyImage(phys, bytes));
            }
        } catch (e) {
            console.warn("[StreamDeck] 画面の描き直しに失敗しました", e);
        } finally {
            rendering = false;
            if (renderAgain) { renderAgain = false; refresh(); }
        }
    }
    // 状態が変わったときに呼ぶ（まとめて少し待ってから描く）
    function refresh(force) {
        if (!device) return;
        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => renderNow(force), force ? 0 : 40);
    }

    // ---- キー入力 ---------------------------------------------------------------------
    function press(logical) {
        const d = assigned()[logical];
        if (!d || !d.run) return false;
        try {
            const r = d.run();
            if (r && typeof r.catch === "function") r.catch(e => console.error("[StreamDeck] 操作に失敗しました", e));
        } catch (e) {
            console.error("[StreamDeck] 操作に失敗しました", e);
        }
        return true;
    }

    function handleInput(ev) {
        if (!profile || !ev || !ev.data) return;
        if (ev.reportId !== undefined && ev.reportId !== 1) return;
        const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
        if (profile.proto === "v2" && data.length && data[0] !== 0) return;    // キー以外（ダイヤル・タッチ）は無視
        const offset = Math.max(0, profile.inputOffset - 1 + keyShift);
        for (let i = 0; i < profile.keyCount; i++) {
            const idx = offset + i;
            if (idx >= data.length) break;
            const down = data[idx] === 1;
            if (down && !prevPressed[i]) press(toLogical(i));
            prevPressed[i] = down;
        }
    }

    // ---- つなぐ・切る ---------------------------------------------------------------------
    function status() {
        onStatus({
            supported: !!(typeof navigator !== "undefined" && navigator.hid),
            connected: !!device,
            name: profile ? profile.name : "",
            keyCount: profile ? profile.keyCount : previewCount,
            flipVertical, keyShift, brightness, previewCount
        });
    }

    async function connect(dev) {
        try {
            if (device && device !== dev) await disconnect(true);
            if (!dev.opened) await dev.open();
            device = dev;
            profile = MODELS[dev.productId] || Object.assign({}, DEFAULT_MODEL, { name: dev.productName || DEFAULT_MODEL.name });
            prevPressed = [];
            sigCache = [];
            inputHandler = handleInput;
            if (dev.addEventListener) dev.addEventListener("inputreport", inputHandler);
            else dev.oninputreport = inputHandler;
            status();
            await setBrightness(brightness);
            refresh(true);
            return true;
        } catch (e) {
            console.error("[StreamDeck] つなげませんでした", e);
            device = null; profile = null;
            status();
            return false;
        }
    }

    async function disconnect(keepStatus) {
        const dev = device;
        device = null;
        if (dev) {
            try {
                if (inputHandler && dev.removeEventListener) dev.removeEventListener("inputreport", inputHandler);
                else dev.oninputreport = null;
            } catch (e) { /* 何もしない */ }
            try { await dev.close(); } catch (e) { /* 抜かれたあとは閉じられない */ }
        }
        profile = null;
        prevPressed = [];
        sigCache = [];
        if (!keepStatus) status();
    }

    // 「接続」ボタン（クリックなどの操作のあとでないと、ブラウザは機器の選択画面を出せない）
    async function requestAndConnect() {
        if (!navigator.hid) return false;
        try {
            const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID }] });
            if (devs.length) return connect(devs[0]);
        } catch (e) {
            console.error("[StreamDeck] 機器を選べませんでした", e);
        }
        return false;
    }

    // 画面を開いたとき：許可済みの機器があれば自動でつなぐ。抜き差しにも追従する
    function init(opts) {
        onStatus = (opts && opts.onStatus) || onStatus;
        loadPrefs();
        status();
        if (!navigator.hid) return;
        navigator.hid.addEventListener("connect", e => { if (e.device && e.device.vendorId === VENDOR_ID && !device) connect(e.device); });
        navigator.hid.addEventListener("disconnect", e => { if (device && e.device === device) disconnect(); });
        navigator.hid.getDevices().then(list => {
            const d = list.find(x => x.vendorId === VENDOR_ID);
            if (d) connect(d);
        }).catch(e => console.warn("[StreamDeck] 許可済みの機器を調べられませんでした", e));
    }

    return {
        MODELS, LAYOUTS, assignKeys, init, connect, disconnect, requestAndConnect, refresh, press, look,
        setActions(list) { defs = list; refresh(); },
        isConnected: () => !!device,
        getProfile: () => profile,
        getKeyCount: () => (profile ? profile.keyCount : previewCount),
        layoutFor: count => assignKeys(defs, count),
        setPreviewCount(n) { previewCount = n; savePrefs(); status(); },
        toggleFlip() { flipVertical = !flipVertical; savePrefs(); status(); refresh(true); return flipVertical; },
        shiftKeys(d) { keyShift = Math.max(-3, Math.min(8, keyShift + d)); savePrefs(); status(); },
        setBrightness(p) { brightness = Math.max(0, Math.min(100, Math.round(p))); savePrefs(); status(); return setBrightness(brightness); },
        // 試験用（モックの機器で描画データを確かめる）
        _layoutLabel: layoutLabel, _drawKey: drawKey, _renderNow: renderNow, _handleInput: handleInput, _toLogical: toLogical, _toPhysical: toPhysical
    };
})();
