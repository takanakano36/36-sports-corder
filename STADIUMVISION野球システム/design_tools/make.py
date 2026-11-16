from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import math, os
D = os.path.dirname(os.path.abspath(__file__))
FD = D + '/../fonts/'           # NotoSansJP / Oswald（同梱）
LOGO = D + '/assets/logo/'      # MLBのロゴは公開リポジトリに入れない。各自ここに置く
OUT = D + '/output/'
W, H = 1920, 1080
NAVY = (12, 35, 64); DEEP = (5, 16, 34); RED = (210, 38, 48); OFF = (242, 239, 232); GRAY = (139, 151, 171)

P = dict(team='SAMPLE TEAM', no='0', name='山田 太郎', kana='やまだ たろう', grade='6年', pos='投手',
         avg='.000', throw='右', bat='右', era='0.00')   # 見本用のダミー

def jp(size, wght=900):
    f = ImageFont.truetype(FD + 'NotoSansJP-VariableFont_wght.ttf', size)
    f.set_variation_by_axes([wght]); return f
def osw(size, wght=700):
    f = ImageFont.truetype(FD + 'Oswald-VariableFont_wght.ttf', size)
    f.set_variation_by_axes([wght]); return f

def text(d, xy, s, f, fill, anchor='ls', spacing=0):
    if not spacing:
        d.text(xy, s, font=f, fill=fill, anchor=anchor); return
    # manual tracking
    widths = [d.textlength(c, font=f) for c in s]
    total = sum(widths) + spacing * (len(s) - 1)
    x, y = xy
    if anchor[0] == 'm': x -= total / 2
    elif anchor[0] == 'r': x -= total
    for c, w in zip(s, widths):
        d.text((x, y), c, font=f, fill=fill, anchor='l' + anchor[1]); x += w + spacing

def tw(d, s, f, spacing=0):
    return sum(d.textlength(c, font=f) for c in s) + spacing * (len(s) - 1) if spacing else d.textlength(s, font=f)

def vgrad(size, top, bot):
    w, h = size; g = Image.new('RGB', (1, h))
    for y in range(h):
        t = y / (h - 1); g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, h))

def glow(base, cx, cy, r, color, alpha):
    m = Image.new('L', base.size, 0); md = ImageDraw.Draw(m)
    md.ellipse((cx - r, cy - r, cx + r, cy + r), fill=alpha)
    m = m.filter(ImageFilter.GaussianBlur(r * 0.45))
    base.paste(Image.new('RGB', base.size, color), (0, 0), m)

def grain(img, amt=6):
    n = Image.effect_noise(img.size, 40).convert('L')
    n = n.point(lambda v: 128 + (v - 128) * amt // 40)
    return ImageChops.add(img, Image.merge('RGB', [n] * 3), 1, -128)

def player(h):
    im = Image.open(D + '/input/sample_cut.png').convert('RGBA')
    im = im.crop(im.getbbox())
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

def shadowed(base, im, xy, blur=30, off=(0, 0), alpha=150):
    a = im.split()[3].point(lambda v: v * alpha // 255)
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); sh.putalpha(a)
    pad = blur * 3
    big = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0)); big.paste(sh, (pad, pad))
    big = big.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(big, (xy[0] - pad + off[0], xy[1] - pad + off[1]))
    base.alpha_composite(im, xy)

