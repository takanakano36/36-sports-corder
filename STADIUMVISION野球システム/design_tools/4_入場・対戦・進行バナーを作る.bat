@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 入場・対戦・進行バナーを、一覧CSVから作ります =====
if not exist input\entrance.csv (
  "%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_banners.py --init
  echo.
  echo 一覧のひな形を input フォルダに作りました。中身は仮です。
  echo input の entrance.csv / matches.csv / program.csv を確かめて直してから、もう一度このファイルを押してください。
  pause
  exit /b
)
"%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_banners.py
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
  pause
  exit /b 1
)
echo.
echo ===== 球場ビジョン用（960x686）を作ります =====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" bulk_banners.py --small
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
  pause
  exit /b 1
)
"%USERPROFILE%\mlb-venv\Scripts\python.exe" banners_band.py
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
echo 作ったバナー: output\入場\  output\対戦\  output\進行\  output\1920x686\全面\（14:5 全面）  ・ ビジョン用 output\960x686\（slides にも入りました）
pause