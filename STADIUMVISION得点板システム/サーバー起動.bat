@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ======================================================
echo  スタジアムビジョン得点板のサーバーを起動しています...
echo  準備ができると、管理画面が自動でブラウザに開きます。
echo  この黒い画面は、試合が終わるまで閉じずにそのままにしてください。
echo ======================================================
where node > nul 2> nul
if errorlevel 1 (
    echo.
    echo [エラー] このPCには Node.js が入っていないため、起動できません。
    echo         https://nodejs.org/ja から「LTS」版を入れてから、もう一度起動してください。
    echo.
    pause
    exit /b 1
)
node server.js --open
pause
