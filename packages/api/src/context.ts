import { auth } from "@kompose/auth";
import type { WithEffectContext } from "@orpc/effect";
import type { User } from "better-auth";
import type { NextRequest } from "next/server";
import { type AppServices, appRuntime } from "./runtime";

export async function createContext(req: NextRequest): Promise<Context> {
  const [result, effectContext] = await Promise.all([
    auth.api.getSession({
      headers: req.headers,
      // Leave extending the session to /get-session. The mobile app saves
      // the refreshed cookie from that response only; if an RPC call extended
      // the session first, the app's saved cookie would still expire on its
      // old date and sign the user out.
      query: { disableRefresh: true },
    }),
    appRuntime.context(),
  ]);

  return {
    "effect/context": effectContext,
    user: result?.user,
  };
}

export interface Context extends WithEffectContext<AppServices> {
  user?: User;
}
