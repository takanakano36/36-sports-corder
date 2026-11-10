#!/bin/bash
# ==========================================================================
# スタジアムビジョン野球システム - HDMI出力（Mac用。32:9 = フルHD 2画面）
#   1. サーバーが動いていなければ起動する
#   2. ビジョン用の画面（主画面以外）を探す
#        ・1台            → その画面に「全体」(3840×1080)（ビジョンへHDMI 1本。いちばん普通の形）
#        ・2台            → 左の画面に「左半分」、右の画面に「右半分」（HDMI 2本の場合）
#        ・3台以上        → どう出すかを番号で選ぶ
#   3. Google Chrome（なければ Microsoft Edge）で、それぞれ全画面で開く
#   --dry-run を付けると、実際には開かずに「どの画面に出すか」だけを表示する（確認用）
# ==========================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE='http://localhost:3007'
# 普段使いのブラウザと混ざらないよう、野球ビジョン専用の設定フォルダで開く（左・右・全体で別々）
PROFILE_BASE="$HOME/Library/Application Support/StadiumVisionBaseball"
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
echo ' スタジアムビジョン野球（32:9）  HDMI出力（Mac）'
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
# 主画面以外を、左にある順に並べる
OTHER_LINES=()
while IFS= read -r line; do
    [ -n "$line" ] && OTHER_LINES+=("$line")
done < <(printf '%s\n' "$SCREENS" | tail -n +2 | sort -t $'\t' -k1,1n)

format_screen() {
    local x y w h name
    IFS=$'\t' read -r x y w h name <<< "$1"
    echo "${name}  ${w}x${h}（位置 ${x},${y}）"
}
# 比率が 32:9 か（差が0.05以内）
is_wide() {
    local x y w h name
    IFS=$'\t' read -r x y w h name <<< "$1"
    awk -v w="$w" -v h="$h" 'BEGIN { d = w / h - 32 / 9; if (d < 0) d = -d; exit (d > 0.05) }'
}
read_number() {
    local n
    read -r -p "$1" n
    if ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 1 ] || [ "$n" -gt "$2" ]; then
        stop_with_error "番号が正しくありません（$n）"
    fi
    echo "$n"
}

# 出すもの（1行＝「left / right / all」と画面）
PLAN_VIEWS=()
PLAN_SCREENS=()
add_plan() { PLAN_VIEWS+=("$1"); PLAN_SCREENS+=("$2"); }

COUNT="${#OTHER_LINES[@]}"
if [ "$COUNT" -eq 0 ]; then
    echo
    echo 'ビジョン用の画面（2台目以降の画面）が見つかりません。次を確認してください。'
    echo '  ・HDMIケーブルがMacとビジョン（またはスイッチャー）につながっているか'
    echo '  ・「システム設定」→「ディスプレイ」で、「ミラーリング」ではなく「拡張ディスプレイ」になっているか'
    read -r -p '確認のため、いまの画面に全体（32:9）を表示しますか？（Y = 表示する ／ それ以外 = やめる）' ans
    case "$ans" in [Yy]) add_plan all "$MAIN_LINE" ;; *) exit 1 ;; esac
elif [ "$COUNT" -eq 1 ]; then
    add_plan all "${OTHER_LINES[0]}"
elif [ "$COUNT" -eq 2 ]; then
    add_plan left "${OTHER_LINES[0]}"
    add_plan right "${OTHER_LINES[1]}"
else
    echo
    echo 'ビジョン用の画面の組み合わせを選んでください。見つかった画面：'
    for i in "${!OTHER_LINES[@]}"; do
        echo "  $((i + 1)) : $(format_screen "${OTHER_LINES[$i]}")"
    done
    echo
    echo '  1 : 左半分と右半分を、別々の画面に出す（HDMI 2本）'
    echo '  2 : 1つの画面に全体（32:9）を出す'
    echo '  3 : 1つの画面に左半分だけを出す'
    echo '  4 : 1つの画面に右半分だけを出す'
    mode="$(read_number '番号：' 4)"
    if [ "$mode" = 1 ]; then
        [ "$COUNT" -ge 2 ] || stop_with_error '画面が1台しかないため、左右を別々には出せません。'
        l="$(read_number '左半分を出す画面の番号：' "$COUNT")"
        r="$(read_number '右半分を出す画面の番号：' "$COUNT")"
        [ "$l" != "$r" ] || stop_with_error '左と右に同じ画面は選べません。'
        add_plan left "${OTHER_LINES[$((l - 1))]}"
        add_plan right "${OTHER_LINES[$((r - 1))]}"
    else
        if [ "$COUNT" -eq 1 ]; then n=1; else n="$(read_number '出す画面の番号：' "$COUNT")"; fi
        case "$mode" in 2) v=all ;; 3) v=left ;; *) v=right ;; esac
        add_plan "$v" "${OTHER_LINES[$((n - 1))]}"
    fi
