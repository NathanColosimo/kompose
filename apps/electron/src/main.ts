import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { electronClient } from "@better-auth/electron/client";
import {
  DESKTOP_COMMAND_BAR_MAX_HEIGHT,
  type DesktopBridge,
  type DesktopCommandBarShortcutPresetId,
  type DesktopInvokeMethod,
  type DesktopTaskSelection,
  desktopChannel,
  desktopCommandBarShortcutPresets,
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";
import { createAuthClient } from "better-auth/client";
import Conf from "conf";
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  globalShortcut,
  ipcMain,
  Menu,
  type Point,
  type Rectangle,
  screen,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  containsPoint,
  fitWindowBounds,
  parsePoint,
  parseWindowState,
  type SavedWindowState,
} from "./window-state";

const isMac = process.platform === "darwin";
const here = dirname(fileURLToPath(import.meta.url));
// Windows load the hosted web app; development points at the local Next server.
const serverURL = app.isPackaged
  ? "https://kompose.dev"
  : (process.env.KOMPOSE_SERVER_URL ?? "https://local.kompose.dev");
const serverOrigin = new URL(serverURL).origin;
const MAIN_WINDOW = { height: 840, width: 1280 };
const MAIN_WINDOW_MINIMUM = { height: 480, width: 720 };
const COMMAND_BAR = { height: 80, width: 480 };
const COMMAND_BAR_MINIMUM = { height: 56, width: COMMAND_BAR.width };

app.setName("Kompose");
// Development builds keep their own profile so they never touch release sessions.
app.setPath(
  "userData",
  join(app.getPath("appData"), app.isPackaged ? "Kompose" : "Kompose Dev")
);

let mainWindow: BrowserWindow | null = null;
let commandWindow: BrowserWindow | null = null;
let quitting = false;
let mainWasFocused = false;
let commandIdleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingTask: DesktopTaskSelection | null = null;
let readyUpdate: string | null = null;
// Where the popup's top-left belongs while shown; growing near the bottom of
// the display may shift the window up, but never moves this anchor.
let commandBarAnchor: Point | undefined;
let commandBarBounds: Rectangle | undefined;
let commandBarDragged = false;
const settings = new Conf<{
  commandBarPosition?: Point;
  mainWindow?: SavedWindowState;
  shortcut: DesktopCommandBarShortcutPresetId;
}>({
  configName: "settings",
  cwd: app.getPath("userData"),
  defaults: { shortcut: "cmd_or_ctrl_shift_k" },
});

function appURL(route: string) {
  return `${serverURL}${route}`;
}
function isAppURL(url: string) {
  return URL.parse(url)?.origin === serverOrigin;
}

/** Copy the session from Better Auth's token exchange into the windows' cookie store. */
async function adoptSessionCookies(response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair = "", ...parts] = header.split(";");
    const separator = pair.indexOf("=");
    const attributes = new Map(
      parts.map((part) => {
        const [key = "", ...value] = part.trim().split("=");
        return [key.toLowerCase(), value.join("=")];
      })
    );
    const maxAge = attributes.get("max-age");
    const expires = attributes.get("expires");
    let expirationDate: number | undefined;
    if (maxAge) {
      expirationDate = Date.now() / 1000 + Number(maxAge);
    } else if (expires) {
      expirationDate = Date.parse(expires) / 1000;
    }
    // biome-ignore lint/performance/noAwaitInLoops: A handful of auth cookies.
    await session.defaultSession.cookies.set({
      expirationDate,
      httpOnly: attributes.has("httponly"),
      name: pair.slice(0, separator).trim(),
      path: attributes.get("path") || "/",
      sameSite: "lax",
      secure: attributes.has("secure"),
      url: serverURL,
      value: pair.slice(separator + 1).trim(),
    });
  }
}

