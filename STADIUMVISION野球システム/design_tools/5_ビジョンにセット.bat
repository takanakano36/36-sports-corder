@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 作ったスライドを、ビジョンの slides フォルダへ入れ替えます（作り直しはしません） =====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" sync_to_slides.py
if errorlevel 1 (
  echo.
  echo 途中でエラーになりました。上の文字を読んでから、何かキーを押してください。
)
pause
