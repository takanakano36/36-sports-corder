"""選手写真の自動配置（A案用）
写真ごとに顔を検出し、「顔の幅」と「顔の中心位置」を全員同じにそろえて
1920x1080 の透過PNG（下端グラデ透過済み）を書き出す。
Photoshop では photo レイヤーを「そのまま(As Is)」で差し替えるだけで位置が合う。

使い方: python3 place.py 入力jpg 出力png
"""
import sys, cv2, numpy as np
from PIL import Image, ImageDraw, ImageChops, ImageOps
from rembg import remove, new_session

W, H = 1920, 1080
# ---- 配置ルール（ここだけ変えれば全員に反映） ----
FACE_W   = 218    # 顔の幅(px)
FACE_CX  = 500    # 顔の中心X
FACE_CY  = 457    # 顔の中心Y
FADE_END = 1040   # ここで完全に透明
FADE_LEN = 260    # グラデの長さ（FADE_END-FADE_LEN から消え始める）
CUT_Y    = 952    # 水平カット位置（右の「0.00 左 左」の下ラインと同じ）
MODE     = 'cut'  # 'fade' or 'cut'
# ------------------------------------------------

_session = None
def load(path):
    # スマホ写真の回転情報(EXIF)を反映し、長辺2000pxに縮小（処理を速く）
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    im.thumbnail((2000, 2000), Image.LANCZOS)
    return im

def cutout(rgb):
    global _session
    _session = _session or new_session('isnet-general-use')
    return remove(rgb, session=_session, post_process_mask=True)

def keep_person(cut, face):
    # 隣に写り込んだ別の子などを消す：顔とつながっている部分だけ残す
    a = np.array(cut.split()[3])
    n, lab = cv2.connectedComponents((a > 40).astype(np.uint8))
    x, y, w, h = [int(v) for v in face]
    ids = lab[y:y + h, x:x + w]
    ids = ids[ids > 0]
    if not len(ids): return cut
    keep = np.bincount(ids).argmax()
    m = np.where(lab == keep, a, 0).astype(np.uint8)
    out = cut.copy(); out.putalpha(Image.fromarray(m)); return out

import os
_YUNET = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'yunet.onnx')
def detect_face(rgb):
    # YuNet(OpenCV) 顔検出：横向き写真や隣の子が写っていても、一番大きい顔を採用
    a = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
    det = cv2.FaceDetectorYN.create(_YUNET, '', (a.shape[1], a.shape[0]), 0.6)
    _, faces = det.detect(a)
    if faces is None or not len(faces): return None
    f = max(faces, key=lambda f: f[2] * f[3])
    return tuple(float(v) for v in f[:4])

def place(src, dst, mode=None):
    global MODE
    MODE = mode or MODE
    rgb = load(src)
    cut = cutout(rgb)
    f = detect_face(rgb)
    if f is None:
        print('!! 顔が見つからない（要確認）:', src)
        bx = cut.getbbox(); fx, fy, fw = bx[0] + (bx[2]-bx[0]) * 0.3, bx[1] + (bx[2]-bx[0]) * 0.2, (bx[2]-bx[0]) * 0.4
        f = (fx, fy, fw, fw)
    cut = keep_person(cut, f)
    x, y, w, h = f
    s = FACE_W / w
    # 写真の下端が CUT_Y まで届かない人は、届くところまで少しだけ拡大（顔基準の位置は維持）
    cy_src = y + h / 2
    reach = FACE_CY + (cut.height - cy_src) * s
    if reach < CUT_Y + 4:
        s2 = (CUT_Y + 4 - FACE_CY) / (cut.height - cy_src)
        print(f'.. 写真が短いので {s2 / s:.2f} 倍に拡大:', src)
        s = s2
    im = cut.resize((round(cut.width * s), round(cut.height * s)), Image.LANCZOS)
    ox = round(FACE_CX - (x + w / 2) * s); oy = round(FACE_CY - (y + h / 2) * s)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0)); canvas.paste(im, (ox, oy), im)
    m = Image.new('L', (W, H), 255); d = ImageDraw.Draw(m)
    if MODE == 'cut':   # 水平カット
        d.rectangle((0, CUT_Y, W, H), fill=0)
    else:               # 下端グラデ透過
        end = min(FADE_END, oy + im.height)   # 写真が短い人は写真の下端で消え切る
        for yy in range(end - FADE_LEN, H):
            t = min(1, (yy - (end - FADE_LEN)) / FADE_LEN)
            d.line([(0, yy), (W, yy)], fill=int(255 * (1 - t) ** 1.5))
    canvas.putalpha(ImageChops.multiply(canvas.split()[3], m))
    # 写真の下端が足りずに途中で切れていないか
    bottom = oy + im.height
    if MODE == 'cut' and bottom < CUT_Y:
        print(f'!! 写真の下が短い（{bottom}px で切れる）:', src)
    canvas.save(dst)
    print(f'ok {src} -> {dst}  scale={s:.3f} face=({x},{y},{w},{h})')

if __name__ == '__main__':
    place(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
