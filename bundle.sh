UUID="pip-on-top@rafostar.github.com"
ZIPFILES="extension.js prefs.js metadata.json schemas locale COPYING"

glib-compile-schemas ./schemas/
zip -qr "$UUID.zip" $ZIPFILES
