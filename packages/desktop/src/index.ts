/** Shared, serializable contract for the sandboxed desktop renderer. */
export const ELECTRON_AUTH_SCHEME = "com.nathancolosimo.kompose";
export const ELECTRON_AUTH_CLIENT_ID = "kompose-electron";
export const DESKTOP_ORIGIN = "kompose-app://app";
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
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "installing";
export interface DesktopUpdateState {
  error?: string;
  percent?: number;
  status: DesktopUpdateStatus;
  version?: string;
}
export interface DesktopTaskSelection {
  date?: string;
  requestId: string;
  sidebarView?: "inbox" | "today";
  target: "calendar" | "sidebar";
  taskId: string;
}
/** Renderer → main requests, keyed by the bridge method that sends them. */
export const desktopInvokeChannels = {
  checkForUpdates: "desktop:check-for-updates",
  dismissCommandBar: "desktop:dismiss-command-bar",
  getShortcut: "desktop:get-shortcut",
  getUpdateState: "desktop:get-update-state",
  installUpdate: "desktop:install-update",
  openExternal: "desktop:open-external",
  openTask: "desktop:open-task",
  resizeCommandBar: "desktop:resize-command-bar",
  setShortcut: "desktop:set-shortcut",
  showMainWindow: "desktop:show-main-window",
} as const satisfies Partial<Record<keyof DesktopBridge, string>>;
export type DesktopInvokeMethod = keyof typeof desktopInvokeChannels;
/** Main → renderer notifications. */
export const desktopEventChannels = {
  openTask: "desktop:task-opened",
  sessionChanged: "desktop:session-changed",
  updateState: "desktop:update-state",
  windowFocus: "desktop:window-focus",
} as const;
export interface DesktopBridge {
  checkForUpdates: () => Promise<void>;
  dismissCommandBar: () => Promise<void>;
  getShortcut: () => Promise<DesktopCommandBarShortcutPresetId>;
  getUpdateState: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<void>;
  onOpenTask: (
    callback: (selection: DesktopTaskSelection) => void
  ) => () => void;
  onSessionChanged: (callback: () => void) => () => void;
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
  onWindowFocus: (callback: (focused: boolean) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  openTask: (selection: DesktopTaskSelection) => Promise<void>;
  platform: string;
  resizeCommandBar: (height: number) => Promise<void>;
  setShortcut: (id: DesktopCommandBarShortcutPresetId) => Promise<void>;
  showMainWindow: () => Promise<void>;
}
