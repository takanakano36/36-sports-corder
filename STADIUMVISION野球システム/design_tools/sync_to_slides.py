"""作ったスライドを、ビジョンの slides フォルダへ入れ替える（作ったら自動でセットまで）。

同期元 → 同期先
  output/960x686/{ロゴ, 進行, 進行_閉会式, 入場, 対戦, 選手, ゲスト}  →  ../slides/<同じ名前>   （選手はチームのサブフォルダごと）
  output/1920x686/全面                                       →  ../slides/全面

- 新しいファイル・中身が変わったファイルだけコピーします（大きさと中身で見分けます）。
- 同期先にあって同期元に無いファイル（名前が変わった古いスライドなど）は、消さずに
  slides/_退避/日時/<フォルダ>/ へ移します（管理画面の一覧・提案には出ません）。
- 同期元に無いフォルダは、何もしません。slides の sample・フタ・手で入れたフォルダにも触りません。

使い方：  python sync_to_slides.py [--output 作った画像のフォルダ] [--slides ビジョンの slides フォルダ]
"""
import argparse
import datetime
import hashlib
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.mp4', '.webm', '.m4v')
FOLDERS_960 = ['ロゴ', '進行', '進行_閉会式', '入場', '対戦', '選手', 'ゲスト']
RETIRE_DIR = '_退避'


def list_files(root):
    """root の中の画像・動画を、root からの相対パス（/ 区切り）で返す"""
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if not d.startswith('.')]
        for f in fn:
            if f.startswith('.') or not f.lower().endswith(EXTS):
                continue
            out.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, '/'))
    return sorted(out)


def sha1(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def same(a, b):
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    return sha1(a) == sha1(b)


def sync(output, slides, stamp=None):
    stamp = stamp or datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    pairs = [(os.path.join(output, '960x686', f), os.path.join(slides, f), f) for f in FOLDERS_960]
    pairs.append((os.path.join(output, '1920x686', '全面'), os.path.join(slides, '全面'), '全面'))
    added, updated, retired = [], [], []
    for src, dst, name in pairs:
        if not os.path.isdir(src):
            continue                                   # 同期元に無いフォルダは、何もしない
        src_files = list_files(src)
        for rel in src_files:
            s, d = os.path.join(src, rel), os.path.join(dst, rel)
            if not os.path.exists(d):
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(s, d)
                added.append(f'{name}/{rel}')
            elif not same(s, d):
                shutil.copy2(s, d)
                updated.append(f'{name}/{rel}')
        if os.path.isdir(dst):
            keep = set(src_files)
            for rel in list_files(dst):
                if rel in keep:
                    continue
                d = os.path.join(dst, rel)
                to = os.path.join(slides, RETIRE_DIR, stamp, name, rel)
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.move(d, to)
                retired.append(f'{name}/{rel}')
    return added, updated, retired


def main(argv=None):
    ap = argparse.ArgumentParser(description='作ったスライドを slides フォルダへ入れ替える')
    ap.add_argument('--output', default=os.path.join(HERE, 'output'), help='作った画像のフォルダ（既定 design_tools/output）')
    ap.add_argument('--slides', default=os.path.normpath(os.path.join(HERE, '..', 'slides')), help='ビジョンの slides フォルダ')
    a = ap.parse_args(argv)
    if not os.path.isdir(a.slides):
        os.makedirs(a.slides, exist_ok=True)
    added, updated, retired = sync(a.output, a.slides)
    msg = f'ビジョンの slides に入れ替えました：追加{len(added)}・更新{len(updated)}・退避{len(retired)}'
    if retired:
        shown = retired[:20]
        msg += '（' + '、'.join(shown) + ('、ほか%d件' % (len(retired) - 20) if len(retired) > 20 else '') + '）'
    print(msg)
    if retired:
        print('  ※ 名前が変わった古いスライドは slides/%s/ に移してあります（消していません）' % RETIRE_DIR)
    if not (added or updated or retired):
        print('  （変わったものはありませんでした）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
