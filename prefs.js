import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

function _addCornerCombo(group, settings, title, key)
{
  const options = [
    { id: 'bottom-right', label: _('Bottom Right') },
    { id: 'bottom-left', label: _('Bottom Left') },
    { id: 'top-right', label: _('Top Right') },
    { id: 'top-left', label: _('Top Left') },
    { id: 'disabled', label: _('Disabled') },
  ];

  const stringList = Gtk.StringList.new(options.map(opt => opt.label));
  const comboRow = new Adw.ComboRow({
    title: title,
    model: stringList,
  });

  const ids = options.map(opt => opt.id);
  const currentVal = settings.get_string(key);
  const initialIndex = ids.indexOf(currentVal);
  if (initialIndex >= 0)
    comboRow.selected = initialIndex;

  comboRow.connect('notify::selected', () => {
    const selectedId = ids[comboRow.selected];
    if (selectedId && settings.get_string(key) !== selectedId)
      settings.set_string(key, selectedId);
  });

  settings.connect(`changed::${key}`, () => {
    const newIdx = ids.indexOf(settings.get_string(key));
    if (newIdx >= 0 && comboRow.selected !== newIdx)
      comboRow.selected = newIdx;
  });

  group.add(comboRow);
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
      _addCornerCombo(group, settings, 'Place in screen corner', 'corner');

      page.add(group);
      window.add(page);
    }
}
