/**
 * Layout for the desktop command bar popup window.
 * Hides the Next.js dev indicator which would overlap the compact popup.
 */
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
