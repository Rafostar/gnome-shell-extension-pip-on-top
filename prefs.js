const { Adw, Gio, Gtk } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init()
{
}

function _addToggle(group, settings, title, key)
{
  const row = new Adw.ActionRow({
    title: title,
  });
  group.add(row);

  const toggle = new Gtk.Switch({
    active: settings.get_boolean(key),
    valign: Gtk.Align.CENTER,
  });
  settings.bind(key, toggle, 'active',
    Gio.SettingsBindFlags.DEFAULT);

  row.add_suffix(toggle);
  row.activatable_widget = toggle;
}

function fillPreferencesWindow(window)
{
  const settings = ExtensionUtils.getSettings(
    'org.gnome.shell.extensions.pip-on-top');

  const page = new Adw.PreferencesPage();
  const group = new Adw.PreferencesGroup({
    title: 'Options',
  });

  _addToggle(group, settings, 'Show on all workspaces', 'stick');

  page.add(group);
  window.add(page);
}
