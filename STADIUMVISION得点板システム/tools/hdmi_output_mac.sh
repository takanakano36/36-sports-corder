#!/bin/bash
# ==========================================================================
# スタジアムビジョン得点板 - HDMI出力（Mac用。OBSを通さず、2台目の画面に全画面で表示）
#   1. サーバーが動いていなければ起動する
#   2. HDMIでつないだ画面（主画面以外）を探す
#   3. Google Chrome（なければ Microsoft Edge）で表示画面を、その画面に全画面で開く
#   --dry-run を付けると、実際には開かずに「どの画面に出すか」だけを表示する（確認用）
# ==========================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE='http://localhost:3006'
OUTPUT_URL="$BASE/scoreboard.html"
# 普段使いのブラウザと混ざらないよう、得点板専用の設定フォルダで開く
PROFILE_DIR="$HOME/Library/Application Support/StadiumVisionScoreboard/BrowserKiosk"
DRY_RUN=0
[ "${1:-}" = '--dry-run' ] && DRY_RUN=1

stop_with_error() {
    echo
    echo "[エラー] $1"
    echo
    read -r -p 'Enterキーを押すと閉じます' _
    exit 1
}

test_server() {
    [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$BASE/api/state")" = '200' ]
}

echo '======================================================'
echo ' スタジアムビジョン得点板  HDMI出力（Mac）'
echo '======================================================'

# --------------------------------------------------------------------------
# 1. サーバー
# --------------------------------------------------------------------------
if test_server; then
    echo 'サーバー：起動しています'
elif [ "$DRY_RUN" = 1 ]; then
    echo 'サーバー：起動していません（確認モードのため起動しません）'
else
    echo 'サーバー：起動します...'
    open -a Terminal "$ROOT/サーバー起動（Mac）.command" || stop_with_error 'サーバーの起動ファイルを開けませんでした。'
    ok=0
    for _ in $(seq 1 30); do
        sleep 0.5
        if test_server; then ok=1; break; fi
    done
    [ "$ok" = 1 ] || stop_with_error 'サーバーを起動できませんでした。もう1つのターミナルの画面に出ているメッセージを確認してください。'
    echo 'サーバー：起動しました'
fi

# --------------------------------------------------------------------------
# 2. 表示する画面を決める
#   macOSから画面の一覧を受け取る（1行＝1画面：横位置 縦位置 幅 高さ 名前、1行目が主画面）
#   位置は、主画面の左上を 0,0 とした値に直して受け取る（ブラウザの位置指定と同じ基準）
# --------------------------------------------------------------------------
SCREENS="$(osascript -l JavaScript -e '
ObjC.import("AppKit");
var list = $.NSScreen.screens;
var mainH = list.objectAtIndex(0).frame.size.height;
var out = [];
for (var i = 0; i < list.count; i++) {
    var s = list.objectAtIndex(i), f = s.frame;
    out.push([Math.round(f.origin.x), Math.round(mainH - f.origin.y - f.size.height),
              Math.round(f.size.width), Math.round(f.size.height), ObjC.unwrap(s.localizedName)].join("\t"));
}
out.join("\n");
')" || stop_with_error '画面の一覧を取得できませんでした。'
[ -n "$SCREENS" ] || stop_with_error '画面の一覧が空でした。'

MAIN_LINE="$(printf '%s\n' "$SCREENS" | head -n 1)"
OTHER_LINES=()
while IFS= read -r line; do
    [ -n "$line" ] && OTHER_LINES+=("$line")
done < <(printf '%s\n' "$SCREENS" | tail -n +2)

format_screen() {
    local x y w h name
    IFS=$'\t' read -r x y w h name <<< "$1"
    echo "${name}  ${w}x${h}（位置 ${x},${y}）"
}

if [ "${#OTHER_LINES[@]}" -eq 0 ]; then
    echo
    echo 'HDMIの画面（2台目の画面）が見つかりません。次を確認してください。'
    echo '  ・HDMIケーブルがMacとスイッチャーにつながっているか'
    echo '  ・「システム設定」→「ディスプレイ」で、HDMIの画面が「ミラーリング」ではなく「拡張ディスプレイ」になっているか'
    read -r -p '確認のため、いまの画面に表示しますか？（Y = 表示する ／ それ以外 = やめる）' ans
    case "$ans" in [Yy]) TARGET="$MAIN_LINE" ;; *) exit 1 ;; esac
