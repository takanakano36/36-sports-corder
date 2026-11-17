@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 1人だけ作り直します（写真を差し替えたあとなど）=====
"%USERPROFILE%\mlb-venv\Scripts\python.exe" remake_one.py
pause
