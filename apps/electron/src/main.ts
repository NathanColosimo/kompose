import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import {
  DESKTOP_ORIGIN,
  type DesktopCommandBarShortcutPresetId,
  type DesktopTaskSelection,
  type DesktopUpdateState,
  desktopCommandBarShortcutPresets,
  ELECTRON_AUTH_CLIENT_ID,
  ELECTRON_AUTH_SCHEME,
} from "@kompose/desktop";
import { createAuthClient } from "better-auth/client";
import Conf from "conf";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  externalURL,
  isTrustedRenderer,
  publicResponseHeaders,
  resolveAsset,
  sanitizeSession,
} from "./protocol";

const AUTH_SESSION_CHANGE = /\/(electron\/token|sign-out)$/;
const here = dirname(fileURLToPath(import.meta.url));
const serverURL =
  process.env.KOMPOSE_SERVER_URL ??
  import.meta.env.MAIN_VITE_SERVER_URL ??
  "https://kompose.dev";
const devURL = app.isPackaged ? undefined : process.env.KOMPOSE_RENDERER_URL;
const assetRoot = app.isPackaged
  ? join(process.resourcesPath, "web")
  : join(here, "../../../web/out");
const serverOrigin = new URL(serverURL).origin;
app.setName("Kompose Electron");
// Use a stable Electron profile, separate from the previous desktop app.
app.setPath("userData", join(app.getPath("appData"), "Kompose Electron"));