// The browser signs in and hands back a PKCE code through the auth URL scheme;
// the plugin exchanges it here. Registered before readiness, as Better Auth
// requires. This also takes the single-instance lock.
createAuthClient({
  baseURL: serverURL,
  plugins: [
    electronClient({
      clientID: ELECTRON_AUTH_CLIENT_ID,
      cookiePrefix: "kompose",
      protocol: { scheme: ELECTRON_AUTH_SCHEME },
      signInURL: appURL("/login"),
      // The session lives in Chromium's cookie store, not the plugin's.
      storage: { getItem: () => null, setItem: () => undefined },
      userImageProxy: { enabled: false },
    }),
    {
      fetchPlugins: [
        {
          hooks: {
            async onSuccess({ request, response }) {
              if (!request.url.toString().endsWith("/electron/token")) {
                return;
              }
              await adoptSessionCookies(response);
              commandWindow?.destroy();
              mainWindow?.loadURL(appURL("/dashboard"));
              showMain();
            },
          },
          id: "kompose-session",
          name: "Kompose session",
        },
      ],
      id: "kompose-session",
    },
  ],
}).setupMain({
  bridges: true,
  csp: false,
  getWindow: () => mainWindow,
  scheme: true,
});

/** Open http(s)/mailto links in the system browser; anything else is dropped. */
function openExternal(url: string) {
  const parsed = URL.parse(url);
  if (
    parsed &&
    ["https:", "http:", "mailto:"].includes(parsed.protocol) &&
    !(parsed.username || parsed.password)
  ) {
    shell.openExternal(parsed.toString()).catch(() => undefined);
  }
}

// Windows stay on the app origin; new windows and other sites open in the browser.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAppURL(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      // -3 is an aborted load, such as a navigation replacing another.
      if (isMainFrame && code !== -3 && isAppURL(url)) {
        contents.loadURL(offlinePage(url, description));
      }
    }
  );
});

