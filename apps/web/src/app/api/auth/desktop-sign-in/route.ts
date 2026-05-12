import { auth } from "@kompose/auth";
import { desktopDeepLinkSchemeSchema, env } from "@kompose/env";
import { type NextRequest, NextResponse } from "next/server";
import { DESKTOP_DEEP_LINK_SCHEME_QUERY_PARAM } from "@/lib/desktop-deep-link";

function isGenericOAuthProvider(provider: string) {
  return provider === "whoop";
}

// POST: desktop opens this URL via the system browser. GET is required because
// the browser navigates here directly (not via fetch). OAuth state parameters
// and one-time link tokens protect against CSRF.
export function POST(request: NextRequest) {
  return handleDesktopSignIn(request);
}

export function GET(request: NextRequest) {
  return handleDesktopSignIn(request);
}

async function handleDesktopSignIn(request: NextRequest) {
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
    const desktopScheme = desktopDeepLinkSchemeSchema.parse(
      url.searchParams.get(DESKTOP_DEEP_LINK_SCHEME_QUERY_PARAM)
    );

    const callbackEntries: Record<string, string> = {
      [DESKTOP_DEEP_LINK_SCHEME_QUERY_PARAM]: desktopScheme,
      provider,
    };

    if (mode === "link" && !linkToken) {
      return NextResponse.json(
        { error: "Missing link token" },
        { status: 400 }
      );
    }

    if (mode === "link" && linkToken) {
      callbackEntries.mode = "link";
      const callbackParams = new URLSearchParams(callbackEntries);

      // --- Account linking mode ---
      // Recover the desktop session from the one-time token and then pass
      // the recovered signed bearer token through explicit Authorization
      // headers. This avoids depending on a transient cookie side effect,
      // which was unreliable in production desktop flows.
      const verification = await auth.api
        .verifyOneTimeToken({
          body: { token: linkToken },
          returnHeaders: true,
        })
        .catch(() => null);

      if (!verification) {
        return NextResponse.json(
          { error: "Invalid or expired link token" },
          { status: 401 }
        );
      }

      const recoveredAuthToken = verification.headers.get("set-auth-token");
      if (!recoveredAuthToken) {
        return NextResponse.json(
          { error: "Failed to recover session from link token" },
          { status: 401 }
        );
      }

      const authHeaders = new Headers({
        authorization: `Bearer ${recoveredAuthToken}`,
        origin: baseUrl,
      });

      const callbackURL = `/api/auth/desktop-callback?${callbackParams.toString()}`;

      try {
        const linkResult = isGenericOAuthProvider(provider)
          ? await auth.api.oAuth2LinkAccount({
              body: {
                callbackURL,
                providerId: provider,
              },
              headers: authHeaders,
              returnHeaders: true,
            })
          : await auth.api.linkSocialAccount({
              body: {
                callbackURL,
                provider,
              },
              headers: authHeaders,
              returnHeaders: true,
            });

        if (!linkResult.response.url) {
          return NextResponse.json(
            {
              detail: linkResult.response,
              error: "Failed to initiate OAuth flow",
            },
            { status: 500 }
          );
        }

        const linkRedirect = NextResponse.redirect(
          linkResult.response.url,
          302
        );
        for (const cookie of linkResult.headers.getSetCookie()) {
          linkRedirect.headers.append("Set-Cookie", cookie);
        }
        return linkRedirect;
      } catch (error) {
        console.error("[desktop-sign-in] Failed to initiate link flow:", error);
        return NextResponse.json(
          { error: "Failed to initiate OAuth flow" },
          { status: 500 }
        );
      }
    }

    // --- Sign-in mode ---
    const callbackParams = new URLSearchParams(callbackEntries);
    const internalResponse = await auth.handler(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          callbackURL: `/api/auth/desktop-callback?${callbackParams.toString()}`,
          errorCallbackURL: `/api/auth/desktop-callback?${callbackParams.toString()}`,
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
