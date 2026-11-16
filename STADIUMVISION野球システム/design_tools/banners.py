"""イベントタイトル 16:9（入場・対戦・進行）— 選手スライドA案と同じ2色（ネイビー＋赤）"""
from make import *

WHITE = (255, 255, 255)
LINE = (255, 255, 255, 200)

def base(slash_x=None):
    bg = vgrad((W, H), (14, 40, 74), DEEP)
    glow(bg, 960, 480, 700, (30, 70, 122), 170)
    img = grain(bg, 5).convert('RGBA')
    return img

FOOT_Y = H - 150   # フッターの線。赤ラインはここで止める
def slash(img, top_x, w=60, lean=200, y0=0, y1=FOOT_Y):
    # top_x は y=0 での位置。y0〜y1 の範囲だけ描く
    k = lean / H
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(lay).polygon([(top_x - k * y0, y0), (top_x + w - k * y0, y0), (top_x + w - k * y1, y1), (top_x - k * y1, y1)], fill=RED + (255,))
    img.alpha_composite(lay)

def fit(d, s, maker, size, maxw, minsize=40, **kw):
    while size > minsize and tw(d, s, maker(size), kw.get('spacing', 0)) > maxw: size -= 4
    return maker(size)

def center_text(d, y, s, f, fill, spacing=0):
    text(d, (W / 2, y), s, f, fill, anchor='ms', spacing=spacing)

def footer(img, d, label):
    lg = logo('MLBCUP2026_horiz_white.png', 40)
    img.alpha_composite(lg, (120, H - 120))
    text(d, (W - 120, H - 85), label, osw(30, 500), (200, 210, 225), anchor='rs', spacing=5)
    d.rectangle((120, FOOT_Y, W - 120, FOOT_Y + 1), fill=(255, 255, 255, 60))

# ------------------------------------------------ 1. 入場（チーム名）
def entrance(order, team, league):
    img = base(); d = ImageDraw.Draw(img)
    outline_text(img, (1800, 900), f'{order:02d}', osw(900, 700), 5, WHITE, 60, anchor='rs')
    slash(img, 1660, 50, 160)
    d = ImageDraw.Draw(img)
    text(d, (160, 380), 'TEAM ENTRANCE', osw(40, 600), RED, spacing=10)
    d.rectangle((160, 410, 260, 413), fill=LINE)
    f = fit(d, team, lambda s: jp(s, 900), 180, 1400)
    text(d, (150, 650), team, f, WHITE)
    text(d, (164, 740), league, jp(44, 500), (200, 210, 225), spacing=4)
    footer(img, d, '11.21 SAT  OPENING CEREMONY')
    return img

# ------------------------------------------------ 2. 対戦
def matchup(block, game, time, venue, date, t1, t2):
    img = base(); d = ImageDraw.Draw(img)
    # 中央の赤ライン
    slash(img, 1000, 56, 120, y0=330)
    center_text(d, 190, f'{block}  {game}', jp(52, 900), WHITE, spacing=6)
    center_text(d, 245, f'{time}  PLAY BALL', osw(34, 500), RED, spacing=8)
    # チーム名（左右、赤ラインをはさむ）
    maxw = 720
    f1 = fit(d, t1, lambda s: jp(s, 900), 110, maxw)
    f2 = fit(d, t2, lambda s: jp(s, 900), 110, maxw)
    sz = min(f1.size, f2.size); f = jp(sz, 900)   # 2チームの文字サイズはそろえる
    text(d, (850, 600), t1, f, WHITE, anchor='rs')
    text(d, (1130, 600), t2, f, WHITE, anchor='ls')
    # VS
    vs = osw(150, 700)
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    ld.ellipse((900, 455, 1080, 635), fill=DEEP + (255,), outline=WHITE + (230,), width=3)
    img.alpha_composite(lay)
    d = ImageDraw.Draw(img)
    text(d, (990, 595), 'VS', osw(92, 700), WHITE, anchor='ms')
    footer(img, d, f'{date}  {venue}')
    return img

