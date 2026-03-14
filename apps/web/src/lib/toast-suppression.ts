const TOAST_SUPPRESSED_PATHS = new Set(["/desktop/command-bar"]);

/**
 * Routes that should never render or emit Sonner toasts.
 */
export function isToastSuppressedPath(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }

  return TOAST_SUPPRESSED_PATHS.has(pathname);
}
