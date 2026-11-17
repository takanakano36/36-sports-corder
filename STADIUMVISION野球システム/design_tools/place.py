"""選手写真の自動配置（A案用）
写真ごとに顔を検出し、「顔の幅」と「顔の中心位置」を全員同じにそろえて
1920x1080 の透過PNG（下端グラデ透過済み）を書き出す。
Photoshop では photo レイヤーを「そのまま(As Is)」で差し替えるだけで位置が合う。

使い方: python3 place.py 入力jpg 出力png
"""
import sys, cv2, numpy as np
from PIL import Image, ImageDraw, ImageChops, ImageOps
from rembg import remove, new_session
import pillow_heif
pillow_heif.register_heif_opener()      # iPhone の HEIC 写真も開けるようにする

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
    # 体の中にできた小さな穴（模様や影を背景と誤認したもの）を埋める。画像の縁につながる穴（腕と体のすきま等）は埋めない
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats((m <= 40).astype(np.uint8))
    Hh, Ww = m.shape; thr = 0.004 * Hh * Ww
    for k in range(1, n2):
        bx, by, bw, bh, area = st2[k]
        if area < thr and bx > 0 and by > 0 and bx + bw < Ww and by + bh < Hh: m[lab2 == k] = 255
    out = cut.copy(); out.putalpha(Image.fromarray(m)); return out

import os
_YUNET = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'yunet.onnx')
_YUNET_BYTES = None
def detect_face(rgb):
    # YuNet(OpenCV) 顔検出：横向き写真や隣の子が写っていても、一番大きい顔を採用
    # ※ OpenCV は日本語を含むパスのモデルを直接読めないので、バイト列にして渡す
    global _YUNET_BYTES
    if _YUNET_BYTES is None:
        with open(_YUNET, 'rb') as fh: _YUNET_BYTES = np.frombuffer(fh.read(), np.uint8)
    a = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
    det = cv2.FaceDetectorYN.create('onnx', _YUNET_BYTES, np.empty(0, np.uint8), (a.shape[1], a.shape[0]), 0.6)
    _, faces = det.detect(a)
    detect_face.count = 0 if faces is None else len(faces)       # 見つかった顔の数（一括ツールが「複数」を確認リストに出すため）
    if faces is None or not len(faces): return None
    f = max(faces, key=lambda f: f[2] * f[3])
    return tuple(float(v) for v in f[:4])

MAX_SCALE = 1.15    # 写真が短いときの拡大の上限。これを超えるなら拡大しすぎず、写真の下端をなじませて消す（顔が大きく写りすぎないように）
BOTTOM_FADE = 150   # 下端をなじませる長さ(px)

