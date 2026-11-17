"""選手と写真の紐付け（背番号と名前の両方で照合）

ルール（別人の写真を出さないことを最優先にする）
- 「名前がまるごと一致」した写真を採用する（空白の全角/半角・有無は無視）。
- 名前が部分一致（名字だけ、など）のときは、写真の背番号＝名簿の背番号のときだけ採用する。背番号が無い/違うときは「候補」にして使わない。
- 名前は合うが背番号が違う、同じ名前の写真が他にもある、は「要確認」（使うが、要確認フォルダに分ける）。
- 同じ写真が2人以上に当たったら、全員「写真が複数」で使わない。同じチームで背番号が重なる場合は呼び出し側で止める。
- 名前が合わず背番号だけ合う写真、名前が似ている写真は「候補」。人の目で確かめるまで使わない。
  確かめたら input/photo_overrides.csv に （チーム,背番号,ファイル名） を書くと、その写真を使う。
- 監督・コーチ・集合写真など（ファイル名やフォルダ名に 監督/コーチ/会長/マネージャー/集合 を含む）は、名前の照合に使わない。
  どの選手にも紐付かなかった写真は「使われなかった写真」として一覧に出す。
"""
import csv, os, re, unicodedata
from difflib import SequenceMatcher

IMG_EXT = ('.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp')
SKIP_DIR_WORDS = ('集合',)                                   # 集合写真フォルダは対象外
STAFF_WORDS = ('監督', 'コーチ', '会長', 'マネージャー')      # 指導者の写真（名前の照合に使わない）


def _key(s):
    return re.sub(r'[\s　]+', '', unicodedata.normalize('NFKC', str(s)))


def _is_staff(path, team_dir):
    rel = os.path.relpath(path, team_dir)
    parts = rel.split(os.sep)
    # フォルダ名は「選手・指導者写真」のように指導者の語を含むのが普通なので、フォルダは「指導者」そのもの・監督・コーチだけを指導者扱いにする
    return any(w in parts[-1] for w in STAFF_WORDS) or any(p == '指導者' or any(w in p for w in ('監督', 'コーチ')) for p in parts[:-1])


def photos_in(team_dir):
    out = []
    for dp, dn, fn in os.walk(team_dir):
        dn[:] = [d for d in dn if not any(w in d for w in SKIP_DIR_WORDS)]
        for f in sorted(fn):
            if f.lower().endswith(IMG_EXT) and not f.startswith('~$'): out.append(os.path.join(dp, f))
    return out


def parse_photo_name(path):
    """ファイル名 → (背番号 or None, 名前の部分)。例: '10 山田太郎'→('10','山田太郎') / '山田　太郎'→(None,'山田太郎')"""
    stem = _key(os.path.splitext(os.path.basename(path))[0])
    m = re.match(r'^(?:背番号)?(\d{1,3})[_\-.、)）]*(.*)$', stem)
    return (m.group(1), m.group(2)) if m else (None, stem)


def load_overrides(path):
    if not os.path.exists(path): return {}
    return {(r['team'].strip(), r['no'].strip()): r['file'].strip() for r in csv.DictReader(open(path, encoding='utf-8-sig'))}


