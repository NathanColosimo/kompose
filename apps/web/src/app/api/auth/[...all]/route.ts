import { auth } from "@kompose/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth.handler);

export const GET = handlers.GET;
export function POST(request: Request) {
  // Bun's `new Request(req, { headers })` breaks route matching inside
  // better-call's router. The @better-auth/expo server plugin uses that
  // pattern to copy expo-origin → origin, which triggers the bug.
  // Workaround: mutate the header in-place so the expo plugin sees origin
  // already set and skips its Request cloning.
  const expoOrigin = request.headers.get("expo-origin");
  if (!request.headers.get("origin") && expoOrigin) {
    request.headers.set("origin", expoOrigin);
  }
  return handlers.POST(request);
}
