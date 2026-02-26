import { auth } from "@kompose/auth";
import { env } from "@kompose/env";
import { cookies } from "next/headers";
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
    const baseUrl = env.NEXT_PUBLIC_WEB_URL;

    if (mode === "link" && linkToken) {
      // --- Account linking mode ---
      // Use direct API calls instead of auth.handler to avoid
      // nextCookies() intercepting Set-Cookie headers and CSRF/session
      // issues with synthetic Request objects.
      // Verify the one-time token. This also calls setSessionCookie
      // internally, and nextCookies() sets the signed cookie value via
      // Next.js cookies() so we can read it back below.
      try {
        await auth.api.verifyOneTimeToken({
          body: { token: linkToken },
        });
      } catch {
        return NextResponse.json(
          { error: "Invalid or expired link token" },
          { status: 401 }
        );
      }

      // Read the signed session cookie that nextCookies() just set.
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get("kompose.session_token");
      if (!sessionCookie) {
        return NextResponse.json(
          { error: "Failed to recover session from link token" },
          { status: 401 }
        );
      }

      const linkResponse = await auth.handler(
        new Request(`${baseUrl}/api/auth/link-social`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `${sessionCookie.name}=${sessionCookie.value}`,
            origin: baseUrl,
          },
          body: JSON.stringify({
            provider,
            callbackURL: "/api/auth/desktop-callback?mode=link",
          }),
        })
      );

      const linkData = (await linkResponse.json().catch(() => null)) as {
        url?: string;
        redirect?: boolean;
        code?: string;
        message?: string;
      } | null;

      if (!linkData?.url) {
        return NextResponse.json(
          {
            error: "Failed to initiate OAuth flow",
            status: linkResponse.status,
            detail: linkData,
          },
          { status: 500 }
        );
      }

      // Forward OAuth state cookies from the internal response.
      // nextCookies() also sets them via cookies(), but NextResponse.redirect
      // doesn't merge cookies() into the response, so we forward manually.
      const linkRedirect = NextResponse.redirect(linkData.url, 302);
      for (const cookie of linkResponse.headers.getSetCookie()) {
        linkRedirect.headers.append("Set-Cookie", cookie);
      }
      return linkRedirect;
    }

    // --- Sign-in mode ---
    const internalResponse = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          callbackURL: "/api/auth/desktop-callback",
          errorCallbackURL: "/api/auth/desktop-callback",
        }),
      })
    );

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

    // Forward Set-Cookie headers (OAuth state) so the browser can
    // complete the sign-in flow.
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
