import type { DesktopDeepLinkScheme } from "@kompose/env";

export const DESKTOP_DEEP_LINK_SCHEME_QUERY_PARAM = "desktop_scheme";

export function getDesktopAuthCallbackPrefix(
  scheme: DesktopDeepLinkScheme
): string {
  return `${scheme}://auth/callback`;
}

/**
 * Build the final deep-link URL that returns the browser OAuth flow back into
 * the correct installed desktop flavor.
 */
export function buildDesktopAuthCallbackUrl(options: {
  token: string;
  mode?: string | null;
  provider?: string | null;
  scheme: DesktopDeepLinkScheme;
}): string {
  const callbackUrl = new URL(getDesktopAuthCallbackPrefix(options.scheme));

  callbackUrl.searchParams.set("token", options.token);

  if (options.mode) {
    callbackUrl.searchParams.set("mode", options.mode);
  }

  if (options.provider) {
    callbackUrl.searchParams.set("provider", options.provider);
  }

  return callbackUrl.toString();
}
