# ==========================================================================
# スタジアムビジョン得点板 - HDMI出力（OBSを通さず、2台目の画面に全画面で表示）
#   1. サーバーが動いていなければ起動する
#   2. HDMIでつないだ画面（主画面以外）を探す
#   3. Microsoft Edge で表示画面を、その画面に全画面で開く
#   -DryRun を付けると、実際には開かずに「どの画面に出すか」だけを表示する（確認用）
# ==========================================================================
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$base = 'http://localhost:3006'
$outputUrl = "$base/scoreboard.html"
# 普段使いのEdgeと混ざらないよう、得点板専用の設定フォルダで開く
$profileDir = Join-Path $env:LOCALAPPDATA 'StadiumVisionScoreboard\EdgeKiosk'

function Stop-WithError([string]$msg) {
    Write-Host ''
    Write-Host "[エラー] $msg" -ForegroundColor Red
    Write-Host ''
    Read-Host 'Enterキーを押すと閉じます' | Out-Null
    exit 1
}

function Test-Server {
    try {
        return (Invoke-WebRequest "$base/api/state" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
    } catch {
        return $false
    }
}

Write-Host '======================================================'
Write-Host ' スタジアムビジョン得点板  HDMI出力'
Write-Host '======================================================'

# --------------------------------------------------------------------------
# 1. サーバー
# --------------------------------------------------------------------------
if (Test-Server) {
    Write-Host 'サーバー：起動しています'
} elseif ($DryRun) {
    Write-Host 'サーバー：起動していません（確認モードのため起動しません）'
} else {
    Write-Host 'サーバー：起動します...'
    Start-Process -FilePath (Join-Path $root 'サーバー起動.bat') -WorkingDirectory $root
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Server) { $ok = $true; break }
    }
    if (-not $ok) { Stop-WithError 'サーバーを起動できませんでした。もう1つの黒い画面に出ているメッセージを確認してください。' }
    Write-Host 'サーバー：起動しました'
}

# --------------------------------------------------------------------------
# 2. 表示する画面を決める
# --------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens)
$others = @($screens | Where-Object { -not $_.Primary })

function Format-Screen($s) { '{0}x{1}（位置 {2},{3}）' -f $s.Bounds.Width, $s.Bounds.Height, $s.Bounds.X, $s.Bounds.Y }

if ($others.Count -eq 0) {
    Write-Host ''
    Write-Host 'HDMIの画面（2台目の画面）が見つかりません。次を確認してください。' -ForegroundColor Yellow
    Write-Host '  ・HDMIケーブルがPCとスイッチャーにつながっているか'
    Write-Host '  ・Windowsの「設定」→「ディスプレイ」で「表示画面を拡張する」になっているか'
    $ans = Read-Host '確認のため、いまの画面に表示しますか？（Y = 表示する ／ それ以外 = やめる）'
    if ($ans -notmatch '^[Yy]$') { exit 1 }
    $target = $screens | Where-Object { $_.Primary }
} elseif ($others.Count -eq 1) {
    $target = $others[0]
} else {
    Write-Host ''
    Write-Host '主画面以外の画面が複数あります。得点板を出す画面の番号を選んでください。'
    for ($i = 0; $i -lt $others.Count; $i++) { Write-Host ('  {0} : {1}' -f ($i + 1), (Format-Screen $others[$i])) }
    $n = Read-Host '番号'
    if ($n -notmatch '^\d+$' -or [int]$n -lt 1 -or [int]$n -gt $others.Count) { Stop-WithError "番号が正しくありません（$n）" }
    $target = $others[[int]$n - 1]
}

Write-Host ('表示する画面：{0}' -f (Format-Screen $target))
$ratio = $target.Bounds.Width / $target.Bounds.Height
if ([math]::Abs($ratio - 16 / 9) -gt 0.02) {
    Write-Host '  ※この画面は16:9ではありません。得点板の上下または左右に黒い余白が付きます。' -ForegroundColor Yellow
    Write-Host '    スイッチャーへ出すときは、Windowsの表示設定でこの画面を 1920×1080 にしてください。' -ForegroundColor Yellow
}

# --------------------------------------------------------------------------
# 3. Edge で全画面表示
# --------------------------------------------------------------------------
$edge = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edge -or -not (Test-Path $edge)) { Stop-WithError 'Microsoft Edge が見つかりません。' }

# Edgeの「キオスクモード」（案内板用の表示方式）で開く
#  ・最初から全画面、メニューやアドレス欄なし
#  ・InPrivateで開くため、Windowsアカウントへの自動サインインや拡張機能のページが出ない
#  ・選んだ画面の中にウィンドウの位置を指定すると、その画面で全画面になる
$x = $target.Bounds.X + 50
$y = $target.Bounds.Y + 50
$edgeArgs = @(
    "--user-data-dir=`"$profileDir`"",
    "--kiosk", $outputUrl,
    '--edge-kiosk-type=fullscreen',
    "--window-position=$x,$y",
    '--no-first-run',
    '--no-default-browser-check',
    # 演出動画に音が入っている場合も、操作なしで音付きのまま自動再生できるようにする
    '--autoplay-policy=no-user-gesture-required',
    # 他のウィンドウに隠れたと判定されても、動画の再生や画面の更新を止めない
    '--disable-background-media-suspend',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
)

if ($DryRun) {
    Write-Host ''
    Write-Host '（確認モード）実際には開きません。起動する内容：'
    Write-Host "  $edge $($edgeArgs -join ' ')"
    exit 0
}

# すでに開いている得点板の出力ウィンドウ（得点板専用の設定フォルダのEdge）だけを閉じてから開き直す
$old = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*$profileDir*" })
if ($old.Count -gt 0) {
    Write-Host '前に開いた出力ウィンドウを閉じて、開き直します...'
    foreach ($p in $old) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { <# 親を閉じた時点で一緒に終わった子プロセスは対象外 #> }
    }
    Start-Sleep -Seconds 1
}

Start-Process -FilePath $edge -ArgumentList $edgeArgs
Write-Host ''
Write-Host '得点板を全画面で表示しました。' -ForegroundColor Green
Write-Host '  ・表示を終わるとき：その画面をクリックして Alt + F4'
Write-Host '  ・もう一度出すとき：デスクトップの「得点板 HDMI出力」をダブルクリック'
Start-Sleep -Seconds 4
