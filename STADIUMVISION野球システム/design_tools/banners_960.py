"""960x686 版バナー（球場ビジョン左半分の枠：入場・対戦・進行・ロゴ）— 2026-11-18
16:9 版(banners.py)はそのまま残し、こちらは 960x686 に合わせて配置を組み直したもの（引き伸ばし・切り取りはしない）。
作り方：横1920×縦1372（=960×686の2倍）で描き、半分に縮めて書き出す。文字は小さい画面で読めるよう、16:9版より大きめ。
色・フォント・斜めライン・VSの形は 16:9 版と同じ（デザインは承認済みのものを踏襲）。
"""
from make import *
from banners import YELLOW, _ink, _shadow_mask

CW, CH = 1920, 1372              # 作る大きさ（出力は半分の 960x686）
OUT_W, OUT_H = 960, 686
WHITE = (255, 255, 255)
LINE = (255, 255, 255, 200)
FOOT = CH - 190                  # フッターの線（赤ラインはここで止める）
SAFE = 120
K_ENT = 160 / 1080               # 斜めラインの傾き（16:9版と同じ角度）
K_MATCH = 340 / 1080


def finish(img):
    return img.convert('RGB').resize((OUT_W, OUT_H), Image.LANCZOS)


def base():
    bg = vgrad((CW, CH), (14, 40, 74), DEEP)
    glow(bg, 960, 560, 800, (30, 70, 122), 170)
    return grain(bg, 5).convert('RGBA')


def slash(img, top_x, w, k, y0=0, y1=FOOT):
    lay = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    ImageDraw.Draw(lay).polygon([(top_x - k * y0, y0), (top_x + w - k * y0, y0), (top_x + w - k * y1, y1), (top_x - k * y1, y1)], fill=RED + (255,))
    img.alpha_composite(lay)


def footer(img, d, label):
    lg = logo('MLBCUP2026_horiz_white.png', 58)
    img.alpha_composite(lg, (SAFE, CH - 150))
    text(d, (CW - SAFE, CH - 98), label, osw(42, 500), (200, 210, 225), anchor='rs', spacing=5)
    d.rectangle((SAFE, FOOT, CW - SAFE, FOOT + 3), fill=(255, 255, 255, 70))


# ---------------------------------------------------------------- 名前の折り返し（長い名前は2行にして大きく）
def _kind(c):
    if c in '々〆' or '一' <= c <= '鿿': return 'kan'
    if '゠' <= c <= 'ヿ': return 'kata'
    if '぀' <= c <= 'ゟ': return 'hira'
    return 'other'


def _splits(s):
    out = []
    for i in range(1, len(s)):
        a, b = s[i - 1], s[i]
        if b == ' ': out.append((s[:i].rstrip(), s[i + 1:].lstrip()))
        elif a == '・': out.append((s[:i], s[i:]))
        elif (_kind(a), _kind(b)) in (('kan', 'kata'), ('kata', 'kan'), ('kan', 'hira')): out.append((s[:i], s[i:]))
    return [(a, b) for a, b in out if len(a.strip()) >= 2 and len(b.strip()) >= 2]


def layout_name(d, s, cap, maxw, wrap_below):
    """→ (文字の大きさ, 行のリスト)。1行で wrap_below 以上の大きさになるなら1行、足りなければ、一番大きくなる2行の分け方を使う"""
    f100 = jp(100, 900)
    w = lambda t: tw(d, t, f100)
    one = min(cap, maxw / w(s) * 100)
    best = (one, [s]); best_key = None
    if one < wrap_below:
        for a, b in _splits(s):
            sz = min(cap, maxw / max(w(a), w(b)) * 100)
            key = sz - 0.35 * sz * abs(w(a) - w(b)) / max(w(a), w(b))    # 大きいほう優先。ただし2行の長さの差が大きいと減点（均等な分け方を優先）
            if sz > one * 1.15 and (best_key is None or key > best_key): best, best_key = (sz, [a, b]), key
    return int(best[0]) // 2 * 2, best[1]


