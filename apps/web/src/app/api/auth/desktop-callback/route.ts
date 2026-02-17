import { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import type { NextRequest } from "next/server";

const SAME_SITE_RE = /SameSite=\w+/i;
const SECURE_RE = /;\s*Secure/i;

/**
 * GET /api/auth/desktop-callback
 *
 * Two modes:
 *
 * 1. **Token generation** (no `verify` param):
 *    Called by the browser after Better Auth completes the OAuth flow.
 *    Generates a one-time token and redirects to kompose://auth/callback.
 *
 * 2. **Token verification** (`?verify=TOKEN`):
 *    Called by the Tauri webview as a first-party page navigation.
 *    Verifies the one-time token, sets the session cookie (first-party,
 *    bypassing Safari/WKWebView ITP), and redirects back to the embedded
 *    Tauri app at tauri://localhost/dashboard.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const verifyToken = url.searchParams.get("verify");

  if (verifyToken) {
    return await handleVerify(verifyToken);
  }

  return await handleGenerateToken(request);
}

/**
 * Verify mode: exchange a one-time token for a session cookie via a
 * first-party page load. WKWebView (Safari engine) blocks Set-Cookie on
 * cross-origin fetch responses (ITP), but allows them on first-party
 * navigations. After setting the cookie, redirects the webview back to
 * tauri://localhost/dashboard so the embedded app can use the cookie.
 */
async function handleVerify(token: string) {
  try {
    // Call auth.handler so Better Auth produces correctly signed cookies.
    const verifyResponse = await auth.handler(
      new Request(`${env.NEXT_PUBLIC_WEB_URL}/api/auth/one-time-token/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );

    if (!verifyResponse.ok) {
      return new Response(
        htmlPage(
          "Authentication failed",
          "Invalid or expired token. Please close this tab and try again.",
          // Auto-redirect back to the Tauri app login page after a moment.
          '<script>setTimeout(function(){window.location.href="tauri://localhost/login"},2000);</script>'
        ),
        { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // In production (HTTPS), rewrite cookies to SameSite=None; Secure so
    // subsequent cross-origin fetch from tauri://localhost includes them.
    // In dev (HTTP), leave as-is — WKWebView is lenient with localhost.
    const isProduction = env.NEXT_PUBLIC_WEB_URL.startsWith("https://");
    const cookies = verifyResponse.headers.getSetCookie();
    const patchedCookies = isProduction
      ? cookies.map((c) => {
          let patched = c.replace(SAME_SITE_RE, "SameSite=None");
          if (!SECURE_RE.test(patched)) {
            patched += "; Secure";
          }
          return patched;
        })
      : cookies;

    // Return HTML that redirects the webview back to the embedded Tauri app.
    const response = new Response(
      htmlPage(
        "Signed in!",
        "Returning to Kompose...",
        '<script>window.location.href="tauri://localhost/dashboard";</script>'
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );

    for (const cookie of patchedCookies) {
      response.headers.append("Set-Cookie", cookie);
    }

    return response;
  } catch (error) {
    console.error("[desktop-callback] Verify error:", error);
    return new Response(
      htmlPage(
        "Authentication failed",
        "Something went wrong. Please try again.",
        '<script>setTimeout(function(){window.location.href="tauri://localhost/login"},2000);</script>'
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

/** Generate mode: create a one-time token and redirect to the deep link. */
async function handleGenerateToken(request: NextRequest) {
  try {
    const data = await auth.api.generateOneTimeToken({
      headers: request.headers,
    });

    const deepLinkUrl = `kompose://auth/callback?token=${data.token}`;

    return new Response(
      htmlPage(
        "Signed in!",
        "Returning to Kompose...",
        `<script>window.location.href = ${JSON.stringify(deepLinkUrl)};</script>`
      ),
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (error) {
    console.error("[desktop-callback] Error:", error);
    return new Response(
      htmlPage(
        "Authentication failed",
        "No valid session found. Please close this tab and try again."
      ),
      {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
}

/** Minimal HTML page template for browser feedback. */
function htmlPage(title: string, message: string, extra = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Kompose</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fafafa; color: #111; }
    .card { text-align: center; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; }
  </style>
  ${extra}
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p style="margin-top: 1rem; font-size: 0.875rem; color: #999;">You can close this tab.</p>
  </div>
</body>
</html>`;
}
