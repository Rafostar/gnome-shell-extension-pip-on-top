/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ALWAYS_ON_TOP_DBUS_INTERFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.PipOnTop">
    <method name="setTopByPid">
      <arg type="i" name="pid" direction="in"/>
    </method>
    <method name="unsetTopByPid">
      <arg type="i" name="pid" direction="in"/>
    </method>
  </interface>
</node>`;

class DBusImpl {
    constructor(extension) {
        this._extension = extension;
    }

    setTopByPid(pid) {
        const actors = global.get_window_actors();
        for (const actor of actors) {
            const window = actor.meta_window;
            if (window && window.get_pid() === pid) {
                this._extension._setTop(window);
                
                // Apply stick setting if enabled in preferences
                if (this._extension.settings.get_boolean('stick')) {
                    window.stick();
                }
                return;
            }
        }
    }

    unsetTopByPid(pid) {
        const actors = global.get_window_actors();
        for (const actor of actors) {
            const window = actor.meta_window;
            if (window && window.get_pid() === pid) {
                this._extension._unsetTop(window);
                
                // Always unstick when unsetTop is called
                if (window.on_all_workspaces) {
                    window.unstick();
                }
                return;
            }
        }
    }
}

export default class PipOnTop extends Extension
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;
    
    this._dbusOwnerId = 0;
    this._dbus = null;

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();
    
    // Set up D-Bus interface
    this._setupDBus();
    
    // Add sleep monitor
    this._sleepSignalId = Gio.bus_watch_name(
        Gio.BusType.SYSTEM,
        'org.freedesktop.login1',
        Gio.BusNameWatcherFlags.NONE,
        this._onLoginServiceAppeared.bind(this),
        null
    );
  }
  
  _setupDBus() {
    if (this._dbusOwnerId) {
        Gio.bus_unown_name(this._dbusOwnerId);
    }
    
    this._dbusOwnerId = Gio.bus_own_name(
        Gio.BusType.SESSION,
        'org.gnome.Shell.Extensions.PipOnTop',
        Gio.BusNameOwnerFlags.NONE,
        this._onBusAcquired.bind(this),
        null,
        this._onNameLost.bind(this)
    );
  }
  
  _onLoginServiceAppeared() {
    this._loginProxy = Gio.DBus.system.get_proxy_sync(
        'org.freedesktop.login1',
        '/org/freedesktop/login1',
        'org.freedesktop.login1.Manager',
        null
    );
    
    this._loginProxy.connectSignal('PrepareForSleep', (proxy, sender, [aboutToSuspend]) => {
        if (aboutToSuspend) {
            // System is going to sleep
            this._teardownDBus();
        } else {
            // System is waking up from sleep
            // A short delay might be needed for the session bus to be ready.
            setTimeout(() => this._setupDBus(), 1000);
        }
    });
  }

  _teardownDBus() {
    if (this._dbus) {
        this._dbus.unexport();
        this._dbus = null;
        this._dbusImpl = null;
    }
    if (this._dbusOwnerId) {
        Gio.bus_unown_name(this._dbusOwnerId);
        this._dbusOwnerId = 0;
    }
  }

  _onBusAcquired() {
      this._dbusImpl = new DBusImpl(this);
      this._dbus = Gio.DBusExportedObject.wrapJSObject(ALWAYS_ON_TOP_DBUS_INTERFACE, this._dbusImpl);
      this._dbus.export(Gio.DBus.session, '/org/gnome/shell/extensions/pipontop');
  }

  _onNameLost() {
      if (this._dbus) {
          this._dbus.unexport();
          this._dbus = null;
          this._dbusImpl = null;
      }
      this._dbusOwnerId = 0;
  }

  _setTop(window) {
      if (!window)
          return;

      window.make_above();
      window._isForcedOnTop = true;
  }

  _unsetTop(window) {
      if (!window || !window._isForcedOnTop)
          return;

      window.unmake_above();
      window._isForcedOnTop = false;
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

    // Remove sleep monitor
    if (this._sleepSignalId) {
        Gio.bus_unwatch_name(this._sleepSignalId);
        this._sleepSignalId = 0;
    }
    
    this._loginProxy = null;
    
    // Clean up D-Bus
    this._teardownDBus();

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
        
        // Clean up forced on top windows
        if (window._isForcedOnTop) {
          window.unmake_above();
          window._isForcedOnTop = false;
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
    this._checkTitle(window);
  }

  _onWindowRemoved(workspace, window)
  {
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
      || window.title == 'TelegramDesktop');

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      window[`${un}stick`]();
    }
  }
}
