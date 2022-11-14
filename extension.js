/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

const { Meta } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const GLib = imports.gi.GLib;

const Gettext = imports.gettext.domain('pip-on-top');
const _ = Gettext.gettext;

class PipOnTop
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    this.settings = ExtensionUtils.getSettings(
      'org.gnome.shell.extensions.pip-on-top');
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._lastWindowRect = JSON.parse(this.settings.get_string("saved-window"));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();
  }

  disable()
  {
    this.settings.disconnect(this._settingsChangedId);
    this.settings = null;

    global.window_manager.disconnect(this._switchWorkspaceId);

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = null;
    this._settingsChangedId = 0;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    if (this._saveTimerId) {
      GLib.Source.remove(this._saveTimerId);
      this._saveTimerId = null;
    }

    let actors = global.get_window_actors();
    if (actors) {
      for (let actor of actors) {
        let window = actor.meta_window;
        if (!window) continue;

        if (window._isPipAble) {
          if (window.above)
            window.unmake_above();
          if (window.on_all_workspaces)
            window.unstick();
          if (window._overrideTimeoutId) {
            GLib.Source.remove(window._overrideTimeoutId);
            window._overrideTimeoutId = null;
          }
        }

        this._onWindowRemoved(null, window);
      }
    }
  }

  _onSettingsChanged(settings, key)
  {
    switch (key) {
      case 'stick':
        /* Updates already present windows */
        this._onSwitchWorkspace();
        break;
      default:
        break;
    }
  }

  _onSwitchWorkspace()
  {
    let workspace = global.workspace_manager.get_active_workspace();
    let wsWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = workspace;
    this._windowAddedId = this._lastWorkspace.connect(
      'window-added', this._onWindowAdded.bind(this));
    this._windowRemovedId = this._lastWorkspace.connect(
      'window-removed', this._onWindowRemoved.bind(this));

    /* Update state on already present windows */
    if (wsWindows) {
      for (let window of wsWindows)
        this._onWindowAdded(workspace, window);
    }
  }

  _onWindowAdded(workspace, window)
  {
    if (!window._notifyPipTitleId) {
      window._notifyPipTitleId = window.connect_after(
        'notify::title', this._checkTitle.bind(this));
    }
    if (!window._windowPositionChangedId) {
      window._windowPositionChangedId = window.connect_after(
        'position-changed', this._onWindowChanged.bind(this));
    }
    if (!window._windowSizeChangedId) {
      window._windowSizeChangedId = window.connect_after(
        'size-changed', this._onWindowChanged.bind(this));
    }

    this._checkTitle(window);
  }

  _onWindowRemoved(workspace, window)
  {
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
    }
    if (window._windowPositionChangedId) {
      window.disconnect(window._windowPositionChangedId);
      window._windowPositionChangedId = null;
    }
    if (window._windowSizeChangedId) {
      window.disconnect(window._windowSizeChangedId);
      window._windowSizeChangedId = null;
    }
    if (window._isPipAble)
      window._isPipAble = null;
  }

  _checkTitle(window)
  {
    if (!window.title)
      return;

    /* Check both translated and untranslated string for
     * users that prefer running applications in English */
    let isPipWin = (window.title == 'Picture-in-Picture'
      || window.title == _('Picture-in-Picture')
      || window.title == 'Picture in picture'
      || window.title == 'Picture-in-picture'
      || window.title.endsWith(' - PiP')
      /* Telegram support */
      || window.title == 'TelegramDesktop');

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      window[`${un}stick`]();

      /* Repeatedly override new window position so it sticks */
      window._overrideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        window._overrideTimeoutId = null;
        return false;
      });
    }
  }

  _onWindowChanged(window)
  {
    if (!window._isPipAble)
      return;

    /* Override new window position and size until timeout */
    if (window._overrideTimeoutId) {
      let last = this._lastWindowRect;
      let current = window.get_frame_rect();
      /* Change position independently of size to avoid aspect
       * ratio lock interference */
      window.move_resize_frame(false, last.x, last.y,
                               current.width, current.height);
      /* Only care about height but width also needs to be applied
       * to avoid window shrinking (Firefox Bug 1794577) */
      window.move_resize_frame(false, last.x, last.y,
                               last.width, last.height);
    } else {
      this._lastWindowRect = window.get_frame_rect();
      this._lazySaveSettings();
    }
  }

  _lazySaveSettings()
  {
    if (this._saveTimerId)
      return;

    this._saveTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
      let rect = this._lastWindowRect;
      this.settings.set_string("saved-window", JSON.stringify({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }));
      this._saveTimerId = null;
      return false;
    });
  }
}

function init()
{
  ExtensionUtils.initTranslations();
  return new PipOnTop();
}
