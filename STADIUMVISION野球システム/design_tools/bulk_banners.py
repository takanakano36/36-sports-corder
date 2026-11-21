"""入場・対戦・進行バナーの一括作成（一覧CSVから）

使い方（専用の環境の Python で実行する）:
  python bulk_banners.py --init     … 一覧CSVのひな形を input/ に作る（すでにあるファイルは上書きしない）
  python bulk_banners.py            … 一覧CSVから全部作る
  python bulk_banners.py --only 対戦  … 入場／対戦／進行／ロゴ のどれかだけ作る

一覧CSV（input/ に置く。Excelで開いて編集してよい。保存は「CSV UTF-8」）
  entrance.csv … order,team[,league] 入場順とチーム名（teams.csv の display と同じ名前）。名簿のないチームは league 列にリーグ名を書く
  closing.csv  … no,ja,en,kicker     閉会式の進行スライド（program.csv と同じ書き方）
  matches.csv  … block,game,date,time,team1,team2,venue   例: Cブロック,第一試合,11.22 SUN,9:00,稲沢中央ボーイズ,東京北砂リトルリーグ,MORIYAMA CITY STADIUM
                 venue（画面右下に出る会場名）は必須。
  program.csv  … no,ja,en,kicker     並び順・項目名・英語名（空でもよい）・見出し。番号は画面には出さない（2026-11-17 指示）
リーグ名（ボーイズリーグ・リトルリーグなど）は input/teams.csv の league 列から入る。
"""
import argparse, csv, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
from roster_build import DataError

IN = os.path.join(D, 'input'); OUT_ROOT = os.path.join(D, 'output')

# ひな形の中身。入場順は引き継ぎ書の「開会式次第の記載どおり」を、正式名称に当てはめたもの（対応は要確認）
ENTRANCE_ORDER = ['ガッツ・黒潮連合チーム', '大洲ボーイズ', 'ナガセ ボーイズ少年野球協会', '稲沢中央ボーイズ', '深谷ボーイズ',
                  'わかやまポニー ATTA BOYS', 'ヤング谷山ジャガーズ', '関西南部リトル', '東京北砂リトルリーグ',
                  '船橋リトルリーグ', '信州チーム', 'Unites Niigata']
BLOCKS = [('Aブロック', 'KUSATSU GREEN STADIUM', ['大洲ボーイズ', 'ガッツ・黒潮連合チーム', '信州チーム']),
          ('Bブロック', 'AI AI FUSHIMI MOMOYAMA STADIUM', ['ヤング谷山ジャガーズ', '船橋リトルリーグ', 'ナガセ ボーイズ少年野球協会']),
          ('Cブロック', 'MORIYAMA CITY STADIUM', ['稲沢中央ボーイズ', '東京北砂リトルリーグ', 'Unites Niigata']),
          ('Dブロック', 'SHIGA KIBOGAOKA PARK BASEBALL STADIUM', ['わかやまポニー ATTA BOYS', '深谷ボーイズ', '関西南部リトル'])]
GAMES = [('第一試合', '9:00', 0, 1), ('第二試合', '11:30', 1, 2), ('第三試合', '14:00', 2, 0)]     # (名前, 開始, 先攻の番号, 後攻の番号)
# 2026-11-18 最新マニュアル(p.50 開会式 式次第)より：選手宣誓は無くなり、始球式が7番
PROGRAM = [(1, '選手入場', ''), (2, '開会宣言', ''), (3, '主催者挨拶', ''), (4, '後援団体参列者ご紹介', ''),
           (5, '三日月滋賀県知事挨拶', ''), (6, 'ゲストご挨拶', ''), (7, '始球式', '')]
# 2026-11-18 最新マニュアル(p.55 閉会式 11/23 15:00 式次第)。「表彰式（トロフィー・メダル授与）」は画面では「表彰式」だけにする
CLOSING = [(1, '開式の辞', ''), (2, '成績発表', ''), (3, '表彰式', ''), (4, 'ゲストご挨拶', ''), (5, '閉会挨拶', '')]
# ゲスト・来賓の名前スライド（960x686 のみ）。守山市長の名前は要確認
GUESTS = [(1, 'SPECIAL GUEST', '元メジャーリーガー', 'マック鈴木', '様'), (2, 'SPECIAL GUEST', '元メジャーリーガー', '川﨑 宗則', '様'),
          (3, 'GUEST', '守山市長', '森中 高史', '様')]
