#!/bin/bash
# スタジアムビジョン得点板 - HDMI出力（Mac用）。中身は tools/hdmi_output_mac.sh
exec /bin/bash "$(dirname "$0")/tools/hdmi_output_mac.sh" "$@"
