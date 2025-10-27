/*
 * GNOME Shell Extension: PiP on top (defensive patch)
 * Applied fixes:
 *  - multiple sanity checks before touching Meta.Window
 *  - schedule changes with GLib.timeout_add to avoid race with Chromium
 *  - robust try/catch around all Meta calls
 *  - safe connect/disconnect handling
 *
 * Drop this file into the extension folder and restart GNOME Shell.
 */

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const CHECK_DELAY_MS = 50; // small delay to avoid racing window destroy

export default class PipOnTop extends Extension {
  enable() {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect('changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace',
      this._onSwitchWorkspace.bind(this)
    );
    this._onSwitchWorkspace();
  }

  disable() {
    try {
      if (this.settings && this._settingsChangedId) {
        try {
          this.settings.disconnect(this._settingsChangedId);
        } catch (e) {
          logError(e, 'PiP on Top: error disconnecting settings');
        }
      }
    } catch (e) {
      logError(e, 'PiP on Top: disable settings cleanup error');
    }

    this.settings = null;

    try {
      if (this._switchWorkspaceId) {
        global.window_manager.disconnect(this._switchWorkspaceId);
      }
    } catch (e) {
      logError(e, 'PiP on Top: error disconnecting switch-workspace');
    }

    if (this._lastWorkspace) {
      try {
        if (this._windowAddedId) this._lastWorkspace.disconnect(this._windowAddedId);
      } catch (e) {
        logError(e, 'PiP on Top: error disconnecting window-added');
      }
      try {
        if (this._windowRemovedId) this._lastWorkspace.disconnect(this._windowRemovedId);
      } catch (e) {
        logError(e, 'PiP on Top: error disconnecting window-removed');
      }
    }

    this._lastWorkspace = null;
    this._settingsChangedId = 0;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    // cleanup any remaining actors safely
    try {
      let actors = global.get_window_actors();
      if (actors) {
        for (let actor of actors) {
          let window = actor.meta_window;
          if (!window) continue;

          try {
            if (window._isPipAble) {
              this._safeUnmakeAbove(window);
              this._safeUnstick(window);
            }
          } catch (e) {
            logError(e, 'PiP on Top: cleanup per-window error');
          }

          // ensure we've disconnected notify id
          this._cleanupNotifyId(window);
        }
      }
    } catch (e) {
      logError(e, 'PiP on Top: final cleanup error');
    }
  }

  _onSettingsChanged(settings, key) {
    try {
      if (key === 'stick') {
        // re-evaluate existing windows
        this._onSwitchWorkspace();
      }
    } catch (e) {
      logError(e, 'PiP on Top: settings changed handler error');
    }
  }

  _onSwitchWorkspace() {
    try {
      let workspace = global.workspace_manager.get_active_workspace();

      // disconnect previous workspace signals
      if (this._lastWorkspace) {
        try {
          if (this._windowAddedId) this._lastWorkspace.disconnect(this._windowAddedId);
        } catch (e) {
          logError(e, 'PiP on Top: error disconnecting window-added on switch');
        }

        try {
          if (this._windowRemovedId) this._lastWorkspace.disconnect(this._windowRemovedId);
        } catch (e) {
          logError(e, 'PiP on Top: error disconnecting window-removed on switch');
        }
      }

      this._lastWorkspace = workspace;

      try {
        this._windowAddedId = this._lastWorkspace.connect('window-added', this._onWindowAdded.bind(this));
      } catch (e) {
        logError(e, 'PiP on Top: error connecting window-added');
        this._windowAddedId = 0;
      }

      try {
        this._windowRemovedId = this._lastWorkspace.connect('window-removed', this._onWindowRemoved.bind(this));
      } catch (e) {
        logError(e, 'PiP on Top: error connecting window-removed');
        this._windowRemovedId = 0;
      }

      // Update existing windows
      let wsWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
      if (wsWindows) {
        for (let window of wsWindows) {
          try {
            this._onWindowAdded(workspace, window);
          } catch (e) {
            logError(e, 'PiP on Top: error in initial window handling');
          }
        }
      }
    } catch (e) {
      logError(e, 'PiP on Top: _onSwitchWorkspace error');
    }
  }

  _onWindowAdded(workspace, window) {
    if (!window) return;

    // protect against destroyed windows
    if (window._destroyed) return;

    // set up a safe notify::title handler if not present
    if (!window._notifyPipTitleId) {
      try {
        // use an arrow wrapper to capture the window reference safely
        let wrapper = () => {
          if (!window) return;
          if (window._destroyed) {
            // cleanup if destroyed
            this._cleanupNotifyId(window);
            return;
          }
          // schedule check to avoid racing destroy
          this._scheduleCheck(window);
        };

        window._notifyPipTitleId = window.connect_after('notify::title', wrapper);
        // store wrapper in case we need it for debugging/cleanup
        window._notifyPipHandler = wrapper;
      } catch (e) {
        logError(e, 'PiP on Top: failed to connect notify::title');
        window._notifyPipTitleId = null;
        window._notifyPipHandler = null;
      }
    }

    // immediate check (but scheduled to avoid race)
    this._scheduleCheck(window);
  }

