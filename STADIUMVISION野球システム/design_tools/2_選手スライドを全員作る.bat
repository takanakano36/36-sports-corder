@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 選手スライドを全員分作ります（約200人で20分ほど）=====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_players.py
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
  pause
  exit /b 1
)
echo.
echo ===== 球場ビジョン用（960x686）も作ります =====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_players.py --small
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
  pause
  exit /b 1
)
echo.
echo ===== ビジョンの slides フォルダへ入れ替えます =====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" sync_to_slides.py
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
  pause
  exit /b 1
)
echo.
echo 作ったスライド: output\選手\チーム名\ ・ output\960x686\選手\（ビジョン用。slides\選手\ にも入りました）
echo 確認リスト: output\確認_選手スライド.csv （写真なし・候補・拡大・背景が甘そう、など）
pause
