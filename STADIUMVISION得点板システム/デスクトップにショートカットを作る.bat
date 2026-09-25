@echo off
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make_shortcuts.ps1"
echo.
pause