def _stack(d, lines, f, cx, top, anchor, fill, pitch):
    """行を上から並べる。top=1行目の文字の見える上端。→ 最後の行の見える下端"""
    t0 = f.getbbox(lines[0], anchor='ls')[1]
    y = top - t0
    last = y
    for i, ln in enumerate(lines):
        text(d, (cx, y), ln, f, fill, anchor=anchor)
        last = y + f.getbbox(ln, anchor='ls')[3]
        y += pitch
    return last


# ------------------------------------------------ 1. 入場
def entrance(order, team, league):
    img = base()
    outline_text(img, (1800, FOOT - 40), f'{order:02d}', osw(1000, 700), 6, WHITE, 60, anchor='rs')
    slash(img, 1660, 56, K_ENT)
    d = ImageDraw.Draw(img)
    X = 150
    size, lines = layout_name(d, team, 210, 1320, 170)     # 右の赤ラインに触れないよう、幅は16:9版より少し狭く
    f = jp(size, 900); pitch = round(size * 1.12)          # 2行のときの行送り
    kf = osw(52, 600)
    kt, kb = kf.getbbox('TEAM ENTRANCE', anchor='ls')[1::2]
    lf = jp(56, 500)
    # 見出し＋線＋名前（1〜2行）＋リーグ名を、ひとつの塊として高さを測り、
    # 塊の見える上端〜下端の真ん中を、上端〜フッターの線の 46% の高さ（目で見た中央＝少しだけ上）に置く。1行でも2行でも同じ規則
    GAP1, RULE, GAP2 = 34, 5, 84
    nt = f.getbbox(lines[0], anchor='ls')[1]
    nb = f.getbbox(lines[-1], anchor='ls')[3]
    names_h = (len(lines) - 1) * pitch + (nb - nt)
    gap3 = round(size * 0.32)                              # 名前とリーグ名のあいだ
    lt, lb = lf.getbbox(league, anchor='ls')[1::2] if league else (0, 0)
    total = (kb - kt) + GAP1 + RULE + GAP2 + names_h + ((gap3 + lb - lt) if league else 0)
    top = FOOT * 0.46 - total / 2                          # 塊の見える上端
    text(d, (X + 10, top - kt), 'TEAM ENTRANCE', kf, RED, spacing=12)
    y = top + (kb - kt) + GAP1
    d.rectangle((X + 10, y, X + 10 + 120, y + 4), fill=LINE); y += RULE + GAP2
    last = _stack(d, lines, f, X - 6, y, 'ls', WHITE, pitch)
    if league:
        text(d, (X + 10, last + gap3 - lt), league, lf, (200, 210, 225), spacing=4)
    footer(img, d, '11.21 SAT  OPENING CEREMONY')
    return finish(img)


# ------------------------------------------------ 2. 対戦
BIG = dict(fs=150, cy=(445, 975), vs_fs=230, vs_ink_top=640)


