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
Additionally if you are running Firefox not in English language, execute `translate.sh` script to generate required translations:
```sh
chmod +x translate.sh
./translate.sh
```

After all is done: logout, login back (or reboot) and enable newly installed extension. Enjoy!

## Usage
### D-Bus Interface
The extension provides a D-Bus interface to control window stacking from any application:

```
Interface: org.gnome.Shell.Extensions.PipOnTop
Object path: /org/gnome/shell/extensions/pipontop
Methods:
  - setTopByPid(pid): Make a window with specified PID stay on top
  - unsetTopByPid(pid): Restore normal stacking for window with specified PID
```

#### Command line examples:
Make a window with PID 12345 stay on top:
```sh
gdbus call --session --dest org.gnome.Shell.Extensions.PipOnTop \
  --object-path /org/gnome/shell/extensions/pipontop \
  --method org.gnome.Shell.Extensions.PipOnTop.setTopByPid 12345
```

Restore normal stacking for window with PID 12345:
```sh
gdbus call --session --dest org.gnome.Shell.Extensions.PipOnTop \
  --object-path /org/gnome/shell/extensions/pipontop \
  --method org.gnome.Shell.Extensions.PipOnTop.unsetTopByPid 12345
```

#### Integration with mpv player:
Create a file `~/.config/mpv/scripts/ontop.lua` with the following content:

```lua
local mp = require("mp")
mp.observe_property("ontop", "bool", function(_, val)
	if val then
		mp.commandv(
			"run",
			"gdbus",
			"call",
			"--session",
			"--dest",
			"org.gnome.Shell.Extensions.PipOnTop",
			"--object-path",
			"/org/gnome/shell/extensions/pipontop",
			"--method",
			"org.gnome.Shell.Extensions.PipOnTop.setTopByPid",
			mp.get_property_number("pid")
		)
	else
		mp.commandv(
			"run",
			"gdbus",
			"call",
			"--session",
			"--dest",
			"org.gnome.Shell.Extensions.PipOnTop",
			"--object-path",
			"/org/gnome/shell/extensions/pipontop",
			"--method",
			"org.gnome.Shell.Extensions.PipOnTop.unsetTopByPid",
			mp.get_property_number("pid")
		)
	end
end)
```

This script will make mpv stay on top even in Wayland sessions when you toggle the "ontop" property (default shortcut: `T`). 
