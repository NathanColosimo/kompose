import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import {
  DESKTOP_COMMAND_BAR_MAX_HEIGHT,
  DESKTOP_ORIGIN,
  type DesktopBridge,
  type DesktopCommandBarShortcutPresetId,
  type DesktopInvokeMethod,
  type DesktopTaskSelection,
  type DesktopUpdateState,
  desktopCommandBarShortcutPresets,
  desktopEventChannels,
  desktopInvokeChannels,
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
  net,
  type Point,
  protocol,
  type Rectangle,
  screen,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  externalURL,
  isTrustedRenderer,
  parseTaskSelection,
  publicResponseHeaders,
  resolveAsset,
  sanitizeSession,
} from "./protocol";
import {
  containsPoint,
  fitWindowBounds,
  parsePoint,
  parseWindowState,
  type SavedWindowState,
} from "./window-state";

const isMac = process.platform === "darwin";
const here = dirname(fileURLToPath(import.meta.url));
const serverURL =
  process.env.KOMPOSE_SERVER_URL ??
  import.meta.env.MAIN_VITE_SERVER_URL ??
  "https://kompose.dev";
const devURL = app.isPackaged ? undefined : process.env.KOMPOSE_RENDERER_URL;
const assetRoot = app.isPackaged
  ? join(process.resourcesPath, "web")
  : join(here, "../../../web/out");
