"""1人だけ作り直す（当日の写真差し替え用）。チーム名の一部と背番号を聞いて、その1人のスライドだけ作り直す。"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from roster_build import DataError
import bulk_players

if __name__ == '__main__':
    team = input('チーム名（一部でよい。例: 稲沢）: ').strip('﻿ 　')
    no = input('背番号（例: 4）: ').strip('﻿ 　')
    if not team or not no:
        print('チーム名と背番号の両方が必要です。'); sys.exit(1)
    try: sys.exit(bulk_players.main(['--team', team, '--no', no]))
    except DataError as e:
        print('!! 止めました:', e); sys.exit(1)
