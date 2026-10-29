#!/usr/bin/env bash
set -euo pipefail

UUID="snowfall@mavox-id.github.io"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
BIN="$HOME/.local/bin"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }

[ -d "$SRC/extension" ] || { echo "Cannot find the extension folder next to this script" >&2; exit 1; }
command -v gnome-shell >/dev/null || warn "gnome-shell not found in PATH — GNOME does not seem to be installed."

say "Copying the extension to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/extension/." "$DEST/"

if command -v glib-compile-schemas >/dev/null; then
    say "Compiling the settings schema"
    glib-compile-schemas "$DEST/schemas"
else
    warn "glib-compile-schemas not found — using the precompiled gschemas.compiled from the archive."
    warn "If the extension fails to load: sudo pacman -S glib2 (or glib2-devel) and run install.sh again."
fi

say "Installing the snowfall command into $BIN"
install -Dm755 "$SRC/snowfall" "$BIN/snowfall"
case ":$PATH:" in *":$BIN:"*) ;; *) warn "$BIN is not in PATH — add it to ~/.bashrc / ~/.zshrc so the snowfall command works." ;; esac

if gsettings list-schemas 2>/dev/null | grep -qx 'org.gnome.shell'; then
    say "Enabling autostart"
    gsettings set org.gnome.shell disable-user-extensions false
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" != *"'$UUID'"* ]]; then
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            new="['$UUID']"
        else
            new="${current%]}, '$UUID']"
        fi
        gsettings set org.gnome.shell enabled-extensions "$new"
    fi
    gnome-extensions enable "$UUID" 2>/dev/null || true
else
    warn "The org.gnome.shell schema is unavailable (not running inside a GNOME session?). Enable manually: gnome-extensions enable $UUID"
fi

echo
say "Done."
if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    echo "    The shell already sees the extension - snow should start right away."
else
    echo "    On Wayland the shell cannot rescan extensions on the fly (Alt+F2 → r does not work)."
    echo "    Log out and back in once - snow will start by itself (autostart is already set up)."
fi
echo "    Control:  snowfall help   ·   Super+Alt+S toggles snow   ·   Super+Alt+C sweeps it away"
echo "    Logs:     journalctl -f -o cat /usr/bin/gnome-shell | grep -i snowfall"
