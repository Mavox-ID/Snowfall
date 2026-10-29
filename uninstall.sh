#!/usr/bin/env bash
set -euo pipefail

UUID="snowfall@mavox-id.github.io"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

gnome-extensions disable "$UUID" 2>/dev/null || true

if gsettings list-schemas 2>/dev/null | grep -qx 'org.gnome.shell'; then
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" == *"'$UUID'"* ]]; then
        new="$(sed -E "s/, *'$UUID'//; s/'$UUID', *//; s/'$UUID'//" <<<"$current")"
        [[ "$new" == "[]" ]] && new="@as []"
        gsettings set org.gnome.shell enabled-extensions "$new"
    fi
fi

command -v dconf >/dev/null && dconf reset -f /org/gnome/shell/extensions/snowfall/ || true
rm -rf "$DEST" "$HOME/.local/bin/snowfall"
echo "Snowfall removed. Log out and back in so the shell unloads it from memory"
