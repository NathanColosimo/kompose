import { setupRenderer } from "@better-auth/electron/preload";
import {
  type DesktopBridge,
  desktopEventChannels,
  desktopInvokeChannels,
} from "@kompose/desktop";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

// Bundled into CommonJS so this preload works with Electron's sandbox enabled.
setupRenderer();
function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
const invoke = desktopInvokeChannels;
const events = desktopEventChannels;
const desktop: DesktopBridge = {
  checkForUpdates: () => ipcRenderer.invoke(invoke.checkForUpdates),
  dismissCommandBar: () => ipcRenderer.invoke(invoke.dismissCommandBar),
  getShortcut: () => ipcRenderer.invoke(invoke.getShortcut),
  getUpdateState: () => ipcRenderer.invoke(invoke.getUpdateState),
  installUpdate: () => ipcRenderer.invoke(invoke.installUpdate),
  onOpenTask: (callback) => subscribe(events.openTask, callback),
  onSessionChanged: (callback) => subscribe(events.sessionChanged, callback),
  onUpdateState: (callback) => subscribe(events.updateState, callback),
  onWindowFocus: (callback) => subscribe(events.windowFocus, callback),
  openExternal: (url) => ipcRenderer.invoke(invoke.openExternal, url),
  openTask: (selection) => ipcRenderer.invoke(invoke.openTask, selection),
  platform: process.platform,
  resizeCommandBar: (height) =>
    ipcRenderer.invoke(invoke.resizeCommandBar, height),
  setShortcut: (id) => ipcRenderer.invoke(invoke.setShortcut, id),
  showMainWindow: () => ipcRenderer.invoke(invoke.showMainWindow),
};
contextBridge.exposeInMainWorld("komposeDesktop", desktop);