def matchup_big(header, playball, t1, sub1, t2, sub2, footer_label):
    img = base()
    slash(img, 1102 - 28, 56, K_MATCH, y0=130)
    d = ImageDraw.Draw(img)
    HB = 130
    d.rectangle((0, 0, CW, HB), fill=DEEP + (255,))
    text(d, (CW / 2, 90), header, jp(64, 900), WHITE, anchor='ms', spacing=8)
    d.polygon([(650, HB), (1270, HB), (1215, 300), (705, 300)], fill=DEEP + (255,))
    text(d, (CW / 2, HB + 50), 'PLAY BALL', osw(34, 600), RED, anchor='ms', spacing=10)
    text(d, (CW / 2, HB + 138), playball, osw(66, 600), WHITE, anchor='ms', spacing=4)

    maxw = CW - 2 * SAFE
    fs = BIG['fs']
    for t in (t1, t2):
        l, r = _ink(jp(BIG['fs'], 900), t)
        if r - l > maxw: fs = min(fs, BIG['fs'] * maxw / (r - l))
    f = jp(fs, 900)
    sf = jp(48, 500); SP = 8; LN = 64; GAP = 34
    names = Image.new('L', (CW, CH), 0); nd = ImageDraw.Draw(names)
    subs = []
    for i, (t, sub) in enumerate(((t1, sub1), (t2, sub2))):
        l, r = _ink(f, t); inkw = r - l
        ink_left = SAFE if i == 0 else (CW - SAFE) - inkw
        cy = BIG['cy'][i]
        nd.text((ink_left - l, cy), t, font=f, fill=255, anchor='lm')
        stw = tw(d, sub, sf, SP); subw = LN + GAP + stw + GAP + LN
        sx = ink_left if i == 0 else ink_left + inkw - subw
        subs.append((sx, cy + fs * 0.5 + 56, sub, stw))
    _shadow_mask(img, names, (2, 10, 28), 140, 0, 4, 10)
    img.paste(Image.new('RGBA', (CW, CH), WHITE + (255,)), (0, 0), names)
    d = ImageDraw.Draw(img)
    for sx, cy, sub, stw in subs:
        sx, cy = round(sx), round(cy)
        d.rectangle((sx, cy - 2, sx + LN - 1, cy + 1), fill=WHITE)
        text(d, (sx + LN + GAP, cy), sub, sf, WHITE, anchor='lm', spacing=SP)
        x2 = round(sx + LN + GAP + stw + GAP)
        d.rectangle((x2, cy - 2, x2 + LN - 1, cy + 1), fill=WHITE)

    vsf = osw(BIG['vs_fs'], 700)
    l, t, r, b = vsf.getbbox('VS', anchor='ls')
    yb = BIG['vs_ink_top'] - t
    vs_mid = BIG['vs_ink_top'] + (b - t) / 2
    cx = 1102 - 28 + 28 - K_MATCH * vs_mid - 21                    # 赤ラインの上（16:9版と同じ位置関係）
    m = Image.new('L', (CW, CH), 0)
    ImageDraw.Draw(m).text((cx, yb), 'VS', font=vsf, fill=255, anchor='ms')
    k = 0.25
    m = m.transform(m.size, Image.AFFINE, (1, k, -k * yb, 0, 1, 0), Image.BICUBIC)
    _shadow_mask(img, m, (0, 0, 0), 115, 7, 10, 8)
    img.paste(Image.new('RGBA', (CW, CH), YELLOW + (255,)), (0, 0), m)
    d = ImageDraw.Draw(img)
    footer(img, d, footer_label)
    return finish(img)


# ------------------------------------------------ 3. 進行（開会式・閉会式）
def program(no, ja, en, kicker, show_no=False, footer_label='11.21 SAT  MORIYAMA CITY STADIUM'):
    img = base()
    slash(img, 360, 56, K_ENT)
    d = ImageDraw.Draw(img)
    CX = (350 + (CW - SAFE)) / 2
    size, lines = layout_name(d, ja, 230, 1300, 190)
    f = jp(size, 900); pitch = round(size * 1.18)
    kf = osw(52, 600)
    kt, kb = kf.getbbox(kicker, anchor='ls')[1::2]
    REF = jp(200, 900).getbbox('国', anchor='ls'); ref_h = REF[3] - REF[1]
    GAP1, RULE, GAP2 = 38, 5, 84
    top = CY = FOOT / 2
    top = CY - ((kb - kt) + GAP1 + RULE + GAP2 + ref_h * 1.5) / 2          # 見出しの位置は全スライド共通（1行と2行の中間を基準）
    text(d, (CX, top - kt), kicker, kf, RED, anchor='ms', spacing=12)
    y = top + (kb - kt) + GAP1
    d.rectangle((CX - 60, y, CX + 60, y + RULE - 1), fill=LINE); y += RULE + GAP2
    last = _stack(d, lines, f, CX, y, 'ms', WHITE, pitch)
    if en: text(d, (CX, last + 50 - osw(60, 500).getbbox(en, anchor='ls')[1]), en, osw(60, 500), (200, 210, 225), anchor='ms', spacing=12)
    footer(img, d, footer_label)
    return finish(img)


