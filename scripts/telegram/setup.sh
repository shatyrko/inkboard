#!/usr/bin/env bash
# Installs the Telegram helper for Inkboard dashboards into ~/.config/inkboard/telegram (a private folder with its own Python
# environment), and writes the `inkboard-telegram` wrapper there. Safe to run again to update. Then sign in once with:
#   ~/.config/inkboard/telegram/inkboard-telegram login
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${XDG_CONFIG_HOME:-$HOME/.config}/inkboard/telegram"

mkdir -p "$dir"
chmod 700 "$dir"
[ -x "$dir/venv/bin/python" ] || python3 -m venv "$dir/venv"
"$dir/venv/bin/python" -m pip install --quiet --upgrade pip telethon

install -m 755 "$here/inkboard_telegram.py" "$dir/inkboard_telegram.py"
cat > "$dir/inkboard-telegram" <<EOF
#!/bin/sh
exec "$dir/venv/bin/python" "$dir/inkboard_telegram.py" "\$@"
EOF
chmod 755 "$dir/inkboard-telegram"

echo "Installed in $dir"
echo "Next: $dir/inkboard-telegram login"
