"""公式ベクター(.ai / PDF互換)から、紺背景・黒背景用の白抜き2段ロゴPNGを作る

使い方:
  python3 logo_white_from_ai.py MLB_CUP_2026_Vector.ai
  → assets/logo/MLBCUP2026_stack_white_vector.png（幅 約3000px・透過）

処理:
  1. pdftocairo で 900dpi・透過PNGに書き出し（poppler-utils が必要）
  2. 文字（MLB / CUP 2026 / ® / ™）を白に
  3. 打者マークは紺・赤・白のまま、周りを白で縁取り（2025年の白抜きロゴと同じ処理）
  ※ 画像の切り出しは必ずベクターから。ロゴ一覧シートからの切り出しは C の左端が欠けた（2026/11/16）。
"""
import os, sys, subprocess, tempfile
import numpy as np, cv2
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
D = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1]
out = os.path.join(D, 'assets', 'logo', 'MLBCUP2026_stack_white_vector.png')

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['pdftocairo', '-png', '-transp', '-r', '900', '-singlefile', src, os.path.join(tmp, 'hi')], check=True)
    im = Image.open(os.path.join(tmp, 'hi.png')).convert('RGBA')
c0 = im.crop(im.getbbox())

PAD = 60
c = Image.new('RGBA', (c0.width + PAD * 2, c0.height + PAD * 2), (0, 0, 0, 0)); c.paste(c0, (PAD, PAD))
a = np.array(c).astype(np.uint8); al = a[:, :, 3]; H_, W_ = al.shape
rows = (al > 10).any(1)
gap = [y for y in range(H_ // 4, H_ * 3 // 4) if not rows[y]]
split = (gap[0] + gap[-1]) // 2                      # 上段(マーク+MLB)と下段(CUP 2026)の境目
n, lab, stats, _ = cv2.connectedComponentsWithStats((al[:split] > 10).astype(np.uint8))
box = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]); bx, by, bw, bh = stats[box, :4]   # 一番大きい塊＝マーク
mark = np.zeros_like(al, bool); mark[by:by + bh, bx:bx + bw] = True
o = a.copy(); o[~mark, 0:3] = 255                   # マーク以外は白
img = Image.fromarray(o, 'RGBA')
R = 22                                              # 白フチの太さ（マーク幅の約2.2%）
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R + 1, 2 * R + 1))
border = Image.fromarray(cv2.dilate(np.where(mark, al, 0).astype(np.uint8), k)).filter(ImageFilter.GaussianBlur(0.8))
canvas = Image.new('RGBA', (W_, H_), (255, 255, 255, 255)); canvas.putalpha(border)
canvas.alpha_composite(img)
canvas = canvas.crop(canvas.getbbox())
os.makedirs(os.path.dirname(out), exist_ok=True)
canvas.save(out); print('saved', out, canvas.size)