  _onWindowRemoved(workspace, window) {
    if (!window) return;

    // disconnect notify handler if present
    this._cleanupNotifyId(window);

    // mark not pip-able
    try {
      window._isPipAble = null;
    } catch (e) {
      // ignore
    }
  }

  _cleanupNotifyId(window) {
    try {
      if (!window) return;
      if (window._notifyPipTitleId) {
        try {
          window.disconnect(window._notifyPipTitleId);
        } catch (e) {
          // disconnect may fail if already disconnected - swallow
        }
        window._notifyPipTitleId = null;
      }
      // clear any stored wrapper
      if (window._notifyPipHandler) {
        window._notifyPipHandler = null;
      }
      // cancel scheduled idle if any
      if (window._pipIdleId) {
        try {
          GLib.source_remove(window._pipIdleId);
        } catch (e) {
          // ignore
        }
        window._pipIdleId = null;
      }
    } catch (e) {
      logError(e, 'PiP on Top: _cleanupNotifyId error');
    }
  }

  _scheduleCheck(window) {
    if (!window) return;

    // if a check is already scheduled, keep it (prevents flooding)
    if (window._pipIdleId) return;

    try {
      // schedule a short timeout to avoid racing window destruction
      window._pipIdleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_DELAY_MS, () => {
        // clear scheduled id immediately
        try {
          window._pipIdleId = null;
        } catch (e) {
          // ignore
        }

        if (!window) return GLib.SOURCE_REMOVE;
        if (window._destroyed) {
          // clean up listeners for destroyed window
          this._cleanupNotifyId(window);
          return GLib.SOURCE_REMOVE;
        }

        try {
          this._checkTitle(window);
        } catch (e) {
          logError(e, 'PiP on Top: scheduled _checkTitle error');
        }
        return GLib.SOURCE_REMOVE;
      });
    } catch (e) {
      // if scheduling failed, run synchronously but guarded
      try {
        this._checkTitle(window);
      } catch (err) {
        logError(err, 'PiP on Top: fallback _checkTitle error');
      }
    }
  }

  _isWindowTitlePipLike(title) {
    if (!title) return false;

    try {
      if (title === 'Picture-in-Picture') return true;
      if (title === _('Picture-in-Picture')) return true;
      if (title === 'Picture in picture') return true;
      if (title === 'Picture-in-picture') return true;
      if (title.endsWith && title.endsWith(' - PiP')) return true;
      if (title === 'TelegramDesktop') return true;
    } catch (e) {
      // title could be weird; treat as not PiP
    }
    return false;
  }

  _safeMakeAbove(window) {
    if (!window) return;
    if (window._destroyed) return;

    try {
      if (typeof window.make_above === 'function') {
        window.make_above();
      }
    } catch (e) {
      logError(e, 'PiP on Top: _safeMakeAbove error');
    }
  }

  _safeUnmakeAbove(window) {
    if (!window) return;
    if (window._destroyed) return;

    try {
      if (typeof window.unmake_above === 'function') {
        window.unmake_above();
      }
    } catch (e) {
      logError(e, 'PiP on Top: _safeUnmakeAbove error');
    }
  }

  _safeStick(window) {
    if (!window) return;
    if (window._destroyed) return;

    try {
      if (typeof window.stick === 'function') {
        window.stick();
      }
    } catch (e) {
      logError(e, 'PiP on Top: _safeStick error');
    }
  }

  _safeUnstick(window) {
    if (!window) return;
    if (window._destroyed) return;

    try {
      if (typeof window.unstick === 'function') {
        window.unstick();
      }
    } catch (e) {
      logError(e, 'PiP on Top: _safeUnstick error');
    }
  }

  _checkTitle(window) {
    if (!window) return;
    if (window._destroyed) return;

    let title = null;
    try {
      title = window.title;
    } catch (e) {
      // if reading title fails, bail
      return;
    }

    if (!title) return;

    let isPipWin = false;
    try {
      isPipWin = this._isWindowTitlePipLike(title);
    } catch (e) {
      // fallback: not pip
      isPipWin = false;
    }

    try {
      if (isPipWin || window._isPipAble) {
        // mark pip-able
        window._isPipAble = true;

        // Make above or unmake above, safely and scheduled
        if (isPipWin) {
          this._safeMakeAbove(window);
        } else {
          this._safeUnmakeAbove(window);
        }

        // handle stick behaviour based on setting
        let stickEnabled = false;
        try {
          stickEnabled = this.settings.get_boolean('stick');
        } catch (e) {
          stickEnabled = false;
        }

        if (isPipWin && stickEnabled) {
          this._safeStick(window);
        } else {
          this._safeUnstick(window);
        }
      } else {
        // not pip and not marked: ensure any previous flags cleared
        try {
          window._isPipAble = null;
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      logError(e, 'PiP on Top: _checkTitle top-level error');
    }
  }
}
