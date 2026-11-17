@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 選手スライドを全員分作ります（約200人で20分ほど）=====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_players.py
echo.
echo 作ったスライド: output\選手\チーム名\
echo 確認リスト: output\確認_選手スライド.csv （写真なし・候補・拡大・背景が甘そう、など）
pause