fi

for i in "${!PLAN_VIEWS[@]}"; do
    case "${PLAN_VIEWS[$i]}" in left) lbl='左半分（0〜1919）' ;; right) lbl='右半分（1920〜3839）' ;; *) lbl='全体（3840×1080）' ;; esac
    echo "$lbl → $(format_screen "${PLAN_SCREENS[$i]}")"
    if [ "${PLAN_VIEWS[$i]}" = all ] && ! is_wide "${PLAN_SCREENS[$i]}"; then
        echo '  ※この画面は32:9ではないため、上下に黒い余白が付いて小さく表示されます。'
        echo '    「システム設定」→「ディスプレイ」で、ビジョンの画面を 3840×1080 にしてください。'
    fi
done

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

browser_args() {
    local view="$1" x y w h name
    IFS=$'\t' read -r x y w h name <<< "$2"
    ARGS=(
        "--user-data-dir=$PROFILE_BASE/$view"
        '--kiosk' "$BASE/vision.html?view=$view"
        "--window-position=$((x + 50)),$((y + 50))"
        '--no-first-run'
        '--no-default-browser-check'
        # 専用の設定フォルダで開いたときに「キーチェーン」のパスワードを聞かれないようにする
        '--use-mock-keychain'
        '--autoplay-policy=no-user-gesture-required'
        # キオスクモードでは許可のボタンを押せないため、カメラ（キャプチャーボード）の使用を自動で許可する
        # （この専用の設定フォルダで開いたブラウザだけに効く）
        '--use-fake-ui-for-media-stream'
        # 他のウィンドウに隠れたと判定されても、動画の再生や画面の更新を止めない
        '--disable-background-media-suspend'
        '--disable-backgrounding-occluded-windows'
        '--disable-renderer-backgrounding'
    )
}

if [ "$DRY_RUN" = 1 ]; then
    echo
    echo '（確認モード）実際には開きません。起動する内容：'
    for i in "${!PLAN_VIEWS[@]}"; do
        browser_args "${PLAN_VIEWS[$i]}" "${PLAN_SCREENS[$i]}"
        echo "  open -na \"$BROWSER\" --args ${ARGS[*]}"
    done
    exit 0
fi

# すでに開いている出力ウィンドウ（野球ビジョン専用の設定フォルダのブラウザ）だけを閉じてから開き直す
if pgrep -f -- "--user-data-dir=$PROFILE_BASE/" > /dev/null; then
    echo '前に開いた出力ウィンドウを閉じて、開き直します...'
    pkill -f -- "--user-data-dir=$PROFILE_BASE/"
    sleep 1
fi

for i in "${!PLAN_VIEWS[@]}"; do
    browser_args "${PLAN_VIEWS[$i]}" "${PLAN_SCREENS[$i]}"
    mkdir -p "$PROFILE_BASE/${PLAN_VIEWS[$i]}" || stop_with_error "設定フォルダを作れませんでした：$PROFILE_BASE/${PLAN_VIEWS[$i]}"
    # -n：普段使いのブラウザが開いていても、別のウィンドウとして新しく起動する
    open -na "$BROWSER" --args "${ARGS[@]}" || stop_with_error "$BROWSER_NAME を起動できませんでした。"
    sleep 1
done

echo
echo "ビジョンの表示を全画面で開きました（$BROWSER_NAME）。"
echo '  ・表示を終わるとき：それぞれの画面をクリックして ⌘（command）＋ Q'
echo '  ・もう一度出すとき：デスクトップの「野球ビジョン HDMI出力」をダブルクリック'
sleep 4