function offlinePage(retryURL: string, reason: string) {
  const html = `<!doctype html><meta charset="utf-8"><title>Kompose</title>
<style>body{font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#666}button{font:inherit;margin-top:8px}</style>
<div style="text-align:center"><p>Kompose can't reach the server (${reason}).</p>
<button onclick="location.replace(${JSON.stringify(retryURL)})">Try again</button></div>
<script>addEventListener("online", () => location.replace(${JSON.stringify(retryURL)}))</script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createAppWindow(
  options: BrowserWindowConstructorOptions,
  route: string
) {
  const window = new BrowserWindow({
    ...options,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
    },
  });
  window.loadURL(appURL(route));
  return window;
}

function createMainWindow() {
  const saved = parseWindowState(settings.get("mainWindow"));
  const { workArea } = saved
    ? screen.getDisplayMatching(saved.bounds)
    : screen.getPrimaryDisplay();
  const bounds = fitWindowBounds(
    saved?.bounds ?? {
      ...MAIN_WINDOW,
      x: workArea.x + (workArea.width - MAIN_WINDOW.width) / 2,
      y: workArea.y + (workArea.height - MAIN_WINDOW.height) / 2,
    },
    workArea,
    MAIN_WINDOW_MINIMUM
  );
  const window = createAppWindow(
    {
      ...bounds,
      // Small displays may be below the usual minimum.
      minHeight: Math.min(MAIN_WINDOW_MINIMUM.height, workArea.height),
      minWidth: Math.min(MAIN_WINDOW_MINIMUM.width, workArea.width),
      title: "Kompose",
      ...(isMac ? { titleBarStyle: "hiddenInset" } : {}),
    },
    "/dashboard"
  );
  window.once("ready-to-show", () => {
    // maximize() also shows the window, so it waits for the first paint too.
    if (saved?.maximized) {
      window.maximize();
    }
    window.show();
  });
  rememberMainWindowState(window);
  // macOS keeps the app running when its window closes.
  window.on("close", (event) => {
    if (isMac && !quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    mainWindow = null;
  });
  window.webContents.on("did-finish-load", () => {
    if (pendingTask) {
      send(window, "onOpenTask", pendingTask);
      pendingTask = null;
    }
    if (readyUpdate) {
      send(window, "onUpdateReady", readyUpdate);
    }
  });
  return window;
}

function createCommandWindow() {
  const window = createAppWindow(
    {
      alwaysOnTop: true,
      frame: false,
      ...COMMAND_BAR,
      resizable: false,
      skipTaskbar: true,
      title: "Kompose Command Bar",
      ...(isMac
        ? {
            transparent: true,
            type: "panel",
            vibrancy: "hud",
            visualEffectState: "active",
          }
        : {}),
    },
    "/desktop/command-bar"
  );
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.on("blur", hideCommandBar);
  window.on("move", () => {
    const { x, y } = window.getBounds();
    // Only a user drag lands somewhere other than where main placed the bar.
    if (x !== commandBarBounds?.x || y !== commandBarBounds.y) {
      commandBarAnchor = { x, y };
      commandBarDragged = true;
    }
  });
  window.on("hide", () => {
    if (commandBarDragged && commandBarAnchor) {
      settings.set("commandBarPosition", commandBarAnchor);
      commandBarDragged = false;
    }
  });
  window.on("closed", () => {
    commandWindow = null;
  });
  return window;
}

function rememberMainWindowState(window: BrowserWindow) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    settings.set("mainWindow", {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    });
  };
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 250);
  };
  window.on("move", scheduleSave);
  window.on("resize", scheduleSave);
  window.on("maximize", save);
  window.on("unmaximize", save);
  window.on("close", save);
}

/** Pull the main window back if its display was removed while it was hidden. */
function keepOnScreen(window: BrowserWindow) {
  if (window.isMaximized() || window.isFullScreen()) {
    return;
  }
  const bounds = window.getBounds();
  window.setBounds(
    fitWindowBounds(
      bounds,
      screen.getDisplayMatching(bounds).workArea,
      MAIN_WINDOW_MINIMUM
    )
  );
}

/** Place the popup at its anchor, sized to its content, within the work area. */
function fitCommandBar(window: BrowserWindow, height: number) {
  if (!commandBarAnchor) {
    return;
  }
  const bounds = { ...commandBarAnchor, height, width: COMMAND_BAR.width };
  commandBarBounds = fitWindowBounds(
    bounds,
    screen.getDisplayMatching(bounds).workArea,
    COMMAND_BAR_MINIMUM
  );
  window.setBounds(commandBarBounds);
}

function showMain() {
  if (!mainWindow) {
    // Shown on ready-to-show, avoiding a blank frame.
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  keepOnScreen(mainWindow);
  mainWindow.show();
  mainWindow.focus();
}

function hideCommandBar() {
  commandWindow?.hide();
  clearTimeout(commandIdleTimer);
  // Retain a warm popup briefly, then release the renderer and its query cache.
  commandIdleTimer = setTimeout(() => {
    if (commandWindow && !commandWindow.isVisible()) {
      commandWindow.destroy();
    }
  }, 60_000);
  commandIdleTimer.unref();
}
function toggleCommandBar() {
  if (commandWindow?.isVisible()) {
    dismissCommandBar();
    return;
  }
  clearTimeout(commandIdleTimer);
  mainWasFocused = mainWindow?.isFocused() ?? false;
  commandWindow ??= createCommandWindow();
  // Open on the display under the cursor, at the remembered spot when it is there.
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );
  const saved = parsePoint(settings.get("commandBarPosition"));
  commandBarAnchor =
    saved && containsPoint(workArea, saved)
      ? saved
      : {
          x: workArea.x + (workArea.width - COMMAND_BAR.width) / 2,
          y: workArea.y + workArea.height * 0.25,
        };
  fitCommandBar(commandWindow, commandWindow.getBounds().height);
  if (!commandWindow.webContents.isLoading()) {
    commandWindow.show();
    commandWindow.focus();
  }
}
function dismissCommandBar() {
  hideCommandBar();
  if (mainWasFocused) {
    showMain();
  } else if (isMac) {
    app.hide();
  }
}

function applyShortcut(id: unknown) {
  const preset = desktopCommandBarShortcutPresets.find(
    (entry) => entry.id === id
  );
  if (!preset) {
    throw new Error("Unknown shortcut preset");
  }
  if (globalShortcut.isRegistered(preset.accelerator)) {
    return;
  }
  if (!globalShortcut.register(preset.accelerator, toggleCommandBar)) {
    throw new Error("This shortcut is already in use by another app.");
  }
  // Only this app's registrations are affected; the others are no-ops.
  for (const other of desktopCommandBarShortcutPresets) {
    if (other.id !== preset.id) {
      globalShortcut.unregister(other.accelerator);
    }
  }
  settings.set("shortcut", preset.id);
}

type DesktopEvent = Exclude<keyof DesktopBridge, DesktopInvokeMethod>;
type DesktopEventPayload<K extends DesktopEvent> = DesktopBridge[K] extends (
  callback: (value: infer T) => void
) => unknown
  ? T
  : never;
function send<K extends DesktopEvent>(
  window: BrowserWindow,
  event: K,
  value: DesktopEventPayload<K>
) {
  window.webContents.send(desktopChannel(event), value);
}
/** Register a bridge method for app pages; its argument is untrusted. */
function handle<K extends DesktopInvokeMethod>(
  method: K,
  callback: (
    value: unknown,
    window: BrowserWindow
  ) => Awaited<ReturnType<DesktopBridge[K]>>
) {
  ipcMain.handle(desktopChannel(method), (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      !(window && event.senderFrame) ||
      event.senderFrame !== event.sender.mainFrame ||
      !isAppURL(event.senderFrame.url)
    ) {
      throw new Error("Untrusted desktop request");
    }
    return callback(value, window);
  });
}

function registerBridge() {
  handle("showMainWindow", () => {
    hideCommandBar();
    showMain();
  });
  handle("getShortcut", () => settings.get("shortcut"));
  handle("setShortcut", (id) => applyShortcut(id));
  handle("dismissCommandBar", () => dismissCommandBar());
  handle("resizeCommandBar", (height, window) => {
    if (
      window !== commandWindow ||
      typeof height !== "number" ||
      !Number.isFinite(height)
    ) {
      return;
    }
    fitCommandBar(window, Math.min(DESKTOP_COMMAND_BAR_MAX_HEIGHT, height));
  });
  // Both windows run our own pages, so the selection is passed through as is.
  handle("openTask", (selection) => {
    hideCommandBar();
    showMain();
    if (!mainWindow || mainWindow.webContents.isLoading()) {
      pendingTask = selection as DesktopTaskSelection;
    } else {
      send(mainWindow, "onOpenTask", selection as DesktopTaskSelection);
    }
  });
  handle("installUpdate", () => {
    if (readyUpdate) {
      quitting = true;
      autoUpdater.quitAndInstall();
    }
  });
}

/** Updates download in the background; the web app offers a restart once ready. */
function setUpAutoUpdates() {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.on("update-downloaded", ({ version }) => {
    readyUpdate = version;
    if (mainWindow) {
      send(mainWindow, "onUpdateReady", version);
    }
  });
  autoUpdater.on("error", (error) =>
    console.warn("Update check failed", error.message)
  );
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 30 * 60_000).unref();
}

function setUpMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          { click: toggleCommandBar, label: "Open Command Bar" },
          { type: "separator" },
          { role: "close" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ])
  );
}

app
  .whenReady()
  .then(() => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    registerBridge();
    setUpMenu();
    showMain();
    try {
      applyShortcut(settings.get("shortcut"));
    } catch (error) {
      console.warn(String(error));
    }
    setUpAutoUpdates();
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on("activate", () => showMain());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});
