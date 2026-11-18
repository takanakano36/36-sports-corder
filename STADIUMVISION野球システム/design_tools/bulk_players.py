"""選手スライドの一括作成ツール

使い方（専用の環境の Python で実行する）:
  python bulk_players.py                      … 全チーム・全選手
  python bulk_players.py --team 稲沢           … チーム名に「稲沢」を含むチームだけ
  python bulk_players.py --team 稲沢 --no 4    … 1人だけ作り直し（当日の写真差し替え用）
  python bulk_players.py --dry                … 紐付けの確認だけ（スライドは作らない。結果は 確認_紐付け.csv）
  python bulk_players.py --accept-number-match … 名前が合わず背番号だけ合う写真も使う（人が確かめたあとだけ）

出力
  output/選手/チーム名/背番号_名前.png          … 1920x1080 のスライド
  output/選手/要確認/チーム名/…                 … 目で確かめるまで使わないもの（顔が見つからない／名前は合うが背番号が違う、など）
  output/選手/_退避/日時/…                      … 作り直す前の古いスライド（消さずに移す）
  output/確認_選手スライド.csv                  … 写真なし／候補／要確認／拡大した／胴が狭い／使われなかった写真 の一覧
元データは input/roster.csv（roster_build.py で作る）。写真の場所は input/settings.json の data_root。
"""
import argparse, collections, csv, datetime, os, re, shutil, sys, tempfile, time, traceback, unicodedata

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import photo_match as pm
from roster_build import data_root, DataError

OUT_DIR = os.path.join(D, 'output', '選手')
CHECK = os.path.join(D, 'output', '確認_選手スライド.csv')
CHECK_DRY = os.path.join(D, 'output', '確認_紐付け.csv')
HEAD = ['チーム', '背番号', '氏名', '区分', '内容', '写真', '出力先', '目安(拡大/胴幅)']
TORSO_MIN = 2.0          # 胴の幅÷顔の幅 がこれ未満なら「要目視」（切り抜きの欠け／アップ写真）。目安であり判定ではない
SCALE_WARN = 1.25        # これ以上に拡大した写真は「要目視」


def safe(s):
    return re.sub(r'[\\/:*?"<>|\s　]+', '', str(s))


def load_roster():
    p = os.path.join(D, 'input', 'roster.csv')
    if not os.path.exists(p): raise DataError('input/roster.csv がありません。先に roster_build.py を実行してください。')
    teams = collections.OrderedDict()
    for r in csv.DictReader(open(p, encoding='utf-8-sig')): teams.setdefault((r['team'], r['folder']), []).append(r)
    for (team, _), pls in teams.items():     # 同じチームで背番号が重なると、別人の写真・名前が混ざるので止める
        c = collections.Counter(p['no'] for p in pls)
        dup = sorted(n for n, k in c.items() if k > 1)
        if dup: raise DataError(f'{team}: 背番号が重なっています {dup}。選手登録フォームを直して、roster_build.py をやり直してください。')
    return teams


def merge_check(path, rows, keys, unused_teams):
    """一部だけ作り直したときは、ほかの人の行を消さずに、今回の分だけ入れ替える"""
    old = []
    if os.path.exists(path):
        for r in csv.reader(open(path, encoding='utf-8-sig')):
            if r and r[0] != HEAD[0]: old.append(r + [''] * (len(HEAD) - len(r)))
    keep = [r for r in old if not ((r[0], r[1]) in keys or (r[3] == '使われなかった写真' and r[0] in unused_teams))]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(HEAD); w.writerows(keep + rows)