# ------------------------------------------------ 3. 進行
def program(no, ja, en, kicker):
    img = base(); d = ImageDraw.Draw(img)
    slash(img, 360, 50, 160)
    outline_text(img, (60, 820), f'{no:02d}', osw(560, 700), 5, WHITE, 60)
    X = 520
    text(d, (X, 360), kicker, osw(40, 600), RED, spacing=10)
    d.rectangle((X, 390, X + 100, 393), fill=LINE)
    f = fit(d, ja, lambda s: jp(s, 900), 210, W - X - 140)
    text(d, (X - 8, 620), ja, f, WHITE)
    text(d, (X, 710), en, osw(56, 500), (200, 210, 225), spacing=12)
    footer(img, d, '11.21 SAT  MORIYAMA CITY STADIUM')
    return img

if __name__ == '__main__':
    # 入場順・連盟名は今年の開会式次第／登録フォルダ名より
    entrance(4, '稲沢中央ボーイズ', 'ボーイズリーグ').convert('RGB').save(f'{OUT}/T1_entrance.png')
    # ※対戦カードの組み合わせ順はサンプル（要確認）
    matchup('Cブロック', '第一試合', '9:00', 'MORIYAMA CITY STADIUM', '11.22 SUN',
            '稲沢中央ボーイズ', '東京北砂リトルリーグ').convert('RGB').save(f'{OUT}/T2_matchup.png')
    program(7, '選手宣誓', "PLAYERS' OATH", 'OPENING CEREMONY').convert('RGB').save(f'{OUT}/T3_program.png')
    print('ok')

