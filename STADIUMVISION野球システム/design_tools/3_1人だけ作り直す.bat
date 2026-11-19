@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 1人だけ作り直します（写真を差し替えたあとなど）=====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" remake_one.py
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
pause