def retire_old(team, no, stamp):
    """作り直す前の、その人の古いスライド（ふつうのフォルダ・要確認フォルダ）を、消さずに _退避 へ移す"""
    moved = []
    for sub in ('', '要確認'):
        d = os.path.join(OUT_DIR, sub, safe(team)) if sub else os.path.join(OUT_DIR, safe(team))
        if not os.path.isdir(d): continue
        for f in os.listdir(d):
            if f.lower().endswith('.png') and re.match(rf'^{int(no):02d}_', f):
                dst = os.path.join(OUT_DIR, '_退避', stamp, sub, safe(team)); os.makedirs(dst, exist_ok=True)
                shutil.move(os.path.join(d, f), os.path.join(dst, f)); moved.append(f)
    return moved


def load_fixes(path):
    """人ごとの手直し input/cutout_fixes.csv（team,no,kind,value）。kind: crop = 元写真の割合 x0,y0,x1,y1／erase = スライド座標の多角形 x,y;x,y;…（複数行可）"""
    out = collections.defaultdict(dict)
    if not os.path.exists(path): return out
    for i, r in enumerate(csv.DictReader(open(path, encoding='utf-8-sig')), 2):
        key = (r['team'].strip(), norm_no(r['no'])); kind = r['kind'].strip(); val = r['value'].strip()
        try:
            if kind == 'crop':
                v = tuple(float(x) for x in val.split(','))
                if len(v) != 4 or not (0 <= v[0] < v[2] <= 1 and 0 <= v[1] < v[3] <= 1): raise ValueError
                out[key]['crop'] = v
            elif kind == 'xscale':
                v = float(val)
                if not 0.5 <= v <= 1.0: raise ValueError
                out[key]['xscale'] = v
            elif kind == 'autocontrast':
                v = float(val)
                if not 0 <= v <= 20: raise ValueError
                out[key]['autocontrast'] = v
            elif kind == 'face_scale':
                v = float(val)
                if not 0.3 <= v <= 2.0: raise ValueError
                out[key]['face_scale'] = v
            elif kind == 'face':
                v = tuple(float(x) for x in val.split(','))
                if len(v) != 4 or not (0 <= v[0] < 1 and 0 <= v[1] < 1 and 0 < v[2] <= 1 and 0 < v[3] <= 1): raise ValueError
                out[key]['face'] = v
            elif kind == 'max_scale':
                v = float(val)
                if not 1.0 <= v <= 3.0: raise ValueError
                out[key]['max_scale'] = v
            elif kind in ('erase', 'keep'):
                poly = [tuple(float(c) for c in p.split(',')) for p in val.split(';')]
                if len(poly) < 3 or any(len(p) != 2 for p in poly): raise ValueError
                out[key].setdefault(kind, []).append(poly)
            else: raise ValueError
        except ValueError:
            raise DataError(f'cutout_fixes.csv {i}行目の書き方が違います（kind は crop か erase。crop は「x0,y0,x1,y1」(0〜1)、erase は「x,y;x,y;x,y」）: {r}')
    return out


REPLACE_DIR = os.path.join(D, 'input', 'photo_replace')
REPLACE_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.heic')


def find_replacement(team, no):
    """AIなどで補正した写真の置き場 input/photo_replace/。ファイル名は「チーム名_背番号.拡張子」（例: 関西南部リトル_05.png）。あれば、元の写真より優先して使う"""
    if not os.path.isdir(REPLACE_DIR): return None
    want = f'{safe(team)}_{int(no):02d}'
    hits = [f for f in os.listdir(REPLACE_DIR) if os.path.splitext(f)[0] == want and f.lower().endswith(REPLACE_EXT)]
    if len(hits) > 1: raise DataError(f'input/photo_replace に同じ選手の写真が複数あります: {hits}')
    return os.path.join(REPLACE_DIR, hits[0]) if hits else None