let mainWindow: BrowserWindow | null = null;
let commandWindow: BrowserWindow | null = null;
let quitting = false;
let mainWasFocused = false;
let commandIdleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingTask: DesktopTaskSelection | null = null;
let updateState: DesktopUpdateState = { status: "idle" };
const settings = new Conf<{ shortcut: DesktopCommandBarShortcutPresetId }>({
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
    onSuccess(context) {
      if (AUTH_SESSION_CHANGE.test(context.request.url.toString())) {
        broadcast("desktop:session-changed");
        if (!context.request.url.toString().endsWith("/sign-out")) {
          showMain();
        }
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
// Register before readiness, as required by Better Auth and Electron.
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

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(false);
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(command: boolean) {
  const window = new BrowserWindow({
    alwaysOnTop: command,
    frame: !command,
    height: command ? 80 : 840,
    minHeight: command ? 56 : 480,
    minWidth: command ? 480 : 720,
    resizable: !command,
    show: false,
    skipTaskbar: command,
    title: command ? "Kompose Command Bar" : "Kompose Electron",
    width: command ? 480 : 1280,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          ...(command
            ? {
                transparent: true,
                type: "panel" as const,
                vibrancy: "hud" as const,
                visualEffectState: "active" as const,
              }
            : {}),
        }
      : {}),
    webPreferences: {
      backgroundThrottling: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(externalURL(url));
    } catch {
      /* Unsupported schemes stay blocked. */
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRenderer(url, devURL)) {
      return;
    }
    event.preventDefault();
    try {
      shell.openExternal(externalURL(url));
    } catch {
      /* Never navigate privileged windows away. */
    }
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault()
  );
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false)
  );
  window.on("focus", () =>
    window.webContents.send("desktop:window-focus", true)
  );
  window.on("blur", () => {
    window.webContents.send("desktop:window-focus", false);
    if (command) {
      hideCommandBar();
    }
  });
  window.on("closed", () => {
    if (command) {
      commandWindow = null;
    } else {
      mainWindow = null;
    }
  });
  if (!command) {
    window.on("close", (event) => {
      if (process.platform === "darwin" && !quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.webContents.on("did-finish-load", () => {
      if (pendingTask) {
        window.webContents.send("desktop:open-task", pendingTask);
        pendingTask = null;
      }
    });
  }
  const route = command ? "/desktop/command-bar" : "/dashboard";
  window.loadURL(`${devURL ?? DESKTOP_ORIGIN}${route}`);
  window.once("ready-to-show", () => {
    window.show();
    if (command) {
      window.focus();
    }
  });
  return window;
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
  if (!commandWindow || commandWindow.isDestroyed()) {
    commandWindow = createWindow(true);
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  commandWindow.setPosition(
    Math.round(x + (width - 480) / 2),
    Math.round(y + height * 0.25)
  );
  if (!commandWindow.webContents.isLoading()) {
    commandWindow.show();
    commandWindow.focus();
  }
}
function dismissCommandBar() {
  hideCommandBar();
  if (mainWasFocused) {
    showMain();
  } else if (process.platform === "darwin") {
    app.hide();
  }
}
function applyShortcut(id: DesktopCommandBarShortcutPresetId) {
  const preset = desktopCommandBarShortcutPresets.find(
    (entry) => entry.id === id
  );
  if (!preset) {
    throw new Error("Unknown shortcut preset");
  }
  const previous = desktopCommandBarShortcutPresets.find(
    (entry) => entry.id === settings.get("shortcut")
  );
  if (previous?.id === id && globalShortcut.isRegistered(preset.accelerator)) {
    return;
  }
  if (!globalShortcut.register(preset.accelerator, toggleCommandBar)) {
    throw new Error("This shortcut is already in use by another app.");
  }
  if (previous && previous.id !== id) {
    globalShortcut.unregister(previous.accelerator);
  }
  settings.set("shortcut", id);
}

function handle<T>(
  channel: string,
  callback: (value: T, window: BrowserWindow) => unknown
) {
  ipcMain.handle(`desktop:${channel}`, (event, value: T) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      !window ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRenderer(event.senderFrame.url, devURL)
    ) {
      throw new Error("Untrusted desktop request");
    }
    return callback(value, window);
  });
}

const allowedAuth = new Map([
  ["/get-session", "GET"],
  ["/list-accounts", "GET"],
  ["/account-info", "GET"],
  ["/unlink-account", "POST"],
  ["/sign-out", "POST"],
]);
async function proxyAPI(request: Request, url: URL): Promise<Response> {
  if (url.pathname.startsWith("/api/auth/")) {
    const path = url.pathname.slice("/api/auth".length);
    if (allowedAuth.get(path) !== request.method) {
      return new Response("Not found", { status: 404 });
    }
    const result = await authClient.$fetch(path, {
      method: request.method as "GET" | "POST",
      query: Object.fromEntries(url.searchParams),
      ...(request.method === "POST" ? { body: await request.json() } : {}),
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
  if (!url.pathname.startsWith("/api/rpc/")) {
    return new Response("Not found", { status: 404 });
  }
  // The destination is fixed. Renderer-supplied cookies, auth, and origins are ignored.
  const headers = new Headers({
    cookie: authClient.getCookie(),
    origin: `${ELECTRON_AUTH_SCHEME}:/`,
  });
  for (const name of [
    "content-type",
    "accept",
    "last-event-id",
    "x-request-start",
  ]) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  // This authenticated request belongs to main, not Chromium's renderer network
  // context. Node fetch preserves the plugin cookie without a browser CORS preflight.
  const response = await fetch(`${serverURL}${url.pathname}${url.search}`, {
    credentials: "omit",
    headers,
    method: request.method,
    redirect: "error",
    signal: request.signal,
    ...(request.method !== "GET" && request.method !== "HEAD"
      ? { body: await request.arrayBuffer() }
      : {}),
  });
  // Forward oRPC subscriptions without buffering.
  return new Response(response.body, {
    headers: publicResponseHeaders(response.headers),
    status: response.status,
  });
}

function setUpdateState(state: DesktopUpdateState) {
  updateState = state;
  broadcast("desktop:update-state", state);
}
async function checkUpdates() {
  if (
    !(
      app.isPackaged &&
      existsSync(join(process.resourcesPath, "app-update.yml"))
    )
  ) {
    throw new Error("This build does not include automatic updates.");
  }
  if (updateState.status !== "idle") {
    return;
  }
  await autoUpdater.checkForUpdates();
}

async function backgroundUpdateCheck() {
  try {
    await checkUpdates();
  } catch (error) {
    setUpdateState({
      error: error instanceof Error ? error.message : "Update check failed.",
      status: "idle",
    });
  }
}

app
  .whenReady()
  .then(() => {
    protocol.handle("kompose-app", async (request) => {
      const url = new URL(request.url);
      if (url.host !== "app") {
        return new Response("Not found", { status: 404 });
      }
      try {
        if (url.pathname.startsWith("/api/")) {
          const response = await proxyAPI(request, url);
          if (devURL) {
            response.headers.set(
              "Access-Control-Allow-Origin",
              new URL(devURL).origin
            );
          }
          return response;
        }
        const path = await resolveAsset(assetRoot, url);
        if (!path) {
          return new Response("Not found", { status: 404 });
        }
        const response = await net.fetch(pathToFileURL(path).toString());
        response.headers.set(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: user-image:; font-src 'self' data:; connect-src 'self' ${serverOrigin}; object-src 'none'; base-uri 'self'; frame-src 'none'`
        );
        return response;
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
    handle<string>("open-external", (url) =>
      shell.openExternal(externalURL(url))
    );
    handle("get-shortcut", () => settings.get("shortcut"));
    handle<DesktopCommandBarShortcutPresetId>("set-shortcut", (id) =>
      applyShortcut(id)
    );
    handle("dismiss-command-bar", () => dismissCommandBar());
    handle<number>("resize-command-bar", (height, window) => {
      if (window !== commandWindow || !Number.isFinite(height)) {
        return;
      }
      window.setSize(480, Math.round(Math.min(600, Math.max(56, height))));
    });
    handle<DesktopTaskSelection>("open-task", (selection) => {
      if (
        !selection ||
        typeof selection.taskId !== "string" ||
        !["calendar", "sidebar"].includes(selection.target)
      ) {
        throw new Error("Invalid task selection");
      }
      hideCommandBar();
      showMain();
      if (mainWindow?.webContents.isLoading()) {
        pendingTask = selection;
      } else {
        mainWindow?.webContents.send("desktop:open-task", selection);
      }
    });
    handle("update-state", () => updateState);
    handle("check-updates", () => checkUpdates());
    handle("install-update", () => {
      if (updateState.status !== "ready") {
        return;
      }
      setUpdateState({ ...updateState, status: "installing" });
      quitting = true;
      autoUpdater.quitAndInstall();
    });
    autoUpdater.channel = "electron";
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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        {
          label: "File",
          submenu: [
            { label: "Open Command Bar", click: toggleCommandBar },
            { type: "separator" },
            { role: "close" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ])
    );
    showMain();
    try {
      applyShortcut(settings.get("shortcut"));
    } catch (error) {
      console.warn(String(error));
    }
    if (
      app.isPackaged &&
      existsSync(join(process.resourcesPath, "app-update.yml"))
    ) {
      backgroundUpdateCheck();
      setInterval(backgroundUpdateCheck, 30 * 60_000).unref();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("activate", () => showMain());
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
