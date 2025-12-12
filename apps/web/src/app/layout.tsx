import "@js-temporal/polyfill/global";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Libre_Baskerville, Lora } from "next/font/google";
import "../index.css";
import Providers from "@/components/providers";

// Preload the custom font trio so the CSS variables resolve immediately.
const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-sans",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "kompose",
  description: "kompose",
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