def norm_no(s):
    s = unicodedata.normalize('NFKC', str(s)).strip()
    return str(int(s)) if re.fullmatch(r'\d{1,3}', s) else s


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--root'); ap.add_argument('--team'); ap.add_argument('--no')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--accept-number-match', action='store_true')
    ap.add_argument('--small', action='store_true', help='960x686 版（球場ビジョン左半分の枠）を output/960x686/ に作る。16:9 版は触らない')
    ap.add_argument('--face-w', type=int, help='（--small のとき）顔の幅(px, 1920x1372の座標)。試すとき用。ふだんは slideA_960.py の値')
    ap.add_argument('--face-cx', type=int, help='（--small のとき）顔の中心の横位置。試すとき用（標準は slideA_960.py の値）')
    ap.add_argument('--align-left', type=int, help='（--small のとき）写真の左端をこの位置にそろえる（下線の左端は120）。試すとき用')
    ap.add_argument('--out', help='（--small のとき）出力先フォルダ。試すときに本番の output を汚さないため')
    a = ap.parse_args(argv)
    global OUT_DIR, CHECK
    if a.small:
        outroot = a.out or os.path.join(D, 'output', '960x686')
        OUT_DIR = os.path.join(outroot, '選手'); CHECK = os.path.join(outroot, '確認_選手スライド_960x686.csv')
    root = data_root(a.root)
    teams = load_roster()
    overrides = pm.load_overrides(os.path.join(D, 'input', 'photo_overrides.csv'))
    fixes = load_fixes(os.path.join(D, 'input', 'cutout_fixes.csv'))
    if a.team:
        a.team = unicodedata.normalize('NFKC', a.team).strip()
        teams = collections.OrderedDict((k, v) for k, v in teams.items() if a.team in unicodedata.normalize('NFKC', k[0]))
    if not teams: raise DataError(f'「{a.team}」を含むチームがありません。')
    if a.no:
        if not a.team: raise DataError('--no を使うときは --team も指定してください（背番号はチームごとに違うため）。')
        a.no = norm_no(a.no)
        if len(teams) > 1: raise DataError(f'「{a.team}」に当たるチームが複数あります: {[k[0] for k in teams]}。もっと長く指定してください。')
        pls = next(iter(teams.values()))
        if not any(norm_no(p['no']) == a.no for p in pls):
            raise DataError(f'{next(iter(teams))[0]} に背番号 {a.no} の選手がいません（あるのは {sorted(int(p["no"]) for p in pls)}）。')
    for (team, folder) in teams:      # 途中で止まらないよう、先に全チームのフォルダがあるか調べる
        if not os.path.isdir(os.path.join(root, folder)): raise DataError(f'チームのフォルダがありません: {os.path.join(root, folder)}')
    lay = None
    if not a.dry:
        import place
        if a.small:
            from slideA_960 import slide, LAYOUT as lay, make_layout
            if a.face_w or a.face_cx is not None or a.align_left is not None:
                from slideA_960 import FACE_W as _fw, FACE_CX as _fcx
                lay = make_layout(a.face_w or _fw, _fcx if a.face_cx is None else a.face_cx, a.align_left)
        else:
            from slideA import slide
    rows, keys, cnt = [], set(), collections.Counter()
    fails_in_row = 0
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    check_path = CHECK_DRY if a.dry else CHECK
    t0 = time.time()
    try:
        for (team, folder), pls in teams.items():
            tdir = os.path.join(root, folder)
            res, unused = pm.match_team(team, pls, tdir, overrides, a.accept_number_match)
            print(f'■ {team}（{len(pls)}人）')
            for pl in pls:
                if a.no and norm_no(pl['no']) != a.no: continue
                no, name = pl['no'], pl['name']; keys.add((team, no)); r = res[no]
                rep = find_replacement(team, no)
                if rep: r = dict(status='ok', path=rep, note='補正した写真を使用（input/photo_replace）')
                ph = os.path.basename(r['path']) if r['path'] else ''
                if not a.dry: retire_old(team, no, stamp)
                if r['status'] in ('none', 'candidate', 'ambiguous') or not r['path']:
                    note = r['note']
                    if r.get('cand'):
                        note += f'  ← 確かめて使うなら input/photo_overrides.csv に「{team},{no},{os.path.relpath(r["cand"], tdir)}」と書く'
                    rows.append([team, no, name, '作成せず', note, os.path.basename(r.get('cand') or ''), '', '']); cnt[r['status']] += 1
                    print(f'   - {no} {name}: {r["status"]}  {r["note"][:60]}'); continue
                if a.dry:
                    rows.append([team, no, name, '作成可（紐付けのみ確認）', r['note'], ph, '', '']); cnt['ok'] += 1; continue
                try:
                    with tempfile.TemporaryDirectory() as tmp:
                        placed = os.path.join(tmp, 'p.png')
                        fx = fixes.get((team, norm_no(no)))
                        info = place.place(r['path'], placed, 'cut', fx, lay)
                        img = slide(dict(pl), placed, 'cut', info['line_y'])
                    notes = [r['note']] if r['note'] else []
                    if fx: notes.append('手直しあり（input/cutout_fixes.csv）')
                    if info['gap']:
                        notes.append(f'【要AI補正】写真が短く、拡大の上限でも線(y={(lay or {}).get("CUT_Y", place.CUT_Y)})まで{info["gap"]}px届かない。画像は伸ばさず、写真の下端(y={info["line_y"]})で水平にカットして線もその位置。肩・胸元をAIで描き足した写真に差し替えると全員と同じ高さになる')
                    sub = ''
                    if not info['face']: sub = '要確認'; notes.append('顔が見つからず位置は推測')
                    if info['faces'] > 1: notes.append(f'顔が{info["faces"]}つ見つかった（いちばん大きい顔を採用）。別の人が手前に写っていないか目で確認')
                    if r['status'] == 'ok_check': sub = '要確認'
                    if info['short']: notes.append('写真が短く、下まで届かない')
                    if info['scaled'] > 1.0001: notes.append(f'写真が短いので{info["scaled"]:.2f}倍に拡大')
                    if info['soft'] < TORSO_MIN: notes.append(f'胴の幅が狭い（目安 {info["soft"]:.2f}）＝背景の抜けが甘い、またはアップの写真。目で確認')
                    if info['scaled'] >= SCALE_WARN: notes.append('大きく拡大したので、顔が大きく見えるかも。目で確認')
                    kind = '要確認' if sub else '作成'
                    outdir = os.path.join(OUT_DIR, sub, safe(team)) if sub else os.path.join(OUT_DIR, safe(team))
                    os.makedirs(outdir, exist_ok=True)
                    outp = os.path.join(outdir, f'{int(no):02d}_{safe(name)}.png')
                    img.save(outp, optimize=True)
                    rows.append([team, no, name, kind, ' / '.join(notes), ph, os.path.relpath(outp, D),
                                 f'{info["scaled"]:.2f}/{info["soft"]:.2f}']); cnt[kind] += 1
                    fails_in_row = 0
                except Exception as e:
                    rows.append([team, no, name, '失敗', f'{type(e).__name__}: {e}', ph, '', '']); cnt['失敗'] += 1
                    print(f'   !! 失敗 {no} {name}: {e}'); traceback.print_exc()
                    fails_in_row += 1
                    if fails_in_row >= 10:
                        raise DataError('10人続けて失敗したので止めました。確認リストと上のエラーを見てください。')
            if not a.no:
                for u in unused: rows.append([team, '', '', '使われなかった写真', '指導者・集合写真など。どの選手にも紐付かなかった', os.path.basename(u), '', ''])
    finally:      # 途中で止まっても、ここまでの記録は必ず残す
        merge_check(check_path, rows, keys, {k[0] for k in teams} if not a.no else set())
    print(f'\n完了 {time.time() - t0:.0f}秒  結果: {dict(cnt)}')
    print(f'確認リスト: {os.path.relpath(check_path, D)}')
    return 1 if cnt['失敗'] else 0


if __name__ == '__main__':
    try: sys.exit(main())
    except DataError as e:
        print('!! 止めました:', e); sys.exit(1)