# ------------------------------------------------ 2'. 対戦（左右分割・左上→右下の対角配置）
YELLOW = (246, 196, 0)
def matchup2(header, playball, t1, sub1, t2, sub2, footer_label, style='split'):
    SPLIT_TOP, SPLIT_BOT = 1130, 790          # 斜めの境目（上端x, 下端x）
    split_x = lambda y: SPLIT_TOP + (SPLIT_BOT - SPLIT_TOP) * y / H
    left = vgrad((W, H), (20, 52, 98), (6, 20, 44))
    glow(left, 520, 380, 520, (34, 78, 138), 150)
    right = vgrad((W, H), (190, 30, 44), (96, 10, 24))
    glow(right, 1400, 760, 520, (214, 52, 62), 120)
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon([(SPLIT_TOP, 0), (W, 0), (W, H), (SPLIT_BOT, H)], fill=255)
    if style == 'split':
        bg = left.copy(); bg.paste(right, (0, 0), m)
        img = grain(bg, 5).convert('RGBA')
    else:   # 紺一色＋赤ライン（元の案）
        img = base()
        slash(img, SPLIT_TOP - 28, 56, SPLIT_TOP - SPLIT_BOT, y0=96)
    d = ImageDraw.Draw(img)
    # ヘッダー帯＋タブ（タブにプレイボール日時）
    HB = 96
    d.rectangle((0, 0, W, HB), fill=DEEP + (255,))
    center_text(d, 66, header, jp(50, 900), WHITE, spacing=8)
    d.polygon([(690, HB), (1230, HB), (1180, 222), (740, 222)], fill=DEEP + (255,))
    center_text(d, HB + 38, 'PLAY BALL', osw(26, 600), RED, spacing=10)
    center_text(d, HB + 100, playball, osw(48, 600), WHITE, spacing=4)
    # チーム名：左チームは左上（右揃え）、右チームは右下（左揃え）
    GAP = 70
    y1, y2 = 400, 770                          # 名前のベースライン
    xr1 = split_x(y1 - 60) - GAP               # 左チームの右端
    xl2 = split_x(y2 - 60) + GAP               # 右チームの左端
    sz = min(fit(d, t1, lambda s: jp(s, 900), 130, xr1 - 140).size,
             fit(d, t2, lambda s: jp(s, 900), 130, W - 140 - xl2).size)
    f = jp(sz, 900); sf = jp(40, 700)
    def block(t, sub, y, x, anchor):
        text(d, (x, y), t, f, WHITE, anchor=anchor)
        nw = tw(d, t, f); cx = x - nw / 2 if anchor[0] == 'r' else x + nw / 2
        sw = tw(d, sub, sf, 8)
        text(d, (cx, y + 80), sub, sf, WHITE, anchor='ms', spacing=8)
        for sgn in (-1, 1):
            x0 = cx + sgn * (sw / 2 + 30)
            d.rectangle((min(x0, x0 + sgn * 56), y + 64, max(x0, x0 + sgn * 56), y + 68), fill=WHITE)
    block(t1, sub1, y1, xr1, 'rs')
    block(t2, sub2, y2, xl2, 'ls')
    # VS（黄色・斜体）を2チームの間、境目の上に
    vsf = osw(220, 700)
    lay = Image.new('RGBA', (600, 400), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    ld.text((300, 300), 'VS', font=vsf, fill=YELLOW + (255,), anchor='ms')
    lay = lay.transform(lay.size, Image.AFFINE, (1, 0.22, -66, 0, 1, 0), Image.BICUBIC)
    sh = Image.new('RGBA', lay.size, (0, 0, 0, 0)); sh.putalpha(lay.split()[3].point(lambda v: v * 120 // 255))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    vx = int(split_x(605)) - 300; vy = 605 - 300 + 80
    img.alpha_composite(sh, (vx + 6, vy + 10)); img.alpha_composite(lay, (vx, vy))
    d = ImageDraw.Draw(img)
    footer(img, d, footer_label)
    return img

if __name__ == '__main__':
    matchup2('Cブロック　第一試合', '11.22 SUN  9:00', '稲沢中央ボーイズ', 'ボーイズリーグ', '東京北砂リトルリーグ', '東京連盟',
             'MORIYAMA CITY STADIUM').convert('RGB').save(f'{OUT}/T2_matchup_v3.png')
    matchup2('Cブロック　第一試合', '11.22 SUN  9:00', '稲沢中央ボーイズ', 'ボーイズリーグ', '東京北砂リトルリーグ', '東京連盟',
             'MORIYAMA CITY STADIUM', style='line').convert('RGB').save(f'{OUT}/T2_matchup_v4_line.png')
    print('ok2')

# ------------------------------------------------ ロゴだけ（32:9 と 16:9）
def logo_banner(w, h, style):
    lw_ = int(w * 0.50) if w / h > 2 else int(w * 0.62)          # ロゴの幅
    if style == 'black':
        img = Image.new('RGBA', (w, h), (0, 0, 0, 255))
    else:
        bg = vgrad((w, h), (14, 40, 74), DEEP)
        glow(bg, w // 2, h // 2, int(h * 0.75), (30, 70, 122), 170)
        img = grain(bg, 5).convert('RGBA')
        # 赤ラインを左右に1本ずつ。他のバナーと同じ「／」の傾きで、ロゴにはかからない位置
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
        lean, sw = int(h * 0.31), int(h * 0.05)
        margin = (w - lw_) / 2
        for cx in (margin * 0.5, w - margin * 0.5):
            t, bt = cx + lean / 2, cx - lean / 2
            ld.polygon([(t - sw / 2, 0), (t + sw / 2, 0), (bt + sw / 2, h), (bt - sw / 2, h)], fill=RED + (255,))
        img.alpha_composite(lay)
    lg = Image.open(LOGO + 'MLBCUP2026_horiz_white.png').convert('RGBA')
    lg = lg.resize((lw_, round(lg.height * lw_ / lg.width)), Image.LANCZOS)
    img.alpha_composite(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
    return img.convert('RGB')

if __name__ == '__main__':
    for (w, h, tag) in ((3840, 1080, '32x9'), (1920, 1080, '16x9')):
        for st in ('design', 'black'):
            logo_banner(w, h, st).save(f'{OUT}/L_{tag}_{st}.png')
    print('ok logos')

# ------------------------------------------------ 2段ロゴ（16:9のみ）
def stack_banner(style):
    w, h = W, H
    lw_ = 1180                                            # ロゴの幅
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
    lg = Image.open(LOGO + 'MLBCUP2026_stack_white_vector.png').convert('RGBA')
    lg = lg.resize((lw_, round(lg.height * lw_ / lg.width)), Image.LANCZOS)
    img.alpha_composite(lg, ((w - lg.width) // 2, (h - lg.height) // 2))
    return img.convert('RGB')

if __name__ == '__main__':
    for st in ('design', 'black'):
        stack_banner(st).save(f'{OUT}/L_16x9_stack_{st}.png')
    print('ok stack')
