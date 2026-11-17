"""選手登録フォーム（各チームの xlsx）→ 選手一覧 input/roster.csv ＋ 確認リスト output/確認_選手データ.csv

使い方:  python roster_build.py [データのフォルダ]
  データのフォルダ = リーグ別フォルダが入っている所（各チームのフォルダに「選手登録フォーム.xlsx」
  と「決勝進出_プロフィール*.xlsx」と写真がある）。省略すると input/settings.json の data_root を使う。

ルール（2026-11-17 プロデューサー確認）
- 打率は「打者成績」欄、防御率は「投手成績」欄から読む。
- 「打率.429 3安打…」「防御率0.00 …」の型はそのまま読む。数字だけの欄は、欄の種類で決める
  （打者欄の 500 → .500、投手欄の 3,31 → 3.31）。
- 読み取れないもの・「-」・空は空欄にして、確認リストに出す。値を作らない。
"""
import csv, json, os, re, sys, unicodedata
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
import openpyxl

D = os.path.dirname(os.path.abspath(__file__))
IMG_EXT = ('.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp')


class DataError(Exception):
    """データの問題（止めて、人に知らせる）"""


def data_root(arg=None):
    if arg: return arg
    p = os.path.join(D, 'input', 'settings.json')
    if os.path.exists(p):
        v = json.load(open(p, encoding='utf-8-sig')).get('data_root')
        if v: return v
    raise DataError('データのフォルダが決まっていません。引数で指定するか、input/settings.json に {"data_root": "..."} と書いてください。')


def nfkc(s):
    return unicodedata.normalize('NFKC', str(s)).strip()


def clean_name(s):
    """氏名・ふりがな：空白の揺れを全角スペース1つにそろえる"""
    return re.sub(r'[\s　]+', '　', str(s).strip())


# ---------------------------------------------------------------- 成績の読み取り
NONE_RE = re.compile(r'^[\s\u3000\-－―—–‐−ー]*$')    # 空・「-」「―」など＝記録なし
def _dec(txt):
    try: return Decimal(txt)
    except InvalidOperation: return None


def parse_avg(raw):
    """戻り値 (値 or '', 区分, メモ)。区分: ''=問題なし / '変換'=数字だけの欄を読み替えた / '要確認'=読めない"""
    if raw is None or NONE_RE.match(str(raw)): return '', '', ''
    s = nfkc(raw).replace(',', '.')
    m = re.search(r'打率\s*([0-9]*\.?[0-9]+)', s)
    kind = ''
    if m: num = _dec(m.group(1))
    elif re.fullmatch(r'[0-9]*\.?[0-9]+', s):
        num = _dec(s); kind = '変換'
    else:
        return '', '要確認', '打率として読めない'
    if num is None: return '', '要確認', '数字として読めない'
    txt = m.group(1) if m else s
    if num > 1:
        # 整数の 100〜1000 だけ「割・分・厘」の読み替え（500 → .500）。1〜99 は安打数などの可能性があり、あいまいなので読まない
        if num == num.to_integral_value() and 100 <= num <= 1000: num = num / 1000
        else: return '', '要確認', '打率として読めない/あいまい（整数の1〜99・小数の1超など）'
    out = str(num.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP))
    if out.startswith('0.'): out = out[1:]                                    # 0.429 → .429（1.000 はそのまま）
    memo = ''
    if kind == '変換': memo = '数字だけの欄を打率として読み替え'
    elif '.' not in txt and num != 1 and not (txt.isdigit() and len(txt) >= 3):
        return '', '要確認', f'「打率{txt}」の読み方があいまい'
    elif '.' in txt and len(txt.split('.')[1]) > 3: memo = '小数4桁以上を3桁に丸めた'
    elif '.' in txt and len(txt.split('.')[1]) < 3 and not txt.endswith('.0'):
        memo = f'小数3桁未満（{txt}）を補った'; kind = '変換'
    return out, kind, memo