elif [ "${#OTHER_LINES[@]}" -eq 1 ]; then
    TARGET="${OTHER_LINES[0]}"
else
    echo
    echo '主画面以外の画面が複数あります。得点板を出す画面の番号を選んでください。'
    for i in "${!OTHER_LINES[@]}"; do
        echo "  $((i + 1)) : $(format_screen "${OTHER_LINES[$i]}")"
    done
    read -r -p '番号：' n
    if ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 1 ] || [ "$n" -gt "${#OTHER_LINES[@]}" ]; then
        stop_with_error "番号が正しくありません（$n）"
    fi
    TARGET="${OTHER_LINES[$((n - 1))]}"
fi

IFS=$'\t' read -r TX TY TW TH _ <<< "$TARGET"
echo "表示する画面：$(format_screen "$TARGET")"
# 16:9（1.778）から外れているかを確かめる（Windows版と同じく、差が0.02より大きければ注意を出す）
if ! awk -v w="$TW" -v h="$TH" 'BEGIN { d = w / h - 16 / 9; if (d < 0) d = -d; exit (d > 0.02) }'; then
    echo '  ※この画面は16:9ではありません。得点板の上下または左右に黒い余白が付きます。'
    echo '    スイッチャーへ出すときは、「システム設定」→「ディスプレイ」でこの画面を 1920×1080 にしてください。'
fi

# --------------------------------------------------------------------------
# 3. ブラウザで全画面表示
# --------------------------------------------------------------------------
BROWSER=''
BROWSER_NAME=''
for app in '/Applications/Google Chrome.app' "$HOME/Applications/Google Chrome.app" \
           '/Applications/Microsoft Edge.app' "$HOME/Applications/Microsoft Edge.app"; do
    if [ -d "$app" ]; then
        BROWSER="$app"
        BROWSER_NAME="$(basename "$app" .app)"
        break
    fi
done
[ -n "$BROWSER" ] || stop_with_error 'Google Chrome が見つかりません。https://www.google.com/chrome/ から入れてください（Safariでは全画面の自動表示ができません）。'

# ブラウザの「キオスクモード」（案内板用の表示方式）で開く
#  ・最初から全画面、メニューやアドレス欄なし
#  ・選んだ画面の中にウィンドウの位置を指定すると、その画面で全画面になる
ARGS=(
    "--user-data-dir=$PROFILE_DIR"
    '--kiosk' "$OUTPUT_URL"
    "--window-position=$((TX + 50)),$((TY + 50))"
    '--no-first-run'
    '--no-default-browser-check'
    # 専用の設定フォルダで開いたときに「キーチェーン」のパスワードを聞かれないようにする
    '--use-mock-keychain'
    # 演出動画に音が入っている場合も、操作なしで音付きのまま自動再生できるようにする
    '--autoplay-policy=no-user-gesture-required'
    # 他のウィンドウに隠れたと判定されても、動画の再生や画面の更新を止めない
    '--disable-background-media-suspend'
    '--disable-backgrounding-occluded-windows'
    '--disable-renderer-backgrounding'
)

if [ "$DRY_RUN" = 1 ]; then
    echo
    echo '（確認モード）実際には開きません。起動する内容：'
    echo "  open -na \"$BROWSER\" --args ${ARGS[*]}"
    exit 0
fi

# すでに開いている得点板の出力ウィンドウ（得点板専用の設定フォルダのブラウザ）だけを閉じてから開き直す
if pgrep -f -- "--user-data-dir=$PROFILE_DIR" > /dev/null; then
    echo '前に開いた出力ウィンドウを閉じて、開き直します...'
    pkill -f -- "--user-data-dir=$PROFILE_DIR"
    sleep 1
fi

mkdir -p "$PROFILE_DIR" || stop_with_error "設定フォルダを作れませんでした：$PROFILE_DIR"
# -n：普段使いのブラウザが開いていても、別のウィンドウとして新しく起動する
open -na "$BROWSER" --args "${ARGS[@]}" || stop_with_error "$BROWSER_NAME を起動できませんでした。"

echo
echo "得点板を全画面で表示しました（$BROWSER_NAME）。"
echo '  ・表示を終わるとき：その画面をクリックして ⌘（command）＋ Q'
echo '  ・もう一度出すとき：デスクトップの「得点板 HDMI出力」をダブルクリック'
sleep 4
