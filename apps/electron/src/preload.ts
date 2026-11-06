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

const desktop: Required<DesktopBridge> = {
  dismissCommandBar: () => invoke("dismissCommandBar"),
  getReadyUpdate: () => invoke("getReadyUpdate"),
  getShortcut: () => invoke("getShortcut"),
  installUpdate: () => invoke("installUpdate"),
  onOpenTask: (callback) => {
    const unsubscribe = subscribe("onOpenTask", callback);
    // Older hosted apps only call onOpenTask, so subscription itself is the ack.
    desktop.setTaskListenerReady(true).catch(() => undefined);
    return () => {
      unsubscribe();
      if (ipcRenderer.listenerCount(desktopChannel("onOpenTask")) === 0) {
        desktop.setTaskListenerReady(false).catch(() => undefined);
      }
    };
  },
  onUpdateReady: (callback) => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = subscribe<string>("onUpdateReady", (version) => {
      receivedEvent = true;
      callback(version);
    });
    // Replay for older web apps too, after their listener has been installed.
    desktop
      .getReadyUpdate()
      .then((version) => {
        if (active && !receivedEvent && version) {
          callback(version);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  },
  openTask: (selection) => invoke("openTask", selection),
  resizeCommandBar: (height) => invoke("resizeCommandBar", height),
  setShortcut: (id) => invoke("setShortcut", id),
  setTaskListenerReady: (ready) => invoke("setTaskListenerReady", ready),
  showMainWindow: () => invoke("showMainWindow"),
};
contextBridge.exposeInMainWorld("komposeDesktop", desktop);
// Enables the Electron drag-region styles in the web app's index.css.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktopRuntime = "electron";
});
