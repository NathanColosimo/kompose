import type { Metadata } from "next";
import { preload } from "react-dom";
import "../index.css";
import Providers from "@/components/providers";
import sentientUprightUrl from "@/fonts/Sentient-Variable.woff2";

export const metadata: Metadata = {
  description:
    "Kompose merges your calendar, tasks, and integrations into one orchestration canvas for planning your day.",
  title: "kompose — calendar and tasks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page's text is Sentient (index.css), so fetch it with the HTML
  // instead of after the CSS is parsed. The import resolves to the same
  // content-hashed, immutable URL the stylesheet uses.
  preload(sentientUprightUrl, {
    as: "font",
    crossOrigin: "anonymous",
    type: "font/woff2",
  });
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <div className="min-h-svh bg-background text-foreground">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
