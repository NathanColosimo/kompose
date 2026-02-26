import { auth } from "@kompose/auth";
import type { NextRequest } from "next/server";

/**
 * GET /api/auth/desktop-callback
 *
 * Called by the browser after Better Auth completes the OAuth flow. At this
 * point the browser has the session cookie set by Better Auth. This route:
 *  1. Generates a one-time token tied to the current session via the plugin.
 *  2. Returns an HTML page that auto-redirects to kompose://auth/callback.
 *
 * The Tauri webview then verifies the token via the Better Auth client.
 * The bearer plugin returns the session token in a `set-auth-token` response
 * header, which the client stores in localStorage for all future requests.
 */
export async function GET(request: NextRequest) {
  try {
    // Generate a one-time token for the current session. The plugin's
    // sessionMiddleware validates the session from cookies automatically.
    const data = await auth.api.generateOneTimeToken({
      headers: request.headers,
    });

    // Preserve the mode param so the Tauri deep link handler knows
    // whether this was a sign-in or account-link operation.
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const modeParam = mode ? `&mode=${mode}` : "";
    const deepLinkUrl = `kompose://auth/callback?token=${data.token}${modeParam}`;

    // Return an HTML page that auto-redirects to the deep link.
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
