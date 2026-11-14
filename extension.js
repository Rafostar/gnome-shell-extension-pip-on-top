/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class PipOnTop extends Extension
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));

    this._grabOpBeginId = global.display.connect('grab-op-begin', (display, window, grabOp) => {
      if (window && window._isPipAble && (grabOp === Meta.GrabOp.MOVING || grabOp === Meta.GrabOp.KEYBOARD_MOVING))
        window._pipUserMoved = true;
    });

    this._onSwitchWorkspace();
  }

  disable()
  {
    this.settings.disconnect(this._settingsChangedId);
    this.settings = null;

    global.window_manager.disconnect(this._switchWorkspaceId);

    if (this._grabOpBeginId) {
      global.display.disconnect(this._grabOpBeginId);
      this._grabOpBeginId = 0;
    }

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = null;
    this._settingsChangedId = 0;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

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
    if (!window._notifyPipSizeId) {
      window._notifyPipSizeId = window.connect(
        'size-changed', this._checkTitle.bind(this));
    }
    this._checkTitle(window);
  }

  _onWindowRemoved(workspace, window)
  {
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
    }
    if (window._notifyPipSizeId) {
      window.disconnect(window._notifyPipSizeId);
      window._notifyPipSizeId = null;
    }
    if (window._isPipAble)
      window._isPipAble = null;
    if (window._pipUserMoved)
      window._pipUserMoved = null;
  }

  _positionWindow(window, attempt = 0)
  {
    const corner = this.settings?.get_string('corner');
    if (!corner || corner === 'disabled' || window._pipUserMoved)
      return;

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!window || window._pipUserMoved)
        return GLib.SOURCE_REMOVE;

      const monitorIndex = window.get_monitor();
      if (monitorIndex < 0)
        return GLib.SOURCE_REMOVE;

      const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
      const frameRect = window.get_frame_rect();

      if (!workArea || !frameRect || frameRect.width <= 50 || frameRect.height <= 50) {
        if (attempt < 10) {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 50, () => {
            if (!window || window._pipUserMoved)
              return GLib.SOURCE_REMOVE;
            this._positionWindow(window, attempt + 1);
            return GLib.SOURCE_REMOVE;
          });
        }
        return GLib.SOURCE_REMOVE;
      }

      let targetX = workArea.x;
      let targetY = workArea.y;

      switch (corner) {
        case 'top-left':
          targetX = workArea.x;
          targetY = workArea.y;
          break;
        case 'top-right':
          targetX = workArea.x + workArea.width - frameRect.width;
          targetY = workArea.y;
          break;
        case 'bottom-left':
          targetX = workArea.x;
          targetY = workArea.y + workArea.height - frameRect.height;
          break;
        case 'bottom-right':
        default:
          targetX = workArea.x + workArea.width - frameRect.width;
          targetY = workArea.y + workArea.height - frameRect.height;
          break;
      }

      if (frameRect.x !== targetX || frameRect.y !== targetY)
        window.move_frame(true, targetX, targetY);

      return GLib.SOURCE_REMOVE;
    });
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
      || window.title == 'TelegramDesktop'
      /* Yandex.Browser support YouTube */
      || window.title.endsWith(' - YouTube'));

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      window[`${un}stick`]();

      if (isPipWin)
        this._positionWindow(window);
    }
  }
}
