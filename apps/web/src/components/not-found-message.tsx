/**
 * Next's built-in 404 UI (http-access-fallback/error-fallback), copied because
 * it isn't exported. Two root layouts mean the app renders it itself: in
 * app/global-not-found.tsx and app/(docs)/not-found.tsx.
 */
export function NotFoundMessage() {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
        height: "100vh",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div>
        <style>
          {
            "body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}"
          }
        </style>
        <h1
          className="next-error-h1"
          style={{
            display: "inline-block",
            fontSize: 24,
            fontWeight: 500,
            lineHeight: "49px",
            margin: "0 20px 0 0",
            padding: "0 23px 0 0",
            verticalAlign: "top",
          }}
        >
          404
        </h1>
        <div style={{ display: "inline-block" }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 400,
              lineHeight: "49px",
              margin: 0,
            }}
          >
            This page could not be found.
          </h2>
        </div>
      </div>
    </div>
  );
}
