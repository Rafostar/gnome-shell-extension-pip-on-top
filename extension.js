/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class PipOnTop extends Extension
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;
    this._grabOpEndId = 0;
    this._lastPipGeometry = null;

    try {
      let cachePath = GLib.build_filenamev([GLib.get_user_cache_dir(), 'pip-on-top-geometry.json']);
      if (GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
        let [ok, contents] = GLib.file_get_contents(cachePath);
        if (ok) {
          let decoder = new TextDecoder('utf-8');
          this._lastPipGeometry = JSON.parse(decoder.decode(contents));
        }
      }
    } catch (e) {
      // ignore
    }

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();

    this._grabOpEndId = global.display.connect('grab-op-end', (display, window, op) => {
      if (window && window._isPipAble) {
        this._saveGeometry(window);
      }
    });
  }

  disable()
  {
    this.settings.disconnect(this._settingsChangedId);
    this.settings = null;

    global.window_manager.disconnect(this._switchWorkspaceId);

    if (this._grabOpEndId) {
      global.display.disconnect(this._grabOpEndId);
      this._grabOpEndId = 0;
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
    this._lastPipGeometry = null;

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

  _saveGeometry(window)
  {
    try {
      let rect = window.get_frame_rect();
      if (rect && rect.width > 50 && rect.height > 50) {
        this._lastPipGeometry = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        let cachePath = GLib.build_filenamev([GLib.get_user_cache_dir(), 'pip-on-top-geometry.json']);
        GLib.file_set_contents(cachePath, JSON.stringify(this._lastPipGeometry));
      }
    } catch (e) {
      // ignore
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
    this._checkTitle(window);
  }

  _onWindowRemoved(workspace, window)
  {
    if (window && window._isPipAble) {
      this._saveGeometry(window);
    }
    if (window._notifyPipTitleId) {
      window.disconnect(window._notifyPipTitleId);
      window._notifyPipTitleId = null;
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
      || window.title == 'TelegramDesktop'
      /* Yandex.Browser support YouTube */
      || window.title.endsWith(' - YouTube'));

    if (isPipWin || window._isPipAble) {
      let isNewPip = isPipWin && !window._isPipAble;
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      window[`${un}stick`]();

      if (isNewPip) {
        // 1. Restore previous geometry if saved
        if (this._lastPipGeometry) {
          let geom = this._lastPipGeometry;
          let applyGeometry = () => {
            window.move_resize_frame(false, geom.x, geom.y, geom.width, geom.height);
          };

          let actor = window.get_compositor_private();
          if (actor) {
            let id = actor.connect('first-frame', () => {
              actor.disconnect(id);
              applyGeometry();
            });
          }
          // Fallback in case first-frame already rendered
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            applyGeometry();
            return GLib.SOURCE_REMOVE;
          });
        }

        // 2. Return focus to the main Firefox window
        let refocusTarget = () => {
          let tracker = Shell.WindowTracker.get_default();
          let app = tracker.get_window_app(window);
          let target = null;
          if (app) {
            let appWindows = app.get_windows();
            for (let w of appWindows) {
              if (w !== window && !w._isPipAble) {
                target = w;
                break;
              }
            }
          }
          if (!target) {
            let ws = global.workspace_manager.get_active_workspace();
            let windows = ws.list_windows();
            for (let w of windows) {
              if (w !== window && !w._isPipAble && w.get_window_type() === Meta.WindowType.NORMAL) {
                target = w;
                break;
              }
            }
          }
          if (target) {
            let time = global.display.get_current_time_roundtrip();
            if (app)
              app.activate_window(target, time);
            target.activate(time);
          }
        };

        let checkAndRefocus = () => {
          if (!window._focusRestored) {
            window._focusRestored = true;
            if (focusId) {
              try { window.disconnect(focusId); } catch (e) {}
              focusId = 0;
            }
            refocusTarget();
          }
        };

        let focusId = window.connect('notify::appears-focused', () => {
          if (window.has_focus()) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
              checkAndRefocus();
              return GLib.SOURCE_REMOVE;
            });
          }
        });

        // Fallback in case window is already focused or notify doesn't fire
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
          checkAndRefocus();
          return GLib.SOURCE_REMOVE;
        });
      }
    }
  }
}