const updatesEnabled =
  app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // user-image: is Better Auth's proxied avatar scheme.
  "img-src 'self' data: blob: https: user-image:",
  "font-src 'self' data:",
  `connect-src 'self' ${new URL(serverURL).origin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join("; ");
const MAIN_WINDOW = { height: 840, width: 1280 };
const MAIN_WINDOW_MINIMUM = { height: 480, width: 720 };
const COMMAND_BAR = { height: 80, width: 480 };
const COMMAND_BAR_MINIMUM = { height: 56, width: COMMAND_BAR.width };
const AUTH_SESSION_CHANGE = /\/(electron\/token|sign-out)$/;
const AUTH_PROXY_ROUTES = new Map<string, "GET" | "POST">([
  ["/get-session", "GET"],
  ["/list-accounts", "GET"],
  ["/account-info", "GET"],
  ["/unlink-account", "POST"],
  ["/sign-out", "POST"],
]);
const RPC_FORWARDED_HEADERS = [
  "content-type",
  "accept",
  "last-event-id",
  "x-request-start",
];

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
let updateState: DesktopUpdateState = { status: "idle" };
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

function broadcast(channel: string, payload?: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}
const authClient = createAuthClient({
  baseURL: serverURL,
  fetchOptions: {
    onSuccess({ request }) {
      const url = request.url.toString();
      if (!AUTH_SESSION_CHANGE.test(url)) {
        return;
      }
      broadcast(desktopEventChannels.sessionChanged);
      if (url.endsWith("/electron/token")) {
        showMain();
      }
    },
  },
  plugins: [
    electronClient({
      clientID: ELECTRON_AUTH_CLIENT_ID,
      cookiePrefix: "kompose",
      protocol: { scheme: ELECTRON_AUTH_SCHEME },
      signInURL: `${serverURL}/login`,
      storage: storage({ configName: "auth" }),
    }),
  ],
});
// Register before readiness, as required by Better Auth and Electron. This also
// takes the single-instance lock and handles auth deep links.
authClient.setupMain({
  bridges: true,
  csp: false,
  getWindow: () => mainWindow,
  scheme: true,
});
protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "kompose-app",
  },
]);

/** Open http(s)/mailto links in the system browser; anything else is dropped. */
function openExternal(url: unknown) {
  try {
    shell.openExternal(externalURL(url)).catch(() => undefined);
  } catch {
    /* Unsupported schemes stay blocked. */
  }
}

// Every renderer, including ones we never create directly, stays on the app origin.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedRenderer(url, devURL)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

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
  window.on("focus", () =>
    window.webContents.send(desktopEventChannels.windowFocus, true)
  );
  window.on("blur", () =>
    window.webContents.send(desktopEventChannels.windowFocus, false)
  );
  window.loadURL(`${devURL ?? DESKTOP_ORIGIN}${route}`);
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
      window.webContents.send(desktopEventChannels.openTask, pendingTask);
      pendingTask = null;
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
      width: COMMAND_BAR.width,
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

type BridgeResult<K extends DesktopInvokeMethod> = Awaited<
  ReturnType<DesktopBridge[K]>
>;
/** Register a bridge method; its argument is untrusted and must be validated. */
function handle<K extends DesktopInvokeMethod>(
  method: K,
  callback: (
    value: unknown,
    window: BrowserWindow
  ) => BridgeResult<K> | Promise<BridgeResult<K>>
) {
  ipcMain.handle(desktopInvokeChannels[method], (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      !(window && event.senderFrame) ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRenderer(event.senderFrame.url, devURL)
    ) {
      throw new Error("Untrusted desktop request");
    }
    return callback(value, window);
  });
}

async function proxyAuth(request: Request, url: URL): Promise<Response> {
  const path = url.pathname.slice("/api/auth".length);
  const method = AUTH_PROXY_ROUTES.get(path);
  if (!method || method !== request.method) {
    return new Response("Not found", { status: 404 });
  }
  const result = await authClient.$fetch(path, {
    method,
    query: Object.fromEntries(url.searchParams),
    ...(method === "POST" ? { body: await request.json() } : {}),
  });
  return Response.json(
    path === "/get-session"
      ? sanitizeSession(result.data)
      : (result.error ?? result.data),
    {
      headers: { "Cache-Control": "no-store" },
      status: result.error?.status ?? 200,
    }
  );
}
async function proxyRPC(request: Request, url: URL): Promise<Response> {
  // The destination is fixed. Renderer-supplied cookies, auth, and origins are ignored.
  const headers = new Headers({
    cookie: authClient.getCookie(),
    origin: `${ELECTRON_AUTH_SCHEME}:/`,
  });
  for (const name of RPC_FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  // This authenticated request belongs to main, not Chromium's renderer network
  // context. Node fetch preserves the plugin cookie without a browser CORS preflight.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(`${serverURL}${url.pathname}${url.search}`, {
    body: hasBody ? await request.arrayBuffer() : undefined,
    credentials: "omit",
    headers,
    method: request.method,
    redirect: "error",
    signal: request.signal,
  });
  // Forward oRPC subscriptions without buffering.
  return new Response(response.body, {
    headers: publicResponseHeaders(response.headers),
    status: response.status,
  });
}
async function serveAsset(url: URL): Promise<Response> {
  const path = await resolveAsset(assetRoot, url);
  if (!path) {
    return new Response("Not found", { status: 404 });
  }
  const response = await net.fetch(pathToFileURL(path).toString());
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return response;
}
async function handleAppRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== "app") {
    return new Response("Not found", { status: 404 });
  }
  if (url.pathname.startsWith("/api/auth/")) {
    return withDevCors(await proxyAuth(request, url));
  }
  if (url.pathname.startsWith("/api/rpc/")) {
    return withDevCors(await proxyRPC(request, url));
  }
  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }
  return serveAsset(url);
}
/** The hot-reload renderer runs on its own origin; packaged builds never need CORS. */
function withDevCors(response: Response) {
  if (devURL) {
    response.headers.set("Access-Control-Allow-Origin", new URL(devURL).origin);
  }
  return response;
}

function setUpdateState(state: DesktopUpdateState) {
  updateState = state;
  broadcast(desktopEventChannels.updateState, state);
}
async function checkForUpdates() {
  if (!updatesEnabled) {
    throw new Error("This build does not include automatic updates.");
  }
  if (updateState.status === "idle") {
    await autoUpdater.checkForUpdates();
  }
}
function setUpAutoUpdates() {
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", () =>
    setUpdateState({ status: "checking" })
  );
  autoUpdater.on("update-not-available", () =>
    setUpdateState({ status: "idle" })
  );
  autoUpdater.on("update-available", (info) =>
    setUpdateState({ status: "downloading", version: info.version })
  );
  autoUpdater.on("download-progress", (progress) =>
    setUpdateState({ ...updateState, percent: progress.percent })
  );
  autoUpdater.on("update-downloaded", (info) =>
    setUpdateState({ status: "ready", version: info.version })
  );
  autoUpdater.on("error", (error) =>
    setUpdateState({ error: error.message, status: "idle" })
  );
  if (updatesEnabled) {
    // Failures are reported through the "error" event above.
    const backgroundCheck = () => checkForUpdates().catch(() => undefined);
    backgroundCheck();
    setInterval(backgroundCheck, 30 * 60_000).unref();
  }
}

function registerBridge() {
  handle("openExternal", (url) => openExternal(url));
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
  handle("openTask", (value) => {
    const selection = parseTaskSelection(value);
    hideCommandBar();
    showMain();
    if (mainWindow?.webContents.isLoading()) {
      pendingTask = selection;
    } else {
      mainWindow?.webContents.send(desktopEventChannels.openTask, selection);
    }
  });
  handle("getUpdateState", () => updateState);
  handle("checkForUpdates", () => checkForUpdates());
  handle("installUpdate", () => {
    if (updateState.status !== "ready") {
      return;
    }
    setUpdateState({ ...updateState, status: "installing" });
    quitting = true;
    autoUpdater.quitAndInstall();
  });
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
    protocol.handle("kompose-app", async (request) => {
      try {
        return await handleAppRequest(request);
      } catch (error) {
        console.error(
          "Desktop request failed",
          error instanceof Error ? error.message : "Unknown error"
        );
        return Response.json(
          { message: "Request failed. Please try again." },
          { status: 502 }
        );
      }
    });
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