# 進行スライドの追加分（台本の参照先の番号を変えないため、既存の番号の後ろに付ける。program.csv に同じ項目があればそちらを使う）
EXTRA_PROGRAM = [(8, '国旗掲揚', ''), (9, 'ゲスト紹介', '')]
# 2人を1枚にした名前スライド
GUEST_PAIRS = []          # 例 [(4, 'SPECIAL GUEST', [('肩書き', '名前'), ('肩書き', '名前')])]（いまは使わない）
OPENING_FOOTER = '11.21 SAT  MORIYAMA CITY STADIUM'
CLOSING_FOOTER = '11.23 MON  MORIYAMA CITY STADIUM'


def safe(s):
    return re.sub(r'[\\/:*?"<>|\s　]+', '', str(s))


def read_csv(name):
    p = os.path.join(IN, name)
    if not os.path.exists(p): raise DataError(f'input/{name} がありません。`bulk_banners.py --init` でひな形を作ってください。')
    return list(csv.DictReader(open(p, encoding='utf-8-sig')))


def teams_map():
    return {r['display']: r for r in read_csv('teams.csv')}


def init_templates():
    tm = teams_map()
    bad = [t for t in ENTRANCE_ORDER if t not in tm]
    if bad: raise DataError(f'teams.csv にないチーム名（入場順のひな形用）: {bad}')
    def put(name, head, rows):
        p = os.path.join(IN, name)
        if os.path.exists(p): print(f'  既にあるので残しました: input/{name}'); return
        with open(p, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f); w.writerow(head); w.writerows(rows)
        print(f'  作りました: input/{name}')
    put('entrance.csv', ['order', 'team'], [(i + 1, t) for i, t in enumerate(ENTRANCE_ORDER)])
    # 対戦：公式プログラム（トーナメント表）の全ブロック 11/22。各ブロック 1-2 / 2-3 / 3-1、左が先攻。会場の英語表記は仮（要確認）
    put('matches.csv', ['block', 'game', 'date', 'time', 'team1', 'team2', 'venue'],
        [(b, g, '11.22 SUN', t, ts[i], ts[j], v) for b, v, ts in BLOCKS for g, t, i, j in GAMES])
    put('program.csv', ['no', 'ja', 'en', 'kicker'], [(n, ja, en, 'OPENING CEREMONY') for n, ja, en in PROGRAM])
    put('closing.csv', ['no', 'ja', 'en', 'kicker'], [(n, ja, en, 'CLOSING CEREMONY') for n, ja, en in CLOSING])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--init', action='store_true'); ap.add_argument('--only', choices=['入場', '対戦', '進行', 'ゲスト', 'ロゴ'])
    ap.add_argument('--small', action='store_true', help='960x686 版（球場ビジョン左半分の枠）を output/960x686/ に作る。16:9 版は触らない')
    a = ap.parse_args(argv)
    if a.init: init_templates(); return 0
    import banners as B
    out_root = OUT_ROOT
    if a.small:
        import banners_960 as B
        out_root = os.path.join(OUT_ROOT, '960x686')
    tm = teams_map()
    def team(name, where):
        if name not in tm: raise DataError(f'{where}: チーム名「{name}」が teams.csv の display にありません（表記ゆれ？）。')
        return tm[name]
    made = []
    def save(img, sub, fname):
        d = os.path.join(out_root, sub); os.makedirs(d, exist_ok=True)
        p = os.path.join(d, fname); img.convert('RGB').save(p, optimize=True); made.append(os.path.relpath(p, D)); print('  ', made[-1])
    if a.only in (None, '入場'):
        print('■ 入場')
        for i, r in enumerate(read_csv('entrance.csv'), 2):
            o = int(r['order'])
            if r['team'] not in tm and (r.get('league') or '').strip():
                # 選手名簿のないチーム（招待チームなど）：リーグ名を entrance.csv の league 列に書けば、名簿なしで作る
                lg = r['league'].strip()
                t = dict(display=r['team'], league='' if lg == '-' else lg)      # 「-」ならリーグ名の行を出さない
            else:
                t = team(r['team'], f'entrance.csv {i}行目')
            save(B.entrance(o, t['display'], t['league']), '入場', f'{o:02d}_{safe(t["display"])}.png')
    if a.only in (None, '対戦'):
        print('■ 対戦')
        for i, r in enumerate(read_csv('matches.csv'), 2):
            t1 = team(r['team1'], f'matches.csv {i}行目'); t2 = team(r['team2'], f'matches.csv {i}行目')
            venue = (r.get('venue') or '').strip()
            if not venue: raise DataError(f'matches.csv {i}行目: venue（会場名）が空です。')
            img = B.matchup_big(f'{r["block"]}　{r["game"]}', f'{r["date"]} {r["time"]}', t1['display'], t1['league'],
                                t2['display'], t2['league'], venue)
            save(img, '対戦', f'{safe(r["block"])}{safe(r["game"])}_{safe(t1["display"])}_vs_{safe(t2["display"])}.png')
    if a.only in (None, '進行'):
        print('■ 進行')
        for r in read_csv('program.csv'):
            n = int(r['no'])
            save(B.program(n, r['ja'], r['en'], r['kicker'], footer_label=OPENING_FOOTER), '進行', f'{n:02d}_{safe(r["ja"])}.png')
        have = {r['ja'] for r in read_csv('program.csv')}
        for n, ja, en in EXTRA_PROGRAM:
            if ja not in have:
                save(B.program(n, ja, en, 'OPENING CEREMONY', footer_label=OPENING_FOOTER), '進行', f'{n:02d}_{safe(ja)}.png')
        print('■ 進行（閉会式）')
        for r in read_csv('closing.csv'):
            n = int(r['no'])
            save(B.program(n, r['ja'], r['en'], r['kicker'], footer_label=CLOSING_FOOTER), '進行_閉会式', f'{n:02d}_{safe(r["ja"])}.png')
    if a.only in (None, 'ゲスト') and a.small:
        # ゲスト・来賓の名前（input/guests.csv があればそれを使う。列：no,kicker,title,name,honor）
        rows = read_csv('guests.csv') if os.path.exists(os.path.join(IN, 'guests.csv')) else [dict(zip(['no', 'kicker', 'title', 'name', 'honor'], map(str, g))) for g in GUESTS]
        print('■ ゲスト・来賓')
        for r in rows:
            save(B.person(r['kicker'], r['title'], r['name'], r.get('honor', '様')), 'ゲスト', f'{int(r["no"]):02d}_{safe(r["name"])}.png')
        for no, kicker, people in GUEST_PAIRS:
            save(B.person2(kicker, people), 'ゲスト', f'{no:02d}_' + '_'.join(safe(n) for _, n in people) + '.png')
    if a.only in (None, 'ロゴ') and a.small:
        print('■ ロゴ（横長・2段 960x686）')
        for kind in ('horiz', 'stack'):
            for st in ('design', 'black'): save(B.logo_960(kind, st), 'ロゴ', f'L_960x686_{kind}_{st}.png')
    elif a.only in (None, 'ロゴ'):
        print('■ ロゴ（横長 32:9 と 16:9／2段 16:9）')
        for (w, h, tag) in ((3840, 1080, '32x9'), (1920, 1080, '16x9')):
            for st in ('design', 'black'): save(B.logo_banner(w, h, st), 'ロゴ', f'L_{tag}_{st}.png')
        for st in ('design', 'black'): save(B.stack_banner(st), 'ロゴ', f'L_16x9_stack_{st}.png')
    print(f'\n完了 {len(made)} 枚')
    return 0


if __name__ == '__main__':
    try: sys.exit(main())
    except DataError as e:
        print('!! 止めました:', e); sys.exit(1)
