/** Contract between the Electron main process and the hosted web app. */
export const ELECTRON_AUTH_SCHEME = "com.nathancolosimo.kompose";
export const ELECTRON_AUTH_CLIENT_ID = "kompose-electron";
export const desktopCommandBarShortcutPresets = [
  {
    accelerator: "CommandOrControl+Shift+K",
    id: "cmd_or_ctrl_shift_k",
    label: "Cmd/Ctrl + Shift + K",
  },
  { accelerator: "Control+Space", id: "ctrl_space", label: "Ctrl + Space" },
  { accelerator: "Alt+Space", id: "alt_space", label: "Alt/Option + Space" },
] as const;
export type DesktopCommandBarShortcutPresetId =
  (typeof desktopCommandBarShortcutPresets)[number]["id"];
export interface DesktopTaskSelection {
  date?: string;
  requestId: string;
  sidebarView?: "inbox" | "today";
  target: "calendar" | "sidebar";
  taskId: string;
}

/**
 * Installed apps keep their bridge until they update, while the web app always
 * ships the latest code. Only add members; feature-detect new ones in the web app.
 */
export interface DesktopBridge {
  dismissCommandBar: () => Promise<void>;
  getShortcut: () => Promise<DesktopCommandBarShortcutPresetId>;
  installUpdate: () => Promise<void>;
  /** Delivers a command bar selection to the main window. */
  onOpenTask: (
    callback: (selection: DesktopTaskSelection) => void
  ) => () => void;
  /** Called with the version once an update has downloaded. */
  onUpdateReady: (callback: (version: string) => void) => () => void;
  openTask: (selection: DesktopTaskSelection) => Promise<void>;
  resizeCommandBar: (height: number) => Promise<void>;
  setShortcut: (id: DesktopCommandBarShortcutPresetId) => Promise<void>;
}
export type DesktopInvokeMethod = {
  [K in keyof DesktopBridge]: K extends `on${string}` ? never : K;
}[keyof DesktopBridge];
/** IPC channel for a bridge member, e.g. `desktop:openTask`. */
export const desktopChannel = (member: keyof DesktopBridge) =>
  `desktop:${member}`;
