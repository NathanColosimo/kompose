import "zod/compile";

/**
 * Register telemetry before Next.js creates root request spans, or they are lost.
 * See documents/otel.md.
 */
export async function register() {
  await import("@kompose/api/telemetry");
}
