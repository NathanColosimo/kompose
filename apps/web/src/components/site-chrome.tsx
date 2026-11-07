import Link from "next/link";

/** Header shared by the landing and legal pages. */
export function SiteHeader() {
  return (
    <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
      <Link className="font-medium font-serif text-lg" href="/">
        Kompose
      </Link>
      <nav className="flex items-center gap-5 text-sm">
        <a
          className="text-muted-foreground transition-colors hover:text-foreground"
          href="/docs"
        >
          Docs
        </a>
        <Link
          className="text-muted-foreground transition-colors hover:text-foreground"
          href="/login"
        >
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Kompose</p>
        <nav className="flex items-center gap-5">
          <Link
            className="transition-colors hover:text-foreground"
            href="/privacy"
          >
            Privacy
          </Link>
          <Link
            className="transition-colors hover:text-foreground"
            href="/terms"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
