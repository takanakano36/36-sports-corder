@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.js
echo.
echo Server stopped. If Node.js is not installed, install it first: https://nodejs.org/
pause
