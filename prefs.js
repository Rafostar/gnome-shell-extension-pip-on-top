import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function _addToggle(group, settings, title, key)
{
  const toggleRow = new Adw.SwitchRow({
    title: title,
    active: settings.get_boolean(key),
  });
  settings.bind(key, toggleRow, 'active',
    Gio.SettingsBindFlags.DEFAULT);
  group.add(toggleRow);
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
