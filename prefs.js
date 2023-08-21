import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

export default class PipOnTopPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window)
    {
      const settings = this.getSettings();

      const page = new Adw.PreferencesPage();
      const group = new Adw.PreferencesGroup({
        title: 'Options',
      });

      _addToggle(group, settings, 'Show on all workspaces', 'stick');

      page.add(group);
      window.add(page);
    }
}
