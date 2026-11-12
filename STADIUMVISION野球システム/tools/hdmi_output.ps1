# ==========================================================================
# スタジアムビジョン野球システム - HDMI出力（32:9 = フルHD 2画面）
#   1. サーバーが動いていなければ起動する
#   2. ビジョン用の画面（主画面以外）を探す
#        ・1台              → その画面に「全体」(3840×1080) を出す（ビジョンへHDMI 1本。いちばん普通の形）
#        ・2台              → 左の画面に「左半分」、右の画面に「右半分」を出す（HDMI 2本の場合）
#        ・3台以上          → どう出すかを番号で選ぶ
#      ※ 管理画面の設定タブで「SDI 1本（1920×1080 の帯）」にしているときは、左右に分けず、
#        1つの画面に 1920×1080 で出す（ビジョンの画面が2台以上あるときは番号で選ぶ）
#   3. Microsoft Edge のキオスクモードで、それぞれ全画面で開く
#   -DryRun を付けると、実際には開かずに「どの画面に出すか」だけを表示する（確認用）
#   ※ 「STADIUMVISION得点板システム」の HDMI出力 をもとに、2画面出力に対応させたもの
# ==========================================================================
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$base = 'http://localhost:3007'
# 普段使いのEdgeと混ざらないよう、野球ビジョン専用の設定フォルダで開く（左・右・全体で別々）
$profileBase = Join-Path $env:LOCALAPPDATA 'StadiumVisionBaseball'

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
Write-Host ' スタジアムビジョン野球（32:9）  HDMI出力'
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

# 出力の形（管理画面の設定タブ）：wide = 32:9 ／ sdi = SDI 1本（1920×1080 の帯）
$outMode = 'wide'
try {
    $st = Invoke-RestMethod "$base/api/state" -TimeoutSec 2
    if ($st.output -and $st.output.mode -eq 'sdi') { $outMode = 'sdi' }
} catch { }
if ($outMode -eq 'sdi') {
    Write-Host '出力の形：SDI 1本（1920×1080。ビジョンに映る帯だけを使う）' -ForegroundColor Cyan
} else {
    Write-Host '出力の形：32:9（3840×1080）'
}

# --------------------------------------------------------------------------
# 2. どの画面に、どう出すかを決める
# --------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens)
$others = @($screens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X })

function Format-Screen($s) { '{0}x{1}（位置 {2},{3}）' -f $s.Bounds.Width, $s.Bounds.Height, $s.Bounds.X, $s.Bounds.Y }
function Is-Wide($s) { [math]::Abs($s.Bounds.Width / $s.Bounds.Height - 32 / 9) -le 0.05 }
function Is-169($s) { [math]::Abs($s.Bounds.Width / $s.Bounds.Height - 16 / 9) -le 0.02 }
function Is-FHD($s) { $s.Bounds.Width -eq 1920 -and $s.Bounds.Height -eq 1080 }

function Read-Number([string]$prompt, [int]$max) {
    $n = Read-Host $prompt
    if ($n -notmatch '^\d+$' -or [int]$n -lt 1 -or [int]$n -gt $max) { Stop-WithError "番号が正しくありません（$n）" }
    return [int]$n
}

# 出すもの：@{ View = 'left' | 'right' | 'all'; Screen = 画面 }
$plan = @()

if ($others.Count -eq 0) {
    Write-Host ''
    Write-Host 'ビジョン用の画面（2台目以降の画面）が見つかりません。次を確認してください。' -ForegroundColor Yellow
    Write-Host '  ・HDMIケーブルがPCとビジョン（またはスイッチャー）につながっているか'
    Write-Host '  ・Windowsの「設定」→「ディスプレイ」で「表示画面を拡張する」になっているか'
    $ans = Read-Host '確認のため、いまの画面に全体を表示しますか？（Y = 表示する ／ それ以外 = やめる）'
    if ($ans -notmatch '^[Yy]$') { exit 1 }
    $plan += @{ View = 'all'; Screen = ($screens | Where-Object { $_.Primary }) }
} elseif ($outMode -eq 'sdi') {
    # SDI 1本：左右に分けず、1つの画面に 1920×1080 で出す
    if ($others.Count -eq 1) {
        $plan += @{ View = 'all'; Screen = $others[0] }
    } else {
        Write-Host ''
        Write-Host 'SDIコンバーターにつないだ画面の番号を選んでください。見つかった画面：'
        for ($i = 0; $i -lt $others.Count; $i++) { Write-Host ('  {0} : {1}' -f ($i + 1), (Format-Screen $others[$i])) }
        $n = Read-Number '番号' $others.Count
        $plan += @{ View = 'all'; Screen = $others[$n - 1] }
    }
} elseif ($others.Count -eq 1) {
    # ビジョンへHDMI 1本（3840×1080）
    $plan += @{ View = 'all'; Screen = $others[0] }
} elseif ($others.Count -eq 2) {
    # 左にある画面に左半分、右にある画面に右半分
    $plan += @{ View = 'left'; Screen = $others[0] }
    $plan += @{ View = 'right'; Screen = $others[1] }
} else {
    Write-Host ''
    Write-Host 'ビジョン用の画面の組み合わせを選んでください。見つかった画面：'
    for ($i = 0; $i -lt $others.Count; $i++) { Write-Host ('  {0} : {1}' -f ($i + 1), (Format-Screen $others[$i])) }
    Write-Host ''
    Write-Host '  1 : 左半分と右半分を、別々の画面に出す（HDMI 2本）'
    Write-Host '  2 : 1つの画面に全体（32:9）を出す'
    Write-Host '  3 : 1つの画面に左半分だけを出す'
    Write-Host '  4 : 1つの画面に右半分だけを出す'
    $mode = Read-Number '番号' 4
    if ($mode -eq 1) {
        if ($others.Count -lt 2) { Stop-WithError '画面が1台しかないため、左右を別々には出せません。' }
        $l = Read-Number '左半分を出す画面の番号' $others.Count
        $r = Read-Number '右半分を出す画面の番号' $others.Count
        if ($l -eq $r) { Stop-WithError '左と右に同じ画面は選べません。' }
        $plan += @{ View = 'left'; Screen = $others[$l - 1] }
        $plan += @{ View = 'right'; Screen = $others[$r - 1] }
    } else {
        $n = if ($others.Count -eq 1) { 1 } else { Read-Number '出す画面の番号' $others.Count }
        $view = @{ 2 = 'all'; 3 = 'left'; 4 = 'right' }[$mode]
        $plan += @{ View = $view; Screen = $others[$n - 1] }
    }
}

