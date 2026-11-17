import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Command Bar — kompose",
};

export default function DesktopCommandBarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        nextjs-portal {
          display: none !important;
        }

        html,
        body {
          background: transparent !important;
        }

        body > div.min-h-svh {
          background: transparent !important;
        }
      `}</style>
      {children}
    </>
  );
}
