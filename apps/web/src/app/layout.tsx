import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Baskerville, Lora } from "next/font/google";
import "../index.css";
import Providers from "@/components/providers";

// Preload the custom font trio so the CSS variables resolve immediately.
const libreBaskerville = Libre_Baskerville({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "700"],
});

const lora = Lora({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

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
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${libreBaskerville.variable} ${lora.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <Providers>
          <div className="min-h-svh bg-background text-foreground">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
