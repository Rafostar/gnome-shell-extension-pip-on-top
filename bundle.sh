UUID="pip-on-top@rafostar.github.com"
ZIPFILES="extension.js prefs.js metadata.json schemas pip-title-matchers.json"

glib-compile-schemas ./schemas/
zip -qr "$UUID.zip" $ZIPFILES