# ------------------------------------------------ 3'. 人物（ゲスト・来賓）
def person(kicker, title, name, honor='様', footer_label='11.21 SAT  MORIYAMA CITY STADIUM'):
    """kicker＝赤の見出し（例 SPECIAL GUEST）、title＝肩書き（名前の上に小さく）、name＝名前（大きく）、honor＝敬称（名前の右に小さく）。
    見出し〜名前の塊を、上端〜フッター線の 46% の高さに置く（入場スライドと同じ重心）"""
    img = base()
    slash(img, 360, 56, K_ENT)
    d = ImageDraw.Draw(img)
    CX = (350 + (CW - SAFE)) / 2
    maxw = 1300
    hf = jp(80, 700)
    hw = (tw(d, ' ' + honor, hf) if honor else 0)
    size, lines = layout_name(d, name, 210, maxw - hw, 170)
    f = jp(size, 900); pitch = round(size * 1.12)
    kf = osw(52, 600); tf = jp(64, 700)
    kt, kb = kf.getbbox(kicker, anchor='ls')[1::2]
    tt, tb = (tf.getbbox(title, anchor='ls')[1::2] if title else (0, 0))
    nt = f.getbbox(lines[0], anchor='ls')[1]; nb = f.getbbox(lines[-1], anchor='ls')[3]
    GAP1, RULE, GAP2, GAP3 = 34, 5, 70, round(size * 0.30)
    h = (kb - kt) + GAP1 + RULE + GAP2 + ((tb - tt) + GAP3 if title else 0) + (nb - nt) + pitch * (len(lines) - 1)
    top = FOOT * 0.46 - h / 2
    text(d, (CX, top - kt), kicker, kf, RED, anchor='ms', spacing=12)
    y = top + (kb - kt) + GAP1
    d.rectangle((CX - 60, y, CX + 60, y + RULE - 1), fill=LINE); y += RULE + GAP2
    # 名前（敬称込み）の塊は中央。肩書きは名前の書き出しの位置に左寄せ（文字の見える左端どうしをそろえる）
    widths = [tw(d, ln, f) + (hw if honor and i == len(lines) - 1 else 0) for i, ln in enumerate(lines)]
    x0 = CX - max(widths) / 2
    ink = lambda t, ft: ft.getbbox(t, anchor='ls')[0]
    if title:
        text(d, (x0 + ink(lines[0], f) - ink(title, tf), y - tt), title, tf, (200, 210, 225), anchor='ls')
        y += (tb - tt) + GAP3
    base_y = y - nt
    for i, ln in enumerate(lines):
        by = base_y + pitch * i
        text(d, (x0, by), ln, f, WHITE, anchor='ls')
        if honor and i == len(lines) - 1:
            text(d, (x0 + tw(d, ln, f) + tw(d, ' ', hf), by), honor, hf, WHITE, anchor='ls')
    footer(img, d, footer_label)
    return finish(img)


# ------------------------------------------------ 4. ロゴ（横長・2段、デザイン／黒）
def logo_960(kind, style):
    w, h = CW, CH
    lw_ = 1180 if kind == 'stack' else int(w * 0.62)
    if style == 'black':
        img = Image.new('RGBA', (w, h), (0, 0, 0, 255))
    else:
        bg = vgrad((w, h), (14, 40, 74), DEEP)
        glow(bg, w // 2, h // 2, int(h * 0.75), (30, 70, 122), 170)
        img = grain(bg, 5).convert('RGBA')
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
        lean, sw = int(h * 0.31), int(h * 0.05)
        margin = (w - lw_) / 2
        for cx in (margin * 0.5, w - margin * 0.5):
            t, bt = cx + lean / 2, cx - lean / 2
            ld.polygon([(t - sw / 2, 0), (t + sw / 2, 0), (bt + sw / 2, h), (bt - sw / 2, h)], fill=RED + (255,))
        img.alpha_composite(lay)
    name = 'MLBCUP2026_stack_white_vector.png' if kind == 'stack' else 'MLBCUP2026_horiz_white.png'
    lg = Image.open(LOGO + name).convert('RGBA')
    lg = lg.resize((lw_, round(lg.height * lw_ / lg.width)), Image.LANCZOS)
    img.alpha_composite(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
    return finish(img)
