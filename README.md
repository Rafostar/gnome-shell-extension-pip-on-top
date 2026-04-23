# gnome-shell-extension-pip-on-top
Keeps "Picture-in-Picture" windows always on top, including on Wayland. Works with Firefox, Brave (YouTube), and the Clapper media player.

[<img src="https://extensions.gnome.org/static/images/gnome-extensions.2635f103c955.svg" width="25%" height="25%">](https://extensions.gnome.org/extension/4691/pip-on-top)

## Installation from source code
Run below in terminal one by one:
```sh
mkdir -p ~/.local/share/gnome-shell/extensions
cd ~/.local/share/gnome-shell/extensions
git clone "https://github.com/Rafostar/gnome-shell-extension-pip-on-top.git" "pip-on-top@rafostar.github.com"
cd pip-on-top@rafostar.github.com
glib-compile-schemas ./schemas/
```
Additionally if you are running Firefox not in English language, execute `translate.sh` script to generate required translations:
```sh
chmod +x translate.sh
./translate.sh
```

After all is done: logout, login back (or reboot) and enable newly installed extension. Enjoy!
