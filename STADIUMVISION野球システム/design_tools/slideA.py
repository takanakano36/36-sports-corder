"""A案 量産テスト: 顔基準の自動配置 × 2種類の下端処理"""
import csv
from make import *
import place

ROWS = {(r['team'], r['no']): r for r in csv.DictReader(open(D + '/input/roster.csv', encoding='utf-8-sig'))}
import sys
# テスト用: (チーム名, 背番号) → input/photos 内のファイル名
SETS = {
  'test': {},
}
SET = sys.argv[1] if len(sys.argv) > 1 else 'test'
PHOTOS = SETS[SET]
CUT_Y = place.CUT_Y

def slide(P, photo_png, mode):
    bg = vgrad((W, H), (14, 40, 74), DEEP)
    glow(bg, 620, 520, 520, (30, 70, 122), 200)
    img = grain(bg, 5).convert('RGBA')
    outline_text(img, (310, CUT_Y), P['no'], osw(1000, 700), 6, (255, 255, 255), 95, anchor='ms')
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    ld.polygon([(905, 0), (965, 0), (765, H), (705, H)], fill=RED + (255,))
    img.alpha_composite(lay)
    pl = Image.open(photo_png).convert('RGBA')
    shadowed(img, pl, (0, 0), blur=40, alpha=170)
    d = ImageDraw.Draw(img)
    if mode == 'cut':
        # 細いライン：左マージン〜赤ラインまで（写真の切り口）
        xr = 905 - (905 - 705) * CUT_Y / H + 30
        d.rectangle((120, CUT_Y, xr, CUT_Y + 2), fill=(255, 255, 255, 200))
    X = 1060
    # 1行目: 背番号（赤）＋チーム名
    nf = osw(64, 700); nw = tw(d, '#' + P['no'], nf)
    text(d, (X, 300), '#' + P['no'], nf, RED)
    d.rectangle((X + nw + 22, 258, X + nw + 24, 300), fill=(255, 255, 255, 90))
    team = P['team']
    if team.isascii(): text(d, (X + nw + 46, 297), team.upper(), osw(40, 600), OFF, spacing=6)
    else: text(d, (X + nw + 46, 297), team, jp(38, 700), OFF, spacing=3)   # 日本語チーム名は和文フォント
    # 名前: 枠(右端 W-90)に入らなければ自動で縮小
    MAXW = W - 90 - X
    size = 150
    while tw(d, P['name'], jp(size, 900)) > MAXW and size > 80: size -= 4
    text(d, (X - 4, 470), P['name'], jp(size, 900), (255, 255, 255))
    text(d, (X + 4, 535), P['kana'], jp(34, 500), GRAY, spacing=10)
    d.rectangle((X, 580, W - 90, 583), fill=(255, 255, 255, 70))
    stats = [('GRADE', '学年', P['grade']), ('POS', 'ポジション', P['pos']), ('AVG', '打率', P['avg']),
             ('ERA', '防御率', P['era']), ('THROWS', '投', P['throw']), ('BATS', '打', P['bat'])]
    cw = (W - 90 - X) / 3
    for i, (en, ja, v) in enumerate(stats):
        cx = X + (i % 3) * cw; cy = 650 + (i // 3) * 190
        text(d, (cx, cy), en, osw(26, 500), RED, spacing=5)
        text(d, (cx + tw(d, en, osw(26, 500), 5) + 14, cy), ja, jp(22, 500), GRAY)
        if not v: pass  # 記録なし → 空欄
        else:
            # 値: セル幅に入らなければ自動で縮小（下のラインは揃えたまま）
            cellw = cw - 56
            if isnum(v):
                sz = 110
                while tw(d, v, osw(sz, 700)) > cellw: sz -= 4
                text(d, (cx - 4, cy + 112), v, osw(sz, 700), (255, 255, 255))
            else:
                sz = 84
                while tw(d, v, jp(sz, 900)) > cellw: sz -= 4
                text(d, (cx - 2, cy + 102), v, jp(sz, 900), (255, 255, 255))
        if i % 3: d.rectangle((cx - 30, cy - 26, cx - 29, cy + 112), fill=(255, 255, 255, 40))
    lg = logo('MLBCUP2026_horiz_white.png', 46)
    img.alpha_composite(lg, (W - 90 - lg.width, 92))
    return img.convert('RGB')

outs = []
for key, src in PHOTOS.items():
    tag = src.split('.')[0]
    ph = f'{OUT}/placed_{tag}.png'
    place.place(f'{D}/input/photos/{src}', ph, 'cut')
    slide(ROWS[key], ph, 'cut').save(f'{OUT}/A_{tag}.png', optimize=True); outs.append(f'{OUT}/A_{tag}.png')

# 並べて比較用シート
ims = [Image.open(o).resize((960, 540)) for o in outs]
sheet = Image.new('RGB', (1920, 1080), (0, 0, 0))
for i, im in enumerate(ims): sheet.paste(im, ((i % 2) * 960, (i // 2) * 540))
sheet.save(f'{OUT}/A_sheet_{SET}.png')