$viewLabel = @{ left = '左半分（0〜1919）'; right = '右半分（1920〜3839）'; all = '全体（3840×1080）' }
if ($outMode -eq 'sdi') { $viewLabel.all = '全体（1920×1080・SDI）' }
foreach ($p in $plan) {
    Write-Host ('{0} → {1}' -f $viewLabel[$p.View], (Format-Screen $p.Screen))
    if ($outMode -eq 'sdi') {
        if (-not (Is-FHD $p.Screen)) {
            Write-Host '  ※この画面は 1920×1080 ではありません。ビジョンに出る位置がずれます。' -ForegroundColor Yellow
            Write-Host '    Windowsの「設定」→「ディスプレイ」で 1920×1080・拡大縮小100% にし、' -ForegroundColor Yellow
            Write-Host '    SDIコンバーター（CRO-H2SC）の EDID を「0（SDI OUT）」か「5（1920×1080）」にしてください。' -ForegroundColor Yellow
        }
        continue
    }
    if ($p.View -ne 'all' -and -not (Is-169 $p.Screen)) {
        Write-Host '  ※この画面は16:9ではありません。上下または左右に黒い余白が付きます。Windowsの表示設定で 1920×1080 にしてください。' -ForegroundColor Yellow
    }
    if ($p.View -eq 'all' -and -not (Is-Wide $p.Screen)) {
        Write-Host '  ※この画面は32:9ではないため、上下に黒い余白が付いて小さく表示されます。' -ForegroundColor Yellow
        Write-Host '    Windowsの「設定」→「ディスプレイ」で、ビジョンの画面の解像度を 3840×1080 にしてください。' -ForegroundColor Yellow
        Write-Host '    一覧に 3840×1080 が無いときは、グラフィックの設定（NVIDIA コントロールパネル等）の「カスタム解像度」で作ります。' -ForegroundColor Yellow
    }
}

# --------------------------------------------------------------------------
# 3. Edge で全画面表示
# --------------------------------------------------------------------------
$edge = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edge -or -not (Test-Path $edge)) { Stop-WithError 'Microsoft Edge が見つかりません。' }

function Get-EdgeArgs($p) {
    $x = $p.Screen.Bounds.X + 50
    $y = $p.Screen.Bounds.Y + 50
    return @(
        "--user-data-dir=`"$(Join-Path $profileBase $p.View)`"",
        '--kiosk', "$base/vision.html?view=$($p.View)",
        '--edge-kiosk-type=fullscreen',
        "--window-position=$x,$y",
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        # キオスクモードでは許可のボタンを押せないため、カメラ（キャプチャーボード）の使用を自動で許可する
        # （このビジョン専用の設定フォルダで開いたEdgeだけに効く。普段使いのEdgeには影響しない）
        '--use-fake-ui-for-media-stream',
        # 他のウィンドウに隠れたと判定されても、動画の再生や画面の更新を止めない
        '--disable-background-media-suspend',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    )
}

if ($DryRun) {
    Write-Host ''
    Write-Host '（確認モード）実際には開きません。起動する内容：'
    foreach ($p in $plan) { Write-Host "  $edge $((Get-EdgeArgs $p) -join ' ')" }
    exit 0
}

# すでに開いている出力ウィンドウ（野球ビジョン専用の設定フォルダのEdge）だけを閉じてから開き直す
$old = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*$profileBase*" })
if ($old.Count -gt 0) {
    Write-Host '前に開いた出力ウィンドウを閉じて、開き直します...'
    foreach ($p in $old) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { <# 親を閉じた時点で一緒に終わった子プロセスは対象外 #> }
    }
    Start-Sleep -Seconds 1
}

foreach ($p in $plan) {
    Start-Process -FilePath $edge -ArgumentList (Get-EdgeArgs $p)
    Start-Sleep -Milliseconds 800
}
Write-Host ''
Write-Host 'ビジョンの表示を全画面で開きました。' -ForegroundColor Green
Write-Host '  ・表示を終わるとき：それぞれの画面をクリックして Alt + F4'
Write-Host '  ・もう一度出すとき：デスクトップの「野球ビジョン HDMI出力」をダブルクリック'
Start-Sleep -Seconds 4
