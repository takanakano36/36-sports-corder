@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 選手登録フォーム(xlsx) から選手一覧を作ります =====
echo ※ 選手登録フォームをExcelで開いている場合は、先に閉じてください。
"%USERPROFILE%\mlb-venv\Scripts\python.exe" roster_build.py
echo.
echo 確認リスト: output\確認_選手データ.csv を開いて、「要確認」「変換」を見てください。
pause
