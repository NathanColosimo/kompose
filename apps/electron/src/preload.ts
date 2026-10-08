import { setupRenderer } from "@better-auth/electron/preload";
import type {
  DesktopBridge,
  DesktopTaskSelection,
  DesktopUpdateState,
} from "@kompose/desktop";
import { contextBridge, ipcRenderer } from "electron";

// Bundled into CommonJS so this preload works with Electron's sandbox enabled.
setupRenderer();
function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) =>
    callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const desktop: DesktopBridge = {
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  dismissCommandBar: () => ipcRenderer.invoke("desktop:dismiss-command-bar"),
  getShortcut: () => ipcRenderer.invoke("desktop:get-shortcut"),
  getUpdateState: () => ipcRenderer.invoke("desktop:update-state"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  onOpenTask: (callback) =>
    subscribe<DesktopTaskSelection>("desktop:open-task", callback),
  onSessionChanged: (callback) =>
    subscribe("desktop:session-changed", callback),
  onUpdateState: (callback) =>
    subscribe<DesktopUpdateState>("desktop:update-state", callback),
  onWindowFocus: (callback) =>
    subscribe<boolean>("desktop:window-focus", callback),
  showMainWindow: () => ipcRenderer.invoke("desktop:show-main-window"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  openTask: (selection) => ipcRenderer.invoke("desktop:open-task", selection),
  platform: process.platform,
  resizeCommandBar: (height) =>
    ipcRenderer.invoke("desktop:resize-command-bar", height),
  setShortcut: (id) => ipcRenderer.invoke("desktop:set-shortcut", id),
};
contextBridge.exposeInMainWorld("komposeDesktop", desktop);
