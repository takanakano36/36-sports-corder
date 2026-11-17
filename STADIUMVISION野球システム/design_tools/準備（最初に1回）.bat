@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ===== 一括作成ツールの準備（最初の1回だけ。通信が必要です）=====
set "VENV=%USERPROFILE%\mlb-venv"
if not exist "%VENV%\Scripts\python.exe" python -m venv "%VENV%"
"%VENV%\Scripts\python.exe" -m pip install "rembg[cpu]" "opencv-python-headless<5" pillow pillow-heif numpy openpyxl
if not exist models mkdir models
if not exist models\yunet.onnx powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' -OutFile 'models\yunet.onnx'"
echo.
echo 準備が終わりました。つぎは「手順書」を見て、input\settings.json を作ってください。
pause
