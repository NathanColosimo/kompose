/** Contract between the Electron main process and the hosted web app. */
export const ELECTRON_AUTH_SCHEME = "com.nathancolosimo.kompose";
export const ELECTRON_AUTH_CLIENT_ID = "kompose-electron";
export const DESKTOP_COMMAND_BAR_MAX_HEIGHT = 520;
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
 * Only add members and feature-detect them: installed apps can have older bridges.
 * See documents/electron-port.md for compatibility and release policy.
 */
export interface DesktopBridge {
  dismissCommandBar: () => Promise<void>;
  /** Snapshot for listeners installed after an update downloaded. */
  getReadyUpdate?: () => Promise<string | null>;
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
  /** Call after installing the task listener; preload also does this for older web apps. */
  setTaskListenerReady?: (ready: boolean) => Promise<void>;
  showMainWindow: () => Promise<void>;
}
export type DesktopInvokeMethod = {
  [K in keyof DesktopBridge]-?: K extends `on${string}` ? never : K;
}[keyof DesktopBridge];
export const desktopChannel = (member: keyof DesktopBridge) =>
  `desktop:${member}`;