def outline_text(base, xy, s, f, stroke, color, alpha=255, anchor='ls'):
    lay = Image.new('RGBA', base.size, (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    d.text(xy, s, font=f, fill=(0, 0, 0, 0), stroke_width=stroke, stroke_fill=color + (alpha,), anchor=anchor)
    # knock out interior
    m = Image.new('L', base.size, 0); ImageDraw.Draw(m).text(xy, s, font=f, fill=255, anchor=anchor)
    a = ImageChops.subtract(lay.split()[3], m); lay.putalpha(a)
    base.alpha_composite(lay)

def logo(name, h):
    im = Image.open(LOGO + name).convert('RGBA')
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

STATS = [('GRADE', '学年', P['grade']), ('POS', 'ポジション', P['pos']), ('AVG', '打率', P['avg']),
         ('ERA', '防御率', P['era']), ('THROWS', '投', P['throw']), ('BATS', '打', P['bat'])]

def isnum(v): return all(c in '.0123456789' for c in v) and v != ''

# ---------------------------------------------------------------- A: broadcast
def pattern_a():
    bg = vgrad((W, H), (14, 40, 74), DEEP)
    glow(bg, 620, 520, 520, (30, 70, 122), 200)
    img = grain(bg, 5).convert('RGBA')
    # huge outlined number behind player
    BASE = 952  # same baseline as the lower stats row (0.00 / 左 / 左)
    outline_text(img, (360, BASE), P['no'], osw(1000, 700), 6, (255, 255, 255), 95, anchor='ms')
    # red diagonal slash accent behind
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    ld.polygon([(905, 0), (965, 0), (765, H), (705, H)], fill=RED + (255,))
    img.alpha_composite(lay)
    pl = player(840)
    # soften the bottom edge of the bust so it dissolves instead of a hard cut
    FH = 170
    m = Image.new('L', pl.size, 255); md = ImageDraw.Draw(m)
    for y in range(FH): md.line([(0, pl.height - FH + y), (pl.width, pl.height - FH + y)], fill=int(255 * (1 - y / (FH - 1)) ** 1.4))
    pl.putalpha(ImageChops.multiply(pl.split()[3], m))
    shadowed(img, pl, (560 - pl.width // 2, BASE - pl.height), blur=40, alpha=170)
    d = ImageDraw.Draw(img)
    X = 1060
    # team line
    d.rectangle((X, 268, X + 10, 300), fill=RED)
    text(d, (X + 28, 297), P['team'].upper(), osw(40, 600), OFF, spacing=6)
    # number + name
    text(d, (X - 4, 470), P['name'], jp(150, 900), (255, 255, 255))
    text(d, (X + 4, 535), P['kana'], jp(34, 500), GRAY, spacing=10)
    nb = osw(150, 700)
    text(d, (W - 90, 470), '#' + P['no'], nb, RED, anchor='rs')
    d.rectangle((X, 580, W - 90, 583), fill=(255, 255, 255, 70))
    # stats 3 x 2 grid
    cw = (W - 90 - X) / 3
    for i, (en, ja, v) in enumerate(STATS):
        cx = X + (i % 3) * cw; cy = 650 + (i // 3) * 190
        text(d, (cx, cy), en, osw(26, 500), RED, spacing=5)
        text(d, (cx + tw(d, en, osw(26, 500), 5) + 14, cy), ja, jp(22, 500), GRAY)
        if isnum(v): text(d, (cx - 4, cy + 112), v, osw(110, 700), (255, 255, 255))
        else: text(d, (cx - 2, cy + 102), v, jp(84, 900), (255, 255, 255))
        if i % 3: d.rectangle((cx - 30, cy - 26, cx - 29, cy + 112), fill=(255, 255, 255, 40))
    lg = logo('MLBCUP2026_horiz_white.png', 46)
    img.alpha_composite(lg, (W - 90 - lg.width, 92))
    return img

# ---------------------------------------------------------------- B: numbers first
def pattern_b():
    img = Image.new('RGBA', (W, H), NAVY + (255,))
    base = vgrad((W, H), (16, 44, 80), (8, 24, 46)); base = grain(base, 4)
    img.paste(base)
    # right photo panel with red field, angled edge
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon([(1130, 0), (W, 0), (W, H), (980, H)], fill=255)
    redp = vgrad((W, H), (200, 34, 46), (120, 14, 28))
    glow(redp, 1500, 420, 420, (232, 70, 76), 120)
    img.paste(redp, (0, 0), m)
    # pinstripes on red panel
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    for x in range(900, W + 200, 46): ld.line([(x, 0), (x - 150 * 0, H)], fill=(255, 255, 255, 22), width=2)
    lay.putalpha(ImageChops.multiply(lay.split()[3], m))
    img.alpha_composite(lay)
    pl = player(1000)
    px = 1470 - pl.width // 2
    shadowed(img, pl, (px, H - pl.height), blur=34, off=(-20, 0), alpha=190)
    d = ImageDraw.Draw(img)
    X = 110
    # giant number
    text(d, (X - 8, 480), P['no'], osw(360, 700), (255, 255, 255))
    nw = tw(d, P['no'], osw(360, 700))
    text(d, (X + nw + 30, 250), 'NO.', osw(44, 500), RED, spacing=4)
    text(d, (X + nw + 30, 320), P['pos'], jp(52, 900), OFF)
    text(d, (X + nw + 30, 380), P['grade'], jp(40, 500), GRAY)
    # name block
    text(d, (X, 640), P['name'], jp(132, 900), (255, 255, 255))
    text(d, (X + 4, 700), P['kana'], jp(30, 500), GRAY, spacing=10)
    text(d, (X + 4, 755), P['team'].upper(), osw(34, 600), RED, spacing=6)
    # stat strip: off-white bar
    sy = 830; sh = 190
    d.rectangle((0, sy, 1000, sy + sh), fill=OFF)
    d.polygon([(1000, sy), (1035, sy), (1000 + 35 - 35 * 0, sy + sh), (1000 - 0, sy + sh)], fill=OFF)
    cells = [('AVG', '打率', P['avg'], 300), ('ERA', '防御率', P['era'], 280), ('T/B', '投/打', P['throw'] + '/' + P['bat'], 260)]
    cx = X
    for i, (en, ja, v, w) in enumerate(cells):
        text(d, (cx, sy + 52), en, osw(28, 600), RED, spacing=5)
        text(d, (cx + tw(d, en, osw(28, 600), 5) + 12, sy + 52), ja, jp(22, 700), NAVY)
        if isnum(v): text(d, (cx - 4, sy + 160), v, osw(104, 700), NAVY)
        else: text(d, (cx - 2, sy + 152), v, jp(80, 900), NAVY)
        if i: d.rectangle((cx - 36, sy + 30, cx - 34, sy + 160), fill=(12, 35, 64, 60))
        cx += w
    lg = logo('MLBCUP2026_horiz_white.png', 40)
    img.alpha_composite(lg, (X, 70))
    return img

# ---------------------------------------------------------------- C: premium minimal
def pattern_c():
    bg = vgrad((W, H), (10, 30, 56), (4, 12, 26))
    glow(bg, 1380, 560, 600, (24, 56, 98), 170)
    img = grain(bg, 4).convert('RGBA')
    d = ImageDraw.Draw(img)
    # thin frame
    d.rectangle((60, 60, W - 61, H - 61), outline=(255, 255, 255, 50), width=2)
    # vertical number giant ghost, right
    pl = player(958)
    shadowed(img, pl, (1390 - pl.width // 2, H - 62 - pl.height), blur=40, alpha=200)
    d = ImageDraw.Draw(img)
    d.rectangle((60, H - 63, W - 61, H - 61), fill=(255, 255, 255, 90))
    X = 150
    lg = logo('MLBCUP2026_stack_white.png', 120)
    img.alpha_composite(lg, (X, 120))
    d.rectangle((X, 300, X + 70, 305), fill=RED)
    text(d, (X, 360), P['team'], osw(38, 500), OFF, spacing=4)
    text(d, (X - 6, 520), P['name'], jp(140, 900), (255, 255, 255))
    text(d, (X, 585), P['kana'], jp(30, 400), GRAY, spacing=14)
    text(d, (X, 650), f"#{P['no']}   {P['pos']}   {P['grade']}   {P['throw']}投{P['bat']}打", jp(34, 500), OFF)
    # two hero numbers
    y = 900
    for i, (en, ja, v) in enumerate([('BATTING AVG', '打率', P['avg']), ('ERA', '防御率', P['era'])]):
        x = X + i * 330
        text(d, (x - 4, y), v, osw(140, 600), (255, 255, 255))
        text(d, (x, y + 52), en, osw(24, 500), RED, spacing=5)
        text(d, (x, y + 88), ja, jp(22, 500), GRAY)
        if i: d.rectangle((x - 50, y - 120, x - 49, y + 88), fill=(255, 255, 255, 50))
    return img

if __name__ == '__main__':
  for k, fn in [('A', pattern_a), ('B', pattern_b), ('C', pattern_c)]:
    fn().convert('RGB').save(f'{OUT}/sample_{k}.png', optimize=True); print('ok', k)
