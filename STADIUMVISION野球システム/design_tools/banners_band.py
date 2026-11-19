"""14:5 全面バナー（1920x686：球場ビジョンの帯ぜんぶ）— 2026-11-19
開会前の待機・ようこそ・まもなく開会式・ホームランダービー・閉会式・ありがとうございました などの「帯全体に出す1枚」。
デザインは今のバナー（banners.py / banners_960.py）と同じ：紺のグラデ＋ノイズ＋アクセント色のライン、白文字、横長／2段ロゴ。
文字・ロゴは「実際に見える外枠」で左右・上下の中央にそろえる（フォントの余白では測らない）。

使い方：  python banners_band.py [--time 13:00]
出力：   output/1920x686/全面/   → これを slides/全面/ にコピーすると、管理画面の「選ぶ」パネルの「全面」タブに出る
"""
import argparse
import os
from make import *

BW, BH = 1920, 686
CX, CY = BW / 2, BH / 2
WHITE = (255, 255, 255)
SUB = (200, 210, 225)
LINE = (255, 255, 255, 200)
OUT_DIR = OUT + '1920x686/全面/'


# ---------------------------------------------------------------- 背景
def band_base(black=False):
    if black:
        return Image.new('RGBA', (BW, BH), (0, 0, 0, 255))
    bg = vgrad((BW, BH), (14, 40, 74), DEEP)
    glow(bg, 960, 343, 760, (30, 70, 122), 170)
    return grain(bg, 5).convert('RGBA')


