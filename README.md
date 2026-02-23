# gnome-shell-extension-pip-on-top
Makes "Picture-in-Picture" windows stay on top (even on Wayland session). Compatible with Firefox and Clapper media player.

[<img src="https://camo.githubusercontent.com/4f1e6d9a2288e9914688d4423892e930f814c7fd10b4ca3a704fe2d3ea927410/68747470733a2f2f6d696368656c65672e6769746875622e696f2f646173682d746f2d646f636b2f6d656469612f6765742d69742d6f6e2d65676f2e706e67" width="25%" height="25%">](https://extensions.gnome.org/extension/4691/pip-on-top)

## Installation from source code
Run below in terminal one by one:
```sh
mkdir -p ~/.local/share/gnome-shell/extensions
cd ~/.local/share/gnome-shell/extensions
git clone "https://github.com/Rafostar/gnome-shell-extension-pip-on-top.git" "pip-on-top@rafostar.github.com"
cd pip-on-top@rafostar.github.com
glib-compile-schemas ./schemas/
```
Optionally generate/update `pip-title-matchers.json` (structured with `firefox`, `chrome` nodes; `update_translations.sh` updates `firefox` + `chrome`):
```sh
chmod +x update_translations.sh
./update_translations.sh
```
Update only one browser node:
```sh
./update_translations.sh --firefox-only
./update_translations.sh --chrome-only
```

After all is done: logout, login back (or reboot) and enable newly installed extension. Enjoy!