def parse_era(raw):
    if raw is None or NONE_RE.match(str(raw)): return '', '', ''
    s = nfkc(raw).replace(',', '.')
    m = re.search(r'防御率\s*([0-9]+(?:\.[0-9]+)?)', s)
    kind = ''
    if m: num = _dec(m.group(1))
    elif re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', s):
        num = _dec(s); kind = '変換'
    else:
        return '', '要確認', '防御率として読めない'
    if num is None: return '', '要確認', '数字として読めない'
    out = str(num.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    memo = ''
    if kind == '変換': memo = '数字だけの欄を防御率として読み替え'
    txt = m.group(1) if m else s
    if '.' in txt and len(txt.split('.')[1]) > 2:
        memo = (memo + ' / ' if memo else '') + f'小数3桁以上を2桁に丸めた（元 {txt}）'
        kind = kind or '変換'
    return out, kind, memo


# ---------------------------------------------------------------- フォームの読み込み
def find_team_dirs(root):
    """選手登録フォームがあるフォルダ＝チームのフォルダ"""
    out = []
    for dp, dn, fn in os.walk(root):
        if any(f.startswith('選手登録フォーム') and f.lower().endswith('.xlsx') and not f.startswith('~$') for f in fn):
            out.append(dp)
    return sorted(out)


def official_name(team_dir):
    for f in sorted(os.listdir(team_dir)):
        if f.startswith('決勝進出_プロフィール') and f.lower().endswith('.xlsx') and not f.startswith('~$'):
            try: ws = openpyxl.load_workbook(os.path.join(team_dir, f), data_only=True).active
            except PermissionError:
                raise DataError(f'ファイルを読めません（Excelなどで開いたままの可能性）。閉じてからもう一度実行してください: {os.path.join(team_dir, f)}')
            for row in ws.iter_rows(values_only=True):
                vals = [c for c in row if c not in (None, '')]
                if vals and str(vals[0]).strip() == 'チーム正式名称' and len(vals) > 1:
                    return str(vals[1]).strip()
    raise DataError(f'チーム正式名称が見つかりません（決勝進出_プロフィール）: {team_dir}')


def clean_team(official):
    """表示用に整える：（）の読み仮名を外す、空白をそろえる、長音の誤字（－）を直す。それ以外は変えない"""
    s = re.sub(r'[（(][^）)]*[）)]', '', official)
    s = re.sub(r'[\s　]+', ' ', s).strip()
    s = re.sub(r'(?<=[ァ-ヶ])[－‐−-](?=[ァ-ヶ])', 'ー', s)
    return s


def league_label(team_dir):
    """リーグ名・連盟名：チームのフォルダ名の「_」のあと（例 ［城東リーグ東京北砂］_［東京連盟］ → 東京連盟）"""
    tail = os.path.basename(team_dir).rsplit('_', 1)[-1]
    return re.sub(r'[\[\]［］【】]', '', tail).strip()


def load_teams_csv(path):
    if not os.path.exists(path): return {}
    return {r['folder']: r for r in csv.DictReader(open(path, encoding='utf-8-sig'))}


def read_form(path):
    try: ws = openpyxl.load_workbook(path, data_only=True).active
    except PermissionError:
        raise DataError(f'ファイルを読めません（Excelなどで開いたままの可能性）。閉じてからもう一度実行してください: {path}')
    rows = list(ws.iter_rows(values_only=True))
    hi = next((i for i, r in enumerate(rows) if r and any(c and '背番号' in str(c) for c in r)), None)
    if hi is None: raise DataError(f'見出し行（背番号）が見つかりません: {path}')
    hdr = [str(c).replace('\n', '').strip() if c else '' for c in rows[hi]]
    def col(*names):
        for n in names:
            for i, h in enumerate(hdr):
                if h == n or (n in h and len(h) <= len(n) + 3): return i
        raise DataError(f'列「{names[0]}」が見つかりません: {path}')
    ix = dict(no=col('背番号'), name=col('氏名'), kana=col('ふりがな'), grade=col('学年'), pos=col('主な守備位置'),
              throw=col('投'), bat=col('打'), avg=col('予選の通算打者成績'), era=col('予選の通算投手成績'))
    return rows[hi + 1:], ix


def build(root):
    teams_path = os.path.join(D, 'input', 'teams.csv')
    known = load_teams_csv(teams_path)
    team_dirs = find_team_dirs(root)
    if not team_dirs: raise DataError(f'選手登録フォームが見つかりません: {root}')
    players, checks, teams_out = [], [], []
    for td in team_dirs:
        folder = os.path.relpath(td, root)
        off = official_name(td)
        t = known.get(folder)
        display = (t['display'].strip() if t and t.get('display', '').strip() else clean_team(off))
        league = (t.get('league', '').strip() if t else '') or league_label(td)
        teams_out.append({'folder': folder, 'official': off, 'display': display, 'league': league})
        form = next(os.path.join(td, f) for f in sorted(os.listdir(td)) if f.startswith('選手登録フォーム') and f.lower().endswith('.xlsx') and not f.startswith('~$'))
        rows, ix = read_form(form)
        seen = {}
        for r in rows:
            nm = r[ix['name']]
            if nm in (None, '') or str(r[0]).strip() == '例': continue
            rawno = r[ix['no']]
            if rawno in (None, ''):
                checks.append([display, '', clean_name(nm), '背番号', '', '', '背番号が空：スライドを作れません', '要確認']); continue
            sno = nfkc(rawno)
            if re.fullmatch(r'\d+\.0+', sno): sno = sno.split('.')[0]                  # Excelの 10.0 → 10
            if not re.fullmatch(r'\d{1,3}', sno):
                checks.append([display, str(rawno), clean_name(nm), '背番号', str(rawno), '', '背番号が整数ではありません（小数・文字など）', '要確認']); continue
            no = sno if set(sno) == {'0'} else sno.lstrip('0')                          # 07 → 7、00 は 00 のまま（0 と別の番号）
            name = clean_name(nm)
            if no in seen: checks.append([display, no, name, '背番号', no, '', f'背番号が重複（{seen[no]} と）', '要確認'])
            seen[no] = name
            posraw = '' if r[ix['pos']] is None else nfkc(r[ix['pos']])
            plist = [p for p in re.split(r'[・/／、,\s]+', posraw) if p]
            pos = plist[0] if plist else ''
            if len(plist) > 1: checks.append([display, no, name, 'ポジション', posraw, pos, '複数あるので先頭だけ表示', '変換'])
            if not plist: checks.append([display, no, name, 'ポジション', '', '', '空欄', '要確認'])
            grade = '' if r[ix['grade']] is None else nfkc(r[ix['grade']])
            if not grade: checks.append([display, no, name, '学年', '', '', '空欄', '要確認'])
            tb = {}
            for k in ('throw', 'bat'):
                v = '' if r[ix[k]] is None else nfkc(r[ix[k]])
                v1 = v[:1] if v[:1] in ('右', '左', '両') else ''
                if v and not v1: checks.append([display, no, name, '投' if k == 'throw' else '打', v, '', '右・左・両のどれでもない', '要確認'])
                if not v: checks.append([display, no, name, '投' if k == 'throw' else '打', '', '', '空欄', '要確認'])
                tb[k] = v1
            avg, ka, ma = parse_avg(r[ix['avg']])
            era, ke, me = parse_era(r[ix['era']])
            if ka: checks.append([display, no, name, '打率', r[ix['avg']], avg, ma, ka])
            elif ma: checks.append([display, no, name, '打率', r[ix['avg']], avg, ma, '変換'])
            if ke: checks.append([display, no, name, '防御率', r[ix['era']], era, me, ke])
            elif me: checks.append([display, no, name, '防御率', r[ix['era']], era, me, '変換'])
            players.append(dict(team=display, no=no, name=name, kana=clean_name(r[ix['kana']] or ''), grade=grade, pos=pos,
                                avg=avg, throw=tb['throw'], bat=tb['bat'], era=era, folder=folder))
    return players, checks, teams_out


def write_all(players, checks, teams_out):
    os.makedirs(os.path.join(D, 'input'), exist_ok=True); os.makedirs(os.path.join(D, 'output'), exist_ok=True)
    cols = ['team', 'no', 'name', 'kana', 'grade', 'pos', 'avg', 'throw', 'bat', 'era', 'folder']
    with open(os.path.join(D, 'input', 'roster.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(players)
    tp = os.path.join(D, 'input', 'teams.csv')
    with open(tp, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, ['folder', 'official', 'display', 'league']); w.writeheader(); w.writerows(teams_out)
    with open(os.path.join(D, 'output', '確認_選手データ.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(['チーム', '背番号', '氏名', '項目', '元の値', '結果', 'メモ', '区分']); w.writerows(checks)


if __name__ == '__main__':
    try:
        players, checks, teams_out = build(data_root(sys.argv[1] if len(sys.argv) > 1 else None))
    except DataError as e:
        print('!! 止めました:', e); sys.exit(1)
    write_all(players, checks, teams_out)
    n_ng = sum(1 for c in checks if c[7] == '要確認')
    print(f'チーム {len(teams_out)} / 選手 {len(players)} 人 → input/roster.csv')
    print(f'確認リスト {len(checks)} 件（うち要確認 {n_ng}）→ output/確認_選手データ.csv')
