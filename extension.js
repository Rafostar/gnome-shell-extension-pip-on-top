/*
 * GNOME Shell Extension: PiP on top
 * Developer: Rafostar
 */

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MATCHER_KEYS = ['firefox', 'chrome'];
const DEBUG_LOGS = false;

export default class PipOnTop extends Extension
{
  enable()
  {
    this._lastWorkspace = null;
    this._windowAddedId = 0;
    this._windowRemovedId = 0;
    this._pipExactTitles = new Set();

    this._loadTitleMatchers();
    this._debug(`enabled (loaded ${this._pipExactTitles.size} JSON titles)`);

    this.settings = this.getSettings();
    this._settingsChangedId = this.settings.connect(
      'changed', this._onSettingsChanged.bind(this));

    this._switchWorkspaceId = global.window_manager.connect_after(
      'switch-workspace', this._onSwitchWorkspace.bind(this));
    this._onSwitchWorkspace();
  }

  disable()
  {
    this._debug('disabling extension');
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
    this._pipExactTitles = null;

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
    this._debug(`window-added: "${window?.title ?? '<no-title>'}"`);
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

  _loadTitleMatchers()
  {
    let matchersPath = GLib.build_filenamev([this.path, 'pip-title-matchers.json']);
    this._debug(`loading title matchers from: ${matchersPath}`);

    try {
      let [ok, contents] = GLib.file_get_contents(matchersPath);
      if (!ok) {
        this._debug('could not read pip-title-matchers.json');
        return;
      }

      let matchers = JSON.parse(new TextDecoder().decode(contents));
      this._setTitleMatchersFromConfig(matchers);
      this._debug(`loaded ${this._pipExactTitles.size} JSON titles`);
    } catch (e) {
      console.error(`[pip-on-top] Failed to load pip-title-matchers.json: ${e}`);
    }
  }

  _setTitleMatchersFromConfig(matchers)
  {
    if (!matchers || typeof matchers !== 'object')
      return;

    /* The "chrome" JSON node is used for all Chromium-based browsers:
     * Chromium, Chrome, Brave. */

    for (let key of MATCHER_KEYS) {
      let node = matchers[key];
      if (!Array.isArray(node))
        continue;
      for (let title of node) {
        if (typeof title === 'string' && title.length > 0)
          this._pipExactTitles.add(this._normalizeTitle(title));
      }
    }
  }

  _isPipWindowTitle(title)
  {
    return this._pipExactTitles.has(title);
  }

  _normalizeTitle(title)
  {
    return title
      .replaceAll('\u00A0', ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _debug(message)
  {
    if (!DEBUG_LOGS)
      return;
    console.log(`[pip-on-top] ${message}`);
  }

  _checkTitle(window)
  {
    if (!window.title)
      return;

    let normalizedTitle = this._normalizeTitle(window.title);

    let isMeetWindow = /^Meet\s*[-–—]\s*/.test(normalizedTitle)
      && (!normalizedTitle.endsWith(' Chromium')
      && !normalizedTitle.endsWith(' Firefox')
      && !normalizedTitle.endsWith(' Brave Web Browser')
      && !normalizedTitle.endsWith(' Google Chrome'));

    let staticMatch = (normalizedTitle == 'Picture-in-Picture'
      || normalizedTitle == 'Picture in picture'
      || normalizedTitle == 'Picture-in-picture'
      || normalizedTitle == 'Mode PIP (Picture-in-Picture)'
      || normalizedTitle == 'PIP mode (Picture-in-Picture)'
      || normalizedTitle.endsWith(' - PiP')
      /* Google Meet support */
      || isMeetWindow
      /* Telegram support */
      || normalizedTitle == 'TelegramDesktop'
      /* Yandex.Browser support YouTube */
      || normalizedTitle.endsWith(' - YouTube')
      /* Collector support */
      || normalizedTitle == 'CollectorMainWindow'
      /* Kasasa support */
      || normalizedTitle.toLowerCase().includes("kasasa"));

    let jsonMatch = this._isPipWindowTitle(normalizedTitle);
    let isPipWin = staticMatch || jsonMatch;
    this._debug(`check-title: "${window.title}" -> "${normalizedTitle}" | static=${staticMatch} json=${jsonMatch} final=${isPipWin}`);

    if (isPipWin || window._isPipAble) {
      let un = (isPipWin) ? '' : 'un';
      this._debug(`apply above: action=${un}make_above title="${window.title}"`);

      window._isPipAble = true;
      window[`${un}make_above`]();

      /* Change stick if enabled or unstick PipAble windows */
      un = (isPipWin && this.settings.get_boolean('stick')) ? '' : 'un';
      this._debug(`apply stick: action=${un}stick title="${window.title}"`);
      window[`${un}stick`]();
    }
  }
}