def place(src, dst, mode=None, fixes=None):
    """fixes（人ごとの手直し。input/cutout_fixes.csv から）:
       crop  = (x0,y0,x1,y1) 元写真の割合(0〜1)。印刷した写真を撮った写真など、使う範囲を絞る
       xscale = 0〜1の数。元写真の横幅にかける倍率（横に伸びている写真を戻す。例 0.88）
       erase = [ [(x,y),...], ... ] スライド座標(1920x1080)の多角形。切り抜きで残ってしまったもの（背景の建物・隣の人の腕）を消す
       keep  = [ [(x,y),...], ... ] スライド座標の多角形。切り抜きで欠けた所を、元の写真のまま戻す
       max_scale = 数（1以上）。この人だけ、写真が短いときの拡大の上限を変える"""
    global MODE
    MODE = mode or MODE
    fixes = fixes or {}
    rgb = load(src)
    if fixes.get('crop'):
        x0, y0, x1, y1 = fixes['crop']; rgb = rgb.crop((round(x0 * rgb.width), round(y0 * rgb.height), round(x1 * rgb.width), round(y1 * rgb.height)))
    if fixes.get('xscale'):     # 元写真が横に伸びている（提出時に縦横比が変わっていた）ときの補正：横幅を縮める
        rgb = rgb.resize((max(1, round(rgb.width * fixes['xscale'])), rgb.height), Image.LANCZOS)
    if fixes.get('autocontrast') is not None:     # 色があせた写真（古い印刷写真など）の明暗をそろえる（PILの標準処理。cutoff=両端の無視する割合%）
        rgb = ImageOps.autocontrast(rgb, cutoff=fixes['autocontrast'], preserve_tone=True)    # 色味は変えず、明暗だけそろえる
    cut = cutout(rgb)
    f = detect_face(rgb)
    info = dict(face=f is not None, faces=getattr(detect_face, 'count', 0), scaled=1.0, short=False, soft=0.0, faded=False)   # 一括ツールが確認リストに使う結果
    if f is None:
        print('!! 顔が見つからない（要確認）:', src)
        bx = cut.getbbox(); fx, fy, fw = bx[0] + (bx[2]-bx[0]) * 0.3, bx[1] + (bx[2]-bx[0]) * 0.2, (bx[2]-bx[0]) * 0.4
        f = (fx, fy, fw, fw)
    cut = keep_person(cut, f)
    x, y, w, h = f
    # 切り抜きの欠けの目安：顔の下の「胴の幅」÷顔の幅（中央値）。普通は2.4以上。白い壁に白いシャツで胴が欠けたり、
    # 顔のアップで胴がほとんど無い写真だと小さくなる。目視確認の目安であり、判定ではない（関西南部の19人で、欠けた4人が1.4〜2.0、ほかは2.4以上）
    al = np.array(cut.split()[3]) > 127
    if not al.any(): raise RuntimeError('背景の切り抜きで人が残りませんでした（写真を確認してください）')
    ys = np.where(al.any(axis=1))[0]
    bot = int(ys.max()) if len(ys) else 0
    y0 = int(y + h)
    if bot > y0 + 12:
        rows = range(y0, bot, max(1, (bot - y0) // 12))
        info['soft'] = float(np.median([al[i].sum() for i in rows]) / w)
    else:
        info['soft'] = 0.0      # 顔の下にほとんど写真が無い
    s = FACE_W / w
    # 写真の下端が CUT_Y まで届かない人は、届くところまで少しだけ拡大（顔基準の位置は維持）
    cy_src = y + h / 2
    reach = FACE_CY + (cut.height - cy_src) * s
    if reach < CUT_Y + 4:
        s2 = (CUT_Y + 4 - FACE_CY) / (cut.height - cy_src)
        mx = fixes.get('max_scale', MAX_SCALE)
        if s2 / s > mx:      # 拡大しすぎると顔が大きく写るので、上限で止めて、下端はなじませて消す
            print(f'.. 写真が短い（{s2 / s:.2f} 倍必要）ので {mx} 倍で止めて下端をなじませる:', src)
            info['scaled'] = mx; info['faded'] = True
            s = s * mx
        else:
            print(f'.. 写真が短いので {s2 / s:.2f} 倍に拡大:', src)
            info['scaled'] = s2 / s
            s = s2
    im = cut.resize((round(cut.width * s), round(cut.height * s)), Image.LANCZOS)
    ox = round(FACE_CX - (x + w / 2) * s); oy = round(FACE_CY - (y + h / 2) * s)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0)); canvas.paste(im, (ox, oy), im)
    for poly in fixes.get('keep', []):      # 手直し：切り抜きで欠けた所（白い壁に白いシャツの肩など）を、元の写真のまま戻す
        full = rgb.resize(im.size, Image.LANCZOS).convert('RGBA')      # 元の写真の色（切り抜き後の画像は、消した所の色が黒になっているため使えない）
        raw = Image.new('RGBA', (W, H), (0, 0, 0, 0)); raw.paste(full, (ox, oy))
        pm_ = Image.new('L', (W, H), 0); ImageDraw.Draw(pm_).polygon(poly, fill=255)
        canvas.paste(raw, (0, 0), pm_)
    m = Image.new('L', (W, H), 255); d = ImageDraw.Draw(m)
    for poly in fixes.get('erase', []):     # 手直し：残ってしまったものを消す
        d.polygon(poly, fill=0)
    info['line_y'] = CUT_Y
    if info['faded']:       # 拡大の上限で止めた人：写真の下端でそのまま水平にカットし、細い線もその位置に引く（透過グラデにはしない）
        end = oy + im.height
        d.rectangle((0, end, W, H), fill=0)
        info['line_y'] = min(CUT_Y, end)
    elif MODE == 'cut':   # 水平カット
        d.rectangle((0, CUT_Y, W, H), fill=0)
    else:               # 下端グラデ透過
        end = min(FADE_END, oy + im.height)   # 写真が短い人は写真の下端で消え切る
        for yy in range(end - FADE_LEN, H):
            t = min(1, (yy - (end - FADE_LEN)) / FADE_LEN)
            d.line([(0, yy), (W, yy)], fill=int(255 * (1 - t) ** 1.5))
    canvas.putalpha(ImageChops.multiply(canvas.split()[3], m))
    # 写真の下端が足りずに途中で切れていないか
    bottom = oy + im.height
    if MODE == 'cut' and bottom < CUT_Y and not info['faded']:
        print(f'!! 写真の下が短い（{bottom}px で切れる）:', src)
        info['short'] = True
    canvas.save(dst)
    print(f'ok {src} -> {dst}  scale={s:.3f} face=({x},{y},{w},{h})')
    return info

if __name__ == '__main__':
    place(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
