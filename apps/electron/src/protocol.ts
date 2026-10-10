import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { DESKTOP_ORIGIN } from "@kompose/desktop";

export function isTrustedRenderer(url: string, devURL?: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "kompose-app:" && parsed.host === "app") ||
      (!!devURL && parsed.origin === new URL(devURL).origin)
    );
  } catch {
    return false;
  }
}

export function externalURL(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid URL");
  }
  const url = new URL(value);
  if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
    throw new Error("Unsupported URL scheme");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  return url.toString();
}

/** Resolve both Next HTML routes and exported RSC/static assets, inside the bundle. */
export async function resolveAsset(
  root: string,
  url: URL
): Promise<string | null> {
  if (`${url.protocol}//${url.host}` !== DESKTOP_ORIGIN) {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    return null;
  }
  const base = resolve(root, `.${pathname}`);
  const rel = relative(root, base);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  for (const candidate of [base, `${base}.html`, resolve(base, "index.html")]) {
    if (
      // biome-ignore lint/performance/noAwaitInLoops: Try the direct file before fallback routes.
      await stat(candidate).then(
        (entry) => entry.isFile(),
        () => false
      )
    ) {
      return candidate;
    }
  }
  return null;
}

export function sanitizeSession(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const data = value as Record<string, unknown>;
  if (!data.session || typeof data.session !== "object") {
    return value;
  }
  const {
    token: _token,
    ipAddress: _ip,
    userAgent: _agent,
    ...session
  } = data.session as Record<string, unknown>;
  return { ...data, session };
}

/** Cookies and bearer headers belong exclusively to the main process. */
export function publicResponseHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  for (const name of [
    "set-cookie",
    "set-auth-token",
    "authorization",
    "content-length",
    "content-encoding",
  ]) {
    result.delete(name);
  }
  result.set("Cache-Control", "no-store");
  return result;
}
