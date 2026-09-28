#!/bin/bash
# スタジアムビジョン得点板 - デスクトップにショートカットを作る（Mac用）。中身は tools/make_shortcuts_mac.sh
/bin/bash "$(dirname "$0")/tools/make_shortcuts_mac.sh"
echo
read -r -p "Enterキーを押すと閉じます" _
