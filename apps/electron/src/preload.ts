import { setupRenderer } from "@better-auth/electron/preload";
import {
  type DesktopBridge,
  type DesktopInvokeMethod,
  desktopChannel,
} from "@kompose/desktop";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

// Bundled into CommonJS so this preload works with Electron's sandbox enabled.
setupRenderer();

function invoke(method: DesktopInvokeMethod, value?: unknown) {
  return ipcRenderer.invoke(desktopChannel(method), value);
}
function subscribe<T>(
  member: keyof DesktopBridge,
  callback: (value: T) => void
) {
  const channel = desktopChannel(member);
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const desktop: DesktopBridge = {
  dismissCommandBar: () => invoke("dismissCommandBar"),
  getShortcut: () => invoke("getShortcut"),
  installUpdate: () => invoke("installUpdate"),
  onOpenTask: (callback) => subscribe("onOpenTask", callback),
  onUpdateReady: (callback) => subscribe("onUpdateReady", callback),
  openTask: (selection) => invoke("openTask", selection),
  resizeCommandBar: (height) => invoke("resizeCommandBar", height),
  setShortcut: (id) => invoke("setShortcut", id),
  showMainWindow: () => invoke("showMainWindow"),
};
contextBridge.exposeInMainWorld("komposeDesktop", desktop);
// Enables the Electron drag-region styles in the web app's index.css.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopRuntime = "electron";
});
