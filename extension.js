/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

class PipOnTop
{
  constructor()
  {
    this._lastWorkspace = null;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;
  }

  enable()
  {
    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();
  }

  disable()
  {
    global.window_manager.disconnect(this._switchWorkspaceId);

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = null;
    this._switchWorkspaceId = 0;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;

    let windows = global.get_window_actors();

    for (let window of windows)
      this._onWindowRemoved(null, window);
  }

  _onSwitchWorkspace()
  {
    let workspace = global.workspace_manager.get_active_workspace();

    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._windowAddedId);
      this._lastWorkspace.disconnect(this._windowRemovedId);
    }

    this._lastWorkspace = workspace;
    this._windowAddedId = this._lastWorkspace.connect(
      'window-added', this._onWindowAdded.bind(this));
    this._windowRemovedId = this._lastWorkspace.connect(
      'window-removed', this._onWindowRemoved.bind(this));
  }

  _onWindowAdded(workspace, window)
  {
    if (!window._notifyPipTitleId) {
      window._notifyPipTitleId = window.connect_after(
        'notify::title', this._checkTitle.bind(this));
    }
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
    let isPipWin = (window.title == 'Picture-in-Picture'
      || window.title.endsWith(' - PiP'));

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';

      window._isPipAble = true;
      window[`${un}make_above`]();
    }
  }
}

function init()
{
  return new PipOnTop();
}
