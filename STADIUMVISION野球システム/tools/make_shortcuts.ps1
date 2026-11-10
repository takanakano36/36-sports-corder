# ==========================================================================
# スタジアムビジョン野球システム - デスクトップにショートカットを作る
#   このPCのデスクトップに「野球ビジョン 管理画面」「野球ビジョン HDMI出力」を作る
#   （別のPCで使うときも、このフォルダをコピーしてから1回実行すればよい）
# ==========================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$items = @(
    @{ Name = '野球ビジョン 管理画面'; Target = 'サーバー起動.bat'; Icon = "$env:SystemRoot\System32\shell32.dll,21"; Desc = '野球ビジョン(32:9)のサーバーを起動して、管理画面を開きます' },
    @{ Name = '野球ビジョン HDMI出力'; Target = 'HDMI出力.bat';     Icon = "$env:SystemRoot\System32\imageres.dll,190"; Desc = 'HDMIでつないだ2画面に、野球ビジョン(32:9)を全画面で表示します' }
)

Write-Host "デスクトップ：$desktop"
foreach ($it in $items) {
    $targetPath = Join-Path $root $it.Target
    if (-not (Test-Path $targetPath)) { throw "起動ファイルが見つかりません：$targetPath" }
    $lnkPath = Join-Path $desktop ($it.Name + '.lnk')

    # 同じ名前の別物のショートカットがある場合は、上書きせずに止める
    # （このフォルダの起動ファイルを指すものは、フォルダを移した後の作り直しとみなして上書きする）
    if (Test-Path $lnkPath) {
        $existing = $shell.CreateShortcut($lnkPath).TargetPath
        if ($existing -and (Split-Path -Leaf $existing) -ne $it.Target) {
            throw "デスクトップに同じ名前の別のショートカットがあります（$lnkPath → $existing）。名前を変えるか削除してから、もう一度実行してください。"
        }
    }

    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $targetPath
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = $it.Icon
    $lnk.Description = $it.Desc
    $lnk.Save()
    Write-Host "  作成しました：$($it.Name)"
}
