import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@wobex/contracts";
import {
  BROWSER_CLOSE_CHANNEL,
  BROWSER_CLOSE_TAB_CHANNEL,
  BROWSER_GET_STATE_CHANNEL,
  BROWSER_GO_BACK_CHANNEL,
  BROWSER_GO_FORWARD_CHANNEL,
  BROWSER_HIDE_CHANNEL,
  BROWSER_NAVIGATE_CHANNEL,
  BROWSER_NEW_TAB_CHANNEL,
  BROWSER_OPEN_CHANNEL,
  BROWSER_OPEN_DEVTOOLS_CHANNEL,
  BROWSER_RELOAD_CHANNEL,
  BROWSER_SELECT_TAB_CHANNEL,
  BROWSER_SET_BOUNDS_CHANNEL,
  BROWSER_STATE_CHANNEL,
} from "./browserBridge";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:get-saved-environment-registry";
const SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:set-saved-environment-registry";
const GET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:get-saved-environment-secret";
const SET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:set-saved-environment-secret";
const REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:remove-saved-environment-secret";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";

contextBridge.exposeInMainWorld("desktopBridge", {
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getClientSettings: () => ipcRenderer.invoke(GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) => ipcRenderer.invoke(SET_CLIENT_SETTINGS_CHANNEL, settings),
  getSavedEnvironmentRegistry: () => ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId, secret),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  getServerExposureState: () => ipcRenderer.invoke(GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) => ipcRenderer.invoke(SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  browser: {
    open: (input) => ipcRenderer.invoke(BROWSER_OPEN_CHANNEL, input),
    close: (input) => ipcRenderer.invoke(BROWSER_CLOSE_CHANNEL, input),
    hide: (input) => ipcRenderer.invoke(BROWSER_HIDE_CHANNEL, input),
    getState: (input) => ipcRenderer.invoke(BROWSER_GET_STATE_CHANNEL, input),
    setPanelBounds: (input) => ipcRenderer.invoke(BROWSER_SET_BOUNDS_CHANNEL, input),
    navigate: (input) => ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, input),
    reload: (input) => ipcRenderer.invoke(BROWSER_RELOAD_CHANNEL, input),
    goBack: (input) => ipcRenderer.invoke(BROWSER_GO_BACK_CHANNEL, input),
    goForward: (input) => ipcRenderer.invoke(BROWSER_GO_FORWARD_CHANNEL, input),
    newTab: (input) => ipcRenderer.invoke(BROWSER_NEW_TAB_CHANNEL, input),
    closeTab: (input) => ipcRenderer.invoke(BROWSER_CLOSE_TAB_CHANNEL, input),
    selectTab: (input) => ipcRenderer.invoke(BROWSER_SELECT_TAB_CHANNEL, input),
    openDevTools: (input) => ipcRenderer.invoke(BROWSER_OPEN_DEVTOOLS_CHANNEL, input),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(BROWSER_STATE_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BROWSER_STATE_CHANNEL, wrappedListener);
      };
    },
  },
} satisfies DesktopBridge);
