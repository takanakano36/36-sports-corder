"""公式ロゴ資料「MLB CUP 2026 PRIMARY MARKS」（ベクターPDF／zipごとでも可）から、紺背景用の白抜きロゴ(透過PNG)を作る

使い方（PyMuPDF が入っている Python で実行）:
  python logo_from_primary_marks.py  資料のPDF または zip  [出力フォルダ]
  → assets/logo/MLBCUP2026_horiz_white.png        … 横長（バナーのフッター・選手スライド右上・ロゴバナー用）
  → assets/logo/MLBCUP2026_stack_white_vector.png … 2段（ロゴ2段バナー用）

作り方
- 資料の「PRIMARY MARKS - FULL COLOR」の紺ベタ背景の段にある、白抜きロゴ（打者マークは紺・赤、文字は白）をベクターのまま高解像度で書き出す。
- 外側の紺ベタ背景だけを透明にする（打者マークの中の紺は残す）。縁のなめらかな画素は、紺と白の混ざり具合から透明度を逆算する。
- 画像の切り出しは必ずベクターから（ロゴ一覧シートの画像から切り出して C の左端が欠けた反省 2026/11/16）。
"""
import io, os, sys, tempfile, zipfile
import numpy as np
import pymupdf
from PIL import Image
from scipy import ndimage as ndi

D = os.path.dirname(os.path.abspath(__file__))
NAVY = np.array([4, 30, 66], float)     # MLB NAVY #041E42
# 資料(1224x792pt)の中の、各ロゴの位置（pt）。白抜き（紺ベタ背景の段）のもの
BOXES = {
    'MLBCUP2026_horiz_white.png': (615, 425, 1135, 505),         # 横長 MLB CUP 2026
    'MLBCUP2026_stack_white_vector.png': (865, 545, 1135, 655),  # 2段（中央そろえ）
}
ZOOM = 10      # 1pt = 10px（横長で約5000px）


def open_source(path):
    if path.lower().endswith('.zip'):
        z = zipfile.ZipFile(path)
        n = next(n for n in z.namelist() if n.endswith('PRIMARY_MARKS_COLOR-B&W_RGB.pdf') and 'コピー' not in n)
        return pymupdf.open(stream=z.read(n), filetype='pdf')
    return pymupdf.open(path)


def make(page, box):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=pymupdf.Rect(*box), alpha=False)
    a = np.array(Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')).astype(float)
    dist = np.abs(a - NAVY).max(axis=2)
    navyish = dist < 24
    lab, n = ndi.label(navyish)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(border))                       # 外側の紺ベタ（枠につながっている紺）
    band = ndi.binary_dilation(outside, iterations=4) & ~outside   # 外側との境の、なめらか画素
    alpha = np.ones(outside.shape, float); alpha[outside] = 0
    # 境の画素：紺（背景）と白（ロゴ）の混ざり具合 → 透明度。色は白にする。赤などが外側に接する所は無い（資料は白縁で囲われている）
    g = a[..., 1]
    ab = np.clip((g - NAVY[1]) / (255 - NAVY[1]), 0, 1)
    alpha[band] = ab[band]
    out = a.copy(); out[band] = 255
    rgba = np.dstack([out, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    return im.crop(im.getbbox())


if __name__ == '__main__':
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, 'assets', 'logo')
    os.makedirs(outdir, exist_ok=True)
    doc = open_source(src)
    page = doc[0]
    for name, box in BOXES.items():
        im = make(page, box)
        p = os.path.join(outdir, name); im.save(p); print('saved', p, im.size)
