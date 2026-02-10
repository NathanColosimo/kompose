/**
 * Next.js instrumentation hook — runs once at server startup, before any
 * request handling. By importing the backend telemetry module here we
 * ensure the NodeSDK registers a global TracerProvider *before* Next.js
 * creates its root request spans. Without this, root spans
 * (BaseServer.handleRequest) are created against a no-op provider and
 * never exported.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/open-telemetry
 */
export async function register() {
  // Side-effect import: NodeSDK.start() runs at module evaluation time
  await import("@kompose/api/telemetry");
}
