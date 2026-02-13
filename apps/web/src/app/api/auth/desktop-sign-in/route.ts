import { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import { type NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/desktop-sign-in?provider=google[&mode=link&link_token=TOKEN]
 *
 * Initiates an OAuth flow in the system browser for desktop (Tauri) sign-in or
 * account linking. Internally proxies to Better Auth's sign-in or link-social
 * endpoint, forwards the state cookies to the browser, and returns a 302
 * redirect to the OAuth provider (Google).
 *
 * Query params:
 *  - provider: OAuth provider name (e.g. "google", "apple")
 *  - mode: "link" for account linking (optional, defaults to sign-in)
 *  - link_token: One-time token for account linking (required when mode=link)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const mode = url.searchParams.get("mode"); // "link" or null (sign-in)
  const linkToken = url.searchParams.get("link_token");

  if (!provider) {
    return NextResponse.json(
      { error: "Missing provider parameter" },
      { status: 400 }
    );
  }

  try {
    // Build the internal request to Better Auth.
    const baseUrl = env.NEXT_PUBLIC_WEB_URL;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let endpoint: string;
    let body: Record<string, unknown>;

    if (mode === "link" && linkToken) {
      // --- Account linking mode ---
      // Verify and consume the one-time link token through auth.handler
      // so Better Auth produces a proper Set-Cookie with the correctly
      // formatted session cookie value.
      const verifyResponse = await auth.handler(
        new Request(`${baseUrl}/api/auth/one-time-token/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: linkToken }),
        })
      );

      if (!verifyResponse.ok) {
        return NextResponse.json(
          { error: "Invalid or expired link token" },
          { status: 401 }
        );
      }

      // Extract the session cookie (name=value) from the verify response
      // so we can forward it to the link-social endpoint.
      const sessionCookie = verifyResponse.headers
        .getSetCookie()
        .find((c) => c.startsWith("kompose.session_token="));

      if (!sessionCookie) {
        return NextResponse.json(
          { error: "Failed to recover session from link token" },
          { status: 401 }
        );
      }

      // Forward just the name=value portion as a Cookie header.
      headers.cookie = sessionCookie.split(";")[0];
      endpoint = `${baseUrl}/api/auth/link-social`;
      body = {
        provider,
        callbackURL: "/api/auth/desktop-callback",
      };
    } else {
      // --- Sign-in mode ---
      endpoint = `${baseUrl}/api/auth/sign-in/social`;
      body = {
        provider,
        callbackURL: "/api/auth/desktop-callback",
        errorCallbackURL: "/api/auth/desktop-callback",
      };
    }

    // Call Better Auth handler internally to get the OAuth redirect URL
    // and the state cookies that must be forwarded to the browser.
    const internalResponse = await auth.handler(
      new Request(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    );

    // Better Auth returns JSON { url, redirect: true } with Set-Cookie headers.
    const data = (await internalResponse.json()) as {
      url?: string;
      redirect?: boolean;
    };

    if (!data.url) {
      console.error(
        "[desktop-sign-in] Better Auth did not return a redirect URL:",
        data
      );
      return NextResponse.json(
        { error: "Failed to initiate OAuth flow" },
        { status: 500 }
      );
    }

    // Build a redirect response, forwarding all Set-Cookie headers from
    // Better Auth (state cookie) so the browser can complete the OAuth flow.
    const redirectResponse = NextResponse.redirect(data.url, 302);
    for (const cookie of internalResponse.headers.getSetCookie()) {
      redirectResponse.headers.append("Set-Cookie", cookie);
    }

    return redirectResponse;
  } catch (error) {
    console.error("[desktop-sign-in] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