def side_slashes(img, margin=96, w=34, lean=90):
    """左右の端に、アクセント色の斜めライン（文字のスライド用。上下いっぱい）"""
    lay = Image.new('RGBA', (BW, BH), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    ld.polygon([(margin + lean, 0), (margin + lean + w, 0), (margin + w, BH), (margin, BH)], fill=RED + (255,))
    ld.polygon([(BW - margin - w, 0), (BW - margin, 0), (BW - margin - lean, BH), (BW - margin - lean - w, BH)], fill=RED + (255,))
    img.alpha_composite(lay)


# ---------------------------------------------------------------- 縦に積んで、見える外枠で上下中央に置く
def text_image(s, f, fill, spacing=0):
    """文字を、見える外枠ぴったりの透明な画像にする（字間・フォントの余白に左右されない）"""
    pad = 60
    d0 = ImageDraw.Draw(Image.new('RGB', (4, 4)))
    w = int(tw(d0, s, f, spacing)) + pad * 2
    lay = Image.new('RGBA', (w, f.size * 3), (0, 0, 0, 0))
    text(ImageDraw.Draw(lay), (w / 2, f.size * 2), s, f, fill + (255,), anchor='ms', spacing=spacing)
    return lay.crop(lay.getbbox())


def stack(img, items, cy=CY):
    """items：('text', 文字, フォント, 色, 字間) / ('img', RGBA画像) / ('rule', 幅, 太さ) / ('gap', 高さ)
    上から順に並べ、かたまり全体の「見える外枠」の真ん中が、左右は帯の中央・上下は cy になるようにする。"""
    d = ImageDraw.Draw(img)
    parts = []
    for it in items:
        if it[0] == 'text':
            parts.append(('img', text_image(it[1], it[2], it[3], it[4])))
        else:
            parts.append(it)
    heights = [p[1].height if p[0] == 'img' else p[2] if p[0] == 'rule' else p[1] for p in parts]
    y = cy - sum(heights) / 2
    for p, h in zip(parts, heights):
        if p[0] == 'img':
            img.alpha_composite(p[1], (round(CX - p[1].width / 2), round(y)))
            d = ImageDraw.Draw(img)
        elif p[0] == 'rule':
            d.rectangle((CX - p[1] / 2, y, CX + p[1] / 2 - 1, y + p[2] - 1), fill=LINE)
        y += h


def fit_font(maker, s, size, maxw, spacing=0, minsize=24):
    """幅に収まるまで文字を小さくする"""
    d = ImageDraw.Draw(Image.new('RGB', (4, 4)))
    while size > minsize and tw(d, s, maker(size), spacing) > maxw:
        size -= 2
    return maker(size)


def trimmed_logo(name, w=None, h=None):
    """ロゴの透明な余白を切り落として、見える大きさにそろえる"""
    im = Image.open(LOGO + name).convert('RGBA')
    im = im.crop(im.getbbox())
    if w:
        return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def save(img, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    img.convert('RGB').save(OUT_DIR + name, optimize=True)
    print('ok', name)


# ---------------------------------------------------------------- ロゴ（横長／2段）：中央に置き、左右にアクセント色のライン
def logo_slide(black, stacked):
    img = band_base(black)
    lg = trimmed_logo('MLBCUP2026_stack_white_vector.png', h=380) if stacked else trimmed_logo('MLBCUP2026_horiz_white.png', w=1080)
    img.alpha_composite(lg, (round(CX - lg.width / 2), round(CY - lg.height / 2)))
    d = ImageDraw.Draw(img)
    gap, margin, th = 70, 120, 6
    xl, xr = CX - lg.width / 2 - gap, CX + lg.width / 2 + gap
    d.rectangle((margin, CY - th / 2, xl, CY + th / 2 - 1), fill=RED + (255,))
    d.rectangle((xr, CY - th / 2, BW - margin, CY + th / 2 - 1), fill=RED + (255,))
    return img


# ---------------------------------------------------------------- 文字のスライド
def title_slide(kicker, title_en, title_ja, sub=None, en_size=150, ja_size=86, logo_top=False):
    img = band_base()
    side_slashes(img)
    items = []
    if kicker:
        items += [('text', kicker, osw(46, 600), RED, 14), ('gap', 34)]
    if logo_top:
        items += [('img', trimmed_logo('MLBCUP2026_horiz_white.png', w=900)), ('gap', 40)]
    if title_en:
        items += [('text', title_en, fit_font(lambda s: osw(s, 700), title_en, en_size, 1380, 8), WHITE, 8)]
    if title_en and title_ja:
        items += [('gap', 36), ('rule', 100, 4), ('gap', 40)]
    if title_ja:
        items += [('text', title_ja, fit_font(lambda s: jp(s, 900), title_ja, ja_size, 1380), WHITE, 0)]
    if sub:
        items += [('gap', 34), ('text', sub, fit_font(lambda s: jp(s, 500), sub, 46, 1380, 4), SUB, 4)]
    stack(img, items)
    return img


def welcome():
    img = band_base()
    side_slashes(img)
    stack(img, [
        ('text', 'WELCOME TO', osw(50, 600), RED, 16), ('gap', 38),
        ('img', trimmed_logo('MLBCUP2026_horiz_white.png', w=1000)), ('gap', 44),
        ('rule', 100, 4), ('gap', 38),
        ('text', 'FINAL ROUND  ／  守山市民球場', jp(46, 500), SUB, 6),
    ])
    return img


def opening_soon(time):
    img = band_base()
    side_slashes(img)
    stack(img, [
        ('text', 'OPENING CEREMONY', fit_font(lambda s: osw(s, 700), 'OPENING CEREMONY', 156, 1380, 8), WHITE, 8), ('gap', 40),
        ('text', 'まもなく開会式を始めます', jp(78, 900), WHITE, 0), ('gap', 40),
        ('rule', 100, 4), ('gap', 34),
        ('text', f'{time}  START', osw(54, 600), RED, 12),
    ])
    return img


def main():
    ap = argparse.ArgumentParser(description='14:5 全面バナー（1920x686）を作る')
    ap.add_argument('--time', default='13:00', help='「まもなく開会式」に出す開始時刻（既定 13:00）')
    a = ap.parse_args()
    save(logo_slide(False, False), '00_ロゴ_紺.png')
    save(logo_slide(True, False), '00_ロゴ_黒.png')
    save(logo_slide(False, True), '01_ロゴ2段_紺.png')
    save(welcome(), '10_ようこそ.png')
    save(opening_soon(a.time), '11_まもなく開会式.png')
    save(title_slide(None, 'HOME RUN DERBY', 'ホームランダービー', en_size=170, ja_size=88), '20_ホームランダービー.png')
    save(title_slide(None, 'CLOSING CEREMONY', '閉会式', en_size=150, ja_size=110), '30_閉会式.png')
    save(title_slide(None, 'THANK YOU', 'ご来場ありがとうございました', en_size=180, ja_size=82), '40_ありがとうございました.png')
    print('出力：', OUT_DIR, ' → slides/全面/ にコピーして使います')


if __name__ == '__main__':
    main()
