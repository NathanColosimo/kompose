import Link from "next/link";

/** Header shared by the landing and legal pages. */
export function SiteHeader() {
  return (
    <header data-desktop-drag-region>
      <div
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
        data-window-controls-inset
      >
        <Link className="font-serif text-lg font-medium" href="/">
          Kompose
        </Link>
        <nav aria-label="Main" className="flex items-center gap-5 text-sm">
          <a
            className="text-muted-foreground hover:text-foreground transition-colors"
            href="/docs"
          >
            Docs
          </a>
          <Link
            className="text-muted-foreground hover:text-foreground transition-colors"
            href="/login"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Kompose</p>
        <nav aria-label="Legal" className="flex items-center gap-5">
          <Link
            className="hover:text-foreground transition-colors"
            href="/privacy"
          >
            Privacy
          </Link>
          <Link
            className="hover:text-foreground transition-colors"
            href="/terms"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
