"""選手スライド 960x686 版（球場ビジョン左半分の枠）— 2026-11-18
16:9 版(slideA.py)はそのまま残し、こちらは 960x686 に合わせて配置を組み直したもの（写真は引き伸ばさない）。
作り方：横1920×縦1372（=960×686の2倍）で描き、半分に縮めて書き出す。
写真の置き方は LAYOUT（place.place の lay に渡す）。顔の幅を 218→300 に大きくし、「顔の中心から線までの距離÷顔の幅」は16:9版と同じにしてあるので、
写真が足りなくて届かない人（要AI補正）は16:9版と同じ顔ぶれになる。
"""
from make import *

CW, CH = 1920, 1372
OUT_W, OUT_H = 960, 686
CUT_Y = 1222                                  # 写真の水平カット線＝右の成績の下のラインと同じ高さ（全員そろえる）
FACE_W = 247                                  # 16:9版は218。270は大きすぎ・225は頭の上があくと指摘され、その中間（2026-11-18）
FACE_CX = 500
ALIGN_LEFT = 120                              # 写真の左端(肩)を下線の左端にそろえる（B案・2026-11-18）。顔の位置は人ごとに動く
RIGHT_LIMIT = 1010                            # 写真の右端はここまで（右の成績の文字は x=1040 から）


def make_layout(face_w=FACE_W, face_cx=FACE_CX, align_left=None):
    """写真の置き方。顔の中心から線までの距離÷顔の幅は、16:9版(顔の中心457→線952, 顔218)と同じ比率。
    align_left を指定すると、写真の左端(肩)をその位置(下線の左端=120)にそろえる（顔の位置は人ごとに動く）"""
    lay = dict(W=CW, H=CH, FACE_W=face_w, FACE_CX=face_cx, FACE_CY=round(CUT_Y - (952 - 457) * face_w / 218), CUT_Y=CUT_Y)
    if align_left is not None:
        lay['ALIGN_LEFT'] = align_left; lay['RIGHT_LIMIT'] = RIGHT_LIMIT
    return lay


LAYOUT = make_layout(align_left=ALIGN_LEFT)


def slide(P, photo_png, mode='cut', line_y=None):
    ly = CUT_Y if line_y is None else line_y      # 細いラインの高さ（写真が短い人は、写真の下端の位置）
    bg = vgrad((CW, CH), (14, 40, 74), DEEP)
    glow(bg, 620, 640, 640, (30, 70, 122), 200)
    img = grain(bg, 5).convert('RGBA')
    outline_text(img, (310, CUT_Y), P['no'], osw(1260, 700), 7, (255, 255, 255), 95, anchor='ms')
    lay = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    SL = (905 - 705) / 1080 * CH                   # 斜めラインの傾き（16:9版と同じ角度）
    ld.polygon([(905, 0), (965, 0), (965 - SL, CH), (905 - SL, CH)], fill=RED + (255,))
    img.alpha_composite(lay)
    pl = Image.open(photo_png).convert('RGBA')
    shadowed(img, pl, (0, 0), blur=48, alpha=170)
    d = ImageDraw.Draw(img)
    if mode == 'cut':
        xr = 905 - SL * ly / CH + 30
        d.rectangle((120, ly, xr, ly + 3), fill=(255, 255, 255, 200))
    X = 1040; RIGHT = CW - 80
    # 1行目: 背番号（青緑）＋チーム名
    BASE1 = 440
    nf = osw(78, 700); nw = tw(d, '#' + P['no'], nf)
    text(d, (X, BASE1), '#' + P['no'], nf, RED)
    d.rectangle((X + nw + 26, BASE1 - 50, X + nw + 29, BASE1), fill=(255, 255, 255, 90))
    team = P['team']; tx = X + nw + 56
    if team.isascii():
        sz = 48
        while tw(d, team.upper(), osw(sz, 600), 6) > RIGHT - tx and sz > 30: sz -= 2
        text(d, (tx, BASE1 - 3), team.upper(), osw(sz, 600), OFF, spacing=6)
    else:
        sz = 46
        while tw(d, team, jp(sz, 700), 3) > RIGHT - tx and sz > 28: sz -= 2
        text(d, (tx, BASE1 - 3), team, jp(sz, 700), OFF, spacing=3)
    # 名前: 枠に入らなければ自動で縮小
    MAXW = RIGHT - X
    size = 180
    while tw(d, P['name'], jp(size, 900)) > MAXW and size > 90: size -= 4
    text(d, (X - 4, 644), P['name'], jp(size, 900), (255, 255, 255))
    text(d, (X + 5, 722), P['kana'], jp(40, 500), GRAY, spacing=12)
    d.rectangle((X, 776, RIGHT, 779), fill=(255, 255, 255, 70))
    stats = [('GRADE', '学年', P['grade']), ('POS', 'ポジション', P['pos']), ('AVG', '打率', P['avg']),
             ('ERA', '防御率', P['era']), ('THROWS', '投', P['throw']), ('BATS', '打', P['bat'])]
    cw = (RIGHT - X) / 3
    ROW2 = CUT_Y - 134                              # 2行目の数字の下端 = 写真の線
    for i, (en, ja, v) in enumerate(stats):
        cx = X + (i % 3) * cw; cy = ROW2 - 228 * (1 - i // 3)
        text(d, (cx, cy), en, osw(32, 500), RED, spacing=6)
        text(d, (cx + tw(d, en, osw(32, 500), 6) + 16, cy), ja, jp(26, 500), GRAY)
        if v:
            cellw = cw - 64
            if isnum(v):
                sz = 132
                while tw(d, v, osw(sz, 700)) > cellw: sz -= 4
                text(d, (cx - 5, cy + 134), v, osw(sz, 700), (255, 255, 255))
            else:
                sz = 100
                while tw(d, v, jp(sz, 900)) > cellw: sz -= 4
                text(d, (cx - 2, cy + 122), v, jp(sz, 900), (255, 255, 255))
        if i % 3: d.rectangle((cx - 36, cy - 31, cx - 34, cy + 134), fill=(255, 255, 255, 40))
    lg = logo('MLBCUP2026_horiz_white.png', 58)
    img.alpha_composite(lg, (RIGHT - lg.width, 100))
    return img.convert('RGB').resize((OUT_W, OUT_H), Image.LANCZOS)