def match_team(team, players, team_dir, overrides=None, accept_number_only=False):
    """players: そのチームの選手(dict: no,name)の一覧。
    戻り値: (結果 {no: dict(status, path, note, cand)}, 使われなかった写真のリスト)
    status: ok（そのまま使う）/ ok_check（使うが要確認）/ candidate（使わない・候補あり）/ ambiguous（使わない）/ none（写真なし）"""
    overrides = overrides or {}
    allp = [(p,) + parse_photo_name(p) for p in photos_in(team_dir)]
    photos = [p for p in allp if not _is_staff(p[0], team_dir)]          # 名前の照合に使うのは、指導者でない写真だけ
    used, res = set(), {}
    nkeys = {p['no']: _key(p['name']) for p in players}
    for pl in players:
        no, nk = pl['no'], nkeys[pl['no']]
        ov = overrides.get((team, no))
        if ov:
            hit = [p for p in allp if os.path.basename(p[0]) == ov or os.path.relpath(p[0], team_dir) == ov]
            if len(hit) == 1:
                res[no] = dict(status='ok', path=hit[0][0], note='input/photo_overrides.csv で指定'); used.add(hit[0][0])
            else:
                res[no] = dict(status='none', path=None, note=f'photo_overrides.csv のファイルが見つからない/複数: {ov}')
            continue
        # 名前の一致：まるごと一致(exact) と 部分一致(partial)
        hits = [p for p in photos if len(p[2]) >= 2 and (nk in p[2] or p[2] in nk)]
        exact = [p for p in hits if p[2] == nk]
        partial_same_no = [p for p in hits if p[2] != nk and p[1] == no]
        good = exact + [p for p in partial_same_no if p not in exact]      # 採用してよい写真
        if len(good) == 1:
            p = good[0]; used.add(p[0])
            # 他の選手の背番号が付いた写真（同じ名字の別の子）は、「他にもある」に数えない
            others = [q for q in hits if q is not p and not (q[1] and q[1] != no and q[1] in nkeys)]
            if others:
                res[no] = dict(status='ok_check', path=p[0], note='同じ名前を含む写真が他にもある: ' + ' / '.join(os.path.basename(q[0]) for q in others))
            elif p[1] and p[1] != no:
                res[no] = dict(status='ok_check', path=p[0], note=f'名前は一致、背番号が違う（写真 {p[1]} / 名簿 {no}）')
            else:
                res[no] = dict(status='ok', path=p[0], note='')
            continue
        if len(good) > 1:
            res[no] = dict(status='ambiguous', path=None, note='写真が複数: ' + ' / '.join(os.path.basename(p[0]) for p in good))
            used.update(p[0] for p in good); continue
        if hits:      # 部分一致だけで、背番号も合わない/無い → 別人かもしれないので使わない
            p = hits[0]; used.add(p[0])
            res[no] = dict(status='candidate', path=None, cand=p[0], note=f'名前の一部だけ一致（写真 {os.path.basename(p[0])}）。背番号も合わないので使っていません')
            continue
        num_hits = [p for p in photos if p[1] == no]
        if len(num_hits) == 1:
            p = num_hits[0]; used.add(p[0])
            res[no] = dict(status='ok_check' if accept_number_only else 'candidate', path=p[0] if accept_number_only else None, cand=p[0],
                           note=f'名前が合わない（写真 {os.path.basename(p[0])}）。背番号だけ一致')
        else:
            res[no] = dict(status='none', path=None, note='写真が見つからない')
    # 同じ写真が2人以上に使われていたら、全員止める
    cnt = {}
    for no, r in res.items():
        if r['path']: cnt.setdefault(r['path'], []).append(no)
    for path, nos in cnt.items():
        if len(nos) > 1:
            for no in nos:
                res[no] = dict(status='ambiguous', path=None, note=f'同じ写真 {os.path.basename(path)} が背番号 {"・".join(nos)} に当たった')
    unused = [p[0] for p in allp if p[0] not in used]
    # 写真が見つからない選手に、名前が似た「使われなかった写真」を候補として添える（使うのは人が確かめてから）
    for pl in players:
        r = res[pl['no']]
        if r['status'] != 'none' or r.get('cand'): continue
        best = max(((SequenceMatcher(None, nkeys[pl['no']], re.sub(r'^\d+', '', _key(os.path.splitext(os.path.basename(u))[0]))).ratio(), u)
                    for u in unused if not _is_staff(u, team_dir)), default=(0, None))
        if best[0] >= 0.5:
            r['status'] = 'candidate'; r['cand'] = best[1]; r['note'] = f'似た名前の写真が未使用: {os.path.basename(best[1])}（別人かもしれないので使っていません）'
    return res, unused
