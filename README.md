<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Snowfall icon">
</p>

<h1 align="center">❄ Snowfall ❄</h1>

<p align="center">It's snowing on your desktop.</p>

https://github.com/user-attachments/assets/eade4202-9065-4083-9a79-d367af2fc07d

Ready for Christmas, but your computer isn't yet? Snowfall brings a quiet snowfall to your GNOME desktop. Flakes drift across the screen and settle in soft drifts on your windows, on your dock and along the bottom edge. Sweep them aside with the cursor, shake a window and watch its snow slide off

Made for GNOME 51 on Wayland. Also declared compatible with GNOME 50

## What it does

❄ Snow falls over your whole desktop, from a light dusting to a heavy storm, or a variable one that swells and eases on its own

❄ Drifts build up on the bottom of the screen, on the top edges of windows that have room above them, and on your dock or taskbar. Snow slumps to a natural slope and spills over free edges

❄ Drag or shake a window and its snow slides off. Close or minimize it and the snow drops in lumps that burst into powder

❄ Move the cursor through a drift and it parts and sprays. Move it through falling snow and the flakes scatter

❄ A window in front hides the drift of the window behind it, and windows on other workspaces keep their snow until you return

❄ Optional melting, wind, flake size, drift height, and a mode where snow falls behind your windows. Snow hides itself in fullscreen apps

## How to install

```sh
git clone https://github.com/Mavox-ID/Snowfall.git
cd Snowfall
chmod +x install.sh && ./install.sh
```

Done! Now log out and log back in. On Wayland the shell can't pick up a new extension on the fly, so this is needed once. After that, snow starts by itself every time you log in

To remove it, run `./uninstall.sh`

## Also install in Gnome!

The extension is now available on Gnome Extensions, where you can install it with the click of a button—no need to download anything extra or run any scripts

## Controls

Press Super+Alt+S to turn the snow on or off, and Super+Alt+C to sweep it all away. There is also a snowflake icon in the top bar with a quick menu, and a full settings window.

The `snowfall` command works from any terminal:

```sh
snowfall level heavy     # off, light, steady, heavy or variable
snowfall off             # and: on, toggle
snowfall density 1.5
snowfall clear
snowfall prefs
snowfall help
```

## Dock and taskbar

Snowfall finds a bottom dock or panel on its own, for example Dash to Dock or Dash to Panel. Stock GNOME has no bottom dock, so there the snow lies on windows and along the bottom of the screen. You can turn dock snow off with `snowfall set dock-snow false`.

## Troubleshooting

If the snow doesn't appear, check the shell log:

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep -i snowfall
gnome-extensions info snowfall@local
```

If it uses too much CPU, try `snowfall set fps 20`, `snowfall density 0.6`, or a lighter intensity
If you encounter any issues, you can reach out to me via an Issue

## Credits

The idea comes from Snowhush, a snow app for macOS and Windows. Snowfall is an independent implementation for GNOME.
